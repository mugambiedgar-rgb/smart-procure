'use strict';
/**
 * Periodic scan that raises time-based alerts which no user action triggers:
 * low/out-of-stock, delayed supplier deliveries, incoming deliveries due, delayed customer deliveries,
 * pending customer deliveries and POs awaiting approval. Alerts are deduplicated per user per day.
 */
const { pool } = require('../config/db');
const { notifyPerms } = require('./notifications');
const { checkStockAlerts } = require('./inventory');

async function runAlertScan() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    await checkStockAlerts();

    const [late] = await pool.query(
      `SELECT po.id, po.po_number, po.expected_date, s.name AS supplier, DATEDIFF(CURDATE(), po.expected_date) AS days_late
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.status IN ('Approved','Sent to Supplier','Partially Received') AND po.expected_date < CURDATE()`);
    for (const p of late) {
      await notifyPerms(pool, ['po.create', 'po.approve'], { type: 'delayed_supplier', severity: 'warning', title: `Supplier delivery overdue: ${p.po_number}`, message: `${p.supplier} is ${p.days_late} day(s) late (expected ${String(p.expected_date).slice(0, 10)}).`, link: `/procurement?po=${p.id}`, dedupeKey: `late-po:${p.id}:${today}` });
    }

    const [soon] = await pool.query(
      `SELECT po.id, po.po_number, po.expected_date, s.name AS supplier FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.status IN ('Sent to Supplier','Partially Received') AND po.expected_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 2 DAY)`);
    for (const p of soon) {
      await notifyPerms(pool, ['grn.create'], { type: 'incoming_delivery', severity: 'info', title: `Delivery due soon: ${p.po_number}`, message: `${p.supplier} - expected ${String(p.expected_date).slice(0, 10)}.`, link: '/goods-received', dedupeKey: `soon-po:${p.id}:${today}` });
    }

    const [dl] = await pool.query(
      `SELECT d.id, d.delivery_no, d.status, o.order_no, o.required_date, c.name AS customer, DATEDIFF(CURDATE(), o.required_date) AS days_late
         FROM deliveries d JOIN customer_orders o ON o.id = d.order_id JOIN customers c ON c.id = o.customer_id
        WHERE o.status = 'Confirmed' AND d.status <> 'Delivered' AND o.required_date < CURDATE()`);
    for (const d of dl) {
      await notifyPerms(pool, ['deliveries.manage', 'orders.create'], { type: 'delayed_delivery', severity: 'error', title: `Customer delivery delayed: ${d.order_no}`, message: `${d.customer} - ${d.days_late} day(s) past the required date; status ${d.status}.`, link: '/sales?tab=deliveries', dedupeKey: `late-del:${d.id}:${today}` });
    }

    const [[pend]] = await pool.query("SELECT COUNT(*) AS n FROM deliveries d JOIN customer_orders o ON o.id = d.order_id WHERE o.status = 'Confirmed' AND d.status IN ('Pending','Processing')");
    if (pend.n > 0) await notifyPerms(pool, ['deliveries.manage'], { type: 'pending_deliveries', severity: 'info', title: `${pend.n} customer deliver${pend.n === 1 ? 'y' : 'ies'} waiting to be processed`, link: '/sales?tab=deliveries', dedupeKey: `pending-del:${today}` });

    const [[appr]] = await pool.query("SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 'Pending Approval'");
    if (appr.n > 0) await notifyPerms(pool, ['po.approve'], { type: 'po_pending_approval', severity: 'info', title: `${appr.n} purchase order(s) awaiting approval`, link: '/procurement', dedupeKey: `pending-po:${today}` });
  } catch (err) {
    console.error('[alert scan] failed:', err.message);
  }
}

function startAlertScanner() {
  setTimeout(runAlertScan, 4000);
  const t = setInterval(runAlertScan, 15 * 60 * 1000);
  t.unref();
}
module.exports = { runAlertScan, startAlertScanner };
