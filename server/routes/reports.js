'use strict';
const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const { requirePerm } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { supplierPerformance } = require('../services/supplierStats');
const { badRequest } = require('../utils/errors');
const v = require('../utils/validate');

const router = express.Router();
const D = (d) => (d ? String(d).slice(0, 10) : '');

/** Each report returns { title, columns:[{key,label,align?,type?}], rows }. Date range = from/to (inclusive). */
const REPORTS = {
  inventory: {
    title: 'Current Inventory', dated: false,
    async run() {
      const [rows] = await pool.query(
        `SELECT p.sku, p.name, c.name AS category, p.min_stock_level, i.physical_qty, i.reserved_qty, i.available_qty,
                COALESCE((SELECT SUM(poi.quantity_ordered - poi.quantity_received) FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id WHERE poi.product_id = p.id AND po.status IN ('Approved','Sent to Supplier','Partially Received')),0) AS incoming_qty,
                p.unit_cost, p.selling_price, (i.physical_qty * p.unit_cost) AS stock_value,
                CASE WHEN i.available_qty <= 0 THEN 'Out of Stock' WHEN i.available_qty <= p.min_stock_level THEN 'Low Stock' ELSE 'In Stock' END AS status
           FROM products p JOIN product_categories c ON c.id = p.category_id JOIN inventory i ON i.product_id = p.id WHERE p.is_active = 1 ORDER BY c.name, p.name`);
      return [
        [['sku', 'SKU'], ['name', 'Product'], ['category', 'Category'], ['physical_qty', 'Physical', 'num'], ['reserved_qty', 'Reserved', 'num'], ['available_qty', 'Available', 'num'], ['incoming_qty', 'Incoming', 'num'], ['min_stock_level', 'Min level', 'num'], ['unit_cost', 'Unit cost', 'money'], ['stock_value', 'Stock value', 'money'], ['status', 'Status']],
        rows];
    },
  },
  'procurement-expenditure': {
    title: 'Procurement Expenditure', dated: true,
    async run(f, t) {
      const [rows] = await pool.query(
        `SELECT DATE_FORMAT(po.order_date, '%Y-%m') AS month, s.name AS supplier, COUNT(*) AS orders, SUM(po.total_amount) AS amount
           FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
          WHERE po.status NOT IN ('Draft','Pending Approval','Cancelled') AND po.order_date BETWEEN ? AND ? GROUP BY month, s.id ORDER BY month, amount DESC`, [f, t]);
      return [[['month', 'Month'], ['supplier', 'Supplier'], ['orders', 'Orders', 'num'], ['amount', 'Amount', 'money']], rows];
    },
  },
  'supplier-performance': {
    title: 'Supplier Performance', dated: false,
    async run() {
      const rows = await supplierPerformance();
      return [[['name', 'Supplier'], ['total_orders', 'Orders', 'num'], ['total_spend', 'Total spend', 'money'], ['on_time_pct', 'On-time %', 'num'], ['fulfillment_pct', 'Fulfillment %', 'num'], ['avg_delivery_days', 'Avg delivery (days)', 'num'], ['incomplete_orders', 'Incomplete orders', 'num'], ['overdue_orders', 'Overdue', 'num'], ['outstanding_value', 'Outstanding value', 'money']], rows];
    },
  },
  'purchase-orders': {
    title: 'Purchase Order History', dated: true,
    async run(f, t) {
      const [rows] = await pool.query(
        `SELECT po.po_number, s.name AS supplier, po.status, po.order_date, po.expected_date, po.total_amount, u.full_name AS created_by
           FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN users u ON u.id = po.created_by WHERE po.order_date BETWEEN ? AND ? ORDER BY po.id DESC`, [f, t]);
      return [[['po_number', 'PO number'], ['supplier', 'Supplier'], ['status', 'Status'], ['order_date', 'Order date', 'date'], ['expected_date', 'Expected', 'date'], ['total_amount', 'Total', 'money'], ['created_by', 'Created by']], rows];
    },
  },
  'goods-received': {
    title: 'Goods Received', dated: true,
    async run(f, t) {
      const [rows] = await pool.query(
        `SELECT g.grn_number, g.received_date, po.po_number, s.name AS supplier, g.status, ru.full_name AS received_by,
                SUM(i.quantity_delivered) AS delivered, SUM(i.quantity_accepted) AS accepted, SUM(i.quantity_damaged) AS damaged, SUM(i.quantity_missing) AS missing
           FROM goods_received_notes g JOIN purchase_orders po ON po.id = g.po_id JOIN suppliers s ON s.id = po.supplier_id JOIN users ru ON ru.id = g.received_by
           JOIN goods_received_items i ON i.grn_id = g.id WHERE g.received_date BETWEEN ? AND ? GROUP BY g.id ORDER BY g.id DESC`, [f, t]);
      return [[['grn_number', 'GRN'], ['received_date', 'Received', 'date'], ['po_number', 'PO'], ['supplier', 'Supplier'], ['status', 'Status'], ['delivered', 'Delivered', 'num'], ['accepted', 'Accepted', 'num'], ['damaged', 'Damaged', 'num'], ['missing', 'Missing', 'num'], ['received_by', 'Received by']], rows];
    },
  },
  'stock-reconciliation': {
    title: 'Stock Reconciliation', dated: true,
    async run(f, t) {
      const [rows] = await pool.query(
        `SELECT r.session_no, r.title, r.status AS session_status, DATE(r.created_at) AS session_date, p.sku, p.name AS product, i.system_qty, i.counted_qty, i.difference, i.status, i.reason
           FROM stock_reconciliation_items i JOIN stock_reconciliations r ON r.id = i.reconciliation_id JOIN products p ON p.id = i.product_id
          WHERE DATE(r.created_at) BETWEEN ? AND ? AND (i.status <> 'Matched' OR r.status = 'Completed') ORDER BY r.id DESC, p.name`, [f, t]);
      return [[['session_no', 'Session'], ['session_date', 'Date', 'date'], ['sku', 'SKU'], ['product', 'Product'], ['system_qty', 'System', 'num'], ['counted_qty', 'Counted', 'num'], ['difference', 'Difference', 'num'], ['status', 'Result'], ['reason', 'Reason']], rows];
    },
  },
  'sales-deliveries': {
    title: 'Sales and Deliveries', dated: true,
    async run(f, t) {
      const [rows] = await pool.query(
        `SELECT o.order_no, DATE(o.order_date) AS order_date, c.name AS customer, o.status, d.status AS delivery_status, o.required_date, d.delivered_at, o.total_amount
           FROM customer_orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN deliveries d ON d.order_id = o.id WHERE DATE(o.order_date) BETWEEN ? AND ? ORDER BY o.id DESC LIMIT 5000`, [f, t]);
      return [[['order_no', 'Order'], ['order_date', 'Date', 'date'], ['customer', 'Customer'], ['status', 'Order status'], ['delivery_status', 'Delivery'], ['required_date', 'Required', 'date'], ['delivered_at', 'Delivered', 'date'], ['total_amount', 'Total', 'money']], rows];
    },
  },
  'inventory-movement': {
    title: 'Inventory Movement', dated: true,
    async run(f, t) {
      const [rows] = await pool.query(
        `SELECT t.created_at, p.sku, p.name AS product, t.txn_type, t.physical_change, t.reserved_change, t.physical_before, t.physical_after, t.reference_no, u.full_name AS user
           FROM inventory_transactions t JOIN products p ON p.id = t.product_id LEFT JOIN users u ON u.id = t.performed_by
          WHERE DATE(t.created_at) BETWEEN ? AND ? ORDER BY t.id DESC LIMIT 5000`, [f, t]);
      return [[['created_at', 'When'], ['sku', 'SKU'], ['product', 'Product'], ['txn_type', 'Type'], ['physical_change', 'Physical +/-', 'num'], ['reserved_change', 'Reserved +/-', 'num'], ['physical_before', 'Before', 'num'], ['physical_after', 'After', 'num'], ['reference_no', 'Reference'], ['user', 'User']], rows];
    },
  },
};

router.get('/', requirePerm('reports.view'), (_req, res) => res.json(Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, dated: r.dated }))));

router.get('/:type', requirePerm('reports.view'), async (req, res) => {
  const def = REPORTS[req.params.type];
  if (!def) throw badRequest('Unknown report type');
  const today = new Date().toISOString().slice(0, 10);
  const from = v.date(req.query.from, 'From date') || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const to = v.date(req.query.to, 'To date') || today;
  if (from > to) throw badRequest('From date must be on or before To date');
  const format = String(req.query.format || 'json').toLowerCase();
  const search = String(req.query.search || '').trim().toLowerCase();

  const [cols, raw] = await def.run(from, to);
  const columns = cols.map(([key, label, type]) => ({ key, label, type: type || 'text' }));
  let rows = raw.map((r) => { const o = {}; columns.forEach((c) => { o[c.key] = r[c.key] === undefined ? null : r[c.key]; }); return o; });
  if (search) rows = rows.filter((r) => Object.values(r).some((x) => x !== null && String(x).toLowerCase().includes(search)));
  const meta = { title: def.title, from: def.dated ? from : null, to: def.dated ? to : null, generatedAt: new Date().toISOString(), count: rows.length };

  if (format === 'json') return res.json({ ...meta, columns, rows });
  await audit(pool, req, 'REPORT_EXPORTED', 'report', req.params.type, { format, from, to, rows: rows.length });
  const base = `${req.params.type}-${today}`;
  const cell = (c, val) => (val === null || val === undefined ? '' : c.type === 'date' ? D(val) : c.type === 'money' ? Number(val).toFixed(2) : String(val));

  if (format === 'csv') {
    const esc = (s) => { s = String(s); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // also neutralises spreadsheet formula injection
    const lines = [columns.map((c) => esc(c.label)).join(',')].concat(rows.map((r) => columns.map((c) => esc(cell(c, r[c.key]))).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send('﻿' + lines.join('\r\n'));
  }
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook(); wb.creator = 'SmartProcure';
    const ws = wb.addWorksheet(def.title.slice(0, 30));
    ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    rows.forEach((r) => ws.addRow(columns.reduce((o, c) => { const val = r[c.key]; o[c.key] = val === null ? null : c.type === 'money' || c.type === 'num' ? Number(val) : c.type === 'date' ? D(val) : String(val); return o; }, {})));
    columns.forEach((c, i) => { if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0.00'; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    await wb.xlsx.write(res); return res.end();
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    doc.pipe(res);
    const W = doc.page.width - 72;
    const widths = columns.map((c) => Math.max(40, Math.min(c.label.length * 6 + 18, 150)));
    const scale = W / widths.reduce((a, b) => a + b, 0); const cw = widths.map((w) => w * scale);
    const header = () => { doc.fontSize(15).fillColor('#0b1220').text(`SmartProcure - ${def.title}`, 36, 36); doc.fontSize(8).fillColor('#64748b').text(`${def.dated ? `Period: ${from} to ${to}   ` : ''}Generated ${meta.generatedAt.slice(0, 16).replace('T', ' ')} UTC   Rows: ${rows.length}`, 36, 56); return 74; };
    let y = header();
    const head = () => { doc.rect(36, y, W, 16).fill('#0b1220').fillColor('#fff').fontSize(7.5); let x = 36; columns.forEach((c, i) => { doc.text(c.label, x + 3, y + 4, { width: cw[i] - 6, lineBreak: false, ellipsis: true, align: c.type === 'text' ? 'left' : 'right' }); x += cw[i]; }); y += 18; doc.fillColor('#1e293b'); };
    head();
    rows.forEach((r, idx) => {
      if (y > doc.page.height - 50) { doc.addPage(); y = header(); head(); }
      if (idx % 2 === 0) doc.rect(36, y - 2, W, 13).fill('#f1f5f9').fillColor('#1e293b');
      let x = 36; doc.fontSize(7.5);
      columns.forEach((c, i) => { const txt = c.type === 'money' && r[c.key] !== null ? Number(r[c.key]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : cell(c, r[c.key]); doc.text(txt, x + 3, y, { width: cw[i] - 6, lineBreak: false, ellipsis: true, align: c.type === 'text' || c.type === 'date' ? 'left' : 'right' }); x += cw[i]; });
      y += 13;
    });
    if (!rows.length) doc.fontSize(10).fillColor('#64748b').text('No records for the selected filters.', 36, y + 10);
    doc.end(); return undefined;
  }
  throw badRequest('Unsupported format. Use json, csv, xlsx or pdf.');
});

module.exports = router;
