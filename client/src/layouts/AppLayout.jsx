import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard, Package, ShoppingCart, Truck, PackageCheck, ClipboardCheck, Users2, LineChart, FileBarChart, Bell, Menu, PanelLeftClose, PanelLeftOpen,
  Search, LogOut, UserCircle, ShieldCheck, ScrollText, Home, Boxes, CheckCheck, AlertTriangle, Info, CheckCircle2, XCircle, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useRealtime } from '../context/RealtimeContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api } from '../services/api.js';
import { timeAgo } from '../utils/format.js';

const NAV = [
  { section: 'Overview' },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perms: ['dashboard.view'] },
  { section: 'Operations' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, perms: ['products.view', 'inventory.view'] },
  { to: '/procurement', label: 'Procurement', icon: ShoppingCart, perms: ['po.view', 'requisitions.view'] },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, perms: ['suppliers.view'] },
  { to: '/goods-received', label: 'Goods Received', icon: PackageCheck, perms: ['grn.view'] },
  { to: '/reconciliation', label: 'Stock Reconciliation', icon: ClipboardCheck, perms: ['reconciliation.view'] },
  { to: '/sales', label: 'Orders & Deliveries', icon: Package, perms: ['orders.view', 'customers.view', 'deliveries.view'] },
  { section: 'Insights' },
  { to: '/analytics', label: 'Analytics & Forecast', icon: LineChart, perms: ['analytics.view'] },
  { to: '/reports', label: 'Reports', icon: FileBarChart, perms: ['reports.view'] },
  { section: 'Administration' },
  { to: '/users', label: 'Users', icon: ShieldCheck, perms: ['users.manage'] },
  { to: '/audit', label: 'Audit Log', icon: ScrollText, perms: ['audit.view'] },
];
const SEV = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle };

function useOutside(ref, onOutside) {
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside(); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, [ref, onOutside]);
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, items: [] });
  const ref = useRef(null); const navigate = useNavigate();
  const { subscribe } = useRealtime(); const { toast } = useUi();
  useOutside(ref, () => setOpen(false));

  const load = useCallback(() => api.get('/notifications?limit=30').then(setData).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe('notification:new', (n) => { load(); const t = n.severity === 'error' ? 'error' : n.severity === 'warning' ? 'warning' : n.severity === 'success' ? 'success' : 'info'; toast[t](n.title); }), [subscribe, load]); // eslint-disable-line

  const openItem = async (n) => {
    if (!n.is_read) { await api.post(`/notifications/${n.id}/read`).catch(() => {}); load(); }
    setOpen(false); if (n.link) navigate(n.link);
  };
  const readAll = async () => { await api.post('/notifications/read-all'); load(); };

  return (
    <div className="dropdown" ref={ref}>
      <button className="icon-btn" aria-label="Notifications" onClick={() => { setOpen(!open); if (!open) load(); }}>
        <Bell size={19} />{data.unread > 0 && <span className="bell-dot">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="dropdown-panel notif-panel">
          <div className="notif-head"><b>Notifications</b>{data.unread > 0 && <button className="btn btn-ghost btn-sm" onClick={readAll}><CheckCheck size={14} /> Mark all read</button>}</div>
          <div className="notif-list">
            {data.items.length === 0 && <div className="empty"><strong>You're all caught up</strong></div>}
            {data.items.slice(0, 12).map((n) => {
              const Icon = SEV[n.severity] || Info;
              return (
                <div key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} onClick={() => openItem(n)}>
                  <div className={`notif-ico sev-${n.severity}`}><Icon size={16} /></div>
                  <div><b>{n.title}</b>{n.message && <p>{n.message}</p>}<p>{timeAgo(n.created_at)}</p></div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: 10, textAlign: 'center' }}><Link to="/notifications" onClick={() => setOpen(false)}>View all notifications</Link></div>
        </div>
      )}
    </div>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth(); const navigate = useNavigate();
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useOutside(ref, () => setOpen(false));
  const initials = user.fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="dropdown" ref={ref}>
      <button className="profile-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <span className="avatar">{initials}</span>
        <span className="profile-meta"><b>{user.fullName}</b><span>{user.role}</span></span>
        <ChevronDown size={14} className="muted" />
      </button>
      {open && (
        <div className="dropdown-panel menu-list" role="menu">
          <div className="menu-head"><b>{user.fullName}</b><span>{user.email}</span></div>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { setOpen(false); navigate('/profile'); }}><UserCircle size={16} /> My profile</button>
          <Link className="menu-item" to="/" onClick={() => setOpen(false)}><Home size={16} /> Home page</Link>
          <div className="menu-sep" />
          <button className="menu-item" onClick={async () => { await logout(); navigate('/login'); }}><LogOut size={16} /> Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { can } = useAuth(); const { connected } = useRealtime();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('sp_collapsed') === '1'; } catch { return false; } });
  const [mobile, setMobile] = useState(false);
  const [q, setQ] = useState(''); const navigate = useNavigate(); const loc = useLocation();
  useEffect(() => { setMobile(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const toggle = () => { const v = !collapsed; setCollapsed(v); try { localStorage.setItem('sp_collapsed', v ? '1' : '0'); } catch { /* ignore */ } };

  const items = NAV.filter((n) => n.section || can(...n.perms));
  const visible = items.filter((n, i) => !n.section || (items[i + 1] && !items[i + 1].section)); // hide empty sections

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''} ${mobile ? 'mobile-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <Link to="/" className="brand" title="Back to home page">
          <span className="brand-mark"><Boxes size={19} /></span>
          <span className="brand-text">SmartProcure<small>Procurement & Inventory</small></span>
        </Link>
        <nav className="nav">
          {visible.map((n, i) => n.section
            ? <div key={i} className="nav-section">{n.section}</div>
            : <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title={collapsed ? n.label : undefined}><n.icon size={19} /><span>{n.label}</span></NavLink>)}
        </nav>
        <div className="sidebar-foot"><span className={`live-dot ${connected ? 'on' : ''}`}><i /><b>{connected ? 'Live sync on' : 'Reconnecting...'}</b></span></div>
      </aside>
      <div className="scrim" onClick={() => setMobile(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn-mobile" aria-label="Open menu" onClick={() => setMobile(true)}><Menu size={20} /></button>
          <button className="icon-btn menu-btn-desktop" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggle}>{collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>
          <form className="search-box" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/inventory?q=${encodeURIComponent(q.trim())}`); }}>
            <Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products by name or SKU..." aria-label="Search products" />
          </form>
          <div className="grow" />
          <NotificationBell />
          <ProfileMenu />
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}
