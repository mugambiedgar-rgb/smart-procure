import { TONES } from '../utils/format.js';

export function Spinner({ label = 'Loading...', block }) {
  return <div className={block ? 'spinner-block' : 'spinner-inline'}><span className="spinner" aria-hidden /> <span className="muted small">{label}</span></div>;
}

export function Badge({ children, tone, dot = true }) {
  const t = tone || TONES[children] || 'neutral';
  return <span className={`badge badge-${t}`}>{dot && <i />}{children}</span>;
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, hint, tone = 'info', onClick }) {
  return (
    <div className={`stat-card tone-${tone} ${onClick ? 'clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="stat-icon">{Icon && <Icon size={20} />}</div>
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {hint && <span className="stat-hint">{hint}</span>}
      </div>
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div><h3>{title}</h3>{subtitle && <p className="muted small">{subtitle}</p>}</div>
          {actions}
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Empty({ title = 'Nothing here yet', children }) {
  return <div className="empty"><strong>{title}</strong>{children && <p className="muted">{children}</p>}</div>;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="error-state">
      <strong>Something went wrong</strong>
      <p className="muted">{error?.message || 'Unable to load data.'}</p>
      {onRetry && <button className="btn btn-ghost" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

/** Quantity bar showing physical / reserved / available at a glance */
export function StockBar({ physical, reserved }) {
  const pct = physical > 0 ? Math.min(100, Math.round((reserved / physical) * 100)) : 0;
  return <div className="stockbar" title={`${reserved} of ${physical} reserved`}><i style={{ width: `${pct}%` }} /></div>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
