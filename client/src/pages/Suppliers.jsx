import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, Card, ErrorState, Field, PageHeader, StatCard, Tabs } from '../components/ui.jsx';
import { ChartTooltip, axis, grid } from '../components/chartTheme.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api } from '../services/api.js';
import { fmtDate, money, num } from '../utils/format.js';
import { Clock, Gauge, Hourglass, AlertCircle } from 'lucide-react';

const pct = (v) => (v === null || v === undefined ? <span className="muted">n/a</span> : <b style={{ color: v >= 90 ? '#4ade80' : v >= 75 ? '#fbbf24' : '#f87171' }}>{v}%</b>);

function SupplierForm({ supplier, onClose, onSaved }) {
  const { toast } = useUi(); const editing = !!supplier?.id;
  const [f, setF] = useState({ name: supplier?.name || '', contactPerson: supplier?.contact_person || '', email: supplier?.email || '', phone: supplier?.phone || '', address: supplier?.address || '', city: supplier?.city || '', country: supplier?.country || '', paymentTerms: supplier?.payment_terms || 'Net 30', isActive: supplier ? !!supplier.is_active : true });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const e = {}; if (f.name.trim().length < 2) e.name = 'Enter the supplier name'; if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Enter a valid email address';
    setErr(e); if (Object.keys(e).length) return;
    setBusy(true);
    try { if (editing) await api.put(`/suppliers/${supplier.id}`, f); else await api.post('/suppliers', f); toast.success(editing ? 'Supplier updated' : 'Supplier registered'); onSaved(); }
    catch (x) { toast.error(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? `Edit ${supplier.name}` : 'Register supplier'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save supplier'}</button></>}>
      <div className="form-grid">
        <Field label="Supplier name *" error={err.name} className="span-2"><input value={f.name} onChange={set('name')} maxLength={150} /></Field>
        <Field label="Contact person"><input value={f.contactPerson} onChange={set('contactPerson')} /></Field>
        <Field label="Payment terms"><input value={f.paymentTerms} onChange={set('paymentTerms')} /></Field>
        <Field label="Email" error={err.email}><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Address" className="span-2"><input value={f.address} onChange={set('address')} /></Field>
        <Field label="City"><input value={f.city} onChange={set('city')} /></Field>
        <Field label="Country"><input value={f.country} onChange={set('country')} /></Field>
        {editing && <label className="check span-2"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /><span>Supplier is active</span></label>}
      </div>
    </Modal>
  );
}

function SupplierDetail({ id, onClose, onEdit, canManage }) {
  const { data: s, loading, reload } = useFetch(`/suppliers/${id}`, { live: ['data:changed'] });
  const products = useFetch('/products'); const { toast } = useUi();
  const [tab, setTab] = useState('history'); const [add, setAdd] = useState({ productId: '', unitPrice: '', leadTimeDays: '' });
  if (loading && !s) return null; if (!s) return null;
  const linked = new Set(s.products.map((p) => p.product_id));
  const save = async () => { try { await api.put(`/suppliers/${id}/products`, { productId: Number(add.productId), unitPrice: Number(add.unitPrice), leadTimeDays: add.leadTimeDays === '' ? null : Number(add.leadTimeDays) }); toast.success('Supplied product saved'); setAdd({ productId: '', unitPrice: '', leadTimeDays: '' }); reload(); } catch (e) { toast.error(e.message); } };
  const remove = async (pid) => { try { await api.del(`/suppliers/${id}/products/${pid}`); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <Modal title={s.name} subtitle={`${s.code} - ${[s.city, s.country].filter(Boolean).join(', ') || 'No address'}`} onClose={onClose} size="lg" footer={canManage && <button className="btn btn-ghost" onClick={() => onEdit(s)}><Pencil size={15} /> Edit supplier</button>}>
      <div className="grid grid-4 mb">
        <StatCard icon={Clock} tone="cyan" label="On-time delivery" value={s.on_time_pct === null ? 'n/a' : `${s.on_time_pct}%`} hint={`${s.delivered_orders} delivered orders`} />
        <StatCard icon={Gauge} tone="violet" label="Fulfilment rate" value={s.fulfillment_pct === null ? 'n/a' : `${s.fulfillment_pct}%`} hint="Accepted / ordered units" />
        <StatCard icon={Hourglass} tone="info" label="Avg delivery time" value={s.avg_delivery_days === null ? 'n/a' : `${s.avg_delivery_days} d`} hint="Order to first receipt" />
        <StatCard icon={AlertCircle} tone={s.overdue_orders ? 'danger' : 'warning'} label="Incomplete orders" value={num(s.incomplete_orders)} hint={`${s.overdue_orders} overdue - ${money(s.outstanding_value, 0)} outstanding`} />
      </div>
      <dl className="kv mb"><dt>Contact</dt><dd>{s.contact_person || '-'}</dd><dt>Email / phone</dt><dd>{[s.email, s.phone].filter(Boolean).join(' - ') || '-'}</dd><dt>Address</dt><dd>{s.address || '-'}</dd><dt>Payment terms</dt><dd>{s.payment_terms || '-'}</dd><dt>Total spend</dt><dd>{money(s.total_spend)} across {s.total_orders} orders</dd></dl>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'history', label: 'Transaction history', count: s.history.length }, { key: 'products', label: 'Supplied products', count: s.products.length }]} />
      {tab === 'history' ? (
        <DataTable searchable={false} pageSize={6} rows={s.history} emptyText="No purchase orders yet" columns={[
          { key: 'po_number', label: 'PO', render: (r) => <span className="mono">{r.po_number}</span> }, { key: 'order_date', label: 'Ordered', render: (r) => fmtDate(r.order_date) }, { key: 'expected_date', label: 'Expected', render: (r) => fmtDate(r.expected_date) },
          { key: 'first_received', label: 'First received', render: (r) => (r.first_received ? <span style={{ color: r.first_received > String(r.expected_date).slice(0, 10) ? '#f87171' : '#4ade80' }}>{fmtDate(r.first_received)}</span> : '-') },
          { key: 'total_amount', label: 'Total', align: 'right', render: (r) => money(r.total_amount) }, { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> }]} />
      ) : (
        <div className="stack">
          {canManage && <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Product" className="grow"><select value={add.productId} onChange={(e) => { const p = (products.data || []).find((x) => x.id === Number(e.target.value)); setAdd({ ...add, productId: e.target.value, unitPrice: p ? p.unit_cost : '' }); }}><option value="">Select...</option>{(products.data || []).filter((p) => p.is_active && !linked.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></Field>
            <Field label="Unit price"><input type="number" min="0" step="0.01" value={add.unitPrice} onChange={(e) => setAdd({ ...add, unitPrice: e.target.value })} style={{ width: 110 }} /></Field>
            <Field label="Lead (days)"><input type="number" min="0" value={add.leadTimeDays} onChange={(e) => setAdd({ ...add, leadTimeDays: e.target.value })} style={{ width: 90 }} /></Field>
            <button className="btn btn-primary" disabled={!add.productId || add.unitPrice === ''} onClick={save}><Plus size={15} /> Add</button></div>}
          <DataTable searchable={false} pageSize={8} rows={s.products} rowKey="product_id" emptyText="No supplied products linked" columns={[
            { key: 'name', label: 'Product', render: (r) => <div><div className="cell-title">{r.name}</div><div className="cell-sub mono">{r.sku}</div></div> }, { key: 'unit_price', label: 'Agreed price', align: 'right', render: (r) => money(r.unit_price) },
            { key: 'lead_time_days', label: 'Lead time', align: 'right', render: (r) => (r.lead_time_days ? `${r.lead_time_days} d` : '-') },
            { key: 'a', label: '', sortable: false, align: 'right', render: (r) => canManage && <button className="icon-btn" aria-label="Remove" onClick={() => remove(r.product_id)}><Trash2 size={15} /></button> }]} />
        </div>
      )}
    </Modal>
  );
}

export default function Suppliers() {
  const { can } = useAuth(); const canManage = can('suppliers.manage');
  const { data, loading, error, reload } = useFetch('/suppliers', { live: ['data:changed'] });
  const [form, setForm] = useState(null); const [detail, setDetail] = useState(null);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const active = (data || []).filter((s) => s.is_active);
  const chart = active.map((s) => ({ name: s.name.split(' ').slice(0, 2).join(' '), 'On-time %': s.on_time_pct || 0, 'Fulfilment %': s.fulfillment_pct || 0, 'Avg delivery (days)': s.avg_delivery_days || 0 }));
  const cols = [
    { key: 'name', label: 'Supplier', render: (s) => <div><div className="cell-title">{s.name}{!s.is_active && <> <Badge tone="neutral" dot={false}>inactive</Badge></>}</div><div className="cell-sub">{s.code} - {s.contact_person || 'no contact'} - {s.country || ''}</div></div> },
    { key: 'on_time_pct', label: 'On-time', align: 'right', render: (s) => pct(s.on_time_pct) },
    { key: 'fulfillment_pct', label: 'Fulfilment', align: 'right', render: (s) => pct(s.fulfillment_pct) },
    { key: 'avg_delivery_days', label: 'Avg delivery', align: 'right', render: (s) => (s.avg_delivery_days === null ? <span className="muted">n/a</span> : `${s.avg_delivery_days} d`) },
    { key: 'incomplete_orders', label: 'Incomplete', align: 'right', render: (s) => <span>{s.incomplete_orders}{s.overdue_orders > 0 && <span className="badge badge-danger" style={{ marginLeft: 6 }}>{s.overdue_orders} overdue</span>}</span> },
    { key: 'outstanding_value', label: 'Outstanding', align: 'right', render: (s) => money(s.outstanding_value, 0) },
    { key: 'total_spend', label: 'Total spend', align: 'right', render: (s) => money(s.total_spend, 0) },
    { key: 'a', label: '', sortable: false, searchable: false, align: 'right', render: (s) => canManage && <button className="icon-btn" aria-label="Edit" onClick={(e) => { e.stopPropagation(); setForm(s); }}><Pencil size={15} /></button> },
  ];
  return (
    <>
      <PageHeader title="Suppliers" subtitle="Delivery performance is measured from verified goods received notes - not from supplier claims."
        actions={canManage && <button className="btn btn-primary" onClick={() => setForm({})}><Plus size={16} /> Register supplier</button>} />
      <Card title="Supplier comparison" subtitle="On-time delivery and fulfilment (%) side by side" className="mb">
        <div className="chart-box"><ResponsiveContainer><BarChart data={chart} margin={{ left: -8, right: 8 }}>
          <CartesianGrid {...grid} /><XAxis dataKey="name" {...axis} interval={0} /><YAxis {...axis} domain={[0, 100]} width={40} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(59,130,246,.08)' }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="On-time %" fill="#22d3ee" radius={[5, 5, 0, 0]} /><Bar dataKey="Fulfilment %" fill="#8b5cf6" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </Card>
      <DataTable columns={cols} rows={data || []} loading={loading} searchPlaceholder="Search suppliers..." onRowClick={(s) => setDetail(s.id)} />
      {form && <SupplierForm supplier={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {detail && <SupplierDetail id={detail} onClose={() => setDetail(null)} canManage={canManage} onEdit={(s) => { setDetail(null); setForm(s); }} />}
    </>
  );
}
