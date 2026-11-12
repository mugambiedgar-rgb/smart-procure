import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Printer, Send, CheckCircle2, XCircle, Pencil, Ban, FilePlus2, AlertTriangle, PackageCheck, ArrowRightCircle } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import LineEditor, { newLine } from '../components/LineEditor.jsx';
import { Badge, Card, Field, PageHeader, Spinner, Tabs } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api, ApiError } from '../services/api.js';
import { addDaysISO, fmtDate, fmtDateTime, money, num, todayISO, uid } from '../utils/format.js';

const STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Sent to Supplier', 'Partially Received', 'Fully Received', 'Cancelled'];

/* ------------------------------------------------------------------ PO create / edit */
function POForm({ po, prefill, onClose, onSaved }) {
  const { toast } = useUi();
  const editing = !!po;
  const suppliers = useFetch('/suppliers'); const products = useFetch('/products');
  const [supplierId, setSupplierId] = useState(po ? po.supplier_id : prefill?.supplierId || '');
  const [expected, setExpected] = useState(po ? String(po.expected_date).slice(0, 10) : addDaysISO(10));
  const [notes, setNotes] = useState(po?.notes || prefill?.notes || '');
  const [lines, setLines] = useState(po ? po.items.map((i) => ({ key: String(i.id), productId: String(i.product_id), quantity: i.quantity_ordered, unitPrice: i.unit_price })) : prefill?.lines || [newLine()]);
  const [idem] = useState(uid);
  const [busy, setBusy] = useState(false); const [dups, setDups] = useState(null); const [error, setError] = useState('');
  const supplier = useFetch(supplierId ? `/suppliers/${supplierId}` : null, { skip: !supplierId });
  const priceMap = useMemo(() => new Map((supplier.data?.products || []).map((p) => [p.product_id, p.unit_price])), [supplier.data]);
  const activeProducts = (products.data || []).filter((p) => p.is_active);
  const options = activeProducts.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})${priceMap.has(p.id) ? '' : ' - not in supplier catalogue'}` }));
  const costOf = (id) => priceMap.get(id) ?? activeProducts.find((p) => p.id === id)?.unit_cost ?? '';
  const total = lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  const body = (submit, confirmDuplicate = false) => ({
    supplierId: Number(supplierId), expectedDate: expected, notes, submit, confirmDuplicate, idempotencyKey: idem, requisitionId: prefill?.requisitionId,
    items: lines.filter((l) => l.productId).map((l) => ({ productId: Number(l.productId), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
  });
  const validate = () => {
    if (!supplierId) return 'Select a supplier.'; if (!expected) return 'Choose the expected delivery date.';
    const filled = lines.filter((l) => l.productId); if (!filled.length) return 'Add at least one product.';
    if (filled.some((l) => !(Number(l.quantity) >= 1) || !Number.isInteger(Number(l.quantity)))) return 'Quantities must be whole numbers of 1 or more.';
    if (filled.some((l) => l.unitPrice === '' || Number(l.unitPrice) < 0)) return 'Every line needs a valid unit price.';
    return '';
  };

  const save = async (submit, confirmDuplicate = false) => {
    const v = validate(); setError(v); if (v) return;
    setBusy(true);
    try {
      if (editing) {
        await api.put(`/purchase-orders/${po.id}`, body(false)); toast.success('Purchase order updated'); onSaved(po.id); return;
      }
      if (!confirmDuplicate) { // duplicate-order prevention: look for similar active orders first
        const chk = await api.post('/purchase-orders/check-duplicates', body(submit));
        if (chk.duplicates.length) { setDups({ list: chk.duplicates, submit }); setBusy(false); return; }
      }
      const r = await api.post('/purchase-orders', body(submit, confirmDuplicate));
      toast.success(r.message); onSaved(r.id);
    } catch (e) {
      if (e instanceof ApiError && e.data.code === 'DUPLICATE_WARNING') setDups({ list: e.data.duplicates, submit });
      else toast.error(e.message);
    } finally { setBusy(false); }
  };

  if (dups) {
    return (
      <Modal title="Similar active orders already exist" onClose={() => setDups(null)} size="md"
        footer={<><button className="btn btn-ghost" onClick={() => setDups(null)}>Go back and review</button><button className="btn btn-danger" disabled={busy} onClick={() => { const s = dups.submit; setDups(null); save(s, true); }}>Create anyway</button></>}>
        <div className="alert alert-warning mb"><AlertTriangle size={18} /><span>To prevent duplicate supplier orders, please confirm this order is really needed. These open purchase orders contain some of the same products:</span></div>
        <table className="table"><thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Products</th></tr></thead><tbody>
          {dups.list.map((d) => <tr key={d.id}><td className="mono">{d.po_number}</td><td>{d.supplier_name}{d.same_supplier && <> <Badge tone="warning" dot={false}>same supplier</Badge></>}</td><td><Badge>{d.status}</Badge></td><td className="small">{d.products}</td></tr>)}
        </tbody></table>
        <p className="muted small mt">Confirming will create the order and notify approvers that a duplicate warning was overridden.</p>
      </Modal>
    );
  }

  return (
    <Modal title={editing ? `Edit ${po.po_number}` : prefill?.requisitionId ? 'Create purchase order from requisition' : 'New purchase order'} onClose={onClose} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        {editing ? <button className="btn btn-primary" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving...' : 'Save changes'}</button>
          : <><button className="btn btn-ghost" disabled={busy} onClick={() => save(false)}>Save as draft</button><button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>{busy ? 'Saving...' : 'Submit for approval'}</button></>}
      </>}>
      <div className="form-grid mb">
        <Field label="Supplier *"><select value={supplierId} disabled={editing} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select supplier...</option>{(suppliers.data || []).filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Expected delivery date *"><input type="date" min={todayISO()} value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        <Field label="Notes" className="span-2"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Delivery instructions, payment terms..." /></Field>
      </div>
      {!supplierId ? <p className="muted">Choose a supplier to start adding products.</p> : (
        <LineEditor lines={lines} setLines={setLines} options={options} defaultPrice={costOf} info={(l) => (priceMap.has(Number(l.productId)) ? `Agreed supplier price ${money(priceMap.get(Number(l.productId)))}` : 'Not in this supplier\'s catalogue - check the price')} />
      )}
      {error && <div className="alert alert-danger mt" role="alert">{error}</div>}
      {total > 0 && <p className="muted small mt">Totals are recalculated and validated by the server when saved.</p>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ PO detail */
function PODetail({ id, onClose, onEdit, onChanged }) {
  const { can } = useAuth(); const { toast, confirm } = useUi();
  const { data: po, loading, reload } = useFetch(`/purchase-orders/${id}`, { live: ['data:changed'] });
  const [busy, setBusy] = useState(false);
  if (loading && !po) return <Modal title="Loading..." onClose={onClose}><Spinner block /></Modal>;
  if (!po) return null;

  const run = async (fn, ok) => { setBusy(true); try { await fn(); toast.success(ok); await reload(); onChanged(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const action = (name) => run(() => api.post(`/purchase-orders/${id}/${name}`), { submit: 'Submitted for approval', approve: 'Purchase order approved', send: 'Marked as sent to supplier' }[name]);
  const withReason = async (name, title, prompt, ok, danger = true) => {
    const reason = await confirm({ title, prompt, confirmText: title, danger }); if (!reason) return;
    run(() => api.post(`/purchase-orders/${id}/${name}`, { reason }), ok);
  };
  const s = po.status; const mine = can('po.create');
  const received = po.items.reduce((a, i) => a + i.quantity_received, 0); const ordered = po.items.reduce((a, i) => a + i.quantity_ordered, 0);

  return (
    <Modal title={po.po_number} subtitle={`${po.supplier_name} - created by ${po.created_by_name}`} onClose={onClose} size="lg"
      footer={<>
        <button className="btn btn-ghost" onClick={() => api.openPdf(`/purchase-orders/${id}/pdf`).catch((e) => toast.error(e.message))}><Printer size={15} /> Print / PDF</button>
        {mine && ['Draft', 'Pending Approval'].includes(s) && <button className="btn btn-ghost" onClick={() => onEdit(po)}><Pencil size={15} /> Edit</button>}
        {mine && ['Draft', 'Pending Approval', 'Approved', 'Sent to Supplier'].includes(s) && <button className="btn btn-danger" disabled={busy} onClick={() => withReason('cancel', 'Cancel order', 'Reason for cancelling', 'Purchase order cancelled')}><Ban size={15} /> Cancel order</button>}
        {mine && s === 'Draft' && <button className="btn btn-primary" disabled={busy} onClick={() => action('submit')}><Send size={15} /> Submit for approval</button>}
        {can('po.approve') && s === 'Pending Approval' && <>
          <button className="btn btn-danger" disabled={busy} onClick={() => withReason('reject', 'Reject', 'Reason for rejection (returned to the creator)', 'Rejected and returned to Draft')}><XCircle size={15} /> Reject</button>
          <button className="btn btn-success" disabled={busy} onClick={() => action('approve')}><CheckCircle2 size={15} /> Approve</button></>}
        {mine && s === 'Approved' && <button className="btn btn-primary" disabled={busy} onClick={() => action('send')}><Send size={15} /> Mark as sent to supplier</button>}
        {can('grn.create') && ['Approved', 'Sent to Supplier', 'Partially Received'].includes(s) && <Link to="/goods-received" className="btn btn-primary"><PackageCheck size={15} /> Receive goods</Link>}
      </>}>
      <div className="row mb"><Badge>{s}</Badge>{po.rejection_reason && s === 'Draft' && <span className="alert alert-danger" style={{ padding: '6px 10px' }}>Rejected: {po.rejection_reason}</span>}{po.cancel_reason && <span className="muted small">Cancelled: {po.cancel_reason}</span>}</div>
      <dl className="kv mb">
        <dt>Order date</dt><dd>{fmtDate(po.order_date)}</dd><dt>Expected delivery</dt><dd>{fmtDate(po.expected_date)}</dd>
        <dt>Supplier contact</dt><dd>{[po.supplier_email, po.supplier_phone].filter(Boolean).join(' - ') || '-'}</dd>
        <dt>Approved by</dt><dd>{po.approved_by_name ? `${po.approved_by_name} (${fmtDateTime(po.approved_at)})` : '-'}</dd>
        {po.notes && <><dt>Notes</dt><dd>{po.notes}</dd></>}
      </dl>
      <div className="table-scroll"><table className="table"><thead><tr><th>Product</th><th className="right">Ordered</th><th className="right">Received</th><th className="right">Outstanding</th><th className="right">Unit price</th><th className="right">Line total</th></tr></thead><tbody>
        {po.items.map((i) => <tr key={i.id}><td><div className="cell-title">{i.name}</div><div className="cell-sub mono">{i.sku}</div></td><td className="right">{num(i.quantity_ordered)}</td><td className="right">{num(i.quantity_received)}</td><td className="right">{num(i.quantity_outstanding)}</td><td className="right">{money(i.unit_price)}</td><td className="right"><b>{money(i.line_total)}</b></td></tr>)}
      </tbody></table></div>
      <div className="total-row"><span className="muted">Order total</span><b>{money(po.total_amount)}</b></div>
      {['Approved', 'Sent to Supplier', 'Partially Received', 'Fully Received'].includes(s) && <div className="row mt"><div className="progress grow"><i style={{ width: `${ordered ? Math.round((received / ordered) * 100) : 0}%` }} /></div><span className="small muted">{received} / {ordered} units received</span></div>}
      {po.grns.length > 0 && <><h4 className="mt mb">Goods received notes</h4>
        <table className="table"><tbody>{po.grns.map((g) => <tr key={g.id}><td className="mono">{g.grn_number}</td><td>{fmtDate(g.received_date)}</td><td>{g.received_by_name}</td><td><Badge>{g.status}</Badge></td></tr>)}</tbody></table></>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ Requisitions */
function RequisitionForm({ onClose, onSaved }) {
  const { toast } = useUi(); const products = useFetch('/products');
  const [priority, setPriority] = useState('Normal'); const [why, setWhy] = useState(''); const [lines, setLines] = useState([newLine()]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const active = (products.data || []).filter((p) => p.is_active);
  const save = async () => {
    const filled = lines.filter((l) => l.productId);
    if (!filled.length) return setError('Add at least one product.'); if (why.trim().length < 5) return setError('Explain why these items are needed (at least 5 characters).');
    if (filled.some((l) => !(Number(l.quantity) >= 1))) return setError('Quantities must be 1 or more.');
    setBusy(true); setError('');
    try { const r = await api.post('/requisitions', { priority, justification: why, items: filled.map((l) => ({ productId: Number(l.productId), quantity: Number(l.quantity), estimatedPrice: Number(l.unitPrice) || 0 })) }); toast.success(r.message); onSaved(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New purchase requisition" subtitle="Request products to be purchased - it goes to management for approval." onClose={onClose} size="lg"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Submitting...' : 'Submit requisition'}</button></>}>
      <div className="form-grid mb">
        <Field label="Priority"><select value={priority} onChange={(e) => setPriority(e.target.value)}>{['Low', 'Normal', 'High', 'Urgent'].map((p) => <option key={p}>{p}</option>)}</select></Field>
        <div />
        <Field label="Justification *" className="span-2"><textarea rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why is this stock needed?" maxLength={1000} /></Field>
      </div>
      <LineEditor lines={lines} setLines={setLines} priceLabel="Est. price" defaultPrice={(id) => active.find((p) => p.id === id)?.unit_cost ?? ''}
        options={active.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})` }))} info={(l) => { const p = active.find((x) => x.id === Number(l.productId)); return p ? `Available ${p.available_qty} - incoming ${p.incoming_qty} - minimum ${p.min_stock_level}` : ''; }} />
      {error && <div className="alert alert-danger mt">{error}</div>}
    </Modal>
  );
}

function Requisitions({ onConvert }) {
  const { can } = useAuth(); const { toast, confirm } = useUi();
  const [open, setOpen] = useState(false); const [view, setView] = useState(null);
  const { data, loading, reload } = useFetch('/requisitions', { live: ['data:changed'] });
  const detail = useFetch(view ? `/requisitions/${view}` : null, { skip: !view });

  const review = async (r, action) => {
    const note = await confirm({ title: action === 'approve' ? 'Approve requisition' : 'Reject requisition', message: `${r.req_number} - ${r.item_count} product(s)`, prompt: action === 'reject' ? 'Reason for rejection' : 'Note (optional)', promptRequired: action === 'reject', confirmText: action === 'approve' ? 'Approve' : 'Reject', danger: action === 'reject' });
    if (note === false) return;
    try { await api.post(`/requisitions/${r.id}/${action}`, { note: typeof note === 'string' ? note : '' }); toast.success(`Requisition ${action === 'approve' ? 'approved' : 'rejected'}`); reload(); } catch (e) { toast.error(e.message); }
  };
  const convert = async (r) => {
    try { const full = await api.get(`/requisitions/${r.id}`); onConvert({ requisitionId: r.id, notes: `From requisition ${r.req_number}`, lines: full.items.map((i) => ({ key: String(i.id), productId: String(i.product_id), quantity: i.quantity, unitPrice: i.estimated_price || i.unit_cost })) }); }
    catch (e) { toast.error(e.message); }
  };
  const cols = [
    { key: 'req_number', label: 'Requisition', render: (r) => <span className="mono">{r.req_number}</span> },
    { key: 'created_at', label: 'Raised', render: (r) => fmtDate(r.created_at) },
    { key: 'requested_by_name', label: 'Requested by' },
    { key: 'priority', label: 'Priority', render: (r) => <Badge>{r.priority}</Badge> },
    { key: 'item_count', label: 'Products', align: 'right' },
    { key: 'status', label: 'Status', render: (r) => <><Badge>{r.status}</Badge>{r.po_number && <div className="cell-sub mono">{r.po_number}</div>}</> },
    { key: 'actions', label: '', sortable: false, searchable: false, align: 'right', render: (r) => (
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
        {can('requisitions.approve') && r.status === 'Pending' && <><button className="btn btn-success btn-sm" onClick={() => review(r, 'approve')}>Approve</button><button className="btn btn-danger btn-sm" onClick={() => review(r, 'reject')}>Reject</button></>}
        {can('po.create') && r.status === 'Approved' && <button className="btn btn-primary btn-sm" onClick={() => convert(r)}><ArrowRightCircle size={14} /> Create PO</button>}
      </div>) },
  ];
  return (
    <>
      <DataTable columns={cols} rows={data || []} loading={loading} searchPlaceholder="Search requisitions..." onRowClick={(r) => setView(r.id)}
        toolbar={can('requisitions.create') && <button className="btn btn-primary" onClick={() => setOpen(true)}><FilePlus2 size={16} /> New requisition</button>} />
      {open && <RequisitionForm onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
      {view && detail.data && (
        <Modal title={detail.data.req_number} subtitle={`Requested by ${detail.data.requested_by_name}`} onClose={() => setView(null)}>
          <div className="row mb"><Badge>{detail.data.status}</Badge><Badge>{detail.data.priority}</Badge></div>
          <p>{detail.data.justification}</p>
          {detail.data.review_note && <div className="alert alert-info mb"><span>Review note ({detail.data.reviewed_by_name}): {detail.data.review_note}</span></div>}
          <table className="table"><thead><tr><th>Product</th><th className="right">Qty</th><th className="right">Available now</th><th className="right">Est. price</th></tr></thead><tbody>
            {detail.data.items.map((i) => <tr key={i.id}><td>{i.name} <span className="muted mono">{i.sku}</span></td><td className="right">{i.quantity}</td><td className="right">{i.available_qty}</td><td className="right">{money(i.estimated_price)}</td></tr>)}</tbody></table>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ Page */
export default function Procurement() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'requisitions' ? 'requisitions' : 'orders');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(null); const [viewId, setViewId] = useState(params.get('po') ? Number(params.get('po')) : null);
  const orders = useFetch('/purchase-orders', { live: ['data:changed'], skip: !can('po.view') });
  const rows = (orders.data || []).filter((p) => !status || p.status === status);
  const closeView = () => { setViewId(null); if (params.get('po')) { params.delete('po'); setParams(params, { replace: true }); } };

  const cols = [
    { key: 'po_number', label: 'PO number', render: (p) => <span className="mono">{p.po_number}</span> },
    { key: 'supplier_name', label: 'Supplier', render: (p) => <div><div className="cell-title">{p.supplier_name}</div><div className="cell-sub">{p.item_count} product(s) - by {p.created_by_name}</div></div> },
    { key: 'order_date', label: 'Ordered', render: (p) => fmtDate(p.order_date) },
    { key: 'expected_date', label: 'Expected', render: (p) => <span style={p.is_overdue ? { color: '#f87171', fontWeight: 600 } : undefined}>{fmtDate(p.expected_date)}{p.is_overdue ? ' (overdue)' : ''}</span> },
    { key: 'total_amount', label: 'Total', align: 'right', render: (p) => <b>{money(p.total_amount)}</b> },
    { key: 'qty_received', label: 'Received', align: 'right', sortValue: (p) => (p.qty_ordered ? p.qty_received / p.qty_ordered : 0), render: (p) => (['Draft', 'Pending Approval', 'Cancelled'].includes(p.status) ? <span className="muted">-</span> : <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}><div className="progress" style={{ width: 60, minWidth: 60 }}><i style={{ width: `${p.qty_ordered ? Math.round((p.qty_received / p.qty_ordered) * 100) : 0}%` }} /></div><span className="small">{p.qty_received}/{p.qty_ordered}</span></div>) },
    { key: 'status', label: 'Status', render: (p) => <Badge>{p.status}</Badge> },
  ];
  return (
    <>
      <PageHeader title="Procurement" subtitle="Requisitions, purchase orders, approvals and procurement history."
        actions={can('po.create') && <button className="btn btn-primary" onClick={() => setForm({})}><Plus size={16} /> New purchase order</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[...(can('po.view') ? [{ key: 'orders', label: 'Purchase orders', count: orders.data?.length }] : []), ...(can('requisitions.view') ? [{ key: 'requisitions', label: 'Requisitions' }] : [])]} />
      {tab === 'orders' && can('po.view') ? (
        <DataTable columns={cols} rows={rows} loading={orders.loading} searchPlaceholder="Search PO number, supplier..." onRowClick={(p) => setViewId(p.id)} pageSize={12}
          filters={<select className="inline-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>} />
      ) : <Requisitions onConvert={(prefill) => setForm({ prefill })} />}
      {form && <POForm po={form.po} prefill={form.prefill} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); orders.reload(); if (id) setViewId(id); setTab('orders'); }} />}
      {viewId && <PODetail id={viewId} onClose={closeView} onChanged={orders.reload} onEdit={(po) => { setViewId(null); setForm({ po }); }} />}
    </>
  );
}
