import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCheck, CheckCircle2, Info, XCircle } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import { Card, Empty, PageHeader, Tabs } from '../components/ui.jsx';
import { api } from '../services/api.js';
import { timeAgo } from '../utils/format.js';

const SEV = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

export default function Notifications() {
  const [tab, setTab] = useState('all'); const navigate = useNavigate();
  const { data, reload } = useFetch('/notifications?limit=200', { live: ['notification:new'] });
  const items = (data?.items || []).filter((n) => tab === 'all' || !n.is_read);
  const open = async (n) => { if (!n.is_read) { await api.post(`/notifications/${n.id}/read`).catch(() => {}); reload(); } if (n.link) navigate(n.link); };
  return (
    <>
      <PageHeader title="Notifications" subtitle="Alerts for low stock, approvals, deliveries, discrepancies and more."
        actions={data?.unread > 0 && <button className="btn btn-ghost" onClick={async () => { await api.post('/notifications/read-all'); reload(); }}><CheckCheck size={15} /> Mark all as read</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread', count: data?.unread }]} />
      <Card pad={false}>
        {items.length === 0 ? <Empty title="No notifications">You're all caught up.</Empty> : items.map((n) => {
          const Icon = SEV[n.severity] || Info;
          return (
            <div key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} onClick={() => open(n)}>
              <div className={`notif-ico sev-${n.severity}`}><Icon size={16} /></div>
              <div className="grow"><b>{n.title}</b>{n.message && <p>{n.message}</p>}</div>
              <span className="muted small nowrap">{timeAgo(n.created_at)}</span>
              {!n.is_read && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); api.post(`/notifications/${n.id}/read`).then(reload); }}>Mark read</button>}
            </div>
          );
        })}
      </Card>
    </>
  );
}
