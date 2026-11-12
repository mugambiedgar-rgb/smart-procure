'use strict';
/**
 * End-to-end test of the running API (server must be up, database seeded).
 *   npm run test --prefix server          (or: node server/tests/smoke.test.js)
 * It WRITES data (orders, POs, GRNs ...). Run "npm run db:reset" afterwards for a clean demo database.
 */
const BASE = process.env.API_URL || 'http://localhost:5000/api';
let passed = 0; let failed = 0;
const ok = (cond, name, extra = '') => { if (cond) { passed++; console.log(`  PASS  ${name}`); } else { failed++; console.log(`  FAIL  ${name} ${extra}`); } };

async function call(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) data = await r.json(); else await r.arrayBuffer();
  return { status: r.status, data, ct };
}
async function login(email) { const r = await call(null, 'POST', '/auth/login', { email, password: 'Password@123' }); if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`); return r.data.token; }
const today = new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  console.log('\n== Authentication & access control');
  const bad = await call(null, 'POST', '/auth/login', { email: 'admin@smartprocure.com', password: 'wrong' });
  ok(bad.status === 401, 'wrong password is rejected (401)');
  ok((await call(null, 'GET', '/products')).status === 401, 'API requires a token (401)');
  const admin = await login('admin@smartprocure.com'); const proc = await login('procurement@smartprocure.com');
  const wh = await login('warehouse@smartprocure.com'); const sales = await login('sales@smartprocure.com'); const mgmt = await login('management@smartprocure.com');
  ok((await call(sales, 'GET', '/suppliers')).status === 403, 'Sales Officer cannot view suppliers (403)');
  ok((await call(proc, 'POST', '/products', {})).status === 403, 'Procurement Officer cannot create products (403)');
  ok((await call(sales, 'POST', '/grn/1/verify')).status === 403, 'Sales Officer cannot verify a GRN (403)');
  ok((await call(proc, 'POST', '/purchase-orders/1/approve')).status === 403, 'Procurement Officer cannot approve a PO (403)');
  ok((await call(mgmt, 'GET', '/reports')).status === 200, 'Management can view reports');
  ok((await call(proc, 'GET', '/users')).status === 403, 'Only admin can list users (403)');

  console.log('\n== Dashboard (all figures from MySQL)');
  const dash = await call(admin, 'GET', '/dashboard');
  ok(dash.status === 200 && dash.data.kpis.total_products > 0, 'dashboard returns KPIs', JSON.stringify(dash.data).slice(0, 200));
  ok(Array.isArray(dash.data.charts.monthlyExpenditure) && dash.data.charts.valuation.length > 0, 'dashboard returns chart datasets');

  console.log('\n== Inventory: available = physical - reserved');
  const prods = (await call(admin, 'GET', '/products')).data;
  ok(prods.every((p) => p.available_qty === p.physical_qty - p.reserved_qty), 'available equals physical minus reserved for every product');
  const customers = (await call(sales, 'GET', '/customers')).data;
  const cust = customers[0].id;
  const target = prods.find((p) => p.available_qty >= 6 && p.available_qty <= 40 && p.is_active);
  const before = (await call(admin, 'GET', `/products/${target.id}`)).data;
  console.log(`  (test product: ${target.sku} physical=${before.physical_qty} reserved=${before.reserved_qty} available=${before.available_qty} incoming=${before.incoming_qty})`);

  console.log('\n== Overselling prevention under concurrency');
  const N = before.available_qty; const attempts = N + 8;
  const results = await Promise.all(Array.from({ length: attempts }, (_, i) => call(sales, 'POST', '/orders', { customerId: cust, items: [{ productId: target.id, quantity: 1 }], idempotencyKey: `conc-${Date.now()}-${i}` })));
  const accepted = results.filter((r) => r.status === 201).length; const refused = results.filter((r) => r.status === 409).length;
  ok(accepted === N, `exactly ${N} of ${attempts} simultaneous 1-unit orders accepted`, `accepted=${accepted}`);
  ok(refused === attempts - N, `the other ${attempts - N} refused with 409 (insufficient stock)`, `refused=${refused}`);
  const after = (await call(admin, 'GET', `/products/${target.id}`)).data;
  ok(after.reserved_qty === before.reserved_qty + N && after.available_qty === 0, 'reserved stock rose by exactly the accepted quantity; available is 0 (never negative)', `reserved ${after.reserved_qty} available ${after.available_qty}`);
  ok(after.physical_qty === before.physical_qty, 'physical stock unchanged by reservations');
  const orderIds = results.filter((r) => r.status === 201).map((r) => r.data.id);

  console.log('\n== Idempotency (double-click protection)');
  const key = `idem-${Date.now()}`;
  const stockProd = prods.find((p) => p.available_qty >= 3 && p.id !== target.id);
  const a = await call(sales, 'POST', '/orders', { customerId: cust, items: [{ productId: stockProd.id, quantity: 1 }], idempotencyKey: key });
  const b = await call(sales, 'POST', '/orders', { customerId: cust, items: [{ productId: stockProd.id, quantity: 1 }], idempotencyKey: key });
  ok(a.status === 201 && b.status === 200 && a.data.id === b.data.id, 'repeating the same request does not create a second order');

  console.log('\n== Cancel releases reservation');
  const c1 = orderIds[0];
  const cancel = await call(sales, 'POST', `/orders/${c1}/cancel`, { reason: 'Test cancellation' });
  const afterCancel = (await call(admin, 'GET', `/products/${target.id}`)).data;
  ok(cancel.status === 200 && afterCancel.reserved_qty === after.reserved_qty - 1 && afterCancel.available_qty === 1, 'cancelling an order releases its reserved unit');

  console.log('\n== Delivery lifecycle changes PHYSICAL stock only on dispatch');
  const c2 = orderIds[1]; const orderDetail = (await call(sales, 'GET', `/orders/${c2}`)).data;
  const delId = orderDetail.delivery.id;
  ok((await call(wh, 'POST', `/deliveries/${delId}/status`, { status: 'Dispatched', driverName: 'T' })).status === 409, 'cannot skip straight from Pending to Dispatched (409)');
  await call(wh, 'POST', `/deliveries/${delId}/status`, { status: 'Processing' });
  await call(wh, 'POST', `/deliveries/${delId}/status`, { status: 'Ready for Dispatch' });
  const pre = (await call(admin, 'GET', `/products/${target.id}`)).data;
  const disp = await call(wh, 'POST', `/deliveries/${delId}/status`, { status: 'Dispatched', driverName: 'Test Driver', vehicleNo: 'VAN-01' });
  const post = (await call(admin, 'GET', `/products/${target.id}`)).data;
  ok(disp.status === 200 && post.physical_qty === pre.physical_qty - 1 && post.reserved_qty === pre.reserved_qty - 1, `dispatch: physical ${pre.physical_qty} -> ${post.physical_qty}, reserved ${pre.reserved_qty} -> ${post.reserved_qty}`);
  const fail = await call(wh, 'POST', `/deliveries/${delId}/status`, { status: 'Failed Delivery', failureReason: 'Customer absent' });
  const post2 = (await call(admin, 'GET', `/products/${target.id}`)).data;
  ok(fail.status === 200 && post2.physical_qty === pre.physical_qty && post2.reserved_qty === pre.reserved_qty, 'failed delivery returns stock to physical and keeps it reserved');

  console.log('\n== Procurement: duplicate prevention and approval workflow');
  const supplierId = (await call(proc, 'GET', '/suppliers')).data[0].id;
  const poProduct = prods.find((p) => p.id === target.id);
  const poBody = { supplierId, expectedDate: inDays(10), items: [{ productId: poProduct.id, quantity: 20, unitPrice: 100 }], submit: true };
  const po1 = await call(proc, 'POST', '/purchase-orders', { ...poBody, idempotencyKey: `po-${Date.now()}-1` });
  ok(po1.status === 201 && /^PO-\d{4}-\d{5}$/.test(po1.data.poNumber), `PO created with unique number ${po1.data.poNumber}`);
  const dup = await call(proc, 'POST', '/purchase-orders', { ...poBody, idempotencyKey: `po-${Date.now()}-2` });
  ok(dup.status === 409 && dup.data.code === 'DUPLICATE_WARNING' && dup.data.duplicates.length > 0, 'a similar active order triggers a duplicate warning (409)');
  const forced = await call(proc, 'POST', '/purchase-orders', { ...poBody, confirmDuplicate: true, idempotencyKey: `po-${Date.now()}-3` });
  ok(forced.status === 201 && forced.data.poNumber !== po1.data.poNumber, 'after confirmation the duplicate-like order is created with a different PO number');
  const poId = po1.data.id;
  ok((await call(proc, 'POST', `/purchase-orders/${poId}/send`)).status === 409, 'a PO that is not approved cannot be sent (409)');
  ok((await call(mgmt, 'POST', `/purchase-orders/${poId}/approve`)).status === 200, 'Management approves the PO');
  const incomingBefore = (await call(admin, 'GET', `/products/${target.id}`)).data;
  ok(incomingBefore.incoming_qty >= 20, 'approved PO quantity shows as INCOMING');
  ok(incomingBefore.available_qty === post2.available_qty, 'incoming stock is NOT counted as available');
  ok((await call(proc, 'POST', `/purchase-orders/${poId}/send`)).status === 200, 'PO sent to supplier');
  const pdf = await call(proc, 'GET', `/purchase-orders/${poId}/pdf`);
  ok(pdf.status === 200 && pdf.ct.includes('pdf'), 'printable PO PDF is generated');

  console.log('\n== Goods received: stock increases only after verification');
  const poFull = (await call(wh, 'GET', `/purchase-orders/${poId}`)).data;
  const line = poFull.items[0];
  ok((await call(wh, 'POST', '/grn', { poId, items: [{ poItemId: line.id, quantityDelivered: 25, quantityDamaged: 0 }] })).status === 400, 'over-delivery (25 > 20 ordered) is refused');
  const physBefore = (await call(admin, 'GET', `/products/${target.id}`)).data.physical_qty;
  const grn = await call(wh, 'POST', '/grn', { poId, deliveryNoteRef: 'DN-TEST', deliveredByName: 'Supplier Driver', items: [{ poItemId: line.id, quantityDelivered: 12, quantityDamaged: 2, remarks: 'Two boxes crushed' }] });
  ok(grn.status === 201, `GRN ${grn.data.grnNumber} recorded (draft)`);
  const physDraft = (await call(admin, 'GET', `/products/${target.id}`)).data.physical_qty;
  ok(physDraft === physBefore, 'recording a GRN does NOT change physical stock');
  ok((await call(proc, 'POST', `/grn/${grn.data.id}/verify`)).status === 403, 'Procurement Officer cannot verify goods');
  const ver = await call(wh, 'POST', `/grn/${grn.data.id}/verify`);
  const physAfter = (await call(admin, 'GET', `/products/${target.id}`)).data.physical_qty;
  ok(ver.status === 200 && physAfter === physBefore + 10 && ver.data.poStatus === 'Partially Received', `verification adds only accepted units (12 delivered - 2 damaged): ${physBefore} -> ${physAfter}; PO Partially Received`);
  const again = await Promise.all([call(wh, 'POST', `/grn/${grn.data.id}/verify`), call(wh, 'POST', `/grn/${grn.data.id}/verify`)]);
  ok(again.every((r) => r.status === 409) && (await call(admin, 'GET', `/products/${target.id}`)).data.physical_qty === physAfter, 'verifying the same GRN twice never doubles stock');
  const grn2 = await call(wh, 'POST', '/grn', { poId, items: [{ poItemId: line.id, quantityDelivered: 10, quantityDamaged: 0 }] });
  await call(wh, 'POST', `/grn/${grn2.data.id}/verify`);
  ok((await call(wh, 'GET', `/purchase-orders/${poId}`)).data.status === 'Fully Received', 'PO becomes Fully Received once all units are accepted');
  const ledger = (await call(admin, 'GET', `/products/movements?productId=${target.id}&limit=5`)).data;
  ok(ledger.length > 0 && ledger[0].physical_after - ledger[0].physical_before === ledger[0].physical_change, 'movement ledger records before/after for every change');

  console.log('\n== Stock reconciliation');
  const rec = await call(wh, 'POST', '/reconciliations', { title: 'Test count', categoryId: prods.find((p) => p.id === target.id).category_id });
  const recDetail = (await call(wh, 'GET', `/reconciliations/${rec.data.id}`)).data;
  const counts = recDetail.items.map((i, idx) => ({ itemId: i.id, countedQty: idx === 0 ? Math.max(0, i.system_qty - 1) : i.system_qty, reason: idx === 0 ? 'Damaged unit found' : null }));
  await call(wh, 'PUT', `/reconciliations/${rec.data.id}/counts`, { counts });
  ok((await call(wh, 'POST', `/reconciliations/${rec.data.id}/submit`)).status === 200, 'count session submitted with a recorded variance');
  const varItem = recDetail.items[0]; const stockBefore = (await call(admin, 'GET', `/products/${varItem.product_id}`)).data.physical_qty;
  ok((await call(sales, 'POST', `/reconciliations/${rec.data.id}/resolve`, { itemId: varItem.id, action: 'approve' })).status === 403, 'Sales Officer cannot approve adjustments');
  const res = await call(wh, 'POST', `/reconciliations/${rec.data.id}/resolve`, { itemId: varItem.id, action: 'approve' });
  const stockAfter = (await call(admin, 'GET', `/products/${varItem.product_id}`)).data.physical_qty;
  ok(res.status === 200 && stockAfter === stockBefore - (varItem.system_qty - counts[0].countedQty), 'approved adjustment corrects physical stock');

  console.log('\n== Analytics, notifications, reports');
  const fc = await call(mgmt, 'GET', '/analytics/forecast');
  ok(fc.status === 200 && fc.data.rows.length > 0 && 'suggested_reorder_qty' in fc.data.rows[0], 'forecast returns suggested reorder quantities');
  const notes = await call(wh, 'GET', '/notifications');
  ok(notes.status === 200 && notes.data.items.length > 0, `warehouse user has notifications (${notes.data.unread} unread)`);
  if (notes.data.items.length) ok((await call(wh, 'POST', `/notifications/${notes.data.items[0].id}/read`)).status === 200, 'notification marked as read');
  for (const t of ['inventory', 'procurement-expenditure', 'supplier-performance', 'purchase-orders', 'goods-received', 'stock-reconciliation', 'sales-deliveries', 'inventory-movement']) {
    const r = await call(mgmt, 'GET', `/reports/${t}?from=2025-01-01&to=${today}`);
    ok(r.status === 200 && r.data.columns.length > 0, `report "${t}" (${r.data && r.data.count} rows)`);
  }
  const csv = await fetch(`${BASE}/reports/inventory?format=csv`, { headers: { Authorization: `Bearer ${mgmt}` } });
  const xlsx = await fetch(`${BASE}/reports/inventory?format=xlsx`, { headers: { Authorization: `Bearer ${mgmt}` } });
  const rpdf = await fetch(`${BASE}/reports/inventory?format=pdf`, { headers: { Authorization: `Bearer ${mgmt}` } });
  ok(csv.status === 200 && (await csv.text()).includes('Physical'), 'CSV export');
  ok(xlsx.status === 200 && (await xlsx.arrayBuffer()).byteLength > 2000, 'Excel export');
  ok(rpdf.status === 200 && (await rpdf.arrayBuffer()).byteLength > 1000, 'PDF export');
  ok((await call(sales, 'GET', '/reports/inventory')).status === 403, 'Sales Officer cannot generate reports (403)');

  console.log('\n== Audit trail');
  const aud = await call(admin, 'GET', '/audit?limit=20');
  ok(aud.status === 200 && aud.data.items.some((a) => a.action === 'GRN_VERIFIED'), 'audit log contains GRN_VERIFIED');

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Test run crashed:', e); process.exit(2); });
