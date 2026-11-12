'use strict';
const express = require('express');
const { pool, withTransaction } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { applyStock, lockProducts, broadcastStock } = require('../services/inventory');
const { notifyPerms, notifyUser } = require('../services/notifications');
const { nextDocNo } = require('../utils/docNumber');
const { notFound, conflict, badRequest } = require('../utils/errors');
const realtime = require('../utils/realtime');
const v = require('../utils/validate');

const router = express.Router();
const RECEIVABLE = ['Approved', 'Sent to Supplier', 'Partially Received'];

router.get('/', requirePerm('grn.view'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT g.id, g.grn_number, g.status, g.received_date, g.delivery_note_ref, g.po_id, po.po_number, s.name AS supplier_name,
            ru.full_name AS received_by_name, vu.full_name AS verified_by_name, g.verified_at,
            (SELECT COALESCE(SUM(quantity_delivered),0) FROM goods_received_items i WHERE i.grn_id = g.id) AS qty_delivered,
            (SELECT COALESCE(SUM(quantity_accepted),0) FROM goods_received_items i WHERE i.grn_id = g.id) AS qty_accepted,
            (SELECT COALESCE(SUM(quantity_damaged),0) FROM goods_received_items i WHERE i.grn_id = g.id) AS qty_damaged,
            (SELECT COALESCE(SUM(quantity_missing),0) FROM goods_received_items i WHERE i.grn_id = g.id) AS qty_missing
       FROM goods_received_notes g JOIN purchase_orders po ON po.id = g.po_id JOIN suppliers s ON s.id = po.supplier_id
       JOIN users ru ON ru.id = g.received_by LEFT JOIN users vu ON vu.id = g.verified_by ORDER BY g.id DESC`);
  res.json(rows);
});

router.get('/:id', requirePerm('grn.view'), async (req, res) => {
  const [[g]] = await pool.query(
    `SELECT g.*, po.po_number, po.status AS po_status, s.name AS supplier_name, ru.full_name AS received_by_name, vu.full_name AS verified_by_name
       FROM goods_received_notes g JOIN purchase_orders po ON po.id = g.po_id JOIN suppliers s ON s.id = po.supplier_id
       JOIN users ru ON ru.id = g.received_by LEFT JOIN users vu ON vu.id = g.verified_by WHERE g.id = ?`, [Number(req.params.id)]);
  if (!g) throw notFound('GRN not found');
  const [items] = await pool.query(
    `SELECT i.*, p.sku, p.name, poi.quantity_ordered, poi.quantity_received AS po_received_now
       FROM goods_received_items i JOIN products p ON p.id = i.product_id JOIN purchase_order_items poi ON poi.id = i.po_item_id WHERE i.grn_id = ? ORDER BY i.id`, [g.id]);
  res.json({ ...g, items });
});

/**
 * Step 1-5 of the receiving workflow: staff record what physically arrived against a PO.
 * This only creates a DRAFT GRN - it does NOT change stock. Stock changes at verification.
 */
router.post('/', requirePerm('grn.create'), async (req, res) => {
  const b = req.body;
  const poId = v.int(b.poId, 'Purchase order', { required: true, min: 1 });
  const receivedDate = v.date(b.receivedDate, 'Received date') || new Date().toISOString().slice(0, 10);
  const deliveryRef = v.str(b.deliveryNoteRef, 'Delivery note reference', { max: 80 });
  const deliveredBy = v.str(b.deliveredByName, 'Delivered by', { max: 120 });
  const notes = v.str(b.notes, 'Notes', { max: 2000 });
  const lines = v.lines(b.items, 'Received items');

  const result = await withTransaction(async (conn) => {
    const [[po]] = await conn.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [poId]);
    if (!po) throw notFound('Purchase order not found');
    if (!RECEIVABLE.includes(po.status)) throw conflict(`Goods cannot be received against a purchase order that is "${po.status}".`);
    const [[pending]] = await conn.query("SELECT grn_number FROM goods_received_notes WHERE po_id = ? AND status = 'Draft' LIMIT 1", [poId]);
    if (pending) throw conflict(`GRN ${pending.grn_number} for this order is still awaiting verification. Verify or cancel it first.`);

    const [poItems] = await conn.query('SELECT * FROM purchase_order_items WHERE po_id = ?', [poId]);
    const byId = new Map(poItems.map((i) => [i.id, i]));
    const clean = []; let anything = false;
    for (const l of lines) {
      const poItemId = v.int(l.poItemId, 'PO line', { required: true, min: 1 });
      const it = byId.get(poItemId);
      if (!it) throw badRequest('A received line does not belong to this purchase order');
      const delivered = v.int(l.quantityDelivered ?? 0, 'Delivered quantity', { max: 1000000 });
      const damaged = v.int(l.quantityDamaged ?? 0, 'Damaged quantity', { max: 1000000 });
      const outstanding = it.quantity_ordered - it.quantity_received;
      if (damaged > delivered) throw badRequest('Damaged quantity cannot exceed the delivered quantity');
      if (delivered > outstanding) throw badRequest(`Delivered quantity (${delivered}) exceeds the outstanding quantity (${outstanding}) for a line. Refuse the surplus goods or raise a new order.`);
      if (delivered > 0) anything = true;
      clean.push({ it, delivered, damaged, accepted: delivered - damaged, missing: outstanding - delivered, remarks: v.str(l.remarks, 'Remarks', { max: 255 }) });
    }
    if (!anything) throw badRequest('Enter the delivered quantity for at least one line');

    const grnNumber = await nextDocNo(conn, 'GRN');
    const [g] = await conn.query(
      `INSERT INTO goods_received_notes (grn_number, po_id, received_date, delivery_note_ref, delivered_by_name, received_by, notes) VALUES (?,?,?,?,?,?,?)`,
      [grnNumber, poId, receivedDate, deliveryRef, deliveredBy, req.user.id, notes]);
    for (const c of clean) {
      await conn.query(
        `INSERT INTO goods_received_items (grn_id, po_item_id, product_id, quantity_delivered, quantity_damaged, quantity_accepted, quantity_missing, remarks) VALUES (?,?,?,?,?,?,?,?)`,
        [g.insertId, c.it.id, c.it.product_id, c.delivered, c.damaged, c.accepted, c.missing, c.remarks]);
    }
    await audit(conn, req, 'GRN_CREATED', 'goods_received_note', g.insertId, { grnNumber, poNumber: po.po_number });
    const disc = clean.filter((c) => c.damaged > 0 || c.missing > 0).length;
    await notifyPerms(conn, ['grn.verify'], { type: 'grn_pending', severity: disc ? 'warning' : 'info', title: `GRN ${grnNumber} awaiting verification`, message: `Against ${po.po_number}${disc ? ` - ${disc} line(s) with damaged/missing goods` : ''}. Stock is not updated until verified.`, link: `/goods-received?grn=${g.insertId}`, excludeUserId: req.user.id });
    return { id: g.insertId, grnNumber };
  });
  realtime.emit('data:changed', { entity: 'grn' });
  res.status(201).json({ ...result, message: `${result.grnNumber} recorded. Verify it to update stock.` });
});

/**
 * Steps 6-8: confirming the delivery increases PHYSICAL stock (accepted quantity only), updates the PO and writes the audit record,
 * all in ONE transaction with the inventory rows locked.
 */
router.post('/:id/verify', requirePerm('grn.verify'), async (req, res) => {
  const id = Number(req.params.id);
  const touched = [];
  const out = await withTransaction(async (conn) => {
    const [[g]] = await conn.query('SELECT * FROM goods_received_notes WHERE id = ? FOR UPDATE', [id]);
    if (!g) throw notFound('GRN not found');
    if (g.status !== 'Draft') throw conflict(`This GRN is already ${g.status.toLowerCase()}. Stock was not changed again.`);
    const [[po]] = await conn.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [g.po_id]);
    if (!RECEIVABLE.includes(po.status)) throw conflict(`The purchase order is "${po.status}" and can no longer receive goods.`);

    const [items] = await conn.query('SELECT * FROM goods_received_items WHERE grn_id = ? ORDER BY product_id', [id]);
    await lockProducts(conn, items.map((i) => i.product_id));
    let damaged = 0; let missing = 0;
    for (const it of items) {
      const [[poi]] = await conn.query('SELECT * FROM purchase_order_items WHERE id = ? FOR UPDATE', [it.po_item_id]);
      if (it.quantity_accepted > poi.quantity_ordered - poi.quantity_received) throw conflict('Quantities no longer match the purchase order (it changed since the GRN was recorded). Cancel this GRN and record it again.');
      if (it.quantity_accepted > 0) {
        await applyStock(conn, it.product_id, { dPhysical: it.quantity_accepted, type: 'GRN_RECEIPT', refType: 'goods_received_note', refId: id, refNo: g.grn_number, notes: `Received against ${po.po_number}`, userId: req.user.id });
        await conn.query('UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE id = ?', [it.quantity_accepted, poi.id]);
        touched.push(it.product_id);
      }
      damaged += it.quantity_damaged;
    }
    const [[left]] = await conn.query('SELECT COALESCE(SUM(quantity_ordered - quantity_received),0) AS n, COALESCE(SUM(quantity_received),0) AS r FROM purchase_order_items WHERE po_id = ?', [po.id]);
    const newStatus = left.n === 0 ? 'Fully Received' : 'Partially Received';
    await conn.query('UPDATE purchase_orders SET status = ?, fully_received_at = ? WHERE id = ?', [newStatus, left.n === 0 ? new Date() : null, po.id]);
    await conn.query("UPDATE goods_received_notes SET status = 'Verified', verified_by = ?, verified_at = NOW() WHERE id = ?", [req.user.id, id]);
    missing = items.reduce((a, i) => a + i.quantity_missing, 0);
    await audit(conn, req, 'GRN_VERIFIED', 'goods_received_note', id, { grnNumber: g.grn_number, poNumber: po.po_number, poStatus: newStatus, damaged, missing });
    await notifyPerms(conn, ['po.create', 'po.view'], { type: 'goods_received', severity: 'success', title: `Goods received: ${g.grn_number}`, message: `${po.po_number} is now ${newStatus}.`, link: `/goods-received?grn=${id}`, excludeUserId: req.user.id });
    if (damaged > 0 || (missing > 0 && newStatus !== 'Fully Received')) {
      await notifyPerms(conn, ['po.create'], { type: 'delivery_discrepancy', severity: 'warning', title: `Delivery discrepancy on ${po.po_number}`, message: `${damaged} damaged and ${missing} still outstanding after ${g.grn_number}.`, link: `/procurement?po=${po.id}`, excludeUserId: req.user.id });
    }
    return { grnNumber: g.grn_number, poStatus: newStatus };
  });
  realtime.emit('data:changed', { entity: 'grn' });
  realtime.emit('data:changed', { entity: 'purchase_orders' });
  await broadcastStock(touched);
  res.json({ ...out, message: `${out.grnNumber} verified. Stock updated; order is ${out.poStatus}.` });
});

router.post('/:id/cancel', requirePerm('grn.create', 'grn.verify'), async (req, res) => {
  const id = Number(req.params.id);
  await withTransaction(async (conn) => {
    const [[g]] = await conn.query('SELECT * FROM goods_received_notes WHERE id = ? FOR UPDATE', [id]);
    if (!g) throw notFound('GRN not found');
    if (g.status !== 'Draft') throw conflict('Only a GRN that has not been verified can be cancelled.');
    await conn.query("UPDATE goods_received_notes SET status = 'Cancelled' WHERE id = ?", [id]);
    await audit(conn, req, 'GRN_CANCELLED', 'goods_received_note', id, { grnNumber: g.grn_number });
  });
  realtime.emit('data:changed', { entity: 'grn' });
  res.json({ message: 'GRN cancelled' });
});

module.exports = router;
