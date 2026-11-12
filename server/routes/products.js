'use strict';
const express = require('express');
const { pool, withTransaction } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { applyStock, broadcastStock } = require('../services/inventory');
const { notFound, badRequest, conflict } = require('../utils/errors');
const realtime = require('../utils/realtime');
const v = require('../utils/validate');

const router = express.Router();

// Incoming = open purchase-order quantity not yet received. NOT part of available stock.
const INCOMING_SQL = `(SELECT COALESCE(SUM(poi.quantity_ordered - poi.quantity_received), 0)
  FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
  WHERE poi.product_id = p.id AND po.status IN ('Approved','Sent to Supplier','Partially Received'))`;

const SELECT_PRODUCT = `
  SELECT p.id, p.sku, p.name, p.category_id, c.name AS category, p.brand, p.description, p.unit_cost, p.selling_price,
         p.min_stock_level, p.lead_time_days, p.track_serial, p.is_active,
         i.physical_qty, i.reserved_qty, i.available_qty, ${INCOMING_SQL} AS incoming_qty,
         (i.physical_qty * p.unit_cost) AS stock_value,
         CASE WHEN i.available_qty <= 0 THEN 'Out of Stock' WHEN i.available_qty <= p.min_stock_level THEN 'Low Stock' ELSE 'In Stock' END AS stock_status
    FROM products p
    JOIN product_categories c ON c.id = p.category_id
    JOIN inventory i ON i.product_id = p.id`;

router.get('/categories', requirePerm('products.view'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.description, COUNT(p.id) AS product_count FROM product_categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1 GROUP BY c.id ORDER BY c.name`);
  res.json(rows);
});
router.post('/categories', requirePerm('products.manage'), async (req, res) => {
  const name = v.str(req.body.name, 'Category name', { required: true, max: 80 });
  const description = v.str(req.body.description, 'Description', { max: 255 });
  const [r] = await pool.query('INSERT INTO product_categories (name, description) VALUES (?,?)', [name, description]);
  await audit(pool, req, 'CATEGORY_CREATED', 'category', r.insertId, { name });
  res.status(201).json({ id: r.insertId });
});

router.get('/', requirePerm('products.view', 'inventory.view'), async (req, res) => {
  const [rows] = await pool.query(`${SELECT_PRODUCT} ORDER BY p.name`);
  res.json(rows);
});

router.get('/movements', requirePerm('inventory.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  const where = []; const params = [];
  if (req.query.productId) { where.push('t.product_id = ?'); params.push(Number(req.query.productId)); }
  if (req.query.type) { where.push('t.txn_type = ?'); params.push(String(req.query.type)); }
  if (req.query.from) { where.push('t.created_at >= ?'); params.push(`${String(req.query.from).slice(0, 10)} 00:00:00`); }
  if (req.query.to) { where.push('t.created_at <= ?'); params.push(`${String(req.query.to).slice(0, 10)} 23:59:59`); }
  const [rows] = await pool.query(
    `SELECT t.*, p.sku, p.name AS product_name, u.full_name AS performed_by_name
       FROM inventory_transactions t JOIN products p ON p.id = t.product_id LEFT JOIN users u ON u.id = t.performed_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT ${limit}`, params);
  res.json(rows);
});

router.get('/:id', requirePerm('products.view', 'inventory.view'), async (req, res) => {
  const [[p]] = await pool.query(`${SELECT_PRODUCT} WHERE p.id = ?`, [Number(req.params.id)]);
  if (!p) throw notFound('Product not found');
  const [history] = await pool.query(
    `SELECT t.*, u.full_name AS performed_by_name FROM inventory_transactions t LEFT JOIN users u ON u.id = t.performed_by
      WHERE t.product_id = ? ORDER BY t.id DESC LIMIT 100`, [p.id]);
  const [serials] = await pool.query('SELECT id, serial_number, status, created_at FROM product_serials WHERE product_id = ? ORDER BY id DESC LIMIT 200', [p.id]);
  const [suppliers] = await pool.query(
    `SELECT s.id, s.name, sp.unit_price, sp.lead_time_days FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id WHERE sp.product_id = ?`, [p.id]);
  res.json({ ...p, history, serials, suppliers });
});

function parseProduct(b) {
  return {
    sku: v.str(b.sku, 'SKU', { required: true, max: 40 }).toUpperCase(),
    name: v.str(b.name, 'Product name', { required: true, min: 2, max: 160 }),
    categoryId: v.int(b.categoryId, 'Category', { required: true, min: 1 }),
    brand: v.str(b.brand, 'Brand', { max: 80 }),
    description: v.str(b.description, 'Description', { max: 2000 }),
    unitCost: v.money(b.unitCost, 'Purchase price', { required: true }),
    sellingPrice: v.money(b.sellingPrice, 'Selling price', { required: true }),
    minStock: v.int(b.minStockLevel, 'Minimum stock level', { required: true, max: 1000000 }),
    leadTime: v.int(b.leadTimeDays ?? 7, 'Lead time (days)', { required: true, max: 365 }),
    trackSerial: v.bool(b.trackSerial),
  };
}

router.post('/', requirePerm('products.manage'), async (req, res) => {
  const p = parseProduct(req.body);
  const openingQty = v.int(req.body.openingQuantity ?? 0, 'Opening quantity', { max: 1000000 });
  const id = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO products (sku, name, category_id, brand, description, unit_cost, selling_price, min_stock_level, lead_time_days, track_serial)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [p.sku, p.name, p.categoryId, p.brand, p.description, p.unitCost, p.sellingPrice, p.minStock, p.leadTime, p.trackSerial]);
    await conn.query('INSERT INTO inventory (product_id, physical_qty, reserved_qty) VALUES (?,0,0)', [r.insertId]);
    if (openingQty > 0) {
      await applyStock(conn, r.insertId, { dPhysical: openingQty, type: 'INITIAL', refNo: 'OPENING-BALANCE', notes: 'Opening stock recorded at product creation', userId: req.user.id });
    }
    await audit(conn, req, 'PRODUCT_CREATED', 'product', r.insertId, { sku: p.sku, openingQty });
    return r.insertId;
  });
  realtime.emit('data:changed', { entity: 'products' });
  await broadcastStock([id]);
  res.status(201).json({ id, message: 'Product created' });
});

router.put('/:id', requirePerm('products.manage'), async (req, res) => {
  const id = Number(req.params.id); const p = parseProduct(req.body);
  const [r] = await pool.query(
    `UPDATE products SET sku=?, name=?, category_id=?, brand=?, description=?, unit_cost=?, selling_price=?, min_stock_level=?, lead_time_days=?, track_serial=? WHERE id=?`,
    [p.sku, p.name, p.categoryId, p.brand, p.description, p.unitCost, p.sellingPrice, p.minStock, p.leadTime, p.trackSerial, id]);
  if (!r.affectedRows) throw notFound('Product not found');
  await audit(pool, req, 'PRODUCT_UPDATED', 'product', id, { sku: p.sku });
  realtime.emit('data:changed', { entity: 'products' });
  res.json({ message: 'Product updated' });
});

// Deactivate (soft delete). Products with stock, reservations or incoming orders cannot be deactivated.
router.delete('/:id', requirePerm('products.manage'), async (req, res) => {
  const id = Number(req.params.id);
  await withTransaction(async (conn) => {
    // Lock the inventory row first so a concurrent sale/receipt cannot slip in between the check and the update.
    await conn.query('SELECT product_id FROM inventory WHERE product_id = ? FOR UPDATE', [id]);
    const [[p]] = await conn.query(`${SELECT_PRODUCT} WHERE p.id = ?`, [id]);
    if (!p) throw notFound('Product not found');
    if (p.physical_qty > 0 || p.reserved_qty > 0) throw conflict('This product still has stock on hand. Adjust or sell the stock before deactivating it.');
    if (p.incoming_qty > 0) throw conflict('This product has open purchase orders. Cancel or receive them first.');
    await conn.query('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
    await audit(conn, req, 'PRODUCT_DEACTIVATED', 'product', id, { sku: p.sku });
  });
  realtime.emit('data:changed', { entity: 'products' });
  res.json({ message: 'Product deactivated' });
});

router.post('/:id/reactivate', requirePerm('products.manage'), async (req, res) => {
  const [r] = await pool.query('UPDATE products SET is_active = 1 WHERE id = ?', [Number(req.params.id)]);
  if (!r.affectedRows) throw notFound('Product not found');
  await audit(pool, req, 'PRODUCT_REACTIVATED', 'product', req.params.id);
  realtime.emit('data:changed', { entity: 'products' });
  res.json({ message: 'Product reactivated' });
});

// Serial numbers (for products flagged track_serial)
router.post('/:id/serials', requirePerm('products.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const [[p]] = await pool.query('SELECT track_serial FROM products WHERE id = ?', [id]);
  if (!p) throw notFound('Product not found');
  if (!p.track_serial) throw badRequest('Serial tracking is not enabled for this product');
  const list = String(req.body.serials || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw badRequest('Enter at least one serial number');
  if (list.length > 500) throw badRequest('Add at most 500 serial numbers at a time');
  await withTransaction(async (conn) => {
    for (const s of list) await conn.query('INSERT INTO product_serials (product_id, serial_number) VALUES (?,?)', [id, s.slice(0, 80)]);
    await audit(conn, req, 'SERIALS_ADDED', 'product', id, { count: list.length });
  });
  res.status(201).json({ message: `${list.length} serial number(s) added` });
});
router.put('/serials/:serialId', requirePerm('products.manage'), async (req, res) => {
  const status = v.oneOf(req.body.status, 'Status', ['In Stock', 'Sold', 'Damaged', 'Returned'], { required: true });
  const [r] = await pool.query('UPDATE product_serials SET status = ? WHERE id = ?', [status, Number(req.params.serialId)]);
  if (!r.affectedRows) throw notFound('Serial number not found');
  res.json({ message: 'Serial status updated' });
});

module.exports = router;
module.exports.INCOMING_SQL = INCOMING_SQL;
