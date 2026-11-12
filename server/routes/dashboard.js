'use strict';
const express = require('express');
const { pool } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { supplierPerformance } = require('../services/supplierStats');

const router = express.Router();

router.get('/', requirePerm('dashboard.view'), async (_req, res) => {
  const q = async (sql, params = []) => (await pool.query(sql, params))[0];
  const [
    [kpi], [po], [stock], [grnToday], [deliv], monthly, movement, demand, statusDist, valuation, activity, perf, [salesToday],
  ] = await Promise.all([
    q('SELECT (SELECT COUNT(*) FROM products WHERE is_active = 1) AS total_products, (SELECT COUNT(*) FROM suppliers WHERE is_active = 1) AS total_suppliers'),
    q(`SELECT COUNT(*) AS total_orders,
              SUM(status IN ('Draft','Pending Approval','Approved','Sent to Supplier','Partially Received')) AS pending_orders,
              SUM(status = 'Pending Approval') AS awaiting_approval,
              SUM(status = 'Fully Received') AS completed_orders,
              SUM(status IN ('Approved','Sent to Supplier','Partially Received') AND expected_date < CURDATE()) AS overdue_orders
         FROM purchase_orders`),
    q(`SELECT COALESCE(SUM(i.physical_qty),0) AS total_stock, COALESCE(SUM(i.reserved_qty),0) AS reserved_stock, COALESCE(SUM(i.available_qty),0) AS available_stock,
              SUM(p.is_active = 1 AND i.available_qty > 0 AND i.available_qty <= p.min_stock_level) AS low_stock,
              SUM(p.is_active = 1 AND i.available_qty <= 0) AS out_of_stock,
              COALESCE(SUM(i.physical_qty * p.unit_cost),0) AS inventory_value
         FROM inventory i JOIN products p ON p.id = i.product_id`),
    q(`SELECT COUNT(*) AS grn_count, COALESCE((SELECT SUM(quantity_accepted) FROM goods_received_items gi JOIN goods_received_notes g2 ON g2.id = gi.grn_id WHERE g2.status = 'Verified' AND DATE(g2.verified_at) = CURDATE()),0) AS units
         FROM goods_received_notes WHERE status = 'Verified' AND DATE(verified_at) = CURDATE()`),
    q(`SELECT COUNT(*) AS pending_deliveries, COALESCE(SUM(o.required_date < CURDATE()),0) AS delayed_deliveries
         FROM deliveries d JOIN customer_orders o ON o.id = d.order_id WHERE o.status = 'Confirmed' AND d.status <> 'Delivered'`),
    q(`SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, ROUND(SUM(total_amount),2) AS amount, COUNT(*) AS orders
         FROM purchase_orders WHERE status NOT IN ('Draft','Pending Approval','Cancelled') AND order_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 6 MONTH)
        GROUP BY month ORDER BY month`),
    q(`SELECT DATE(created_at) AS day, SUM(CASE WHEN physical_change > 0 THEN physical_change ELSE 0 END) AS inbound,
              SUM(CASE WHEN physical_change < 0 THEN -physical_change ELSE 0 END) AS outbound
         FROM inventory_transactions WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) AND txn_type IN ('GRN_RECEIPT','SALE_DISPATCH','DELIVERY_RETURN','ADJUSTMENT')
        GROUP BY day ORDER BY day`),
    q(`SELECT DATE_FORMAT(o.order_date, '%Y-%m') AS month, c.name AS category, SUM(i.quantity) AS units
         FROM customer_order_items i JOIN customer_orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id JOIN product_categories c ON c.id = p.category_id
        WHERE o.status <> 'Cancelled' AND o.order_date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 6 MONTH) GROUP BY month, c.name ORDER BY month`),
    q('SELECT status, COUNT(*) AS count FROM purchase_orders GROUP BY status'),
    q(`SELECT c.name AS category, ROUND(SUM(i.physical_qty * p.unit_cost),2) AS value, SUM(i.physical_qty) AS units
         FROM inventory i JOIN products p ON p.id = i.product_id JOIN product_categories c ON c.id = p.category_id GROUP BY c.id ORDER BY value DESC`),
    q(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, u.full_name AS user_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.action NOT IN ('LOGIN','LOGOUT','LOGIN_FAILED') ORDER BY a.id DESC LIMIT 12`),
    supplierPerformance(),
    q("SELECT COALESCE(SUM(total_amount),0) AS amount, COUNT(*) AS orders FROM customer_orders WHERE status <> 'Cancelled' AND DATE(order_date) = CURDATE()"),
  ]);

  // Pivot demand into {month, <category>: units}
  const demandMap = new Map();
  const categories = new Set();
  demand.forEach((r) => { categories.add(r.category); const m = demandMap.get(r.month) || { month: r.month }; m[r.category] = Number(r.units); demandMap.set(r.month, m); });

  res.json({
    kpis: { ...kpi, ...po, ...stock, grn_today: grnToday.grn_count, units_received_today: Number(grnToday.units), ...deliv, sales_today: Number(salesToday.amount), orders_today: salesToday.orders },
    charts: {
      monthlyExpenditure: monthly,
      stockMovement: movement.map((m) => ({ day: String(m.day).slice(0, 10), inbound: Number(m.inbound), outbound: Number(m.outbound) })),
      demand: { rows: [...demandMap.values()], categories: [...categories] },
      supplierPerformance: perf.filter((s) => s.is_active).map((s) => ({ name: s.name, onTime: s.on_time_pct, fulfillment: s.fulfillment_pct })),
      poStatus: statusDist,
      valuation,
    },
    activity: activity.map((a) => ({ ...a, details: typeof a.details === 'string' ? safeJson(a.details) : a.details })),
  });
});

function safeJson(s) { try { return JSON.parse(s); } catch (_) { return {}; } }

module.exports = router;
