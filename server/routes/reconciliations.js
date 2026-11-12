'use strict';
const express = require('express');
const { pool, withTransaction } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { applyStock, lockProducts, broadcastStock } = require('../services/inventory');
const { notifyPerms } = require('../services/notifications');
const { nextDocNo } = require('../utils/docNumber');
const { notFound, conflict, badRequest } = require('../utils/errors');
const realtime = require('../utils/realtime');
const v = require('../utils/validate');

const router = express.Router();

router.get('/', requirePerm('reconciliation.view'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*, c.name AS category_name, u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM stock_reconciliation_items i WHERE i.reconciliation_id = r.id) AS item_count,
            (SELECT COUNT(*) FROM stock_reconciliation_items i WHERE i.reconciliation_id = r.id AND i.counted_qty IS NOT NULL) AS counted_count,
            (SELECT COUNT(*) FROM stock_reconciliation_items i WHERE i.reconciliation_id = r.id AND i.status IN ('Variance','Approved','Rejected')) AS variance_count
       FROM stock_reconciliations r LEFT JOIN product_categories c ON c.id = r.category_id JOIN users u ON u.id = r.created_by ORDER BY r.id DESC`);
  res.json(rows);
});

router.get('/:id', requirePerm('reconciliation.view'), async (req, res) => {
  const [[r]] = await pool.query(
    `SELECT r.*, c.name AS category_name, u.full_name AS created_by_name FROM stock_reconciliations r
       LEFT JOIN product_categories c ON c.id = r.category_id JOIN users u ON u.id = r.created_by WHERE r.id = ?`, [Number(req.params.id)]);
  if (!r) throw notFound('Stock count session not found');
  const [items] = await pool.query(
    `SELECT i.*, p.sku, p.name, inv.physical_qty AS current_system_qty, ru.full_name AS resolved_by_name
       FROM stock_reconciliation_items i JOIN products p ON p.id = i.product_id JOIN inventory inv ON inv.product_id = p.id
       LEFT JOIN users ru ON ru.id = i.resolved_by WHERE i.reconciliation_id = ? ORDER BY p.name`, [r.id]);
  res.json({ ...r, items });
});

// Step 1: create a count session; system quantities are snapshotted now.
router.post('/', requirePerm('reconciliation.manage'), async (req, res) => {
  const title = v.str(req.body.title, 'Title', { required: true, min: 3, max: 150 });
  const categoryId = v.int(req.body.categoryId, 'Category', { min: 1 });
  const notes = v.str(req.body.notes, 'Notes', { max: 255 });
  const out = await withTransaction(async (conn) => {
    const [products] = await conn.query(
      `SELECT p.id, i.physical_qty FROM products p JOIN inventory i ON i.product_id = p.id WHERE p.is_active = 1 ${categoryId ? 'AND p.category_id = ?' : ''} ORDER BY p.id`, categoryId ? [categoryId] : []);
    if (!products.length) throw badRequest('There are no active products to count in that selection');
    const sessionNo = await nextDocNo(conn, 'REC');
    const [r] = await conn.query('INSERT INTO stock_reconciliations (session_no, title, category_id, notes, created_by) VALUES (?,?,?,?,?)', [sessionNo, title, categoryId, notes, req.user.id]);
    for (const p of products) await conn.query('INSERT INTO stock_reconciliation_items (reconciliation_id, product_id, system_qty) VALUES (?,?,?)', [r.insertId, p.id, p.physical_qty]);
    await audit(conn, req, 'RECON_CREATED', 'stock_reconciliation', r.insertId, { sessionNo, products: products.length });
    return { id: r.insertId, sessionNo };
  });
  realtime.emit('data:changed', { entity: 'reconciliations' });
  res.status(201).json({ ...out, message: `Count session ${out.sessionNo} created` });
});

// Steps 2-5: enter counted quantities and reasons
router.put('/:id/counts', requirePerm('reconciliation.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const counts = v.lines(req.body.counts, 'Counts', { max: 1000 });
  await withTransaction(async (conn) => {
    const [[r]] = await conn.query('SELECT * FROM stock_reconciliations WHERE id = ? FOR UPDATE', [id]);
    if (!r) throw notFound('Stock count session not found');
    if (r.status !== 'Open') throw conflict(`Counts can only be edited while the session is Open (it is ${r.status}).`);
    for (const c of counts) {
      const itemId = v.int(c.itemId, 'Item', { required: true, min: 1 });
      const counted = c.countedQty === '' || c.countedQty === null || c.countedQty === undefined ? null : v.int(c.countedQty, 'Counted quantity', { max: 10000000 });
      const reason = v.str(c.reason, 'Reason', { max: 255 });
      const [[it]] = await conn.query('SELECT system_qty FROM stock_reconciliation_items WHERE id = ? AND reconciliation_id = ?', [itemId, id]);
      if (!it) throw badRequest('A count line does not belong to this session');
      const status = counted === null ? 'Pending Count' : counted === it.system_qty ? 'Matched' : 'Variance';
      await conn.query('UPDATE stock_reconciliation_items SET counted_qty = ?, reason = ?, status = ? WHERE id = ?', [counted, reason, status, itemId]);
    }
  });
  res.json({ message: 'Counts saved' });
});

// Submit for approval: every line must be counted and every variance needs a reason
router.post('/:id/submit', requirePerm('reconciliation.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const out = await withTransaction(async (conn) => {
    const [[r]] = await conn.query('SELECT * FROM stock_reconciliations WHERE id = ? FOR UPDATE', [id]);
    if (!r) throw notFound('Stock count session not found');
    if (r.status !== 'Open') throw conflict(`This session is already ${r.status}.`);
    const [items] = await conn.query('SELECT * FROM stock_reconciliation_items WHERE reconciliation_id = ?', [id]);
    const uncounted = items.filter((i) => i.counted_qty === null);
    if (uncounted.length) throw badRequest(`${uncounted.length} product(s) have not been counted yet.`);
    const noReason = items.filter((i) => i.status === 'Variance' && !i.reason);
    if (noReason.length) throw badRequest(`${noReason.length} variance(s) need a recorded reason.`);
    const variances = items.filter((i) => i.status === 'Variance').length;
    const status = variances ? 'Submitted' : 'Completed';
    await conn.query(`UPDATE stock_reconciliations SET status = ?, submitted_at = NOW(), completed_at = ${variances ? 'NULL' : 'NOW()'} WHERE id = ?`, [status, id]);
    await audit(conn, req, 'RECON_SUBMITTED', 'stock_reconciliation', id, { sessionNo: r.session_no, variances });
    if (variances) await notifyPerms(conn, ['reconciliation.approve'], { type: 'stock_discrepancy', severity: 'warning', title: `Stock discrepancies in ${r.session_no}`, message: `${variances} product(s) differ from the system. Review and approve adjustments.`, link: `/reconciliation?id=${id}`, excludeUserId: req.user.id });
    return { status, variances };
  });
  realtime.emit('data:changed', { entity: 'reconciliations' });
  res.json({ ...out, message: out.variances ? `Submitted - ${out.variances} discrepancy(ies) await approval` : 'All counts match - session completed' });
});

/**
 * Approve or reject one variance. Approval posts an ADJUSTMENT to the ledger for (counted - snapshot),
 * applied to the CURRENT physical quantity so sales/receipts made during the count are preserved.
 */
router.post('/:id/resolve', requirePerm('reconciliation.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const itemId = v.int(req.body.itemId, 'Item', { required: true, min: 1 });
  const action = v.oneOf(req.body.action, 'Action', ['approve', 'reject'], { required: true });
  const note = v.str(req.body.note, 'Note', { max: 255 });
  const touched = [];
  const out = await withTransaction(async (conn) => {
    const [[r]] = await conn.query('SELECT * FROM stock_reconciliations WHERE id = ? FOR UPDATE', [id]);
    if (!r) throw notFound('Stock count session not found');
    if (r.status !== 'Submitted') throw conflict('Adjustments can only be approved after the count has been submitted.');
    const [[it]] = await conn.query('SELECT * FROM stock_reconciliation_items WHERE id = ? AND reconciliation_id = ? FOR UPDATE', [itemId, id]);
    if (!it) throw notFound('Count line not found');
    if (it.status !== 'Variance') throw conflict(`This line is already ${it.status.toLowerCase()}.`);
    if (action === 'approve') {
      const delta = it.counted_qty - it.system_qty;
      await lockProducts(conn, [it.product_id]);
      await applyStock(conn, it.product_id, { dPhysical: delta, type: 'ADJUSTMENT', refType: 'stock_reconciliation', refId: id, refNo: r.session_no, notes: it.reason, userId: req.user.id });
      await conn.query(
        'INSERT INTO stock_adjustments (product_id, reconciliation_id, reconciliation_item_id, system_qty, physical_qty, quantity_change, reason, approved_by) VALUES (?,?,?,?,?,?,?,?)',
        [it.product_id, id, it.id, it.system_qty, it.counted_qty, delta, it.reason, req.user.id]);
      touched.push(it.product_id);
    }
    await conn.query('UPDATE stock_reconciliation_items SET status = ?, resolved_by = ?, resolved_at = NOW(), resolution_note = ? WHERE id = ?', [action === 'approve' ? 'Approved' : 'Rejected', req.user.id, note, itemId]);
    await audit(conn, req, action === 'approve' ? 'STOCK_ADJUSTED' : 'ADJUSTMENT_REJECTED', 'product', it.product_id, { sessionNo: r.session_no, system: it.system_qty, counted: it.counted_qty, reason: it.reason, note });
    const [[left]] = await conn.query("SELECT COUNT(*) AS n FROM stock_reconciliation_items WHERE reconciliation_id = ? AND status = 'Variance'", [id]);
    if (left.n === 0) await conn.query("UPDATE stock_reconciliations SET status = 'Completed', completed_at = NOW() WHERE id = ?", [id]);
    return { completed: left.n === 0 };
  });
  realtime.emit('data:changed', { entity: 'reconciliations' });
  await broadcastStock(touched);
  res.json({ ...out, message: action === 'approve' ? 'Adjustment approved and stock updated' : 'Adjustment rejected - stock left unchanged' });
});

router.post('/:id/cancel', requirePerm('reconciliation.manage'), async (req, res) => {
  const id = Number(req.params.id);
  await withTransaction(async (conn) => {
    const [[r]] = await conn.query('SELECT * FROM stock_reconciliations WHERE id = ? FOR UPDATE', [id]);
    if (!r) throw notFound('Stock count session not found');
    if (r.status !== 'Open') throw conflict('Only an Open session can be cancelled.');
    await conn.query("UPDATE stock_reconciliations SET status = 'Cancelled' WHERE id = ?", [id]);
    await audit(conn, req, 'RECON_CANCELLED', 'stock_reconciliation', id, { sessionNo: r.session_no });
  });
  realtime.emit('data:changed', { entity: 'reconciliations' });
  res.json({ message: 'Session cancelled' });
});

module.exports = router;
