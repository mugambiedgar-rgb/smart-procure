import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Power, History, Info, ScanBarcode } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, Card, ErrorState, Field, PageHeader, StatCard, StockBar, Tabs } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api } from '../services/api.js';
import { fmtDateTime, money, num } from '../utils/format.js';
import { Boxes, Lock, CheckCircle2, Truck } from 'lucide-react';

const TXN_LABEL = { INITIAL: 'Opening balance', GRN_RECEIPT: 'Goods received', RESERVE: 'Reserved', RELEASE: 'Reservation released', SALE_DISPATCH: 'Dispatched to customer', DELIVERY_RETURN: 'Returned (failed delivery)', ADJUSTMENT: 'Stock adjustment' };
const signed = (n) => (n === 0 ? <span className="muted">0</span> : <span className={n > 0 ? 'num-pos' : 'num-neg'}>{n > 0 ? `+${n}` : n}</span>);

const EMPTY = { sku: '', name: '', categoryId: '', brand: '', description: '', unitCost: '', sellingPrice: '', minStockLevel: 5, leadTimeDays: 7, trackSerial: false, openingQuantity: 0 };

export function MovementsTable({ productId, limit = 300 }) {
  const [type, setType] = useState('');
  const { data, loading } = useFetch(`/products/movements?limit=${limit}${productId ? `&productId=${productId}` : ''}${type ? `&type=${type}` : ''}`, { live: ['inventory:update'] });
  const cols = [
    { key: 'created_at', label: 'When', render: (r) => <span className="nowrap">{fmtDateTime(r.created_at)}</span> },
    ...(productId ? [] : [{ key: 'product_name', label: 'Product', render: (r) => <div><div className="cell-title">{r.product_name}</div><div className="cell-sub mono">{r.sku}</div></div> }]),
    { key: 'txn_type', label: 'Type', render: (r) => <Badge tone={r.physical_change > 0 ? 'success' : r.physical_change < 0 ? 'info' : 'warning'} dot={false}>{TXN_LABEL[r.txn_type] || r.txn_type}</Badge> },
    { key: 'physical_change', label: 'Physical', align: 'right', render: (r) => <span>{signed(r.physical_change)} <span className="muted small">({r.physical_before} to {r.physical_after})</span></span> },
    { key: 'reserved_change', label: 'Reserved', align: 'right', render: (r) => <span>{signed(r.reserved_change)} <span className="muted small">({r.reserved_before} to {r.reserved_after})</span></span> },
    { key: 'reference_no', label: 'Reference', render: (r) => <span className="mono">{r.reference_no || '-'}</span> },
    { key: 'performed_by_name', label: 'By', render: (r) => r.performed_by_name || <span className="muted">System</span> },
  ];
  return (
    <DataTable columns={cols} rows={data || []} loading={loading} pageSize={productId ? 8 : 15} searchPlaceholder="Search movements..." emptyText="No stock movements"
      filters={<select className="inline-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Movement type"><option value="">All movement types</option>{Object.entries(TXN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>} />
  );
}

function ProductForm({ product, categories, onClose, onSaved }) {
  const { toast } = useUi();
  const editing = !!product;
  const [f, setF] = useState(editing ? { sku: product.sku, name: product.name, categoryId: product.category_id, brand: product.brand || '', description: product.description || '', unitCost: product.unit_cost, sellingPrice: product.selling_price, minStockLevel: product.min_stock_level, leadTimeDays: product.lead_time_days, trackSerial: !!product.track_serial } : EMPTY);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const validate = () => {
    const e = {};
    if (!f.sku.trim()) e.sku = 'SKU is required'; if (f.name.trim().length < 2) e.name = 'Enter the product name'; if (!f.categoryId) e.categoryId = 'Choose a category';
    if (f.unitCost === '' || Number(f.unitCost) < 0) e.unitCost = 'Enter a valid purchase price'; if (f.sellingPrice === '' || Number(f.sellingPrice) < 0) e.sellingPrice = 'Enter a valid selling price';
    if (Number(f.minStockLevel) < 0 || f.minStockLevel === '') e.minStockLevel = 'Enter a minimum level';
    setErr(e); return Object.keys(e).length === 0;
  };
  const save = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      if (editing) await api.put(`/products/${product.id}`, f); else await api.post('/products', f);
      toast.success(editing ? 'Product updated' : 'Product created'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? `Edit ${product.name}` : 'Add new product'} onClose={onClose} size="md"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving...' : editing ? 'Save changes' : 'Create product'}</button></>}>
      <div className="form-grid">
        <Field label="SKU *" error={err.sku}><input value={f.sku} onChange={set('sku')} placeholder="e.g. LAP-HP-450" maxLength={40} /></Field>
        <Field label="Category *" error={err.categoryId}><select value={f.categoryId} onChange={set('categoryId')}><option value="">Select...</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Product name *" error={err.name} className="span-2"><input value={f.name} onChange={set('name')} placeholder="e.g. HP ProBook 450 G10" maxLength={160} /></Field>
        <Field label="Brand"><input value={f.brand} onChange={set('brand')} maxLength={80} /></Field>
        <Field label="Lead time (days)" hint="Used by demand forecasting"><input type="number" min="0" value={f.leadTimeDays} onChange={set('leadTimeDays')} /></Field>
        <Field label="Purchase price (USD) *" error={err.unitCost}><input type="number" min="0" step="0.01" value={f.unitCost} onChange={set('unitCost')} /></Field>
        <Field label="Selling price (USD) *" error={err.sellingPrice}><input type="number" min="0" step="0.01" value={f.sellingPrice} onChange={set('sellingPrice')} /></Field>
        <Field label="Minimum stock level *" error={err.minStockLevel} hint="Low-stock alerts fire at or below this"><input type="number" min="0" value={f.minStockLevel} onChange={set('minStockLevel')} /></Field>
        {!editing && <Field label="Opening quantity" hint="Recorded as an opening balance in the ledger"><input type="number" min="0" value={f.openingQuantity} onChange={set('openingQuantity')} /></Field>}
        <Field label="Description" className="span-2"><textarea rows={2} value={f.description} onChange={set('description')} maxLength={2000} /></Field>
        <label className="check span-2"><input type="checkbox" checked={f.trackSerial} onChange={set('trackSerial')} /><span>Track serial numbers for this product</span></label>
      </div>
      {editing && <p className="muted small mt">Stock quantities are not edited here. They change only through goods received, sales, deliveries and approved reconciliation adjustments, so every unit is traceable.</p>}
    </Modal>
  );
}

function ProductDetail({ id, onClose, onEdit, canManage }) {
  const { data, loading, reload } = useFetch(`/products/${id}`, { live: ['inventory:update'] });
  const { toast } = useUi(); const [serials, setSerials] = useState('');
  const [tab, setTab] = useState('history');
  if (loading && !data) return <Modal title="Loading..." onClose={onClose}><p className="muted">Loading product...</p></Modal>;
  if (!data) return null;
  const p = data;
  const addSerials = async () => { try { const r = await api.post(`/products/${id}/serials`, { serials }); toast.success(r.message); setSerials(''); reload(); } catch (e) { toast.error(e.message); } };
  const setSerialStatus = async (sid, status) => { try { await api.put(`/products/serials/${sid}`, { status }); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <Modal title={p.name} subtitle={`${p.sku} - ${p.category}${p.brand ? ` - ${p.brand}` : ''}`} onClose={onClose} size="lg"
      footer={canManage && <button className="btn btn-ghost" onClick={() => onEdit(p)}><Pencil size={15} /> Edit details</button>}>
      <div className="grid grid-4 mb">
        <StatCard icon={Boxes} tone="info" label="Physical" value={num(p.physical_qty)} />
        <StatCard icon={Lock} tone="warning" label="Reserved" value={num(p.reserved_qty)} />
        <StatCard icon={CheckCircle2} tone="success" label="Available" value={num(p.available_qty)} hint={p.stock_status} />
        <StatCard icon={Truck} tone="violet" label="Incoming (not available)" value={num(p.incoming_qty)} hint="On open purchase orders" />
      </div>
      <div className="formula mb"><span>Available</span><b>{p.available_qty}</b><span>=</span><span>Physical</span><b>{p.physical_qty}</b><span>-</span><span>Reserved</span><b>{p.reserved_qty}</b></div>
      <dl className="kv mb">
        <dt>Purchase price</dt><dd>{money(p.unit_cost)}</dd><dt>Selling price</dt><dd>{money(p.selling_price)}</dd><dt>Minimum level</dt><dd>{p.min_stock_level}</dd>
        <dt>Lead time</dt><dd>{p.lead_time_days} days</dd><dt>Status</dt><dd>{p.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>}</dd>
        <dt>Suppliers</dt><dd>{p.suppliers.length ? p.suppliers.map((s) => `${s.name} (${money(s.unit_price)})`).join(', ') : <span className="muted">None linked</span>}</dd>
      </dl>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'history', label: 'Product history' }, ...(p.track_serial ? [{ key: 'serials', label: 'Serial numbers', count: p.serials.length }] : [])]} />
      {tab === 'history' && <MovementsTable productId={p.id} />}
      {tab === 'serials' && (
        <div className="stack">
          {canManage && <div className="row" style={{ alignItems: 'flex-end' }}><Field label="Add serial numbers (one per line or comma separated)" className="grow"><textarea rows={2} value={serials} onChange={(e) => setSerials(e.target.value)} /></Field><button className="btn btn-primary" onClick={addSerials} disabled={!serials.trim()}><ScanBarcode size={15} /> Add</button></div>}
          <DataTable searchable={false} pageSize={6} rows={p.serials} columns={[{ key: 'serial_number', label: 'Serial number', render: (r) => <span className="mono">{r.serial_number}</span> }, { key: 'status', label: 'Status', render: (r) => canManage ? <select className="inline-select" value={r.status} onChange={(e) => setSerialStatus(r.id, e.target.value)}>{['In Stock', 'Sold', 'Damaged', 'Returned'].map((s) => <option key={s}>{s}</option>)}</select> : r.status }, { key: 'created_at', label: 'Added', render: (r) => fmtDateTime(r.created_at) }]} emptyText="No serial numbers recorded" />
        </div>
      )}
    </Modal>
  );
}

export default function Inventory() {
  const { can } = useAuth(); const { toast, confirm } = useUi();
  const [params] = useSearchParams();
  const [tab, setTab] = useState('products');
  const [cat, setCat] = useState(''); const [status, setStatus] = useState(params.get('status') || ''); const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(null); const [detail, setDetail] = useState(null);
  const products = useFetch('/products', { live: ['inventory:update', 'data:changed'] });
  const cats = useFetch('/products/categories');
  const canManage = can('products.manage');

  const rows = useMemo(() => (products.data || []).filter((p) => (showInactive || p.is_active) && (!cat || String(p.category_id) === cat) && (!status || p.stock_status === status)), [products.data, cat, status, showInactive]);
  const all = (products.data || []).filter((p) => p.is_active);
  const totals = { low: all.filter((p) => p.stock_status === 'Low Stock').length, out: all.filter((p) => p.stock_status === 'Out of Stock').length };

  const deactivate = async (p) => {
    if (!(await confirm({ title: `Deactivate ${p.name}?`, message: 'The product is hidden from new orders. Products that still hold stock or have open purchase orders cannot be deactivated.', confirmText: 'Deactivate', danger: true }))) return;
    try { await api.del(`/products/${p.id}`); toast.success('Product deactivated'); products.reload(); } catch (e) { toast.error(e.message); }
  };
  const reactivate = async (p) => { try { await api.post(`/products/${p.id}/reactivate`); toast.success('Product reactivated'); products.reload(); } catch (e) { toast.error(e.message); } };

  const columns = [
    { key: 'name', label: 'Product', render: (p) => <div><div className="cell-title">{p.name}</div><div className="cell-sub"><span className="mono">{p.sku}</span> - {p.category}{!p.is_active && ' - deactivated'}</div></div> },
    { key: 'physical_qty', label: 'Physical', align: 'right', render: (p) => num(p.physical_qty) },
    { key: 'reserved_qty', label: 'Reserved', align: 'right', render: (p) => <div>{num(p.reserved_qty)}<StockBar physical={p.physical_qty} reserved={p.reserved_qty} /></div> },
    { key: 'available_qty', label: 'Available', align: 'right', render: (p) => <b className={p.available_qty <= 0 ? 'num-neg' : p.available_qty <= p.min_stock_level ? '' : 'num-pos'} style={p.available_qty > 0 && p.available_qty <= p.min_stock_level ? { color: '#fbbf24' } : undefined}>{num(p.available_qty)}</b> },
    { key: 'incoming_qty', label: 'Incoming', align: 'right', render: (p) => p.incoming_qty > 0 ? <span style={{ color: '#a78bfa' }}>+{num(p.incoming_qty)}</span> : <span className="muted">-</span> },
    { key: 'min_stock_level', label: 'Min', align: 'right' },
    { key: 'selling_price', label: 'Cost / Price', align: 'right', render: (p) => <div><div>{money(p.selling_price)}</div><div className="cell-sub">{money(p.unit_cost)}</div></div> },
    { key: 'stock_status', label: 'Status', render: (p) => <Badge>{p.stock_status}</Badge> },
    { key: 'actions', label: '', sortable: false, searchable: false, align: 'right', render: (p) => (
      <div className="row" style={{ gap: 2, justifyContent: 'flex-end', flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="View history" onClick={() => setDetail(p.id)}><History size={16} /></button>
        {canManage && <button className="icon-btn" title="Edit" onClick={() => setForm(p)}><Pencil size={16} /></button>}
        {canManage && (p.is_active ? <button className="icon-btn" title="Deactivate" onClick={() => deactivate(p)}><Power size={16} /></button> : <button className="btn btn-ghost btn-sm" onClick={() => reactivate(p)}>Reactivate</button>)}
      </div>) },
  ];

  if (products.error && !products.data) return <ErrorState error={products.error} onRetry={products.reload} />;
  return (
    <>
      <PageHeader title="Inventory" subtitle="Physical, reserved, available and incoming stock - updated live across all departments."
        actions={canManage && <button className="btn btn-primary" onClick={() => setForm({})}><Plus size={16} /> Add product</button>} />
      <div className="alert alert-info mb"><Info size={18} /><span><b>Available = Physical - Reserved.</b> Incoming stock (open purchase orders) is shown separately and is never available until the goods are received and verified.</span></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'products', label: 'Products', count: all.length }, { key: 'movements', label: 'Stock movements' }]} />
      {tab === 'products' ? (
        <DataTable key={params.get('q') || 'all'} initialSearch={params.get('q') || ''} columns={columns} rows={rows} loading={products.loading} searchPlaceholder="Search by name, SKU, brand..." onRowClick={(p) => setDetail(p.id)}
          rowClass={(p) => (p.stock_status === 'Out of Stock' ? 'row-danger' : p.stock_status === 'Low Stock' ? 'row-warn' : '')}
          filters={<>
            <select className="inline-select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select className="inline-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Stock status"><option value="">All stock levels</option><option>In Stock</option><option>Low Stock</option><option>Out of Stock</option></select>
            {canManage && <label className="check small"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /><span className="muted">Show deactivated</span></label>}
          </>}
          toolbar={<span className="muted small">{totals.low} low - {totals.out} out of stock</span>} />
      ) : <Card pad={false}><MovementsTable /></Card>}
      {form && <ProductForm product={form.id ? form : null} categories={cats.data || []} onClose={() => setForm(null)} onSaved={() => { setForm(null); products.reload(); }} />}
      {detail && <ProductDetail id={detail} onClose={() => setDetail(null)} canManage={canManage} onEdit={(p) => { setDetail(null); setForm({ ...p }); }} />}
    </>
  );
}
