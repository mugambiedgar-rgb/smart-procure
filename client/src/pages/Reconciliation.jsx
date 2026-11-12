import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Send, Check, X, Ban, TrendingDown, TrendingUp, Equal } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, Field, PageHeader, StatCard } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api } from '../services/api.js';
import { fmtDateTime, num } from '../utils/format.js';
import { AlertTriangle } from 'lucide-react';

const Diff = ({ d }) => {
  if (d === null || d === undefined) return <span className="muted">-</span>;
  if (d === 0) return <span className="diff-cell muted"><Equal size={13} /> 0</span>;
  return <span className={`diff-cell ${d < 0 ? 'num-neg' : 'num-pos'}`}>{d < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}{d > 0 ? `+${d}` : d}</span>;
};

function NewSession({ onClose, onSaved }) {
  const { toast } = useUi(); const cats = useFetch('/products/categories');
  const [f, setF] = useState({ title: `Stock count ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, categoryId: '', notes: '' }); const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { const r = await api.post('/reconciliations', { ...f, categoryId: f.categoryId ? Number(f.categoryId) : undefined }); toast.success(r.message); onSaved(r.id); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <Modal title="New stock-count session" subtitle="System quantities are snapshotted now; enter what you physically count." onClose={onClose} size="sm"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || f.title.trim().length < 3} onClick={save}>Create session</button></>}>
      <div className="stack">
        <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={150} /></Field>
        <Field label="Scope"><select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">All active products</option>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={255} /></Field>
      </div>
    </Modal>
  );
}

function SessionView({ id, onClose, onChanged }) {
  const { can } = useAuth(); const { toast, confirm } = useUi();
  const { data: s, reload } = useFetch(`/reconciliations/${id}`, { live: ['data:changed'] });
  const [counts, setCounts] = useState({}); const [busy, setBusy] = useState(false);
  useEffect(() => { if (s) setCounts(Object.fromEntries(s.items.map((i) => [i.id, { countedQty: i.counted_qty ?? '', reason: i.reason || '' }]))); }, [s?.id, s?.status]); // eslint-disable-line
  if (!s) return null;
  const open = s.status === 'Open'; const editable = open && can('reconciliation.manage');
  const set = (iid, patch) => setCounts({ ...counts, [iid]: { ...counts[iid], ...patch } });
  const view = s.items.map((i) => { const c = counts[i.id] || {}; const counted = open ? (c.countedQty === '' || c.countedQty === undefined ? null : Number(c.countedQty)) : i.counted_qty; return { ...i, counted, diff: counted === null ? null : counted - i.system_qty }; });
  const variances = view.filter((v) => v.diff !== null && v.diff !== 0).length; const uncounted = view.filter((v) => v.counted === null).length;

  const saveCounts = async (quiet) => {
    const payload = Object.entries(counts).map(([itemId, c]) => ({ itemId: Number(itemId), countedQty: c.countedQty, reason: c.reason }));
    await api.put(`/reconciliations/${id}/counts`, { counts: payload }); if (!quiet) toast.success('Counts saved');
  };
  const wrap = async (fn) => { setBusy(true); try { await fn(); await reload(); onChanged(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const submit = () => wrap(async () => { await saveCounts(true); const r = await api.post(`/reconciliations/${id}/submit`); toast.success(r.message); });
  const resolve = async (item, action) => {
    const note = await confirm({ title: action === 'approve' ? `Approve adjustment for ${item.name}?` : `Reject adjustment for ${item.name}?`, message: action === 'approve' ? `Physical stock changes by ${item.difference > 0 ? '+' : ''}${item.difference} (system ${item.system_qty} to counted ${item.counted_qty}). This is written to the ledger and audit log.` : 'Stock stays as recorded in the system.', prompt: 'Note (optional)', promptRequired: false, confirmText: action === 'approve' ? 'Approve' : 'Reject', danger: action === 'reject' });
    if (note === false) return;
    wrap(async () => { const r = await api.post(`/reconciliations/${id}/resolve`, { itemId: item.id, action, note: typeof note === 'string' ? note : '' }); toast.success(r.message); });
  };
  const cancel = async () => { if (!(await confirm({ title: 'Cancel this count session?', danger: true, confirmText: 'Cancel session' }))) return; wrap(async () => { await api.post(`/reconciliations/${id}/cancel`); toast.success('Session cancelled'); }); };

  const cols = [
    { key: 'name', label: 'Product', render: (i) => <div><div className="cell-title">{i.name}</div><div className="cell-sub mono">{i.sku}</div></div> },
    { key: 'system_qty', label: 'System stock', align: 'right', render: (i) => <b>{i.system_qty}</b> },
    { key: 'counted', label: 'Physical count', align: 'right', sortValue: (i) => i.counted, render: (i) => editable ? <input type="number" min="0" style={{ width: 90 }} value={counts[i.id]?.countedQty ?? ''} onChange={(e) => set(i.id, { countedQty: e.target.value })} aria-label={`Count ${i.name}`} /> : (i.counted_qty ?? '-') },
    { key: 'diff', label: 'Difference', align: 'right', sortValue: (i) => i.diff, render: (i) => <Diff d={i.diff} /> },
    { key: 'reason', label: 'Reason', sortable: false, render: (i) => editable ? (i.diff ? <input value={counts[i.id]?.reason ?? ''} onChange={(e) => set(i.id, { reason: e.target.value })} placeholder="Required for a variance" maxLength={255} /> : null) : <span className="small">{i.reason || ''}</span> },
    { key: 'status', label: 'Result', render: (i) => <Badge>{open ? (i.diff === null ? 'Pending Count' : i.diff === 0 ? 'Matched' : 'Variance') : i.status}</Badge> },
    ...(s.status === 'Submitted' && can('reconciliation.approve') ? [{ key: 'act', label: '', sortable: false, align: 'right', render: (i) => i.status === 'Variance' && (
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}><button className="btn btn-success btn-sm" disabled={busy} onClick={() => resolve(i, 'approve')}><Check size={14} /> Approve</button><button className="btn btn-danger btn-sm" disabled={busy} onClick={() => resolve(i, 'reject')}><X size={14} /></button></div>) }] : []),
  ];
  return (
    <Modal title={s.title} subtitle={`${s.session_no} - ${s.category_name || 'All products'} - started ${fmtDateTime(s.created_at)} by ${s.created_by_name}`} onClose={onClose} size="xl"
      footer={editable && <><button className="btn btn-danger" onClick={cancel}><Ban size={15} /> Cancel session</button><button className="btn btn-ghost" disabled={busy} onClick={() => wrap(() => saveCounts(false))}>Save counts</button><button className="btn btn-primary" disabled={busy} onClick={submit}><Send size={15} /> Submit for approval</button></>}>
      <div className="grid grid-4 mb">
        <StatCard icon={Equal} tone="info" label="Products" value={s.items.length} hint={`${uncounted} not yet counted`} />
        <StatCard icon={TrendingDown} tone={variances ? 'warning' : 'success'} label="Discrepancies" value={variances} hint={variances ? 'Need a reason and approval' : 'All counted items match'} />
        <StatCard icon={Check} tone="success" label="Matched" value={view.filter((v) => v.diff === 0).length} />
        <div className="stat-card"><div className="stat-body"><span className="stat-label">Session status</span><strong className="stat-value" style={{ fontSize: 18 }}><Badge>{s.status}</Badge></strong></div></div>
      </div>
      {s.status === 'Submitted' && <div className="alert alert-warning mb"><AlertTriangle size={18} /><span>Waiting for an authorised person to approve or reject each discrepancy. Approved adjustments change physical stock; rejected ones leave it unchanged.</span></div>}
      <DataTable columns={cols} rows={view} pageSize={10} searchPlaceholder="Search products..." rowClass={(i) => (i.diff ? (i.diff < 0 ? 'row-danger' : 'row-warn') : '')} />
    </Modal>
  );
}

export default function Reconciliation() {
  const { can } = useAuth(); const [params, setParams] = useSearchParams();
  const [create, setCreate] = useState(false); const [view, setView] = useState(params.get('id') ? Number(params.get('id')) : null);
  const { data, loading, reload } = useFetch('/reconciliations', { live: ['data:changed'] });
  const closeView = () => { setView(null); if (params.get('id')) { params.delete('id'); setParams(params, { replace: true }); } };
  const cols = [
    { key: 'session_no', label: 'Session', render: (r) => <span className="mono">{r.session_no}</span> },
    { key: 'title', label: 'Title', render: (r) => <div><div className="cell-title">{r.title}</div><div className="cell-sub">{r.category_name || 'All products'}</div></div> },
    { key: 'created_at', label: 'Started', render: (r) => fmtDateTime(r.created_at) },
    { key: 'created_by_name', label: 'By' },
    { key: 'counted_count', label: 'Counted', align: 'right', render: (r) => `${r.counted_count}/${r.item_count}` },
    { key: 'variance_count', label: 'Discrepancies', align: 'right', render: (r) => (r.variance_count > 0 ? <span className="badge badge-warning">{r.variance_count}</span> : <span className="muted">0</span>) },
    { key: 'status', label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ];
  return (
    <>
      <PageHeader title="Stock reconciliation" subtitle="Compare physical counts with system stock, record reasons and approve adjustments - every change is audited."
        actions={can('reconciliation.manage') && <button className="btn btn-primary" onClick={() => setCreate(true)}><Plus size={16} /> New count session</button>} />
      <DataTable columns={cols} rows={data || []} loading={loading} searchPlaceholder="Search sessions..." onRowClick={(r) => setView(r.id)} emptyText="No stock-count sessions yet" />
      {create && <NewSession onClose={() => setCreate(false)} onSaved={(id) => { setCreate(false); reload(); setView(id); }} />}
      {view && <SessionView id={view} onClose={closeView} onChanged={reload} />}
    </>
  );
}
