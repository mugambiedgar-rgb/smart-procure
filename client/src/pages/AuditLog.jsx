import { useState } from 'react';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import { Badge, PageHeader } from '../components/ui.jsx';
import { fmtDateTime } from '../utils/format.js';

export default function AuditLog() {
  const [action, setAction] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const qs = `/audit?limit=500${action ? `&action=${action}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`;
  const { data, loading } = useFetch(qs, { live: ['data:changed'] });
  const cols = [
    { key: 'created_at', label: 'When', render: (a) => <span className="nowrap">{fmtDateTime(a.created_at)}</span> },
    { key: 'user_name', label: 'User', render: (a) => a.user_name || <span className="muted">System / anonymous</span> },
    { key: 'action', label: 'Action', render: (a) => <Badge tone={a.action.includes('FAILED') || a.action.includes('CANCEL') || a.action.includes('REJECT') ? 'danger' : a.action.includes('ADJUST') ? 'warning' : 'info'} dot={false}>{a.action}</Badge> },
    { key: 'entity_type', label: 'Entity', render: (a) => (a.entity_type ? <span className="mono">{a.entity_type}{a.entity_id ? ` #${a.entity_id}` : ''}</span> : '-') },
    { key: 'details', label: 'Details', sortable: false, searchable: false, render: (a) => <span className="small muted mono">{typeof a.details === 'string' ? a.details : JSON.stringify(a.details)}</span> },
    { key: 'ip_address', label: 'IP', render: (a) => <span className="mono muted">{a.ip_address || '-'}</span> },
  ];
  const rows = (data?.items || []).map((a) => ({ ...a, search: `${a.details}` }));
  return (
    <>
      <PageHeader title="Audit log" subtitle="An immutable record of who did what, and when." />
      <DataTable columns={cols} rows={rows} loading={loading} pageSize={20} searchPlaceholder="Search audit trail..."
        filters={<>
          <select className="inline-select" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action"><option value="">All actions</option>{(data?.actions || []).map((a) => <option key={a}>{a}</option>)}</select>
          <input type="date" className="inline-select" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" style={{ width: 150 }} />
          <input type="date" className="inline-select" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" style={{ width: 150 }} />
        </>} />
    </>
  );
}
