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

const customers = express.Router();
const orders = express.Router();
const deliveries = express.Router();

// =============================================================== customers
customers.get('/', requirePerm('customers.view', 'orders.view'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM customer_orders o WHERE o.customer_id = c.id AND o.status <> 'Cancelled') AS order_count,
            (SELECT COALESCE(SUM(total_amount),0) FROM customer_orders o WHERE o.customer_id = c.id AND o.status <> 'Cancelled') AS total_sales
       FROM customers c ORDER BY c.name`);
  res.json(rows);
});
function parseCustomer(b) {
  return {
    name: v.str(b.name, 'Customer name', { required: true, min: 2, max: 150 }), contact: v.str(b.contactPerson, 'Contact person', { max: 120 }),
    email: v.email(b.email, 'Email'), phone: v.str(b.phone, 'Phone', { max: 30 }), address: v.str(b.address, 'Address', { max: 255 }), city: v.str(b.city, 'City', { max: 80 }),
  };
}
customers.post('/', requirePerm('customers.manage'), async (req, res) => {
  const c = parseCustomer(req.body);
  const id = await withTransaction(async (conn) => {
    const [[{ n }]] = await conn.query('SELECT COALESCE(MAX(id),0) + 1 AS n FROM customers FOR UPDATE');
    const [r] = await conn.query('INSERT INTO customers (customer_code, name, contact_person, email, phone, address, city) VALUES (?,?,?,?,?,?,?)',
      [`CUS-${String(n).padStart(3, '0')}`, c.name, c.contact, c.email, c.phone, c.address, c.city]);
    await audit(conn, req, 'CUSTOMER_CREATED', 'customer', r.insertId, { name: c.name });
    return r.insertId;
  });
  res.status(201).json({ id, message: 'Customer registered' });
});
customers.put('/:id', requirePerm('customers.manage'), async (req, res) => {
  const c = parseCustomer(req.body); const isActive = v.bool(req.body.isActive, true);
  const [r] = await pool.query('UPDATE customers SET name=?, contact_person=?, email=?, phone=?, address=?, city=?, is_active=? WHERE id=?', [c.name, c.contact, c.email, c.phone, c.address, c.city, isActive, Number(req.params.id)]);
  if (!r.affectedRows) throw notFound('Customer not found');
  await audit(pool, req, 'CUSTOMER_UPDATED', 'customer', req.params.id);
  res.json({ message: 'Customer updated' });
});

// =============================================================== customer orders
orders.get('/', requirePerm('orders.view'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT o.id, o.order_no, o.status, o.order_date, o.required_date, o.total_amount, o.customer_id, c.name AS customer_name, u.full_name AS created_by_name,
            d.status AS delivery_status, d.delivery_no,
            (SELECT COUNT(*) FROM customer_order_items i WHERE i.order_id = o.id) AS item_count,
            (o.status = 'Confirmed' AND o.required_date IS NOT NULL AND o.required_date < CURDATE() AND d.status NOT IN ('Delivered')) AS is_delayed
       FROM customer_orders o JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.created_by LEFT JOIN deliveries d ON d.order_id = o.id
      ORDER BY o.id DESC LIMIT 1000`);
  res.json(rows);
});

orders.get('/:id', requirePerm('orders.view'), async (req, res) => {
  const [[o]] = await pool.query(
    `SELECT o.*, c.name AS customer_name, c.address AS customer_address, c.city AS customer_city, c.phone AS customer_phone, u.full_name AS created_by_name
       FROM customer_orders o JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.created_by WHERE o.id = ?`, [Number(req.params.id)]);
  if (!o) throw notFound('Order not found');
  const [items] = await pool.query(
    `SELECT i.*, p.sku, p.name, inv.available_qty, COALESCE(r.status,'-') AS reservation_status
       FROM customer_order_items i JOIN products p ON p.id = i.product_id JOIN inventory inv ON inv.product_id = p.id
       LEFT JOIN stock_reservations r ON r.order_item_id = i.id WHERE i.order_id = ? ORDER BY i.id`, [o.id]);
  const [[delivery]] = await pool.query('SELECT * FROM deliveries WHERE order_id = ?', [o.id]);
  res.json({ ...o, items, delivery: delivery || null });
});

/** Availability check for the order form (read-only; the real check happens again, locked, on create). */
orders.post('/check-availability', requirePerm('orders.create'), async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const ids = items.map((i) => Number(i.productId)).filter(Boolean);
  if (!ids.length) return res.json({ lines: [] });
  const [rows] = await pool.query('SELECT product_id, physical_qty, reserved_qty, available_qty FROM inventory WHERE product_id IN (?)', [ids]);
  const m = new Map(rows.map((r) => [r.product_id, r]));
  res.json({ lines: items.map((i) => { const r = m.get(Number(i.productId)); const q = Number(i.quantity) || 0; return { productId: Number(i.productId), requested: q, available: r ? r.available_qty : 0, ok: !!r && q <= r.available_qty }; }) });
});

// Create order -> check availability, RESERVE stock (never oversell) and open a delivery, all atomically.
orders.post('/', requirePerm('orders.create'), async (req, res) => {
  const b = req.body;
  const customerId = v.int(b.customerId, 'Customer', { required: true, min: 1 });
  const requiredDate = v.date(b.requiredDate, 'Required date');
  const notes = v.str(b.notes, 'Notes', { max: 255 });
  const idem = v.str(b.idempotencyKey, 'Idempotency key', { max: 64 });
  const lines = v.lines(b.items);
  const seen = new Set();
  const clean = lines.map((l) => {
    const productId = v.int(l.productId, 'Product', { required: true, min: 1 });
    if (seen.has(productId)) throw badRequest('Each product can only appear once per order');
    seen.add(productId);
    return { productId, quantity: v.int(l.quantity, 'Quantity', { required: true, min: 1, max: 100000 }), unitPrice: l.unitPrice === undefined || l.unitPrice === '' ? null : v.money(l.unitPrice, 'Unit price') };
  });
  const touched = clean.map((c) => c.productId);

  const out = await withTransaction(async (conn) => {
    if (idem) {
      const [[ex]] = await conn.query('SELECT id, order_no FROM customer_orders WHERE idempotency_key = ?', [idem]);
      if (ex) return { id: ex.id, orderNo: ex.order_no, repeat: true };
    }
    const [[cust]] = await conn.query('SELECT id, is_active FROM customers WHERE id = ?', [customerId]);
    if (!cust) throw badRequest('Customer does not exist');
    if (!cust.is_active) throw badRequest('This customer is inactive');

    // Lock all inventory rows (ascending id) BEFORE checking, so two simultaneous orders cannot both pass the check.
    const stock = await lockProducts(conn, touched);
    const sm = new Map(stock.map((s) => [s.product_id, s]));
    const [prods] = await conn.query('SELECT id, name, sku, selling_price, is_active FROM products WHERE id IN (?)', [touched]);
    const pm = new Map(prods.map((p) => [p.id, p]));
    const shortages = [];
    for (const c of clean) {
      const p = pm.get(c.productId); const s = sm.get(c.productId);
      if (!p || !s) throw badRequest(`Product #${c.productId} does not exist`);
      if (!p.is_active) throw badRequest(`${p.name} is inactive and cannot be sold`);
      if (c.quantity > s.available_qty) shortages.push({ productId: p.id, sku: p.sku, name: p.name, requested: c.quantity, available: s.available_qty });
      c.price = c.unitPrice ?? p.selling_price;
    }
    if (shortages.length) throw conflict('Not enough available stock to confirm this order. Overselling is not allowed.', { code: 'INSUFFICIENT_STOCK', shortages });

    const orderNo = await nextDocNo(conn, 'SO');
    const total = Math.round(clean.reduce((a, c) => a + c.quantity * c.price, 0) * 100) / 100;
    const [o] = await conn.query('INSERT INTO customer_orders (order_no, customer_id, required_date, total_amount, notes, idempotency_key, created_by) VALUES (?,?,?,?,?,?,?)', [orderNo, customerId, requiredDate, total, notes, idem, req.user.id]);
    for (const c of clean) {
      const [i] = await conn.query('INSERT INTO customer_order_items (order_id, product_id, quantity, unit_price) VALUES (?,?,?,?)', [o.insertId, c.productId, c.quantity, c.price]);
      await conn.query('INSERT INTO stock_reservations (order_id, order_item_id, product_id, quantity) VALUES (?,?,?,?)', [o.insertId, i.insertId, c.productId, c.quantity]);
      await applyStock(conn, c.productId, { dReserved: c.quantity, type: 'RESERVE', refType: 'customer_order', refId: o.insertId, refNo: orderNo, notes: 'Stock reserved for customer order', userId: req.user.id });
    }
    const deliveryNo = await nextDocNo(conn, 'DLV');
    await conn.query('INSERT INTO deliveries (delivery_no, order_id, scheduled_date, updated_by) VALUES (?,?,?,?)', [deliveryNo, o.insertId, requiredDate, req.user.id]);
    await audit(conn, req, 'ORDER_CREATED', 'customer_order', o.insertId, { orderNo, total, lines: clean.length });
    await notifyPerms(conn, ['deliveries.manage'], { type: 'new_order', severity: 'info', title: `New customer order ${orderNo}`, message: `Delivery ${deliveryNo} is Pending - total ${total.toFixed(2)}.`, link: '/sales?tab=deliveries', excludeUserId: req.user.id });
    return { id: o.insertId, orderNo, deliveryNo };
  });
  realtime.emit('data:changed', { entity: 'orders' });
  if (!out.repeat) await broadcastStock(touched);
  res.status(out.repeat ? 200 : 201).json({ ...out, message: out.repeat ? 'This order was already created.' : `Order ${out.orderNo} confirmed and stock reserved` });
});

// Cancel (before dispatch) -> releases the reservation
orders.post('/:id/cancel', requirePerm('orders.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const reason = v.str(req.body.reason, 'Cancellation reason', { required: true, min: 3, max: 255 });
  const touched = [];
  await withTransaction(async (conn) => {
    const [[o]] = await conn.query('SELECT * FROM customer_orders WHERE id = ? FOR UPDATE', [id]);
    if (!o) throw notFound('Order not found');
    if (o.status !== 'Confirmed') throw conflict(`This order is already ${o.status.toLowerCase()}.`);
    const [[d]] = await conn.query('SELECT * FROM deliveries WHERE order_id = ? FOR UPDATE', [id]);
    if (!['Pending', 'Processing', 'Ready for Dispatch', 'Failed Delivery'].includes(d.status)) throw conflict(`The delivery is already ${d.status}; the order can no longer be cancelled.`);
    const [res_] = await conn.query("SELECT * FROM stock_reservations WHERE order_id = ? AND status = 'Active' ORDER BY product_id FOR UPDATE", [id]);
    await lockProducts(conn, res_.map((r) => r.product_id));
    for (const r of res_) {
      await applyStock(conn, r.product_id, { dReserved: -r.quantity, type: 'RELEASE', refType: 'customer_order', refId: id, refNo: o.order_no, notes: `Order cancelled: ${reason}`, userId: req.user.id });
      touched.push(r.product_id);
    }
    await conn.query("UPDATE stock_reservations SET status = 'Released' WHERE order_id = ? AND status = 'Active'", [id]);
    await conn.query("UPDATE customer_orders SET status = 'Cancelled', cancel_reason = ? WHERE id = ?", [reason, id]);
    await audit(conn, req, 'ORDER_CANCELLED', 'customer_order', id, { orderNo: o.order_no, reason });
  });
  realtime.emit('data:changed', { entity: 'orders' });
  await broadcastStock(touched);
  res.json({ message: 'Order cancelled and reserved stock released' });
});

// =============================================================== deliveries
const FLOW = {
  'Pending': ['Processing'],
  'Processing': ['Ready for Dispatch'],
  'Ready for Dispatch': ['Dispatched'],
  'Dispatched': ['Delivered', 'Failed Delivery'],
  'Failed Delivery': ['Processing', 'Ready for Dispatch'],
  'Delivered': [],
};

deliveries.get('/', requirePerm('deliveries.view'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT d.*, o.order_no, o.status AS order_status, o.required_date, o.total_amount, c.name AS customer_name, c.city AS customer_city,
            (d.status NOT IN ('Delivered') AND o.status = 'Confirmed' AND o.required_date IS NOT NULL AND o.required_date < CURDATE()) AS is_delayed
       FROM deliveries d JOIN customer_orders o ON o.id = d.order_id JOIN customers c ON c.id = o.customer_id
      WHERE o.status <> 'Cancelled' ORDER BY (d.status = 'Delivered'), d.id DESC LIMIT 1000`);
  res.json(rows);
});

/**
 * Move a delivery through its lifecycle. Stock side-effects:
 *   Dispatched       -> physical -qty AND reserved -qty (goods physically leave the warehouse)
 *   Failed Delivery  -> goods return: physical +qty AND reserved +qty (still promised to the customer)
 */
deliveries.post('/:id/status', requirePerm('deliveries.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const to = v.oneOf(req.body.status, 'Status', Object.keys(FLOW), { required: true });
  const driver = v.str(req.body.driverName, 'Driver', { max: 120 });
  const vehicle = v.str(req.body.vehicleNo, 'Vehicle', { max: 40 });
  const scheduled = v.date(req.body.scheduledDate, 'Scheduled date');
  const failure = v.str(req.body.failureReason, 'Failure reason', { max: 255, required: to === 'Failed Delivery' });
  const touched = [];
  const out = await withTransaction(async (conn) => {
    const [[d]] = await conn.query('SELECT * FROM deliveries WHERE id = ? FOR UPDATE', [id]);
    if (!d) throw notFound('Delivery not found');
    const [[o]] = await conn.query('SELECT * FROM customer_orders WHERE id = ? FOR UPDATE', [d.order_id]);
    if (o.status === 'Cancelled') throw conflict('This order was cancelled.');
    if (!FLOW[d.status].includes(to)) throw conflict(`A delivery that is "${d.status}" cannot move to "${to}". Allowed: ${FLOW[d.status].join(', ') || 'none'}.`);
    if (to === 'Dispatched' && (!(driver || d.driver_name))) throw badRequest('Assign a driver before dispatching');

    const [items] = await conn.query('SELECT product_id, quantity FROM customer_order_items WHERE order_id = ? ORDER BY product_id', [o.id]);
    if (to === 'Dispatched') {
      await lockProducts(conn, items.map((i) => i.product_id));
      for (const i of items) {
        await applyStock(conn, i.product_id, { dPhysical: -i.quantity, dReserved: -i.quantity, type: 'SALE_DISPATCH', refType: 'customer_order', refId: o.id, refNo: o.order_no, notes: `Dispatched ${d.delivery_no}`, userId: req.user.id });
        touched.push(i.product_id);
      }
      await conn.query("UPDATE stock_reservations SET status = 'Fulfilled' WHERE order_id = ? AND status = 'Active'", [o.id]);
    }
    if (to === 'Failed Delivery' && d.status === 'Dispatched') {
      await lockProducts(conn, items.map((i) => i.product_id));
      for (const i of items) {
        await applyStock(conn, i.product_id, { dPhysical: i.quantity, dReserved: i.quantity, type: 'DELIVERY_RETURN', refType: 'customer_order', refId: o.id, refNo: o.order_no, notes: `Failed delivery - goods returned (${d.delivery_no})`, userId: req.user.id });
        touched.push(i.product_id);
      }
      await conn.query("UPDATE stock_reservations SET status = 'Active' WHERE order_id = ? AND status = 'Fulfilled'", [o.id]);
    }
    await conn.query(
      `UPDATE deliveries SET status = ?, driver_name = COALESCE(?, driver_name), vehicle_no = COALESCE(?, vehicle_no), scheduled_date = COALESCE(?, scheduled_date),
              dispatched_at = ${to === 'Dispatched' ? 'NOW()' : 'dispatched_at'}, delivered_at = ${to === 'Delivered' ? 'NOW()' : 'NULL'},
              failure_reason = ${to === 'Failed Delivery' ? '?' : 'NULL'}, updated_by = ? WHERE id = ?`,
      to === 'Failed Delivery' ? [to, driver, vehicle, scheduled, failure, req.user.id, id] : [to, driver, vehicle, scheduled, req.user.id, id]);
    if (to === 'Delivered') await conn.query("UPDATE customer_orders SET status = 'Completed' WHERE id = ?", [o.id]);
    await audit(conn, req, `DELIVERY_${to.toUpperCase().replace(/ /g, '_')}`, 'delivery', id, { deliveryNo: d.delivery_no, orderNo: o.order_no });
    if (to === 'Failed Delivery') await notifyPerms(conn, ['orders.create', 'deliveries.manage'], { type: 'delivery_failed', severity: 'error', title: `Failed delivery: ${o.order_no}`, message: failure, link: '/sales?tab=deliveries', excludeUserId: req.user.id });
    if (to === 'Delivered') await notifyPerms(conn, ['orders.create'], { type: 'delivered', severity: 'success', title: `Order delivered: ${o.order_no}`, link: '/sales', excludeUserId: req.user.id });
    return { deliveryNo: d.delivery_no };
  });
  realtime.emit('data:changed', { entity: 'orders' });
  await broadcastStock(touched);
  res.json({ ...out, message: `${out.deliveryNo} is now ${to}` });
});

module.exports = { customers, orders, deliveries };
