'use strict';
const express = require('express');
const PDFDocument = require('pdfkit');
const { pool, withTransaction } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { notifyPerms, notifyUser } = require('../services/notifications');
const { nextDocNo } = require('../utils/docNumber');
const { notFound, conflict, badRequest } = require('../utils/errors');
const realtime = require('../utils/realtime');
const v = require('../utils/validate');

const router = express.Router();
const OPEN = ['Draft', 'Pending Approval', 'Approved', 'Sent to Supplier', 'Partially Received'];
const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- helpers
async function cleanItems(conn, supplierId, rawItems) {
  const items = v.lines(rawItems);
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const productId = v.int(it.productId, 'Product', { required: true, min: 1 });
    if (seen.has(productId)) throw badRequest('Each product can only appear once per purchase order. Combine the quantities instead.');
    seen.add(productId);
    const quantity = v.int(it.quantity, 'Quantity', { required: true, min: 1, max: 1000000 });
    const [[p]] = await conn.query(
      `SELECT p.id, p.name, p.is_active, sp.unit_price AS supplier_price FROM products p
         LEFT JOIN supplier_products sp ON sp.product_id = p.id AND sp.supplier_id = ? WHERE p.id = ?`, [supplierId, productId]);
    if (!p) throw badRequest(`Product #${productId} does not exist`);
    if (!p.is_active) throw badRequest(`${p.name} is deactivated and cannot be ordered`);
    const unitPrice = v.money(it.unitPrice ?? p.supplier_price, `Unit price for ${p.name}`, { required: true });
    out.push({ productId, quantity, unitPrice });
  }
  const total = Math.round(out.reduce((a, i) => a + i.quantity * i.unitPrice, 0) * 100) / 100;
  return { items: out, total };
}

/** Open POs that overlap (same product) with the one being created. */
async function findSimilar(conn, supplierId, productIds, excludePoId = 0) {
  const [rows] = await conn.query(
    `SELECT po.id, po.po_number, po.status, po.order_date, po.supplier_id, s.name AS supplier_name,
            GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS products
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
       JOIN purchase_order_items i ON i.po_id = po.id JOIN products p ON p.id = i.product_id
      WHERE po.status IN (?) AND po.id <> ? AND i.product_id IN (?)
      GROUP BY po.id ORDER BY po.id DESC LIMIT 10`, [OPEN, excludePoId, productIds]);
  return rows.map((r) => ({ ...r, same_supplier: r.supplier_id === supplierId }));
}

async function lockPO(conn, id) {
  const [[po]] = await conn.query('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE', [id]);
  if (!po) throw notFound('Purchase order not found');
  return po;
}
async function writeItems(conn, poId, items) {
  await conn.query('DELETE FROM purchase_order_items WHERE po_id = ?', [poId]);
  for (const it of items) {
    await conn.query('INSERT INTO purchase_order_items (po_id, product_id, quantity_ordered, unit_price) VALUES (?,?,?,?)', [poId, it.productId, it.quantity, it.unitPrice]);
  }
}

// ---------------------------------------------------------------- reads
router.get('/', requirePerm('po.view'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT po.id, po.po_number, po.status, po.order_date, po.expected_date, po.total_amount, po.supplier_id, s.name AS supplier_name,
            u.full_name AS created_by_name, po.created_at,
            (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = po.id) AS item_count,
            (SELECT COALESCE(SUM(quantity_ordered),0) FROM purchase_order_items i WHERE i.po_id = po.id) AS qty_ordered,
            (SELECT COALESCE(SUM(quantity_received),0) FROM purchase_order_items i WHERE i.po_id = po.id) AS qty_received,
            (po.status IN ('Approved','Sent to Supplier','Partially Received') AND po.expected_date < CURDATE()) AS is_overdue
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users u ON u.id = po.created_by ORDER BY po.id DESC`);
  res.json(rows);
});

// Orders a warehouse user can currently receive goods against
router.get('/receivable', requirePerm('grn.view', 'grn.create'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT po.id, po.po_number, po.status, po.expected_date, s.name AS supplier_name,
            (SELECT COALESCE(SUM(quantity_ordered - quantity_received),0) FROM purchase_order_items i WHERE i.po_id = po.id) AS qty_outstanding
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.status IN ('Approved','Sent to Supplier','Partially Received') ORDER BY po.expected_date, po.id`);
  res.json(rows);
});

router.get('/:id', requirePerm('po.view', 'grn.view'), async (req, res) => {
  const id = Number(req.params.id);
  const [[po]] = await pool.query(
    `SELECT po.*, s.name AS supplier_name, s.email AS supplier_email, s.phone AS supplier_phone, s.address AS supplier_address,
            s.city AS supplier_city, s.country AS supplier_country, cu.full_name AS created_by_name, au.full_name AS approved_by_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users cu ON cu.id = po.created_by LEFT JOIN users au ON au.id = po.approved_by WHERE po.id = ?`, [id]);
  if (!po) throw notFound('Purchase order not found');
  const [items] = await pool.query(
    `SELECT i.*, p.sku, p.name, (i.quantity_ordered - i.quantity_received) AS quantity_outstanding FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = ? ORDER BY i.id`, [id]);
  const [grns] = await pool.query(
    `SELECT g.id, g.grn_number, g.status, g.received_date, u.full_name AS received_by_name FROM goods_received_notes g JOIN users u ON u.id = g.received_by WHERE g.po_id = ? ORDER BY g.id DESC`, [id]);
  res.json({ ...po, items, grns });
});

// ---------------------------------------------------------------- duplicate pre-check (UI calls this before submit)
router.post('/check-duplicates', requirePerm('po.create'), async (req, res) => {
  const supplierId = v.int(req.body.supplierId, 'Supplier', { required: true, min: 1 });
  const ids = (req.body.items || []).map((i) => Number(i.productId)).filter(Boolean);
  const matches = ids.length ? await findSimilar(pool, supplierId, ids, Number(req.body.excludeId) || 0) : [];
  res.json({ duplicates: matches });
});

// ---------------------------------------------------------------- create / edit
router.post('/', requirePerm('po.create'), async (req, res) => {
  const b = req.body;
  const supplierId = v.int(b.supplierId, 'Supplier', { required: true, min: 1 });
  const orderDate = v.date(b.orderDate, 'Order date') || new Date().toISOString().slice(0, 10);
  const expectedDate = v.date(b.expectedDate, 'Expected delivery date', { required: true });
  if (expectedDate < orderDate) throw badRequest('Expected delivery date cannot be before the order date');
  const notes = v.str(b.notes, 'Notes', { max: 2000 });
  const idem = v.str(b.idempotencyKey, 'Idempotency key', { max: 64 });
  const submit = !!b.submit;

  const result = await withTransaction(async (conn) => {
    if (idem) { // double-click / retry protection: same key returns the order already created
      const [[existing]] = await conn.query('SELECT id, po_number FROM purchase_orders WHERE idempotency_key = ?', [idem]);
      if (existing) return { id: existing.id, poNumber: existing.po_number, duplicateRequest: true };
    }
    const [[sup]] = await conn.query('SELECT id, is_active FROM suppliers WHERE id = ? FOR UPDATE', [supplierId]); // serialises concurrent creates per supplier
    if (!sup) throw badRequest('Supplier does not exist');
    if (!sup.is_active) throw badRequest('This supplier is inactive');
    const { items, total } = await cleanItems(conn, supplierId, b.items);

    const similar = await findSimilar(conn, supplierId, items.map((i) => i.productId));
    if (similar.length && !b.confirmDuplicate) {
      throw conflict('Similar active purchase orders already exist. Please review them and confirm if you still want to create this order.', { code: 'DUPLICATE_WARNING', duplicates: similar });
    }

    let requisitionId = null;
    if (b.requisitionId) {
      const [[rq]] = await conn.query('SELECT id, status FROM purchase_requisitions WHERE id = ? FOR UPDATE', [Number(b.requisitionId)]);
      if (!rq) throw badRequest('Requisition not found');
      if (rq.status !== 'Approved') throw conflict('Only an approved requisition can be converted to a purchase order.');
      requisitionId = rq.id;
    }

    const poNumber = await nextDocNo(conn, 'PO');
    const status = submit ? 'Pending Approval' : 'Draft';
    const [r] = await conn.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, requisition_id, status, order_date, expected_date, total_amount, notes, idempotency_key, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`, [poNumber, supplierId, requisitionId, status, orderDate, expectedDate, total, notes, idem, req.user.id]);
    await writeItems(conn, r.insertId, items);
    if (requisitionId) await conn.query("UPDATE purchase_requisitions SET status = 'Converted' WHERE id = ?", [requisitionId]);
    await audit(conn, req, 'PO_CREATED', 'purchase_order', r.insertId, { poNumber, total, status, duplicateConfirmed: !!(similar.length && b.confirmDuplicate) });
    if (similar.length && b.confirmDuplicate) {
      await notifyPerms(conn, ['po.approve', 'po.create'], { type: 'duplicate_order', severity: 'warning', title: `Duplicate-order warning overridden: ${poNumber}`, message: `${req.user.full_name} created ${poNumber} although ${similar.length} similar active order(s) exist (${similar.map((s) => s.po_number).join(', ')}).`, link: `/procurement?po=${r.insertId}`, excludeUserId: req.user.id });
    }
    if (submit) await notifyPerms(conn, ['po.approve'], { type: 'po_pending_approval', severity: 'info', title: `New purchase order awaiting approval: ${poNumber}`, message: `Total ${fmt(total)} - ${items.length} product(s).`, link: `/procurement?po=${r.insertId}`, excludeUserId: req.user.id });
    return { id: r.insertId, poNumber };
  });
  realtime.emit('data:changed', { entity: 'purchase_orders' });
  res.status(result.duplicateRequest ? 200 : 201).json({ ...result, message: result.duplicateRequest ? 'This purchase order was already created.' : `Purchase order ${result.poNumber} created` });
});

router.put('/:id', requirePerm('po.create'), async (req, res) => {
  const id = Number(req.params.id); const b = req.body;
  const expectedDate = v.date(b.expectedDate, 'Expected delivery date', { required: true });
  const notes = v.str(b.notes, 'Notes', { max: 2000 });
  await withTransaction(async (conn) => {
    const po = await lockPO(conn, id);
    if (!['Draft', 'Pending Approval'].includes(po.status)) throw conflict(`Only Draft or Pending Approval orders can be edited (this one is ${po.status}).`);
    if (expectedDate < String(po.order_date).slice(0, 10)) throw badRequest('Expected delivery date cannot be before the order date');
    const { items, total } = await cleanItems(conn, po.supplier_id, b.items);
    await writeItems(conn, id, items);
    await conn.query('UPDATE purchase_orders SET expected_date = ?, notes = ?, total_amount = ?, rejection_reason = NULL WHERE id = ?', [expectedDate, notes, total, id]);
    await audit(conn, req, 'PO_EDITED', 'purchase_order', id, { poNumber: po.po_number, total });
  });
  realtime.emit('data:changed', { entity: 'purchase_orders' });
  res.json({ message: 'Purchase order updated' });
});

// ---------------------------------------------------------------- workflow
async function transition(req, res, { from, to, perm, fn, message }) {
  const id = Number(req.params.id);
  const out = await withTransaction(async (conn) => {
    const po = await lockPO(conn, id);
    if (!from.includes(po.status)) throw conflict(`Cannot do this: the order is "${po.status}" (allowed from: ${from.join(', ')}).`);
    await conn.query('UPDATE purchase_orders SET status = ? WHERE id = ?', [to, id]);
    if (fn) await fn(conn, po);
    return po;
  });
  realtime.emit('data:changed', { entity: 'purchase_orders' });
  res.json({ message: message(out) });
}

router.post('/:id/submit', requirePerm('po.create'), (req, res) => transition(req, res, {
  from: ['Draft'], to: 'Pending Approval', message: (po) => `${po.po_number} submitted for approval`,
  fn: async (conn, po) => {
    await audit(conn, req, 'PO_SUBMITTED', 'purchase_order', po.id, { poNumber: po.po_number });
    await notifyPerms(conn, ['po.approve'], { type: 'po_pending_approval', severity: 'info', title: `Purchase order awaiting approval: ${po.po_number}`, message: `Total ${fmt(po.total_amount)}.`, link: `/procurement?po=${po.id}`, excludeUserId: req.user.id });
  },
}));

router.post('/:id/approve', requirePerm('po.approve'), (req, res) => transition(req, res, {
  from: ['Pending Approval'], to: 'Approved', message: (po) => `${po.po_number} approved`,
  fn: async (conn, po) => {
    await conn.query('UPDATE purchase_orders SET approved_by = ?, approved_at = NOW(), rejection_reason = NULL WHERE id = ?', [req.user.id, po.id]);
    await audit(conn, req, 'PO_APPROVED', 'purchase_order', po.id, { poNumber: po.po_number });
    await notifyUser(conn, po.created_by, { type: 'po_approved', severity: 'success', title: `Purchase order approved: ${po.po_number}`, message: 'You can now send it to the supplier.', link: `/procurement?po=${po.id}` });
  },
}));

router.post('/:id/reject', requirePerm('po.approve'), async (req, res) => {
  const reason = v.str(req.body.reason, 'Rejection reason', { required: true, min: 3, max: 255 });
  return transition(req, res, {
    from: ['Pending Approval'], to: 'Draft', message: (po) => `${po.po_number} rejected and returned to Draft`,
    fn: async (conn, po) => {
      await conn.query('UPDATE purchase_orders SET rejection_reason = ? WHERE id = ?', [reason, po.id]);
      await audit(conn, req, 'PO_REJECTED', 'purchase_order', po.id, { poNumber: po.po_number, reason });
      await notifyUser(conn, po.created_by, { type: 'po_rejected', severity: 'warning', title: `Purchase order rejected: ${po.po_number}`, message: reason, link: `/procurement?po=${po.id}` });
    },
  });
});

router.post('/:id/send', requirePerm('po.create'), (req, res) => transition(req, res, {
  from: ['Approved'], to: 'Sent to Supplier', message: (po) => `${po.po_number} marked as sent to the supplier`,
  fn: async (conn, po) => {
    await conn.query('UPDATE purchase_orders SET sent_at = NOW() WHERE id = ?', [po.id]);
    await audit(conn, req, 'PO_SENT', 'purchase_order', po.id, { poNumber: po.po_number });
    await notifyPerms(conn, ['grn.create'], { type: 'incoming_delivery', severity: 'info', title: `Incoming delivery expected: ${po.po_number}`, message: `Expected ${String(po.expected_date).slice(0, 10)}. Record a GRN when the goods arrive.`, link: '/goods-received', excludeUserId: req.user.id });
  },
}));

router.post('/:id/cancel', requirePerm('po.create'), async (req, res) => {
  const reason = v.str(req.body.reason, 'Cancellation reason', { required: true, min: 3, max: 255 });
  return transition(req, res, {
    from: ['Draft', 'Pending Approval', 'Approved', 'Sent to Supplier'], to: 'Cancelled', message: (po) => `${po.po_number} cancelled`,
    fn: async (conn, po) => {
      const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM goods_received_notes WHERE po_id = ? AND status = 'Draft'", [po.id]);
      if (n > 0) throw conflict('This order has a draft GRN. Cancel the GRN first.');
      await conn.query('UPDATE purchase_orders SET cancel_reason = ?, cancelled_at = NOW() WHERE id = ?', [reason, po.id]);
      await audit(conn, req, 'PO_CANCELLED', 'purchase_order', po.id, { poNumber: po.po_number, reason });
      if (po.created_by !== req.user.id) await notifyUser(conn, po.created_by, { type: 'po_cancelled', severity: 'warning', title: `Purchase order cancelled: ${po.po_number}`, message: reason, link: `/procurement?po=${po.id}` });
    },
  });
});

// ---------------------------------------------------------------- printable PO (PDF)
router.get('/:id/pdf', requirePerm('po.view'), async (req, res) => {
  const id = Number(req.params.id);
  const [[po]] = await pool.query(
    `SELECT po.*, s.name AS supplier_name, s.contact_person, s.email AS supplier_email, s.phone AS supplier_phone, s.address AS supplier_address, s.city AS supplier_city, s.country AS supplier_country,
            cu.full_name AS created_by_name, au.full_name AS approved_by_name
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users cu ON cu.id = po.created_by LEFT JOIN users au ON au.id = po.approved_by WHERE po.id = ?`, [id]);
  if (!po) throw notFound('Purchase order not found');
  const [items] = await pool.query('SELECT i.*, p.sku, p.name FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = ? ORDER BY i.id', [id]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${po.po_number}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  doc.fontSize(20).fillColor('#0b1220').text('SmartProcure', { continued: true }).fontSize(10).fillColor('#64748b').text('   Wholesale Electronics Distribution');
  doc.moveDown(0.5).fontSize(18).fillColor('#0b1220').text('PURCHASE ORDER');
  doc.fontSize(10).fillColor('#334155');
  doc.text(`PO Number: ${po.po_number}`).text(`Status: ${po.status}`).text(`Order date: ${String(po.order_date).slice(0, 10)}`).text(`Expected delivery: ${String(po.expected_date).slice(0, 10)}`);
  doc.moveDown().fontSize(11).fillColor('#0b1220').text('Supplier', { underline: true }).fontSize(10).fillColor('#334155');
  doc.text(po.supplier_name);
  if (po.contact_person) doc.text(`Attn: ${po.contact_person}`);
  const addr = [po.supplier_address, po.supplier_city, po.supplier_country].filter(Boolean).join(', ');
  if (addr) doc.text(addr);
  if (po.supplier_email) doc.text(po.supplier_email);
  if (po.supplier_phone) doc.text(po.supplier_phone);

  let y = doc.moveDown().y + 6;
  const col = { sku: 50, name: 135, qty: 330, price: 395, total: 470 };
  doc.rect(50, y - 4, 495, 18).fill('#0b1220');
  doc.fillColor('#ffffff').fontSize(9);
  doc.text('SKU', col.sku + 4, y, { lineBreak: false }).text('Product', col.name, y, { lineBreak: false }).text('Qty', col.qty, y, { width: 50, align: 'right', lineBreak: false })
    .text('Unit price', col.price, y, { width: 65, align: 'right', lineBreak: false }).text('Line total', col.total, y, { width: 70, align: 'right', lineBreak: false });
  y += 20; doc.fillColor('#1e293b');
  items.forEach((it, idx) => {
    if (y > 740) { doc.addPage(); y = 60; }
    if (idx % 2 === 0) doc.rect(50, y - 3, 495, 16).fill('#f1f5f9').fillColor('#1e293b');
    doc.fontSize(9).text(it.sku, col.sku + 4, y, { width: 80, lineBreak: false }).text(it.name, col.name, y, { width: 190, lineBreak: false, ellipsis: true })
      .text(String(it.quantity_ordered), col.qty, y, { width: 50, align: 'right', lineBreak: false }).text(fmt(it.unit_price), col.price, y, { width: 65, align: 'right', lineBreak: false })
      .text(fmt(it.line_total), col.total, y, { width: 70, align: 'right', lineBreak: false });
    y += 16;
  });
  y += 8; doc.moveTo(330, y).lineTo(545, y).strokeColor('#94a3b8').stroke();
  doc.fontSize(11).fillColor('#0b1220').text('TOTAL', 330, y + 6, { width: 70, lineBreak: false }).text(fmt(po.total_amount), 400, y + 6, { width: 140, align: 'right' });
  if (po.notes) { doc.moveDown(2).fontSize(10).fillColor('#0b1220').text('Notes', 50, doc.y, { underline: true }).fillColor('#334155').text(po.notes, { width: 495 }); }
  doc.moveDown(3).fontSize(9).fillColor('#64748b').text(`Prepared by: ${po.created_by_name}${po.approved_by_name ? `    Approved by: ${po.approved_by_name}` : ''}`, 50);
  doc.text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  doc.end();
});

module.exports = router;
