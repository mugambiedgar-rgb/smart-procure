import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Boxes, CheckCircle2, ClipboardCheck, ShoppingCart, PackageCheck, LineChart, Truck, ShieldCheck, Zap, Bell, FileBarChart, Lock, Layers,
  Copy, PackageX, Scale, TrendingDown, Clock, MessageSquareWarning, Eye, Play, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../services/api.js';
import { num } from '../utils/format.js';

const PROBLEMS = [
  { icon: Clock, t: 'Delayed inventory updates', fix: 'Every stock change is written in one database transaction and pushed live to every screen.' },
  { icon: Scale, t: 'Inaccurate stock availability', fix: 'Available = Physical - Reserved, calculated by the database itself - never typed in by hand.' },
  { icon: Copy, t: 'Duplicate supplier orders', fix: 'Unique PO numbers, active-order checks and a confirmation step before any look-alike order is created.' },
  { icon: PackageX, t: 'Goods received but not recorded', fix: 'A Goods Received Note is the only way stock goes up - verified against the purchase order.' },
  { icon: Layers, t: 'Physical vs digital differences', fix: 'Stock-count sessions compare counted vs system quantities and post approved adjustments to an audit trail.' },
  { icon: TrendingDown, t: 'Poor demand forecasting', fix: 'Transparent forecasts from real sales history and lead times, with suggested reorder quantities.' },
  { icon: Truck, t: 'Delayed customer deliveries', fix: 'Stock is reserved at order time, deliveries are tracked end-to-end, delays raise alerts.' },
  { icon: MessageSquareWarning, t: 'Poor communication between teams', fix: 'Role-based notifications tell the right people the moment something needs their attention.' },
];

const MODULES = [
  { icon: Boxes, t: 'Inventory', d: 'Physical, reserved, available and incoming stock per product, with a full movement history and serial tracking.' },
  { icon: ShoppingCart, t: 'Procurement', d: 'Requisitions, multi-line purchase orders, approvals, duplicate checks and printable PO documents.' },
  { icon: Truck, t: 'Suppliers', d: 'On-time delivery, fulfilment rate and average lead time measured from what was actually received.' },
  { icon: PackageCheck, t: 'Goods Received', d: 'Record deliveries against POs, flag damaged or missing goods, then verify to update stock.' },
  { icon: ClipboardCheck, t: 'Reconciliation', d: 'Count stock, see every discrepancy, record reasons and approve adjustments.' },
  { icon: Zap, t: 'Orders & Deliveries', d: 'Check availability, reserve stock, prevent overselling and follow each delivery to the door.' },
  { icon: LineChart, t: 'Analytics', d: 'Fast and slow movers, seasonality and reorder suggestions - clearly labelled as estimates.' },
  { icon: FileBarChart, t: 'Reports', d: 'Eight reports with date filters, exportable to PDF, CSV and Excel.' },
];

const STEPS = [
  ['Locate the purchase order', 'Warehouse staff find the matching approved PO for the delivery.'],
  ['Verify the products', 'Count what physically arrived, line by line.'],
  ['Compare ordered vs delivered', 'The system shows outstanding, delivered, damaged and missing quantities.'],
  ['Record discrepancies', 'Damaged and missing goods are captured on the GRN with remarks.'],
  ['Confirm the delivery', 'A warehouse manager verifies the note.'],
  ['Stock updates automatically', 'Only accepted units are added to physical stock, inside one locked transaction.'],
  ['The PO status updates', 'Partially Received or Fully Received - no manual editing.'],
  ['An audit record is written', 'Who, what and when are stored permanently.'],
];

const ROLES = [
  ['Administrator', 'Full system access, user management and audit trail.'],
  ['Procurement Officer', 'Suppliers, requisitions and purchase orders.'],
  ['Warehouse Manager', 'Inventory, goods received, stock counts and dispatch.'],
  ['Sales Officer', 'Customers, orders, stock availability and deliveries.'],
  ['Management', 'Approvals, analytics, reports and performance.'],
];

export default function Home() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  useEffect(() => { api.get('/public/overview').then(setStats).catch(() => setStats(null)); }, []);
  const go = user ? '/dashboard' : '/login';

  return (
    <div className="home">
      <header className="home-nav">
        <Link to="/" className="brand"><span className="brand-mark"><Boxes size={19} /></span><span className="brand-text">SmartProcure</span></Link>
        <nav className="home-links" aria-label="Page sections">
          <a href="#problems">Why SmartProcure</a><a href="#stock">Stock accuracy</a><a href="#receiving">Goods receiving</a><a href="#modules">Modules</a><a href="#roles">Roles</a>
        </nav>
        <div className="home-cta">
          {user ? <Link to="/dashboard" className="btn btn-primary">Open dashboard <ArrowRight size={16} /></Link>
            : <><Link to="/login" className="btn btn-ghost">Sign in</Link><Link to="/login" className="btn btn-primary">Get started</Link></>}
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow"><Zap size={14} /> Real-time procurement &amp; inventory for wholesale electronics</span>
          <h1>Know exactly what's on your shelves - <span className="grad-text">every second.</span></h1>
          <p className="lead">SmartProcure connects purchasing, the warehouse and sales on one trusted record. Goods are only counted once they're received and verified, stock is reserved the moment an order is confirmed, and every change is audited.</p>
          <div className="hero-actions">
            <Link to={go} className="btn btn-primary btn-lg">{user ? 'Go to dashboard' : 'Sign in to the system'} <ArrowRight size={18} /></Link>
            <a href="#stock" className="btn btn-ghost btn-lg"><Play size={16} /> See how stock stays accurate</a>
          </div>
          <div className="hero-trust"><span><CheckCircle2 size={16} /> Transaction-safe stock</span><span><CheckCircle2 size={16} /> No overselling</span><span><CheckCircle2 size={16} /> Full audit trail</span></div>
        </div>

        <div style={{ position: 'relative' }} aria-hidden>
          <div className="mock">
            <div className="mock-bar"><i /><i /><i /></div>
            <div className="mock-row">
              <div className="mock-tile"><span>Physical</span><b>20</b></div>
              <div className="mock-tile"><span>Reserved</span><b style={{ color: '#fbbf24' }}>5</b></div>
              <div className="mock-tile"><span>Available</span><b style={{ color: '#4ade80' }}>15</b></div>
            </div>
            <div className="mock-flow">
              <small className="muted">HP ProBook 450 - sale of 5 units</small>
              <div className="eq"><div><small>Before</small><b>20</b></div><i>-</i><div><small>Sold</small><b>5</b></div><i>=</i><div><small>New physical</small><b className="grad-text">15</b></div></div>
            </div>
            <div className="mock-list">
              <div className="mock-line"><PackageCheck size={15} color="#4ade80" /> GRN-2026-00105 verified <span className="badge badge-success"><i />Stock updated</span></div>
              <div className="mock-line"><ShoppingCart size={15} color="#a78bfa" /> PO-2026-00103 approved <span className="badge badge-violet"><i />Incoming 20</span></div>
              <div className="mock-line"><Bell size={15} color="#fbbf24" /> Low stock: Samsung Galaxy S24 <span className="badge badge-warning"><i />Reorder</span></div>
            </div>
          </div>
          <div className="floating"><CheckCircle2 size={16} /> Synced to all departments</div>
        </div>
      </section>

      <div className="stats-strip">
        <div className="stats-inner">
          <div><b>{stats ? num(stats.products) : '-'}</b><span>Products tracked</span></div>
          <div><b>{stats ? num(stats.units) : '-'}</b><span>Units in the warehouse</span></div>
          <div><b>{stats ? num(stats.suppliers) : '-'}</b><span>Active suppliers</span></div>
          <div><b>{stats ? num(stats.movements) : '-'}</b><span>Stock movements on record</span></div>
        </div>
      </div>

      <section className="section" id="problems">
        <div className="section-head"><span className="kicker">The problem</span><h2>Built to remove the causes of unreliable stock</h2><p>Traditional procurement leaves gaps between what's ordered, what arrives, what's recorded and what's sold. SmartProcure closes each one.</p></div>
        <div className="feature-grid">
          {PROBLEMS.map((p) => (
            <div className="feature problem" key={p.t}>
              <div>
                <div className="ico"><p.icon size={20} /></div>
                <small>Problem</small><h3>{p.t}</h3>
                <div className="fix"><CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /><span>{p.fix}</span></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="stock">
        <div className="split">
          <div>
            <div className="section-head" style={{ marginBottom: 20 }}><span className="kicker">One source of truth</span><h2>Four kinds of stock, never confused</h2>
              <p>Incoming goods are not stock. Reserved goods are not for sale. SmartProcure keeps the numbers separate so the figure a salesperson sees is the figure they can promise.</p></div>
            <div className="stack">
              {[[Eye, 'Physical stock', 'What is actually in the warehouse - changes only on verified receipts, dispatches, returns and approved adjustments.'], [Lock, 'Reserved stock', 'Promised to confirmed customer orders. Reserving checks availability under a row lock, so two sales can never claim the same unit.'], [CheckCircle2, 'Available stock', 'Physical minus reserved. The only quantity that can be sold.'], [Truck, 'Incoming stock', 'On open purchase orders. Shown for planning, never added to available stock until the goods are received and verified.']].map(([I, t, d]) => (
                <div key={t} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><div className="ico feature" style={{ width: 38, height: 38, padding: 0, display: 'grid', placeItems: 'center', flexShrink: 0, marginBottom: 0 }}><I size={18} /></div><div><b>{t}</b><p className="muted" style={{ margin: '2px 0 0' }}>{d}</p></div></div>
              ))}
            </div>
          </div>
          <div className="stock-demo" aria-hidden>
            <div className="eq"><div><small>Physical</small><b>25</b></div><i>-</i><div><small>Reserved</small><b style={{ color: '#fbbf24' }}>10</b></div><i>=</i><div><small>Available</small><b style={{ color: '#4ade80' }}>15</b></div></div>
            <div className="incoming"><AlertTriangle size={18} style={{ flexShrink: 0 }} /><span><b>+40 incoming</b> on PO-2026-00098. Not available until the goods arrive, are checked and the GRN is verified.</span></div>
          </div>
        </div>
      </section>

      <section className="section" id="receiving">
        <div className="split">
          <div className="steps">
            {STEPS.map(([t, d], i) => <div className="step" key={t}><div className="step-n">{i + 1}</div><div><b>{t}</b><p>{d}</p></div></div>)}
          </div>
          <div>
            <div className="section-head" style={{ marginBottom: 20 }}><span className="kicker">Goods received</span><h2>A delivery isn't stock until you've checked it</h2>
              <p>A supplier marking an order "delivered" never changes your inventory. Only a verified Goods Received Note does - and only for the units you accepted.</p></div>
            <div className="alert alert-success"><ShieldCheck size={18} /><span>Damaged and missing quantities are recorded on the GRN, so supplier performance is measured from facts, not promises.</span></div>
          </div>
        </div>
      </section>

      <section className="section" id="modules">
        <div className="section-head"><span className="kicker">Everything in one platform</span><h2>Every department, one connected system</h2></div>
        <div className="feature-grid">
          {MODULES.map((m) => <div className="feature" key={m.t}><div className="ico"><m.icon size={20} /></div><h3>{m.t}</h3><p>{m.d}</p></div>)}
        </div>
      </section>

      <section className="section" id="roles">
        <div className="section-head"><span className="kicker">Role-based access</span><h2>The right access for every team</h2><p>Permissions are enforced on the server for every request, not just hidden in the interface.</p></div>
        <div className="roles-grid">
          {ROLES.map(([r, d]) => <div className="role" key={r}><span className="avatar">{r[0]}</span><h4>{r}</h4><p>{d}</p></div>)}
        </div>
      </section>

      <div className="cta-band">
        <div className="cta-box">
          <h2>Ready to trust your stock numbers?</h2>
          <p>Sign in with a demo account to explore live inventory, procurement, receiving, reconciliation and sales workflows.</p>
          <Link to={go} className="btn btn-primary btn-lg">{user ? 'Open dashboard' : 'Sign in now'} <ArrowRight size={18} /></Link>
        </div>
      </div>

      <footer className="home-foot"><span>&copy; {new Date().getFullYear()} SmartProcure - Wholesale Procurement &amp; Inventory Management</span><span>React - Node.js - Express - MySQL 8</span></footer>
    </div>
  );
}
