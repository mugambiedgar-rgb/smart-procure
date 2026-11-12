'use strict';
const express = require('express');
const { pool, withTransaction } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { notifyPerms, notifyUser } = require('../services/notifications');
const { nextDocNo } = require('../utils/docNumber');
const { notFound, conflict, badRequest } = require('../utils/errors');
const realtime = require('../utils/realtime');
const v = require('../utils/validate');

const router = express.Router();

router.get('/', requirePerm('requisitions.view'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*, u.full_name AS requested_by_name, rv.full_name AS reviewed_by_name,
            (SELECT COUNT(*) FROM purchase_requisition_items i WHERE i.requisition_id = r.id) AS item_count,
            (SELECT po.po_number FROM purchase_orders po WHERE po.requisition_id = r.id LIMIT 1) AS po_number
       FROM purchase_requisitions r JOIN users u ON u.id = r.requested_by LEFT JOIN users rv ON rv.id = r.reviewed_by ORDER BY r.id DESC`);
  res.json(rows);
});

router.get('/:id', requirePerm('requisitions.view'), async (req, res) => {
  const [[r]] = await pool.query(
    `SELECT r.*, u.full_name AS requested_by_name, rv.full_name AS reviewed_by_name
       FROM purchase_requisitions r JOIN users u ON u.id = r.requested_by LEFT JOIN users rv ON rv.id = r.reviewed_by WHERE r.id = ?`, [Number(req.params.id)]);
  if (!r) throw notFound('Requisition not found');
  const [items] = await pool.query(
    `SELECT i.*, p.sku, p.name, p.unit_cost, inv.available_qty FROM purchase_requisition_items i
       JOIN products p ON p.id = i.product_id JOIN inventory inv ON inv.product_id = p.id WHERE i.requisition_id = ?`, [r.id]);
  res.json({ ...r, items });
});

router.post('/', requirePerm('requisitions.create'), async (req, res) => {
  const priority = v.oneOf(req.body.priority || 'Normal', 'Priority', ['Low', 'Normal', 'High', 'Urgent'], { required: true });
  const justification = v.str(req.body.justification, 'Justification', { required: true, min: 5, max: 1000 });
  const items = v.lines(req.body.items);
  const seen = new Set();
  const clean = items.map((it) => {
    const productId = v.int(it.productId, 'Product', { required: true, min: 1 });
    if (seen.has(productId)) throw badRequest('Each product can only appear once in a requisition');
    seen.add(productId);
    return { productId, quantity: v.int(it.quantity, 'Quantity', { required: true, min: 1, max: 1000000 }), price: v.money(it.estimatedPrice ?? 0, 'Estimated price') };
  });
  const result = await withTransaction(async (conn) => {
    const reqNumber = await nextDocNo(conn, 'REQ');
    const [r] = await conn.query('INSERT INTO purchase_requisitions (req_number, requested_by, priority, justification) VALUES (?,?,?,?)', [reqNumber, req.user.id, priority, justification]);
    for (const it of clean) {
      await conn.query('INSERT INTO purchase_requisition_items (requisition_id, product_id, quantity, estimated_price) VALUES (?,?,?,?)', [r.insertId, it.productId, it.quantity, it.price]);
    }
    await audit(conn, req, 'REQ_CREATED', 'purchase_requisition', r.insertId, { reqNumber, lines: clean.length });
    await notifyPerms(conn, ['requisitions.approve'], { type: 'requisition', severity: 'info', title: `New purchase requisition ${reqNumber}`, message: `${req.user.full_name} requested ${clean.length} product(s) - priority ${priority}.`, link: '/procurement?tab=requisitions', excludeUserId: req.user.id });
    return { id: r.insertId, reqNumber };
  });
  realtime.emit('data:changed', { entity: 'requisitions' });
  res.status(201).json({ ...result, message: 'Requisition submitted for approval' });
});

async function review(req, res, status) {
  const id = Number(req.params.id);
  const note = v.str(req.body.note, 'Note', { max: 255, required: status === 'Rejected' });
  await withTransaction(async (conn) => {
    const [[r]] = await conn.query('SELECT * FROM purchase_requisitions WHERE id = ? FOR UPDATE', [id]);
    if (!r) throw notFound('Requisition not found');
    if (r.status !== 'Pending') throw conflict(`This requisition has already been ${r.status.toLowerCase()}.`);
    await conn.query('UPDATE purchase_requisitions SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE id = ?', [status, req.user.id, note, id]);
    await audit(conn, req, `REQ_${status.toUpperCase()}`, 'purchase_requisition', id, { reqNumber: r.req_number, note });
    await notifyUser(conn, r.requested_by, {
      type: 'requisition', severity: status === 'Approved' ? 'success' : 'warning',
      title: `Requisition ${r.req_number} ${status.toLowerCase()}`, message: note || null, link: '/procurement?tab=requisitions',
    });
    if (status === 'Approved') {
      await notifyPerms(conn, ['po.create'], { type: 'requisition', severity: 'info', title: `Requisition ${r.req_number} approved`, message: 'Ready to be converted into a purchase order.', link: '/procurement?tab=requisitions', excludeUserId: req.user.id });
    }
  });
  realtime.emit('data:changed', { entity: 'requisitions' });
  res.json({ message: `Requisition ${status.toLowerCase()}` });
}
router.post('/:id/approve', requirePerm('requisitions.approve'), (req, res) => review(req, res, 'Approved'));
router.post('/:id/reject', requirePerm('requisitions.approve'), (req, res) => review(req, res, 'Rejected'));

module.exports = router;
