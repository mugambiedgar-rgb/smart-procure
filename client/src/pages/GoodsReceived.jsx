import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, ShieldCheck, Ban, AlertTriangle, Info } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, Field, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api } from '../services/api.js';
import { fmtDate, fmtDateTime, num, todayISO } from '../utils/format.js';

function GRNForm({ onClose, onSaved }) {
  const { toast } = useUi();
  const receivable = useFetch('/purchase-orders/receivable');
  const [poId, setPoId] = useState(''); const [po, setPo] = useState(null);
  const [lines, setLines] = useState([]); const [f, setF] = useState({ receivedDate: todayISO(), deliveryNoteRef: '', deliveredByName: '', notes: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  useEffect(() => {
    if (!poId) { setPo(null); setLines([]); return; }
    api.get(`/purchase-orders/${poId}`).then((p) => { setPo(p); setLines(p.items.filter((i) => i.quantity_outstanding > 0).map((i) => ({ ...i, delivered: i.quantity_outstanding, damaged: 0, remarks: '' }))); }).catch((e) => toast.error(e.message));
  }, [poId]); // eslint-disable-line
  const upd = (id, patch) => setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const save = async () => {
    setError('');
    for (const l of lines) {
      const d = Number(l.delivered); const x = Number(l.damaged);
      if (!Number.isInteger(d) || d < 0 || !Number.isInteger(x) || x < 0) return setError('Quantities must be whole numbers of 0 or more.');
      if (d > l.quantity_outstanding) return setError(`${l.name}: delivered (${d}) exceeds outstanding (${l.quantity_outstanding}).`);
      if (x > d) return setError(`${l.name}: damaged cannot exceed delivered.`);
    }
    if (!lines.some((l) => Number(l.delivered) > 0)) return setError('Enter the delivered quantity for at least one product.');
    setBusy(true);
    try {
      const r = await api.post('/grn', { poId: Number(poId), ...f, items: lines.map((l) => ({ poItemId: l.id, quantityDelivered: Number(l.delivered), quantityDamaged: Number(l.damaged), remarks: l.remarks })) });
      toast.success(r.message); onSaved(r.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const missing = lines.reduce((a, l) => a + Math.max(0, l.quantity_outstanding - (Number(l.delivered) || 0)), 0);
  const damaged = lines.reduce((a, l) => a + (Number(l.damaged) || 0), 0);

  return (
    <Modal title="Record goods received" subtitle="Step 1: record what physically arrived. Stock only changes when the GRN is verified." onClose={onClose} size="xl"
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || !po} onClick={save}>{busy ? 'Saving...' : 'Record GRN'}</button></>}>
      <div className="form-grid mb">
        <Field label="Purchase order *" className="span-2"><select value={poId} onChange={(e) => setPoId(e.target.value)}><option value="">Select the order being delivered...</option>
          {(receivable.data || []).map((p) => <option key={p.id} value={p.id}>{p.po_number} - {p.supplier_name} - {p.qty_outstanding} units outstanding (due {fmtDate(p.expected_date)})</option>)}</select></Field>
        <Field label="Received date"><input type="date" max={todayISO()} value={f.receivedDate} onChange={(e) => setF({ ...f, receivedDate: e.target.value })} /></Field>
        <Field label="Supplier delivery note no."><input value={f.deliveryNoteRef} onChange={(e) => setF({ ...f, deliveryNoteRef: e.target.value })} maxLength={80} /></Field>
        <Field label="Delivered by (driver / company)"><input value={f.deliveredByName} onChange={(e) => setF({ ...f, deliveredByName: e.target.value })} maxLength={120} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {receivable.data && receivable.data.length === 0 && <div className="alert alert-info"><Info size={18} /><span>There are no approved purchase orders waiting for delivery.</span></div>}
      {po && (
        <>
          <div className="table-scroll"><table className="table"><thead><tr><th>Product</th><th className="right">Ordered</th><th className="right">Previously received</th><th className="right">Outstanding</th><th style={{ width: 110 }}>Delivered now</th><th style={{ width: 110 }}>Of which damaged</th><th className="right">Accepted</th><th className="right">Missing</th><th>Remarks</th></tr></thead><tbody>
            {lines.map((l) => {
              const d = Number(l.delivered) || 0; const x = Number(l.damaged) || 0; const miss = Math.max(0, l.quantity_outstanding - d);
              return (<tr key={l.id}><td><div className="cell-title">{l.name}</div><div className="cell-sub mono">{l.sku}</div></td><td className="right">{l.quantity_ordered}</td><td className="right">{l.quantity_received}</td><td className="right"><b>{l.quantity_outstanding}</b></td>
                <td><input type="number" min="0" max={l.quantity_outstanding} value={l.delivered} onChange={(e) => upd(l.id, { delivered: e.target.value })} aria-label={`Delivered ${l.name}`} /></td>
                <td><input type="number" min="0" value={l.damaged} onChange={(e) => upd(l.id, { damaged: e.target.value })} aria-label={`Damaged ${l.name}`} /></td>
                <td className="right"><b className="num-pos">{Math.max(0, d - x)}</b></td><td className="right">{miss > 0 ? <span className="num-neg">{miss}</span> : <span className="muted">0</span>}</td>
                <td><input value={l.remarks} onChange={(e) => upd(l.id, { remarks: e.target.value })} placeholder="Optional" maxLength={255} /></td></tr>);
            })}</tbody></table></div>
          {(missing > 0 || damaged > 0) && <div className="alert alert-warning mt"><AlertTriangle size={18} /><span>Discrepancies: <b>{damaged}</b> damaged and <b>{missing}</b> not delivered. These are recorded on the GRN and the order stays open for the outstanding quantity.</span></div>}
        </>
      )}
      {error && <div className="alert alert-danger mt" role="alert">{error}</div>}
    </Modal>
  );
}

function GRNDetail({ id, onClose, onChanged }) {
  const { can } = useAuth(); const { toast, confirm } = useUi();
  const { data: g, reload } = useFetch(`/grn/${id}`, { live: ['data:changed'] }); const [busy, setBusy] = useState(false);
  if (!g) return null;
  const verify = async () => {
    if (!(await confirm({ title: `Verify ${g.grn_number}?`, message: `This confirms the delivery and adds ${g.items.reduce((a, i) => a + i.quantity_accepted, 0)} accepted unit(s) to PHYSICAL stock. It cannot be undone - corrections are made through a stock reconciliation.`, confirmText: 'Verify and update stock' }))) return;
    setBusy(true); try { const r = await api.post(`/grn/${id}/verify`); toast.success(r.message); await reload(); onChanged(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const cancel = async () => { if (!(await confirm({ title: 'Cancel this GRN?', message: 'Stock will not be changed.', danger: true, confirmText: 'Cancel GRN' }))) return; try { await api.post(`/grn/${id}/cancel`); toast.success('GRN cancelled'); await reload(); onChanged(); } catch (e) { toast.error(e.message); } };
  return (
    <Modal title={g.grn_number} subtitle={`${g.supplier_name} - against ${g.po_number}`} onClose={onClose} size="lg"
      footer={g.status === 'Draft' && <>{can('grn.create', 'grn.verify') && <button className="btn btn-danger" onClick={cancel}><Ban size={15} /> Cancel GRN</button>}{can('grn.verify') && <button className="btn btn-success" disabled={busy} onClick={verify}><ShieldCheck size={15} /> Verify &amp; update stock</button>}</>}>
      <div className="row mb"><Badge>{g.status}</Badge>{g.status === 'Draft' && <span className="muted small">Awaiting verification - stock has not changed yet.</span>}</div>
      <dl className="kv mb"><dt>Received date</dt><dd>{fmtDate(g.received_date)}</dd><dt>Received by</dt><dd>{g.received_by_name}</dd><dt>Delivery note</dt><dd>{g.delivery_note_ref || '-'}</dd><dt>Delivered by</dt><dd>{g.delivered_by_name || '-'}</dd><dt>Verified</dt><dd>{g.verified_by_name ? `${g.verified_by_name} (${fmtDateTime(g.verified_at)})` : '-'}</dd>{g.notes && <><dt>Notes</dt><dd>{g.notes}</dd></>}</dl>
      <div className="table-scroll"><table className="table"><thead><tr><th>Product</th><th className="right">Ordered</th><th className="right">Delivered</th><th className="right">Damaged</th><th className="right">Accepted into stock</th><th className="right">Missing</th><th>Remarks</th></tr></thead><tbody>
        {g.items.map((i) => <tr key={i.id}><td><div className="cell-title">{i.name}</div><div className="cell-sub mono">{i.sku}</div></td><td className="right">{i.quantity_ordered}</td><td className="right">{i.quantity_delivered}</td><td className="right">{i.quantity_damaged ? <span className="num-neg">{i.quantity_damaged}</span> : 0}</td><td className="right"><b className="num-pos">{i.quantity_accepted}</b></td><td className="right">{i.quantity_missing ? <span className="num-neg">{i.quantity_missing}</span> : 0}</td><td className="small muted">{i.remarks || ''}</td></tr>)}</tbody></table></div>
    </Modal>
  );
}

export default function GoodsReceived() {
  const { can } = useAuth(); const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(false); const [view, setView] = useState(params.get('grn') ? Number(params.get('grn')) : null); const [status, setStatus] = useState('');
  const { data, loading, reload } = useFetch('/grn', { live: ['data:changed'] });
  const rows = (data || []).filter((g) => !status || g.status === status);
  const awaiting = (data || []).filter((g) => g.status === 'Draft').length;
  const closeView = () => { setView(null); if (params.get('grn')) { params.delete('grn'); setParams(params, { replace: true }); } };
  const cols = [
    { key: 'grn_number', label: 'GRN', render: (g) => <span className="mono">{g.grn_number}</span> },
    { key: 'received_date', label: 'Received', render: (g) => fmtDate(g.received_date) },
    { key: 'po_number', label: 'Purchase order', render: (g) => <div><div className="mono">{g.po_number}</div><div className="cell-sub">{g.supplier_name}</div></div> },
    { key: 'qty_delivered', label: 'Delivered', align: 'right', render: (g) => num(g.qty_delivered) },
    { key: 'qty_accepted', label: 'Accepted', align: 'right', render: (g) => <b className="num-pos">{num(g.qty_accepted)}</b> },
    { key: 'qty_damaged', label: 'Damaged', align: 'right', render: (g) => (g.qty_damaged > 0 ? <span className="num-neg">{g.qty_damaged}</span> : <span className="muted">0</span>) },
    { key: 'qty_missing', label: 'Missing', align: 'right', render: (g) => (g.qty_missing > 0 ? <span className="num-neg">{g.qty_missing}</span> : <span className="muted">0</span>) },
    { key: 'received_by_name', label: 'Received by' },
    { key: 'status', label: 'Status', render: (g) => <Badge>{g.status}</Badge> },
  ];
  return (
    <>
      <PageHeader title="Goods received" subtitle="Deliveries are only counted as stock after a Goods Received Note is verified against the purchase order."
        actions={can('grn.create') && <button className="btn btn-primary" onClick={() => setForm(true)}><Plus size={16} /> Record delivery</button>} />
      {awaiting > 0 && <div className="alert alert-warning mb"><AlertTriangle size={18} /><span><b>{awaiting}</b> GRN{awaiting > 1 ? 's are' : ' is'} awaiting verification. Stock is not updated until verified.</span></div>}
      <DataTable columns={cols} rows={rows} loading={loading} searchPlaceholder="Search GRN, PO, supplier..." onRowClick={(g) => setView(g.id)} rowClass={(g) => (g.status === 'Draft' ? 'row-warn' : '')}
        filters={<select className="inline-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option>Draft</option><option>Verified</option><option>Cancelled</option></select>} />
      {form && <GRNForm onClose={() => setForm(false)} onSaved={(id) => { setForm(false); reload(); setView(id); }} />}
      {view && <GRNDetail id={view} onClose={closeView} onChanged={reload} />}
    </>
  );
}
