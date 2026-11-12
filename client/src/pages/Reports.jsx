import { useEffect, useState } from 'react';
import { FileText, FileSpreadsheet, FileDown, Play } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import { Card, Field, PageHeader } from '../components/ui.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api } from '../services/api.js';
import { fmtDate, money, num } from '../utils/format.js';

const cellValue = (c, v) => { if (v === null || v === undefined) return '-'; if (c.type === 'money') return money(v); if (c.type === 'date') return fmtDate(v); if (c.type === 'num') return num(v); return String(v); };

export default function Reports() {
  const { toast } = useUi(); const list = useFetch('/reports');
  const [type, setType] = useState('inventory');
  const today = new Date().toISOString().slice(0, 10); const ago = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(ago); const [to, setTo] = useState(today); const [search, setSearch] = useState('');
  const [result, setResult] = useState(null); const [loading, setLoading] = useState(false); const [exporting, setExporting] = useState('');
  const def = (list.data || []).find((r) => r.key === type);
  const qs = (fmt) => `/reports/${type}?format=${fmt}&from=${from}&to=${to}${search ? `&search=${encodeURIComponent(search)}` : ''}`;

  const run = async () => {
    if (from > to) return toast.error('The start date must be on or before the end date.');
    setLoading(true); try { setResult(await api.get(qs('json'))); } catch (e) { toast.error(e.message); setResult(null); } finally { setLoading(false); }
  };
  useEffect(() => { if (list.data) run(); }, [type, list.data]); // eslint-disable-line
  const exportAs = async (fmt) => { setExporting(fmt); try { await api.download(qs(fmt), `${type}-${today}.${fmt}`); toast.success(`${fmt.toUpperCase()} downloaded`); } catch (e) { toast.error(e.message); } finally { setExporting(''); } };

  const columns = (result?.columns || []).map((c) => ({ key: c.key, label: c.label, align: c.type === 'money' || c.type === 'num' ? 'right' : undefined, render: (r) => cellValue(c, r[c.key]) }));
  const rows = (result?.rows || []).map((r, i) => ({ ...r, _id: i }));

  return (
    <>
      <PageHeader title="Reports" subtitle="Generate, filter and export operational reports." />
      <div className="grid grid-main" style={{ gridTemplateColumns: '300px minmax(0,1fr)' }}>
        <Card title="Report type" pad={false}>
          <div style={{ padding: 8 }}>{(list.data || []).map((r) => <button key={r.key} className={`menu-item ${type === r.key ? 'nav-link active' : ''}`} onClick={() => setType(r.key)}><FileText size={16} /> {r.title}</button>)}</div>
        </Card>
        <div className="stack">
          <Card title={def?.title || 'Report'} subtitle={def?.dated ? 'Filtered by date range' : 'Current snapshot - date range does not apply'}>
            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              {def?.dated && <><Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></Field></>}
              <Field label="Search within report"><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="Filter rows..." /></Field>
            </div>
            <div className="row mt">
              <button className="btn btn-primary" onClick={run} disabled={loading}><Play size={15} /> {loading ? 'Generating...' : 'Generate'}</button>
              <div className="grow" />
              <button className="btn btn-ghost" disabled={!!exporting} onClick={() => exportAs('pdf')}><FileDown size={15} /> {exporting === 'pdf' ? 'Preparing...' : 'PDF'}</button>
              <button className="btn btn-ghost" disabled={!!exporting} onClick={() => exportAs('csv')}><FileText size={15} /> {exporting === 'csv' ? 'Preparing...' : 'CSV'}</button>
              <button className="btn btn-ghost" disabled={!!exporting} onClick={() => exportAs('xlsx')}><FileSpreadsheet size={15} /> {exporting === 'xlsx' ? 'Preparing...' : 'Excel'}</button>
            </div>
          </Card>
          <DataTable columns={columns} rows={rows} rowKey="_id" loading={loading} pageSize={15} searchable={false} emptyText="No records for these filters"
            toolbar={result && <span className="muted small">{result.count} row(s){result.from ? ` - ${result.from} to ${result.to}` : ''}</span>} />
        </div>
      </div>
    </>
  );
}
