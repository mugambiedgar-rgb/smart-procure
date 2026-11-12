'use strict';
const express = require('express');
const { pool, withTransaction } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { supplierPerformance } = require('../services/supplierStats');
const { notFound, conflict } = require('../utils/errors');
const realtime = require('../utils/realtime');
const v = require('../utils/validate');

const router = express.Router();

router.get('/', requirePerm('suppliers.view', 'po.view'), async (_req, res) => res.json(await supplierPerformance()));

router.get('/:id', requirePerm('suppliers.view', 'po.view'), async (req, res) => {
  const id = Number(req.params.id);
  const [perf] = await supplierPerformance(id);
  if (!perf) throw notFound('Supplier not found');
  const [[detail]] = await pool.query('SELECT address FROM suppliers WHERE id = ?', [id]);
  const [products] = await pool.query(
    `SELECT sp.id, sp.product_id, p.sku, p.name, p.is_active, sp.supplier_sku, sp.unit_price, sp.lead_time_days
       FROM supplier_products sp JOIN products p ON p.id = sp.product_id WHERE sp.supplier_id = ? ORDER BY p.name`, [id]);
  const [history] = await pool.query(
    `SELECT po.id, po.po_number, po.status, po.order_date, po.expected_date, po.total_amount,
            (SELECT MIN(g.received_date) FROM goods_received_notes g WHERE g.po_id = po.id AND g.status = 'Verified') AS first_received
       FROM purchase_orders po WHERE po.supplier_id = ? ORDER BY po.id DESC LIMIT 100`, [id]);
  res.json({ ...perf, address: detail.address, products, history });
});

function parse(b) {
  return {
    name: v.str(b.name, 'Supplier name', { required: true, min: 2, max: 150 }),
    contact: v.str(b.contactPerson, 'Contact person', { max: 120 }),
    email: v.email(b.email, 'Email'),
    phone: v.str(b.phone, 'Phone', { max: 30 }),
    address: v.str(b.address, 'Address', { max: 255 }),
    city: v.str(b.city, 'City', { max: 80 }),
    country: v.str(b.country, 'Country', { max: 80 }),
    terms: v.str(b.paymentTerms, 'Payment terms', { max: 60 }),
  };
}

router.post('/', requirePerm('suppliers.manage'), async (req, res) => {
  const s = parse(req.body);
  const id = await withTransaction(async (conn) => {
    const [[{ n }]] = await conn.query('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM suppliers FOR UPDATE');
    const code = `SUP-${String(n).padStart(3, '0')}`;
    const [r] = await conn.query(
      'INSERT INTO suppliers (code, name, contact_person, email, phone, address, city, country, payment_terms) VALUES (?,?,?,?,?,?,?,?,?)',
      [code, s.name, s.contact, s.email, s.phone, s.address, s.city, s.country, s.terms]);
    await audit(conn, req, 'SUPPLIER_CREATED', 'supplier', r.insertId, { name: s.name, code });
    return r.insertId;
  });
  realtime.emit('data:changed', { entity: 'suppliers' });
  res.status(201).json({ id, message: 'Supplier registered' });
});

router.put('/:id', requirePerm('suppliers.manage'), async (req, res) => {
  const id = Number(req.params.id); const s = parse(req.body);
  const isActive = v.bool(req.body.isActive, true);
  if (!isActive) {
    const [[open]] = await pool.query("SELECT COUNT(*) AS n FROM purchase_orders WHERE supplier_id = ? AND status IN ('Draft','Pending Approval','Approved','Sent to Supplier','Partially Received')", [id]);
    if (open.n > 0) throw conflict('This supplier has open purchase orders and cannot be deactivated yet.');
  }
  const [r] = await pool.query(
    'UPDATE suppliers SET name=?, contact_person=?, email=?, phone=?, address=?, city=?, country=?, payment_terms=?, is_active=? WHERE id=?',
    [s.name, s.contact, s.email, s.phone, s.address, s.city, s.country, s.terms, isActive, id]);
  if (!r.affectedRows) throw notFound('Supplier not found');
  await audit(pool, req, 'SUPPLIER_UPDATED', 'supplier', id, { isActive });
  realtime.emit('data:changed', { entity: 'suppliers' });
  res.json({ message: 'Supplier updated' });
});

// Supplied products (catalogue of what each supplier sells, with agreed unit price)
router.put('/:id/products', requirePerm('suppliers.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const productId = v.int(req.body.productId, 'Product', { required: true, min: 1 });
  const unitPrice = v.money(req.body.unitPrice, 'Unit price', { required: true });
  const leadTime = v.int(req.body.leadTimeDays, 'Lead time', { max: 365 });
  const supplierSku = v.str(req.body.supplierSku, 'Supplier SKU', { max: 60 });
  await pool.query(
    `INSERT INTO supplier_products (supplier_id, product_id, supplier_sku, unit_price, lead_time_days) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE supplier_sku = VALUES(supplier_sku), unit_price = VALUES(unit_price), lead_time_days = VALUES(lead_time_days)`,
    [id, productId, supplierSku, unitPrice, leadTime]);
  await audit(pool, req, 'SUPPLIER_PRODUCT_SET', 'supplier', id, { productId, unitPrice });
  res.json({ message: 'Supplied product saved' });
});
router.delete('/:id/products/:productId', requirePerm('suppliers.manage'), async (req, res) => {
  await pool.query('DELETE FROM supplier_products WHERE supplier_id = ? AND product_id = ?', [Number(req.params.id), Number(req.params.productId)]);
  await audit(pool, req, 'SUPPLIER_PRODUCT_REMOVED', 'supplier', req.params.id, { productId: req.params.productId });
  res.json({ message: 'Removed' });
});

module.exports = router;
