import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Ban, Truck, AlertTriangle, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import LineEditor, { newLine } from '../components/LineEditor.jsx';
import { Badge, Field, PageHeader, Tabs } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api, ApiError } from '../services/api.js';
import { addDaysISO, fmtDate, fmtDateTime, money, num, todayISO, uid } from '../utils/format.js';

/* ------------------------------------------------------------ new order */
function OrderForm({ onClose, onSaved }) {
  const { toast } = useUi();
  const customers = useFetch('/customers'); const products = useFetch('/products', { live: ['inventory:update'] });
  const [customerId, setCustomerId] = useState(''); const [required, setRequired] = useState(addDaysISO(3)); const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([newLine()]); const [idem] = useState(uid); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [shortages, setShortages] = useState(null);
  const active = (products.data || []).filter((p) => p.is_active);
  const byId = useMemo(() => new Map(active.map((p) => [p.id, p])), [active]);
  const filled = lines.filter((l) => l.productId);
  const over = filled.filter((l) => Number(l.quantity) > (byId.get(Number(l.productId))?.available_qty ?? 0));
  const total = filled.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  const save = async () => {
    setError(''); setShortages(null);
    if (!customerId) return setError('Select a customer.'); if (!filled.length) return setError('Add at least one product.');
    if (filled.some((l) => !(Number(l.quantity) >= 1) || !Number.isInteger(Number(l.quantity)))) return setError('Quantities must be whole numbers of 1 or more.');
    setBusy(true);
    try {
      const r = await api.post('/orders', { customerId: Number(customerId), requiredDate: required || undefined, notes, idempotencyKey: idem, items: filled.map((l) => ({ productId: Number(l.productId), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })) });
      toast.success(r.message); onSaved();
    } catch (e) { if (e instanceof ApiError && e.data.shortages) setShortages(e.data.shortages); setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New customer order" subtitle="Availability is checked and stock is reserved the moment the order is confirmed." onClose={onClose} size="lg"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || over.length > 0} onClick={save}>{busy ? 'Confirming...' : 'Confirm order & reserve stock'}</button></>}>
      <div className="form-grid mb">
        <Field label="Customer *"><select value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">Select customer...</option>{(customers.data || []).filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Required delivery date"><input type="date" min={todayISO()} value={required} onChange={(e) => setRequired(e.target.value)} /></Field>
        <Field label="Notes" className="span-2"><input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={255} /></Field>
      </div>
      <LineEditor lines={lines} setLines={setLines} priceLabel="Unit price" defaultPrice={(id) => byId.get(id)?.selling_price ?? ''}
        options={active.map((p) => ({ id: p.id, label: `${p.name} (${p.sku}) - ${p.available_qty} available` }))}
        info={(l) => { const p = byId.get(Number(l.productId)); if (!p) return ''; const q = Number(l.quantity) || 0; return q > p.available_qty ? <span className="num-neg">Only {p.available_qty} available (physical {p.physical_qty}, reserved {p.reserved_qty}). Reduce the quantity.</span> : `Available ${p.available_qty} (physical ${p.physical_qty}, reserved ${p.reserved_qty})`; }} />
      {over.length > 0 && <div className="alert alert-danger mt"><AlertTriangle size={18} /><span>Overselling is blocked: reduce the highlighted quantities to what is available.</span></div>}
      {error && <div className="alert alert-danger mt" role="alert"><XCircle size={18} /><div>{error}{shortages && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{shortages.map((s) => <li key={s.productId}>{s.name}: requested {s.requested}, available {s.available}</li>)}</ul>}</div></div>}
      {total > 0 && <p className="muted small mt">Order value {money(total)}</p>}
    </Modal>
  );
}

function OrderDetail({ id, onClose, onChanged }) {
  const { can } = useAuth(); const { toast, confirm } = useUi();
  const { data: o, reload } = useFetch(`/orders/${id}`, { live: ['data:changed', 'inventory:update'] });
  if (!o) return null;
  const cancellable = o.status === 'Confirmed' && ['Pending', 'Processing', 'Ready for Dispatch', 'Failed Delivery'].includes(o.delivery?.status);
  const cancel = async () => {
    const reason = await confirm({ title: 'Cancel order', message: 'Reserved stock is released back to available stock.', prompt: 'Reason for cancelling', confirmText: 'Cancel order', danger: true }); if (!reason) return;
    try { await api.post(`/orders/${id}/cancel`, { reason }); toast.success('Order cancelled'); await reload(); onChanged(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal title={o.order_no} subtitle={`${o.customer_name} - ${[o.customer_address, o.customer_city].filter(Boolean).join(', ')}`} onClose={onClose} size="lg" footer={can('orders.manage') && cancellable && <button className="btn btn-danger" onClick={cancel}><Ban size={15} /> Cancel order</button>}>
      <div className="row mb"><Badge>{o.status}</Badge>{o.delivery && <Badge>{o.delivery.status}</Badge>}{o.cancel_reason && <span className="muted small">Reason: {o.cancel_reason}</span>}</div>
      <dl className="kv mb"><dt>Ordered</dt><dd>{fmtDateTime(o.order_date)} by {o.created_by_name}</dd><dt>Required by</dt><dd>{fmtDate(o.required_date)}</dd>{o.delivery && <><dt>Delivery</dt><dd><span className="mono">{o.delivery.delivery_no}</span>{o.delivery.driver_name ? ` - ${o.delivery.driver_name} (${o.delivery.vehicle_no || 'no vehicle'})` : ''}</dd></>}{o.notes && <><dt>Notes</dt><dd>{o.notes}</dd></>}</dl>
      <table className="table"><thead><tr><th>Product</th><th className="right">Qty</th><th className="right">Unit price</th><th className="right">Line total</th><th>Reservation</th></tr></thead><tbody>
        {o.items.map((i) => <tr key={i.id}><td><div className="cell-title">{i.name}</div><div className="cell-sub mono">{i.sku}</div></td><td className="right">{i.quantity}</td><td className="right">{money(i.unit_price)}</td><td className="right"><b>{money(i.line_total)}</b></td><td><Badge tone={i.reservation_status === 'Active' ? 'warning' : i.reservation_status === 'Fulfilled' ? 'success' : 'neutral'}>{i.reservation_status}</Badge></td></tr>)}</tbody></table>
      <div className="total-row"><span className="muted">Total</span><b>{money(o.total_amount)}</b></div>
    </Modal>
  );
}

/* ------------------------------------------------------------ customers */
function CustomerForm({ customer, onClose, onSaved }) {
  const { toast } = useUi(); const editing = !!customer?.id;
  const [f, setF] = useState({ name: customer?.name || '', contactPerson: customer?.contact_person || '', email: customer?.email || '', phone: customer?.phone || '', address: customer?.address || '', city: customer?.city || '', isActive: customer ? !!customer.is_active : true });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const e = {}; if (f.name.trim().length < 2) e.name = 'Enter the customer name'; if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Enter a valid email'; setErr(e); if (Object.keys(e).length) return;
    setBusy(true); try { if (editing) await api.put(`/customers/${customer.id}`, f); else await api.post('/customers', f); toast.success(editing ? 'Customer updated' : 'Customer registered'); onSaved(); } catch (x) { toast.error(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? `Edit ${customer.name}` : 'Register customer'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save customer</button></>}>
      <div className="form-grid">
        <Field label="Customer name *" error={err.name} className="span-2"><input value={f.name} onChange={set('name')} maxLength={150} /></Field>
        <Field label="Contact person"><input value={f.contactPerson} onChange={set('contactPerson')} /></Field><Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email" error={err.email}><input type="email" value={f.email} onChange={set('email')} /></Field><Field label="City"><input value={f.city} onChange={set('city')} /></Field>
        <Field label="Delivery address" className="span-2"><input value={f.address} onChange={set('address')} /></Field>
        {editing && <label className="check span-2"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /><span>Customer is active</span></label>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ deliveries */
const NEXT = { 'Pending': ['Processing'], 'Processing': ['Ready for Dispatch'], 'Ready for Dispatch': ['Dispatched'], 'Dispatched': ['Delivered', 'Failed Delivery'], 'Failed Delivery': ['Processing', 'Ready for Dispatch'], 'Delivered': [] };

function DeliveryAction({ d, onClose, onDone }) {
  const { toast } = useUi(); const [to, setTo] = useState(NEXT[d.status][0]);
  const [driver, setDriver] = useState(d.driver_name || ''); const [vehicle, setVehicle] = useState(d.vehicle_no || ''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async () => {
    setError('');
    if (to === 'Dispatched' && !driver.trim()) return setError('Assign a driver before dispatching.'); if (to === 'Failed Delivery' && reason.trim().length < 3) return setError('Record why the delivery failed.');
    setBusy(true); try { const r = await api.post(`/deliveries/${d.id}/status`, { status: to, driverName: driver, vehicleNo: vehicle, failureReason: reason }); toast.success(r.message); onDone(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Update ${d.delivery_no}`} subtitle={`${d.order_no} - ${d.customer_name}`} onClose={onClose} size="sm" footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Update status</button></>}>
      <div className="stack">
        <div className="row"><Badge>{d.status}</Badge><ArrowRight size={16} className="muted" /><select className="inline-select" value={to} onChange={(e) => setTo(e.target.value)}>{NEXT[d.status].map((s) => <option key={s}>{s}</option>)}</select></div>
        {(to === 'Dispatched' || to === 'Ready for Dispatch' || to === 'Processing') && <div className="form-grid"><Field label={`Driver${to === 'Dispatched' ? ' *' : ''}`}><input value={driver} onChange={(e) => setDriver(e.target.value)} /></Field><Field label="Vehicle"><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></Field></div>}
        {to === 'Failed Delivery' && <Field label="Reason for failure *"><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} /></Field>}
        {to === 'Dispatched' && <div className="alert alert-info"><span>Dispatching removes these units from <b>physical</b> stock and from reserved stock.</span></div>}
        {to === 'Failed Delivery' && d.status === 'Dispatched' && <div className="alert alert-warning"><span>The goods return to the warehouse and stay reserved for this customer.</span></div>}
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    </Modal>
  );
}

export default function Sales() {
  const { can } = useAuth(); const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || (can('orders.view') ? 'orders' : 'deliveries'));
  const [form, setForm] = useState(false); const [view, setView] = useState(null); const [custForm, setCustForm] = useState(null); const [act, setAct] = useState(null); const [status, setStatus] = useState('');
  const orders = useFetch('/orders', { live: ['data:changed'], skip: !can('orders.view') });
  const customers = useFetch('/customers', { live: ['data:changed'], skip: !can('customers.view', 'orders.view') });
  const deliveries = useFetch('/deliveries', { live: ['data:changed'], skip: !can('deliveries.view') });
  const reloadAll = () => { orders.reload(); deliveries.reload(); customers.reload(); };
  const delayed = (deliveries.data || []).filter((d) => d.is_delayed).length;

  const orderCols = [
    { key: 'order_no', label: 'Order', render: (o) => <span className="mono">{o.order_no}</span> },
    { key: 'customer_name', label: 'Customer', render: (o) => <div><div className="cell-title">{o.customer_name}</div><div className="cell-sub">{o.item_count} product(s) - {fmtDate(o.order_date)}</div></div> },
    { key: 'required_date', label: 'Required', render: (o) => <span style={o.is_delayed ? { color: '#f87171', fontWeight: 600 } : undefined}>{fmtDate(o.required_date)}{o.is_delayed ? ' (delayed)' : ''}</span> },
    { key: 'total_amount', label: 'Total', align: 'right', render: (o) => <b>{money(o.total_amount)}</b> },
    { key: 'delivery_status', label: 'Delivery', render: (o) => (o.delivery_status ? <Badge>{o.delivery_status}</Badge> : '-') },
    { key: 'status', label: 'Order status', render: (o) => <Badge>{o.status}</Badge> },
  ];
  const delCols = [
    { key: 'delivery_no', label: 'Delivery', render: (d) => <span className="mono">{d.delivery_no}</span> },
    { key: 'order_no', label: 'Order / customer', render: (d) => <div><div className="mono">{d.order_no}</div><div className="cell-sub">{d.customer_name}{d.customer_city ? `, ${d.customer_city}` : ''}</div></div> },
    { key: 'required_date', label: 'Required', render: (d) => <span style={d.is_delayed ? { color: '#f87171', fontWeight: 600 } : undefined}>{fmtDate(d.required_date)}{d.is_delayed ? ' (delayed)' : ''}</span> },
    { key: 'driver_name', label: 'Driver', render: (d) => (d.driver_name ? `${d.driver_name}${d.vehicle_no ? ` - ${d.vehicle_no}` : ''}` : <span className="muted">Unassigned</span>) },
    { key: 'status', label: 'Status', render: (d) => <div><Badge>{d.status}</Badge>{d.failure_reason && <div className="cell-sub">{d.failure_reason}</div>}</div> },
    { key: 'a', label: '', sortable: false, searchable: false, align: 'right', render: (d) => can('deliveries.manage') && NEXT[d.status].length > 0 && d.order_status === 'Confirmed' && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setAct(d); }}><Truck size={14} /> Update</button> },
  ];
  const custCols = [
    { key: 'name', label: 'Customer', render: (c) => <div><div className="cell-title">{c.name}{!c.is_active && <> <Badge tone="neutral" dot={false}>inactive</Badge></>}</div><div className="cell-sub">{c.customer_code} - {c.contact_person || ''}</div></div> },
    { key: 'email', label: 'Email / phone', render: (c) => <div><div>{c.email || '-'}</div><div className="cell-sub">{c.phone}</div></div> }, { key: 'city', label: 'City' },
    { key: 'order_count', label: 'Orders', align: 'right', render: (c) => num(c.order_count) }, { key: 'total_sales', label: 'Total sales', align: 'right', render: (c) => money(c.total_sales, 0) },
    { key: 'a', label: '', sortable: false, searchable: false, align: 'right', render: (c) => can('customers.manage') && <button className="icon-btn" aria-label="Edit" onClick={() => setCustForm(c)}><Pencil size={15} /></button> },
  ];
  return (
    <>
      <PageHeader title="Orders & deliveries" subtitle="Orders reserve stock immediately so nothing can be oversold. Stock leaves the warehouse when a delivery is dispatched."
        actions={can('orders.create') && <button className="btn btn-primary" onClick={() => setForm(true)}><Plus size={16} /> New order</button>} />
      {delayed > 0 && <div className="alert alert-danger mb"><AlertTriangle size={18} /><span><b>{delayed}</b> customer deliver{delayed > 1 ? 'ies are' : 'y is'} past the required date.</span></div>}
      <Tabs value={tab} onChange={(t) => { setTab(t); setStatus(''); }} tabs={[...(can('orders.view') ? [{ key: 'orders', label: 'Customer orders', count: orders.data?.length }] : []), ...(can('deliveries.view') ? [{ key: 'deliveries', label: 'Deliveries', count: (deliveries.data || []).filter((d) => d.status !== 'Delivered').length }] : []), ...(can('customers.view', 'orders.view') ? [{ key: 'customers', label: 'Customers', count: customers.data?.length }] : [])]} />
      {tab === 'orders' && <DataTable columns={orderCols} rows={(orders.data || []).filter((o) => !status || o.status === status)} loading={orders.loading} searchPlaceholder="Search orders, customers..." onRowClick={(o) => setView(o.id)} rowClass={(o) => (o.is_delayed ? 'row-danger' : '')}
        filters={<select className="inline-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Order status"><option value="">All orders</option><option>Confirmed</option><option>Completed</option><option>Cancelled</option></select>} />}
      {tab === 'deliveries' && <DataTable columns={delCols} rows={(deliveries.data || []).filter((d) => !status || d.status === status)} loading={deliveries.loading} searchPlaceholder="Search deliveries..." onRowClick={(d) => setView(d.order_id)} rowClass={(d) => (d.is_delayed ? 'row-danger' : d.status === 'Failed Delivery' ? 'row-warn' : '')}
        filters={<select className="inline-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Delivery status"><option value="">All statuses</option>{Object.keys(NEXT).map((s) => <option key={s}>{s}</option>)}</select>} />}
      {tab === 'customers' && <DataTable columns={custCols} rows={customers.data || []} loading={customers.loading} searchPlaceholder="Search customers..." toolbar={can('customers.manage') && <button className="btn btn-primary" onClick={() => setCustForm({})}><Plus size={16} /> Register customer</button>} />}
      {form && <OrderForm onClose={() => setForm(false)} onSaved={() => { setForm(false); reloadAll(); setTab('orders'); }} />}
      {view && <OrderDetail id={view} onClose={() => setView(null)} onChanged={reloadAll} />}
      {custForm && <CustomerForm customer={custForm.id ? custForm : null} onClose={() => setCustForm(null)} onSaved={() => { setCustForm(null); customers.reload(); }} />}
      {act && <DeliveryAction d={act} onClose={() => setAct(null)} onDone={() => { setAct(null); reloadAll(); }} />}
    </>
  );
}
