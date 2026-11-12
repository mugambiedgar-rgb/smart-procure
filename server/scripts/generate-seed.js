/**
 * Generates database/seed.sql with ~7 months of internally consistent sample data.
 * Every stock balance is produced by replaying the inventory ledger, so
 * inventory.physical_qty always equals the sum of inventory_transactions.
 * All timestamps are relative to the moment seed.sql is imported (CURDATE()).
 *
 * Usage: npm run seed:generate   (from /server)  - then re-import the database.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const ANCHOR = Date.UTC(2026, 10, 9); // only used to label document numbers with a year
const START = 220;                    // days of history
const DEMO_PASSWORD = 'Password@123';

// ---------- deterministic random ----------
let _s = 20261109;
const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[ri(0, a.length - 1)];
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- SQL helpers ----------
class Raw { constructor(s) { this.s = s; } }
const sqlDate = (d) => (d >= 0 ? `DATE_SUB(CURDATE(), INTERVAL ${d} DAY)` : `DATE_ADD(CURDATE(), INTERVAL ${-d} DAY)`);
const D = (d) => new Raw(sqlDate(d));
const T = (d, mins) => {
  mins = Math.max(0, Math.min(1439, mins));
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return new Raw(`TIMESTAMP(${sqlDate(d)}, '${hh}:${mm}:00')`);
};
const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Raw) return v.s;
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
};
const clk = {};
const tick = (d) => {
  if (clk[d] === undefined) clk[d] = d === 0 ? 5 : 8 * 60 + ri(0, 25);
  clk[d] += d === 0 ? ri(1, 2) : ri(3, 14);
  return Math.min(clk[d], d === 0 ? 400 : 1430);
};
const now = (d) => T(d, tick(d));
const yearOf = (d) => new Date(ANCHOR - d * 86400000).getUTCFullYear();
const monthOf = (d) => new Date(ANCHOR - d * 86400000).getUTCMonth();
const dowOf = (d) => new Date(ANCHOR - d * 86400000).getUTCDay();
const counters = {};
const docNo = (prefix, d) => {
  const key = `${prefix}-${yearOf(d)}`;
  counters[key] = (counters[key] || 0) + 1;
  return `${key}-${String(counters[key]).padStart(5, '0')}`;
};

// ---------- reference data ----------
const PERMS = [
  ['dashboard.view', 'View executive dashboard'], ['products.view', 'View products and stock'],
  ['products.manage', 'Create, edit and deactivate products'], ['inventory.view', 'View inventory and movements'],
  ['suppliers.view', 'View suppliers'], ['suppliers.manage', 'Create and edit suppliers'],
  ['requisitions.view', 'View purchase requisitions'], ['requisitions.create', 'Create purchase requisitions'],
  ['requisitions.approve', 'Approve or reject requisitions'], ['po.view', 'View purchase orders'],
  ['po.create', 'Create, edit, send and cancel purchase orders'], ['po.approve', 'Approve or reject purchase orders'],
  ['grn.view', 'View goods received notes'], ['grn.create', 'Record goods received notes'],
  ['grn.verify', 'Verify GRNs and update physical stock'], ['reconciliation.view', 'View stock reconciliations'],
  ['reconciliation.manage', 'Create stock-count sessions and enter counts'],
  ['reconciliation.approve', 'Approve stock adjustments'], ['customers.view', 'View customers'],
  ['customers.manage', 'Create and edit customers'], ['orders.view', 'View customer orders'],
  ['orders.create', 'Create customer orders'], ['orders.manage', 'Cancel customer orders'],
  ['deliveries.view', 'View deliveries'], ['deliveries.manage', 'Assign and update deliveries'],
  ['analytics.view', 'View analytics and forecasting'], ['reports.view', 'Generate and export reports'],
  ['users.manage', 'Manage users'], ['audit.view', 'View audit logs'], ['settings.manage', 'Change system settings'],
];
const ROLES = [
  ['Administrator', 'Full system access', PERMS.map((p) => p[0])],
  ['Procurement Officer', 'Manages suppliers and purchase orders', ['dashboard.view', 'products.view', 'inventory.view', 'suppliers.view', 'suppliers.manage', 'requisitions.view', 'requisitions.create', 'po.view', 'po.create', 'grn.view', 'analytics.view', 'reports.view']],
  ['Warehouse Manager', 'Manages inventory and goods received', ['dashboard.view', 'products.view', 'products.manage', 'inventory.view', 'suppliers.view', 'requisitions.view', 'requisitions.create', 'po.view', 'grn.view', 'grn.create', 'grn.verify', 'reconciliation.view', 'reconciliation.manage', 'reconciliation.approve', 'orders.view', 'deliveries.view', 'deliveries.manage', 'reports.view']],
  ['Sales Officer', 'Manages customer orders and stock availability', ['dashboard.view', 'products.view', 'inventory.view', 'customers.view', 'customers.manage', 'orders.view', 'orders.create', 'orders.manage', 'deliveries.view', 'deliveries.manage']],
  ['Management', 'Views reports, analytics and business performance', ['dashboard.view', 'products.view', 'inventory.view', 'suppliers.view', 'requisitions.view', 'requisitions.approve', 'po.view', 'po.approve', 'grn.view', 'reconciliation.view', 'customers.view', 'orders.view', 'deliveries.view', 'analytics.view', 'reports.view', 'audit.view']],
];
const ADMIN = 1, PROC = 2, WH = 3, SALES = 4, MGMT = 5;
const USERS = [
  ['Ava Mitchell', 'admin@smartprocure.com', 1, '+1 555 0101'],
  ['Daniel Okoye', 'procurement@smartprocure.com', 2, '+1 555 0102'],
  ['Grace Njeri', 'warehouse@smartprocure.com', 3, '+1 555 0103'],
  ['Samuel Ortiz', 'sales@smartprocure.com', 4, '+1 555 0104'],
  ['Priya Raman', 'management@smartprocure.com', 5, '+1 555 0105'],
];
const CATEGORIES = [
  ['Laptops', 'Notebook and ultrabook computers'], ['Desktop Computers', 'Desktop PCs and small-form-factor machines'],
  ['Smartphones', 'Mobile phones'], ['Tablets', 'Tablet computers'], ['Computer Accessories', 'Peripherals, monitors, cables and hubs'],
  ['Printers', 'Laser and inkjet printers'], ['Networking Equipment', 'Routers, switches and access points'],
  ['Storage Devices', 'SSDs, HDDs and flash drives'],
];
// sku, name, cat, brand, cost, price, min, lead, qtyLo, qtyHi, weight, reorder, suppliers, serial
const PRODUCT_DEFS = [
  ['LAP-HP-450', 'HP ProBook 450 G10', 1, 'HP', 640, 749, 8, 10, 1, 5, 1.4, 25, [1], 1],
  ['LAP-DL-5440', 'Dell Latitude 5440', 1, 'Dell', 690, 799, 8, 10, 1, 4, 1.3, 25, [1], 1],
  ['LAP-LN-E14', 'Lenovo ThinkPad E14 Gen 5', 1, 'Lenovo', 610, 719, 6, 10, 1, 4, 1.0, 20, [1], 1],
  ['LAP-AS-VB15', 'ASUS VivoBook 15', 1, 'ASUS', 430, 519, 6, 12, 1, 4, 0.8, 20, [1], 1],
  ['DSK-DL-7010', 'Dell OptiPlex 7010 SFF', 2, 'Dell', 560, 649, 5, 10, 1, 3, 0.8, 15, [1], 0],
  ['DSK-HP-800', 'HP EliteDesk 800 G9', 2, 'HP', 620, 719, 5, 10, 1, 3, 0.7, 15, [1], 0],
  ['DSK-LN-M70', 'Lenovo ThinkCentre M70s', 2, 'Lenovo', 480, 565, 4, 10, 1, 3, 0.5, 12, [1], 0],
  ['PHN-SM-A55', 'Samsung Galaxy A55 5G', 3, 'Samsung', 290, 349, 15, 8, 2, 8, 1.6, 60, [3], 1],
  ['PHN-SM-S24', 'Samsung Galaxy S24', 3, 'Samsung', 640, 749, 10, 8, 1, 5, 1.0, 30, [3], 1],
  ['PHN-XI-RN13', 'Xiaomi Redmi Note 13', 3, 'Xiaomi', 165, 209, 15, 8, 3, 10, 1.5, 60, [3], 1],
  ['PHN-TC-SP20', 'Tecno Spark 20', 3, 'Tecno', 95, 129, 20, 8, 4, 12, 1.3, 80, [3], 1],
  ['TAB-SM-A9', 'Samsung Galaxy Tab A9+', 4, 'Samsung', 175, 219, 10, 8, 2, 6, 1.0, 40, [3], 0],
  ['TAB-AP-IP10', 'Apple iPad 10th Gen 64GB', 4, 'Apple', 345, 419, 8, 8, 1, 4, 0.8, 24, [3], 1],
  ['TAB-LN-M10', 'Lenovo Tab M10 Plus', 4, 'Lenovo', 130, 169, 10, 8, 2, 6, 0.7, 40, [3], 0],
  ['ACC-LG-MXK', 'Logitech MX Keys Keyboard', 5, 'Logitech', 78, 99, 15, 6, 3, 12, 1.0, 50, [2, 4], 0],
  ['ACC-LG-M185', 'Logitech M185 Wireless Mouse', 5, 'Logitech', 8, 12, 40, 6, 10, 40, 1.6, 200, [2, 4], 0],
  ['ACC-DL-P2422', 'Dell 24" Monitor P2422H', 5, 'Dell', 135, 169, 12, 8, 2, 8, 1.2, 40, [2], 0],
  ['ACC-HDMI-2M', 'HDMI Cable 2m', 5, 'Generic', 2.5, 5, 80, 6, 15, 60, 1.4, 400, [4], 0],
  ['ACC-UCH-7IN1', 'USB-C Hub 7-in-1', 5, 'Anker', 24, 35, 25, 6, 4, 16, 1.0, 100, [2, 4], 0],
  ['PRN-HP-M404', 'HP LaserJet Pro M404dn', 6, 'HP', 195, 249, 6, 8, 1, 4, 0.8, 20, [2], 0],
  ['PRN-EP-L3250', 'Epson EcoTank L3250', 6, 'Epson', 165, 209, 6, 8, 1, 5, 1.0, 24, [2], 0],
  ['PRN-CN-G3420', 'Canon PIXMA G3420', 6, 'Canon', 125, 159, 5, 8, 1, 3, 0.35, 15, [2], 0],
  ['NET-TP-AX55', 'TP-Link Archer AX55 Router', 7, 'TP-Link', 58, 79, 20, 7, 3, 12, 1.2, 80, [4], 0],
  ['NET-CS-CBS110', 'Cisco CBS110 8-Port Switch', 7, 'Cisco', 48, 69, 10, 7, 2, 8, 0.4, 30, [4], 0],
  ['NET-UB-U6LITE', 'Ubiquiti UniFi U6 Lite AP', 7, 'Ubiquiti', 105, 139, 10, 7, 2, 8, 0.7, 30, [4], 0],
  ['STO-SM-T7-1TB', 'Samsung T7 Portable SSD 1TB', 8, 'Samsung', 78, 105, 20, 9, 3, 15, 1.2, 60, [5], 0],
  ['STO-WD-BLU2TB', 'WD Blue 2TB HDD', 8, 'Western Digital', 52, 69, 20, 9, 3, 15, 0.9, 60, [5], 0],
  ['STO-SD-128', 'SanDisk Ultra 128GB USB Drive', 8, 'SanDisk', 9, 14, 60, 9, 10, 40, 1.4, 300, [5], 0],
  ['STO-KG-NV2-1TB', 'Kingston NV2 1TB NVMe SSD', 8, 'Kingston', 55, 75, 20, 9, 3, 15, 1.0, 60, [5], 0],
];
const SUPPLIERS = [
  ['SUP-001', 'TechSource Distribution Ltd', 'Marcus Webb', 'orders@techsource.example', '+1 555 0201', '14 Industrial Way', 'Dallas', 'USA', 'Net 30', 0.92, 0.95],
  ['SUP-002', 'Global Compute Supplies', 'Elena Petrova', 'sales@globalcompute.example', '+1 555 0202', '88 Harbour Road', 'Rotterdam', 'Netherlands', 'Net 45', 0.78, 0.85],
  ['SUP-003', 'Prime Mobile Imports', 'Hiro Tanaka', 'wholesale@primemobile.example', '+1 555 0203', '3-12 Shinjuku Plaza', 'Tokyo', 'Japan', 'Net 30', 0.85, 0.9],
  ['SUP-004', 'NetLink Wholesale', 'Aisha Rahman', 'trade@netlink.example', '+1 555 0204', '221 Cable Street', 'Manchester', 'UK', 'Net 30', 0.9, 0.95],
  ['SUP-005', 'DataVault Storage Co', 'Lucas Ferreira', 'b2b@datavault.example', '+1 555 0205', '9 Silicon Park', 'Shenzhen', 'China', 'Net 60', 0.65, 0.8],
];
const CUSTOMERS = [
  ['CUS-001', 'BrightPath Schools', 'Helen Carter', 'procurement@brightpath.example', '+1 555 0301', '12 Academy Lane', 'Austin'],
  ['CUS-002', 'Zenith Retail Group', 'Omar Haddad', 'buying@zenithretail.example', '+1 555 0302', '450 Market Square', 'Chicago'],
  ['CUS-003', 'Orbit Office Solutions', 'Julia Kim', 'orders@orbitoffice.example', '+1 555 0303', '77 Commerce Drive', 'Denver'],
  ['CUS-004', 'Kestrel Telecom', 'Ben Alvarez', 'it@kestreltel.example', '+1 555 0304', '9 Tower Road', 'Seattle'],
  ['CUS-005', 'Lakeview Hospital', 'Dr. Naomi Reed', 'supplies@lakeviewhospital.example', '+1 555 0305', '1 Lakeview Avenue', 'Boston'],
  ['CUS-006', 'Horizon Cyber Cafes', 'Tariq Mensah', 'owner@horizoncafes.example', '+1 555 0306', '35 Station Road', 'Atlanta'],
  ['CUS-007', 'Apex Insurance Brokers', 'Sofia Rossi', 'ops@apexbrokers.example', '+1 555 0307', '600 Finance Plaza', 'New York'],
  ['CUS-008', 'Summit University', 'Prof. Daniel Cho', 'it-purchasing@summit.example', '+1 555 0308', 'University Campus', 'Portland'],
];
const DRIVERS = ['Joseph K.', 'Mercy A.', 'Peter N.', 'Linda W.'];
const VEHICLES = ['VAN-01', 'VAN-02', 'TRK-03'];

// ---------- output tables ----------
const T_ = {
  roles: [], permissions: [], role_permissions: [], users: [], product_categories: [], products: [], product_serials: [],
  suppliers: [], supplier_products: [], purchase_requisitions: [], purchase_requisition_items: [], purchase_orders: [],
  purchase_order_items: [], goods_received_notes: [], goods_received_items: [], inventory: [], inventory_transactions: [],
  customers: [], customer_orders: [], customer_order_items: [], stock_reservations: [], deliveries: [],
  stock_reconciliations: [], stock_reconciliation_items: [], stock_adjustments: [], audit_logs: [],
};
const events = {};
const schedule = (d, fn) => { (events[d] = events[d] || []).push(fn); };
const audit = (d, userId, action, type, id, details) => T_.audit_logs.push({ user_id: userId, action, entity_type: type, entity_id: String(id), details: JSON.stringify(details || {}), ip_address: '127.0.0.1', created_at: now(d) });

ROLES.forEach(([name, desc], i) => T_.roles.push({ id: i + 1, name, description: desc }));
PERMS.forEach(([code, desc], i) => T_.permissions.push({ id: i + 1, code, description: desc }));
ROLES.forEach(([, , codes], i) => codes.forEach((c) => T_.role_permissions.push({ role_id: i + 1, permission_id: PERMS.findIndex((p) => p[0] === c) + 1 })));
const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
USERS.forEach(([full_name, email, role_id, phone], i) => T_.users.push({ id: i + 1, full_name, email, password_hash: hash, role_id, phone, is_active: 1 }));
CATEGORIES.forEach(([name, description], i) => T_.product_categories.push({ id: i + 1, name, description }));

const products = PRODUCT_DEFS.map((d, i) => {
  const [sku, name, cat, brand, cost, price, min, lead, lo, hi, w, reorder, sup, serial] = d;
  const p = { id: i + 1, sku, name, cat, brand, cost, price, min, lead, lo, hi, w, reorder, sup, serial, weekly: w * 1.55 * ((lo + hi) / 2) };
  T_.products.push({ id: p.id, sku, name, category_id: cat, brand, description: `${brand} ${name}`, unit_cost: cost, selling_price: price, min_stock_level: min, lead_time_days: lead, track_serial: serial, is_active: 1 });
  return p;
});
const P = (id) => products[id - 1];
const suppliers = SUPPLIERS.map((s, i) => {
  const o = { id: i + 1, ontime: s[9], fill: s[10] };
  T_.suppliers.push({ id: o.id, code: s[0], name: s[1], contact_person: s[2], email: s[3], phone: s[4], address: s[5], city: s[6], country: s[7], payment_terms: s[8], is_active: 1 });
  return o;
});
let spId = 0;
products.forEach((p) => p.sup.forEach((sid) => T_.supplier_products.push({ id: ++spId, supplier_id: sid, product_id: p.id, supplier_sku: 'S' + sid + '-' + p.sku, unit_price: p.cost, lead_time_days: p.lead })));
CUSTOMERS.forEach((c, i) => T_.customers.push({ id: i + 1, customer_code: c[0], name: c[1], contact_person: c[2], email: c[3], phone: c[4], address: c[5], city: c[6], is_active: 1 }));
for (let i = 1; i <= 6; i++) T_.product_serials.push({ product_id: 1, serial_number: `HP450G10-${5120000 + i * 37}`, status: 'In Stock' });

// ---------- inventory ledger ----------
const st = {}; const incoming = {};
products.forEach((p) => { st[p.id] = { phys: 0, res: 0, ver: 0 }; incoming[p.id] = 0; });
function txn(pid, type, dp, dr, d, o = {}) {
  const s = st[pid]; const pb = s.phys; const rb = s.res;
  s.phys += dp; s.res += dr; s.ver++;
  if (s.phys < 0 || s.res < 0) throw new Error(`Negative stock for product ${pid} (${type}) day ${d}: ${s.phys}/${s.res}`);
  T_.inventory_transactions.push({ product_id: pid, txn_type: type, physical_change: dp, reserved_change: dr, physical_before: pb, physical_after: s.phys, reserved_before: rb, reserved_after: s.res, reference_type: o.refType || null, reference_id: o.refId || null, reference_no: o.refNo || null, notes: o.notes || null, performed_by: o.by || null, created_at: now(d) });
}

// ---------- purchase orders ----------
const poItemId = { n: 0 }; const grnItemId = { n: 0 };
function createPO({ d, supplierId, lines, status, expectedAgo, creator = PROC, reqId = null, notes = null, cancelReason = null }) {
  const id = T_.purchase_orders.length + 1;
  const lead = Math.max(...lines.map(([pid]) => P(pid).lead));
  const exp = expectedAgo !== undefined ? expectedAgo : d - lead;
  const approver = (id % 2) ? ADMIN : MGMT;
  const items = lines.map(([pid, qty]) => ({ id: ++poItemId.n, po_id: id, product_id: pid, quantity_ordered: qty, quantity_received: 0, unit_price: round2(P(pid).cost * (0.98 + rnd() * 0.04)) }));
  const total = round2(items.reduce((a, i) => a + i.quantity_ordered * i.unit_price, 0));
  const approved = ['Approved', 'Sent to Supplier', 'Partially Received', 'Fully Received'].includes(status);
  const sent = ['Sent to Supplier', 'Partially Received', 'Fully Received'].includes(status);
  const po = {
    id, po_number: docNo('PO', d), supplier_id: supplierId, requisition_id: reqId, status, order_date: D(d), expected_date: D(exp), total_amount: total, notes,
    rejection_reason: null, cancel_reason: cancelReason, idempotency_key: null, created_by: creator, approved_by: approved ? approver : null,
    approved_at: approved ? now(d) : null, sent_at: sent ? now(d) : null, fully_received_at: null, cancelled_at: status === 'Cancelled' ? now(d - 2) : null,
    created_at: now(d), updated_at: now(d), _items: items, _exp: exp,
  };
  T_.purchase_orders.push(po); T_.purchase_order_items.push(...items);
  audit(d, creator, 'PO_CREATED', 'purchase_order', id, { po_number: po.po_number, total });
  if (approved) audit(d, approver, 'PO_APPROVED', 'purchase_order', id, { po_number: po.po_number });
  if (sent) audit(d, creator, 'PO_SENT', 'purchase_order', id, { po_number: po.po_number });
  if (approved) items.forEach((it) => { incoming[it.product_id] += it.quantity_ordered; });
  return po;
}
function receive(po, recv, d) { // recv: [[item, delivered, damaged]]
  const id = T_.goods_received_notes.length + 1;
  const grn = { id, grn_number: docNo('GRN', d), po_id: po.id, status: 'Verified', received_date: D(d), delivery_note_ref: 'DN-' + ri(10000, 99999), delivered_by_name: pick(DRIVERS), received_by: WH, verified_by: WH, verified_at: now(d), notes: null, created_at: now(d) };
  T_.goods_received_notes.push(grn);
  let damagedTotal = 0;
  recv.forEach(([item, delivered, damaged]) => {
    const accepted = delivered - damaged; const outstanding = item.quantity_ordered - item.quantity_received;
    T_.goods_received_items.push({ id: ++grnItemId.n, grn_id: id, po_item_id: item.id, product_id: item.product_id, quantity_delivered: delivered, quantity_damaged: damaged, quantity_accepted: accepted, quantity_missing: Math.max(0, outstanding - delivered), remarks: damaged ? 'Damaged in transit' : null });
    item.quantity_received += accepted; incoming[item.product_id] -= accepted; damagedTotal += damaged;
    if (accepted > 0) txn(item.product_id, 'GRN_RECEIPT', accepted, 0, d, { refType: 'goods_received_note', refId: id, refNo: grn.grn_number, by: WH, notes: `Received against ${po.po_number}` });
  });
  const all = po._items.every((i) => i.quantity_received >= i.quantity_ordered);
  po.status = all ? 'Fully Received' : 'Partially Received';
  if (all) po.fully_received_at = now(d);
  audit(d, WH, 'GRN_VERIFIED', 'goods_received_note', id, { grn_number: grn.grn_number, po_number: po.po_number, damaged: damagedTotal });
}
function histPO(d, supplierId, lines) {
  const sup = suppliers[supplierId - 1];
  const po = createPO({ d, supplierId, lines, status: 'Sent to Supplier' });
  const lead = Math.max(...lines.map(([pid]) => P(pid).lead));
  const delay = rnd() < sup.ontime ? ri(-1, 0) : ri(1, 7);
  const r = d - lead - delay;
  const partial = rnd() > sup.fill;
  if (!partial) {
    schedule(r, () => receive(po, po._items.map((i) => [i, i.quantity_ordered, 0]), r));
  } else {
    const ratio = 0.55 + rnd() * 0.3;
    schedule(r, () => receive(po, po._items.map((i) => { const del = Math.max(1, Math.floor(i.quantity_ordered * ratio)); return [i, del, del > 3 && rnd() < 0.3 ? 1 : 0]; }), r));
    const r2 = Math.max(1, r - ri(3, 7));
    schedule(r2, () => receive(po, po._items.filter((i) => i.quantity_received < i.quantity_ordered).map((i) => [i, i.quantity_ordered - i.quantity_received, 0]), r2));
  }
}

// ---------- customer orders ----------
const mult = (cat, d) => { const m = monthOf(d); if ((cat === 1 || cat === 4) && (m === 7 || m === 8)) return 1.5; if ((cat === 1 || cat === 4) && m === 0) return 1.3; if (cat === 3 && (m === 10 || m === 11)) return 1.4; return 1; };
function chooseItems(d) {
  const n = ri(1, 4); const chosen = new Map();
  const weights = products.map((p) => p.w * mult(p.cat, d)); const sum = weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < n * 3 && chosen.size < n; k++) {
    let x = rnd() * sum; let idx = 0;
    while (x > weights[idx] && idx < weights.length - 1) { x -= weights[idx]; idx++; }
    const p = products[idx]; if (!chosen.has(p.id)) chosen.set(p.id, ri(p.lo, p.hi));
  }
  return [...chosen.entries()];
}
function makeOrder(d, opts = {}) {
  const want = opts.items || chooseItems(d);
  const lines = [];
  for (const [pid, qty] of want) { const q = Math.min(qty, st[pid].phys - st[pid].res); if (q > 0) lines.push([pid, q]); }
  if (!lines.length) return null;
  let plan = opts.plan;
  if (!plan) plan = d >= 3 ? 'complete' : d === 2 ? 'dispatched' : d === 1 ? 'ready' : (rnd() < 0.5 ? 'pending' : 'processing');
  const id = T_.customer_orders.length + 1;
  const items = lines.map(([pid, q]) => ({ id: T_.customer_order_items.length + 1 + lines.findIndex((l) => l[0] === pid), order_id: id, product_id: pid, quantity: q, unit_price: round2(P(pid).price * (1 - rnd() * 0.04)) }));
  const total = round2(items.reduce((a, i) => a + i.quantity * i.unit_price, 0));
  const order = { id, order_no: docNo('SO', d), customer_id: opts.customer || ri(1, CUSTOMERS.length), status: plan === 'complete' ? 'Completed' : 'Confirmed', order_date: now(d), required_date: D(plan === 'stuck' ? 3 : d - ri(2, 7)), total_amount: total, notes: opts.notes || null, cancel_reason: null, idempotency_key: null, created_by: SALES, created_at: now(d) };
  T_.customer_orders.push(order); T_.customer_order_items.push(...items);
  const delivery = { id, delivery_no: docNo('DLV', d), order_id: id, status: 'Pending', driver_name: null, vehicle_no: null, scheduled_date: D(plan === 'stuck' ? 4 : d - 2), dispatched_at: null, delivered_at: null, failure_reason: null, updated_by: null, created_at: now(d), updated_at: now(d) };
  T_.deliveries.push(delivery);
  const reservations = items.map((it) => ({ id: T_.stock_reservations.length + 1 + items.indexOf(it), order_id: id, order_item_id: it.id, product_id: it.product_id, quantity: it.quantity, status: 'Active', created_at: now(d), updated_at: now(d) }));
  T_.stock_reservations.push(...reservations);
  items.forEach((it) => txn(it.product_id, 'RESERVE', 0, it.quantity, d, { refType: 'customer_order', refId: id, refNo: order.order_no, by: SALES, notes: 'Stock reserved for order' }));
  audit(d, SALES, 'ORDER_CREATED', 'customer_order', id, { order_no: order.order_no, total });
  const dispatch = (day) => {
    items.forEach((it) => txn(it.product_id, 'SALE_DISPATCH', -it.quantity, -it.quantity, day, { refType: 'customer_order', refId: id, refNo: order.order_no, by: WH, notes: 'Dispatched ' + delivery.delivery_no }));
    reservations.forEach((r) => { r.status = 'Fulfilled'; });
    delivery.status = 'Dispatched'; delivery.driver_name = pick(DRIVERS); delivery.vehicle_no = pick(VEHICLES); delivery.dispatched_at = now(day); delivery.updated_by = WH;
    audit(day, WH, 'DELIVERY_DISPATCHED', 'delivery', id, { delivery_no: delivery.delivery_no });
  };
  if (plan === 'complete' || plan === 'dispatched' || plan === 'failed') schedule(d - 2, () => dispatch(d - 2));
  if (plan === 'complete') schedule(d - 3, () => { delivery.status = 'Delivered'; delivery.delivered_at = now(d - 3); order.status = 'Completed'; audit(d - 3, WH, 'DELIVERY_DELIVERED', 'delivery', id, { delivery_no: delivery.delivery_no }); });
  if (plan === 'failed') schedule(d - 3, () => {
    items.forEach((it) => txn(it.product_id, 'DELIVERY_RETURN', it.quantity, it.quantity, d - 3, { refType: 'customer_order', refId: id, refNo: order.order_no, by: WH, notes: 'Failed delivery - stock returned' }));
    reservations.forEach((r) => { r.status = 'Active'; });
    delivery.status = 'Failed Delivery'; delivery.failure_reason = 'Customer premises closed at delivery time'; delivery.delivered_at = null;
    audit(d - 3, WH, 'DELIVERY_FAILED', 'delivery', id, { delivery_no: delivery.delivery_no });
  });
  if (plan === 'ready') delivery.status = 'Ready for Dispatch';
  if (plan === 'processing' || plan === 'stuck') delivery.status = 'Processing';
  return order;
}

// ---------- scheduled "story" events ----------
schedule(60, () => createPO({ d: 60, supplierId: 1, lines: [[5, 15]], status: 'Cancelled', cancelReason: 'Superseded by revised requirement' }));
schedule(40, () => { // completed accessories cycle count
  const rid = 1; const when = 40;
  T_.stock_reconciliations.push({ id: rid, session_no: docNo('REC', when), title: 'Accessories cycle count', category_id: 5, status: 'Completed', notes: 'Monthly cycle count', created_by: WH, created_at: now(when), submitted_at: now(when), completed_at: now(when) });
  const deltas = { 15: 0, 16: -3, 17: 4, 18: -1, 19: 0 }; const reasons = { 16: 'Damaged units written off', 17: 'Unrecorded return from customer', 18: 'Miscounted at receiving' };
  Object.entries(deltas).forEach(([pidStr, delta0]) => {
    const pid = Number(pidStr); const s = st[pid]; const delta = Math.max(delta0, -(s.phys - s.res));
    const item = { id: T_.stock_reconciliation_items.length + 1, reconciliation_id: rid, product_id: pid, system_qty: s.phys, counted_qty: s.phys + delta, reason: delta ? reasons[pid] : null, status: delta ? 'Approved' : 'Matched', resolved_by: delta ? ADMIN : null, resolved_at: delta ? now(when) : null, resolution_note: delta ? 'Approved after recount' : null };
    T_.stock_reconciliation_items.push(item);
    if (delta) {
      txn(pid, 'ADJUSTMENT', delta, 0, when, { refType: 'stock_reconciliation', refId: rid, refNo: 'REC cycle count', by: ADMIN, notes: reasons[pid] });
      T_.stock_adjustments.push({ product_id: pid, reconciliation_id: rid, reconciliation_item_id: item.id, system_qty: item.system_qty, physical_qty: item.counted_qty, quantity_change: delta, reason: reasons[pid], approved_by: ADMIN, approved_at: now(when) });
      audit(when, ADMIN, 'STOCK_ADJUSTED', 'product', pid, { quantity_change: delta, reason: reasons[pid] });
    }
  });
});
// requisitions
const reqs = (id, d, by, status, priority, why, items, reviewer, note) => {
  const r = { id, req_number: docNo('REQ', d), requested_by: by, status, priority, justification: why, reviewed_by: reviewer || null, reviewed_at: reviewer ? now(d - 1) : null, review_note: note || null, created_at: now(d) };
  T_.purchase_requisitions.push(r);
  items.forEach(([pid, q]) => T_.purchase_requisition_items.push({ id: T_.purchase_requisition_items.length + 1, requisition_id: id, product_id: pid, quantity: q, estimated_price: P(pid).cost }));
  audit(d, by, 'REQ_CREATED', 'purchase_requisition', id, { req_number: r.req_number });
  return r;
};
schedule(25, () => createPO({ d: 25, supplierId: 1, lines: [[1, 20], [3, 12]], status: 'Sent to Supplier', expectedAgo: 12 }) && null);
schedule(18, () => { const po = createPO({ d: 18, supplierId: 2, lines: [[15, 40], [16, 150], [19, 60]], status: 'Sent to Supplier', expectedAgo: 2 }); schedule(3, () => receive(po, [[po._items[0], 25, 1], [po._items[1], 100, 0], [po._items[2], 40, 0]], 3)); });
schedule(16, () => createPO({ d: 16, supplierId: 5, lines: [[26, 50], [29, 40], [27, 30]], status: 'Sent to Supplier', expectedAgo: 4 }));
schedule(10, () => reqs(3, 10, PROC, 'Rejected', 'Low', 'Restock Canon printers', [[22, 40]], MGMT, 'Slow-moving item - existing stock is sufficient'));
schedule(7, () => createPO({ d: 7, supplierId: 3, lines: [[9, 40], [8, 50], [10, 30]], status: 'Sent to Supplier', expectedAgo: -3 }));
schedule(6, () => reqs(2, 6, WH, 'Approved', 'Normal', 'Seasonal storage demand ahead of quarter end', [[26, 30], [29, 30]], MGMT, 'Approved - raise PO with DataVault'));
schedule(3, () => reqs(1, 3, WH, 'Pending', 'High', 'Router stock trending below minimum level', [[24, 20], [23, 40]]));
schedule(2, () => createPO({ d: 2, supplierId: 4, lines: [[23, 60], [24, 20], [25, 15]], status: 'Approved', expectedAgo: -6 }));
schedule(1, () => createPO({ d: 1, supplierId: 2, lines: [[20, 10], [21, 8]], status: 'Draft', expectedAgo: -9 }));
schedule(1, () => { const po = createPO({ d: 0, supplierId: 1, lines: [[1, 15], [2, 12], [3, 10]], status: 'Pending Approval', expectedAgo: -10, reqId: 4, notes: 'Converted from requisition' }); reqs(4, 1, PROC, 'Converted', 'High', 'Laptop stock running low ahead of demand', [[1, 15], [2, 12], [3, 10]], MGMT, 'Approved - converted to ' + po.po_number); });

// ---------- simulation ----------
for (let d = START; d >= 0; d--) {
  (events[d] || []).forEach((fn) => fn());
  if (d === START) products.forEach((p) => txn(p.id, 'INITIAL', Math.round(p.min + p.weekly * 5), 0, d, { refNo: 'OPENING-BALANCE', by: ADMIN, notes: 'Opening stock balance' }));
  if (d === 8) makeOrder(8, { items: [[18, 30], [19, 10]], plan: 'stuck', customer: 4, notes: 'Awaiting customer site access' });
  if (d === 7) makeOrder(7, { items: [[9, Infinity]], customer: 8, notes: 'Campus rollout' });
  if (d === 5) makeOrder(5, { items: [[16, 40], [17, 6]], plan: 'failed', customer: 6 });
  if (d === 3) { const s = st[23]; const want = s.phys - s.res - (P(23).min - 2); if (want > 0) makeOrder(3, { items: [[23, want]], customer: 4 }); }
  if (d === 1) makeOrder(1, { items: [[2, Infinity]], customer: 7, notes: 'Branch refresh' });
  const dow = dowOf(d);
  const nOrders = dow === 0 ? 0 : dow === 6 ? ri(0, 2) : ri(2, 4);
  for (let k = 0; k < nOrders; k++) makeOrder(d);
  if (d >= 30 && d <= START - 6 && d % 3 === 0) {
    const bySupplier = {};
    products.forEach((p) => {
      const avail = st[p.id].phys - st[p.id].res + incoming[p.id];
      if (avail < p.min + p.weekly * (p.lead / 7 + 0.5)) (bySupplier[p.sup[0]] = bySupplier[p.sup[0]] || []).push([p.id, Math.max(p.reorder, Math.ceil(p.weekly * 3))]);
    });
    Object.entries(bySupplier).forEach(([sid, lines]) => histPO(d, Number(sid), lines));
  }
}

// ---------- finalise ----------
products.forEach((p) => T_.inventory.push({ product_id: p.id, physical_qty: st[p.id].phys, reserved_qty: st[p.id].res, version: st[p.id].ver }));
[...T_.purchase_orders].forEach((po) => { delete po._items; delete po._exp; });
const settings = [['forecast_window_days', '90', 'Days of sales history used to compute average daily demand'], ['safety_stock_days', '7', 'Days of average demand kept as safety stock'], ['cover_days', '30', 'Days of demand a replenishment order should cover beyond the lead time'], ['delayed_order_grace_days', '0', 'Days after the required date before an order is flagged as delayed']];

const out = [];
out.push('-- =====================================================================');
out.push('-- SmartProcure sample data (generated by server/scripts/generate-seed.js)');
out.push('-- Demo users (password for all: ' + DEMO_PASSWORD + '):');
USERS.forEach((u) => out.push(`--   ${u[1]}  (${ROLES[u[2] - 1][0]})`));
out.push('-- All dates are relative to the moment this script is imported.');
out.push('-- =====================================================================');
out.push('USE wholesale_procurement_db;', 'SET NAMES utf8mb4;', 'START TRANSACTION;');
const order = ['roles', 'permissions', 'role_permissions', 'users', 'product_categories', 'products', 'product_serials', 'suppliers', 'supplier_products', 'inventory', 'purchase_requisitions', 'purchase_requisition_items', 'purchase_orders', 'purchase_order_items', 'goods_received_notes', 'goods_received_items', 'inventory_transactions', 'customers', 'customer_orders', 'customer_order_items', 'stock_reservations', 'deliveries', 'stock_reconciliations', 'stock_reconciliation_items', 'stock_adjustments', 'audit_logs'];
const sortKey = { inventory_transactions: 'created_at', audit_logs: 'created_at' };
order.forEach((name) => {
  const rows = T_[name]; if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  out.push(`\n-- ${name} (${rows.length})`);
  for (let i = 0; i < rows.length; i += 150) {
    const chunk = rows.slice(i, i + 150).map((r) => '(' + cols.map((c) => esc(r[c])).join(', ') + ')');
    out.push(`INSERT INTO ${name} (${cols.join(', ')}) VALUES\n${chunk.join(',\n')};`);
  }
});
out.push('\n-- document number sequences so new numbers continue after the sample data');
Object.entries(counters).forEach(([k, v]) => out.push(`INSERT INTO doc_sequences (seq_key, last_number) VALUES (${esc(k)}, ${v});`));
out.push('\n-- settings');
settings.forEach(([k, v, desc]) => out.push(`INSERT INTO settings (setting_key, setting_value, description) VALUES (${esc(k)}, ${esc(v)}, ${esc(desc)});`));
out.push('COMMIT;');

const target = path.resolve(__dirname, '../../database/seed.sql');
fs.writeFileSync(target, out.join('\n') + '\n');
const low = products.filter((p) => st[p.id].phys - st[p.id].res <= p.min).map((p) => `${p.sku}: ${st[p.id].phys}/${st[p.id].res}`);
console.log(`seed.sql written: ${T_.customer_orders.length} orders, ${T_.purchase_orders.length} POs, ${T_.goods_received_notes.length} GRNs, ${T_.inventory_transactions.length} ledger rows`);
console.log('low/out of stock (physical/reserved):', low.join(' | ') || 'none');
