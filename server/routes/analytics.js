'use strict';
const express = require('express');
const { pool } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { badRequest } = require('../utils/errors');
const v = require('../utils/validate');

const router = express.Router();

const DEFAULTS = { forecast_window_days: 90, safety_stock_days: 7, cover_days: 30, delayed_order_grace_days: 0 };

async function getSettings() {
  const [rows] = await pool.query('SELECT setting_key, setting_value, description FROM settings');
  const out = { ...DEFAULTS }; const meta = {};
  rows.forEach((r) => { out[r.setting_key] = Number(r.setting_value); meta[r.setting_key] = r.description; });
  return { values: out, meta };
}

/**
 * Transparent forecast (NOT stock - estimates only):
 *   avg daily demand      = units sold in the last N days / N
 *   demand during lead    = avg daily demand x product lead time
 *   safety stock          = avg daily demand x safety days
 *   reorder point         = demand during lead + safety stock
 *   stock position        = available + incoming (open purchase orders)
 *   suggested reorder qty = max(0, avg daily demand x (lead + cover days) + safety - stock position)
 *   days of cover         = available / avg daily demand
 */
router.get('/forecast', requirePerm('analytics.view'), async (_req, res) => {
  const { values: s } = await getSettings();
  const win = Math.max(7, s.forecast_window_days);
  const [rows] = await pool.query(
    `SELECT p.id, p.sku, p.name, p.lead_time_days, p.min_stock_level, c.name AS category,
            i.physical_qty, i.reserved_qty, i.available_qty,
            COALESCE((SELECT SUM(poi.quantity_ordered - poi.quantity_received) FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
                       WHERE poi.product_id = p.id AND po.status IN ('Approved','Sent to Supplier','Partially Received')),0) AS incoming_qty,
            COALESCE((SELECT SUM(oi.quantity) FROM customer_order_items oi JOIN customer_orders o ON o.id = oi.order_id
                       WHERE oi.product_id = p.id AND o.status <> 'Cancelled' AND o.order_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)),0) AS units_sold,
            COALESCE((SELECT SUM(oi.quantity) FROM customer_order_items oi JOIN customer_orders o ON o.id = oi.order_id
                       WHERE oi.product_id = p.id AND o.status <> 'Cancelled' AND o.order_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)),0) AS units_sold_30d
       FROM products p JOIN product_categories c ON c.id = p.category_id JOIN inventory i ON i.product_id = p.id WHERE p.is_active = 1 ORDER BY p.name`, [win, 30]);

  const out = rows.map((r) => {
    const avg = r.units_sold / win;
    const lead = r.lead_time_days;
    const demandLead = avg * lead; const safety = avg * s.safety_stock_days;
    const reorderPoint = Math.ceil(demandLead + safety);
    const position = r.available_qty + r.incoming_qty;
    const suggested = Math.max(0, Math.ceil(avg * (lead + s.cover_days) + safety - position));
    const daysCover = avg > 0 ? Math.round((r.available_qty / avg) * 10) / 10 : null;
    let risk = 'OK';
    if (r.available_qty <= 0 && avg > 0) risk = 'Stock-out';
    else if (avg > 0 && r.available_qty < demandLead) risk = r.incoming_qty >= demandLead - r.available_qty ? 'Watch (incoming)' : 'Shortage risk';
    else if (r.available_qty <= r.min_stock_level) risk = 'Low';
    return { ...r, avg_daily_demand: Math.round(avg * 100) / 100, forecast_lead_demand: Math.ceil(demandLead), reorder_point: reorderPoint, stock_position: position, suggested_reorder_qty: suggested, days_of_cover: daysCover, risk };
  });
  res.json({ settings: s, windowDays: win, note: 'Forecast figures are estimates from historical sales. They are not stock and do not change inventory.', rows: out });
});

router.get('/movers', requirePerm('analytics.view'), async (_req, res) => {
  const { values: s } = await getSettings();
  const [rows] = await pool.query(
    `SELECT p.id, p.sku, p.name, c.name AS category, i.physical_qty,
            COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity END),0) AS units_sold,
            COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity * oi.unit_price END),0) AS revenue,
            MAX(o.order_date) AS last_sale
       FROM products p JOIN product_categories c ON c.id = p.category_id JOIN inventory i ON i.product_id = p.id
       LEFT JOIN customer_order_items oi ON oi.product_id = p.id
       LEFT JOIN customer_orders o ON o.id = oi.order_id AND o.status <> 'Cancelled' AND o.order_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      WHERE p.is_active = 1 GROUP BY p.id ORDER BY units_sold DESC`, [s.forecast_window_days]);
  const n = rows.length; const fastCut = Math.ceil(n * 0.25); const slowStart = n - Math.ceil(n * 0.25);
  const ranked = rows.map((r, idx) => ({ ...r, rank: idx + 1, movement: r.units_sold === 0 ? 'Slow-moving' : idx < fastCut ? 'Fast-moving' : idx >= slowStart ? 'Slow-moving' : 'Steady' }));
  res.json({ windowDays: s.forecast_window_days, rows: ranked });
});

router.get('/seasonality', requirePerm('analytics.view'), async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(o.order_date, '%Y-%m') AS month, c.name AS category, SUM(oi.quantity) AS units, ROUND(SUM(oi.quantity * oi.unit_price),2) AS revenue
       FROM customer_order_items oi JOIN customer_orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id JOIN product_categories c ON c.id = p.category_id
      WHERE o.status <> 'Cancelled' AND o.order_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
      GROUP BY month, c.name ORDER BY month`);
  const map = new Map(); const cats = new Set(); const totals = new Map();
  rows.forEach((r) => { cats.add(r.category); const m = map.get(r.month) || { month: r.month }; m[r.category] = Number(r.units); map.set(r.month, m); totals.set(r.month, (totals.get(r.month) || 0) + Number(r.units)); });
  const avg = [...totals.values()].reduce((a, b) => a + b, 0) / (totals.size || 1);
  const index = [...totals.entries()].map(([month, units]) => ({ month, units, seasonalIndex: Math.round((units / avg) * 100) / 100 }));
  res.json({ rows: [...map.values()], categories: [...cats], index });
});

router.get('/settings', requirePerm('analytics.view'), async (_req, res) => res.json(await getSettings()));
router.put('/settings', requirePerm('settings.manage'), async (req, res) => {
  const b = req.body;
  const next = {
    forecast_window_days: v.int(b.forecast_window_days, 'Forecast window (days)', { required: true, min: 7, max: 365 }),
    safety_stock_days: v.int(b.safety_stock_days, 'Safety stock (days)', { required: true, min: 0, max: 90 }),
    cover_days: v.int(b.cover_days, 'Cover (days)', { required: true, min: 0, max: 180 }),
  };
  for (const [k, val] of Object.entries(next)) {
    await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [k, String(val)]);
  }
  await audit(pool, req, 'SETTINGS_UPDATED', 'settings', null, next);
  res.json({ message: 'Forecast settings saved' });
});

module.exports = router;
module.exports.getSettings = getSettings;
module.exports.badRequest = badRequest;
