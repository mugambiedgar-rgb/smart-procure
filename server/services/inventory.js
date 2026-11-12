'use strict';
/**
 * Inventory engine - the ONLY code allowed to change stock quantities.
 *
 *   physical  = units physically in the warehouse (changes on GRN verify, dispatch, return, adjustment)
 *   reserved  = units promised to confirmed customer orders (changes on order create / cancel / dispatch)
 *   available = physical - reserved (computed by MySQL as a generated column)
 *   incoming  = open purchase-order quantity not yet received. Derived on read, NEVER stored as stock.
 *
 * Every change:
 *   1. runs inside the caller's transaction,
 *   2. locks the inventory row with SELECT ... FOR UPDATE (concurrent sales/receipts queue up),
 *   3. validates the result (no negative stock, never reserve more than is available),
 *   4. updates the row and bumps its version,
 *   5. appends an immutable before/after record to inventory_transactions.
 */
const { pool } = require('../config/db');
const { badRequest, conflict } = require('../utils/errors');
const realtime = require('../utils/realtime');
const { notifyPerms } = require('./notifications');

const TYPES = ['INITIAL', 'GRN_RECEIPT', 'RESERVE', 'RELEASE', 'SALE_DISPATCH', 'DELIVERY_RETURN', 'ADJUSTMENT'];

/**
 * Apply one stock change. `conn` MUST be a connection inside a transaction.
 * Lock ordering: when changing several products, call lockProducts() first (ascending id) to avoid deadlocks.
 */
async function applyStock(conn, productId, { dPhysical = 0, dReserved = 0, type, refType = null, refId = null, refNo = null, notes = null, userId = null }) {
  if (!TYPES.includes(type)) throw new Error(`Unknown inventory transaction type ${type}`);
  const [[row]] = await conn.query('SELECT physical_qty, reserved_qty FROM inventory WHERE product_id = ? FOR UPDATE', [productId]);
  if (!row) throw badRequest(`Product #${productId} has no inventory record`);

  const physBefore = row.physical_qty; const resBefore = row.reserved_qty;
  const physAfter = physBefore + dPhysical; const resAfter = resBefore + dReserved;

  if (physAfter < 0) throw conflict(`Insufficient physical stock for product #${productId} (have ${physBefore}, change ${dPhysical})`, { code: 'INSUFFICIENT_STOCK', productId });
  if (resAfter < 0) throw conflict(`Reserved quantity for product #${productId} cannot be negative`, { code: 'RESERVED_NEGATIVE', productId });
  if (dReserved > 0 && physAfter - resAfter < 0) throw conflict(`Insufficient available stock for product #${productId} (available ${physBefore - resBefore}, requested ${dReserved})`, { code: 'INSUFFICIENT_STOCK', productId });
  if (resAfter > physAfter) throw conflict(`This change would leave reserved stock (${resAfter}) above physical stock (${physAfter}) for product #${productId}`, { code: 'RESERVED_EXCEEDS_PHYSICAL', productId });

  await conn.query('UPDATE inventory SET physical_qty = ?, reserved_qty = ?, version = version + 1 WHERE product_id = ?', [physAfter, resAfter, productId]);
  await conn.query(
    `INSERT INTO inventory_transactions
       (product_id, txn_type, physical_change, reserved_change, physical_before, physical_after, reserved_before, reserved_after,
        reference_type, reference_id, reference_no, notes, performed_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [productId, type, dPhysical, dReserved, physBefore, physAfter, resBefore, resAfter, refType, refId, refNo, notes, userId]);

  return { productId, physicalBefore: physBefore, physicalAfter: physAfter, reservedBefore: resBefore, reservedAfter: resAfter, availableAfter: physAfter - resAfter };
}

/** Lock several inventory rows in ascending product order (deadlock-safe). */
async function lockProducts(conn, productIds) {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (!ids.length) return [];
  const [rows] = await conn.query('SELECT product_id, physical_qty, reserved_qty, available_qty FROM inventory WHERE product_id IN (?) ORDER BY product_id FOR UPDATE', [ids]);
  return rows;
}

/** After a transaction commits: broadcast the new balances to every connected user. */
async function broadcastStock(productIds) {
  const ids = [...new Set(productIds)];
  if (!ids.length) return;
  const [rows] = await pool.query(
    `SELECT i.product_id AS productId, p.sku, p.name, i.physical_qty AS physical, i.reserved_qty AS reserved, i.available_qty AS available
       FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.product_id IN (?)`, [ids]);
  realtime.emit('inventory:update', { items: rows, at: new Date().toISOString() });
  await checkStockAlerts(ids);
}

/** Raise low-stock / out-of-stock notifications for the given products (deduplicated per day). */
async function checkStockAlerts(productIds = null) {
  const where = productIds && productIds.length ? 'AND p.id IN (?)' : '';
  const [rows] = await pool.query(
    `SELECT p.id, p.sku, p.name, p.min_stock_level, i.physical_qty, i.reserved_qty, i.available_qty
       FROM products p JOIN inventory i ON i.product_id = p.id
      WHERE p.is_active = 1 AND i.available_qty <= p.min_stock_level ${where}`, productIds && productIds.length ? [productIds] : []);
  const today = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    const out = r.available_qty <= 0;
    await notifyPerms(pool, ['products.manage', 'po.create'], {
      type: out ? 'out_of_stock' : 'low_stock',
      severity: out ? 'error' : 'warning',
      title: out ? `Out of stock: ${r.name}` : `Low stock: ${r.name}`,
      message: `${r.sku} - available ${r.available_qty} (physical ${r.physical_qty}, reserved ${r.reserved_qty}); minimum level ${r.min_stock_level}.`,
      link: '/inventory',
      dedupeKey: `${out ? 'oos' : 'low'}:${r.id}:${today}`,
    });
  }
}

module.exports = { applyStock, lockProducts, broadcastStock, checkStockAlerts };
