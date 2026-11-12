import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Boxes, Eye, EyeOff, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api } from '../services/api.js';
import { Field, Spinner } from '../components/ui.jsx';

export function Aside() {
  return (
    <aside className="auth-aside">
      <Link to="/" className="brand" style={{ border: 0, padding: 0 }}><span className="brand-mark"><Boxes size={19} /></span><span className="brand-text">SmartProcure</span></Link>
      <div>
        <h2>Accurate stock. Fewer surprises.</h2>
        <ul className="auth-points">
          <li><CheckCircle2 size={18} /> Stock changes are transaction-safe and update live on every screen.</li>
          <li><CheckCircle2 size={18} /> Goods only become stock after a verified receipt.</li>
          <li><CheckCircle2 size={18} /> Every action is recorded in an audit trail.</li>
        </ul>
      </div>
      <span className="muted small">Wholesale Procurement &amp; Inventory Management</span>
    </aside>
  );
}

const DEMO = [
  ['admin@smartprocure.com', 'Administrator'], ['procurement@smartprocure.com', 'Procurement Officer'], ['warehouse@smartprocure.com', 'Warehouse Manager'],
  ['sales@smartprocure.com', 'Sales Officer'], ['management@smartprocure.com', 'Management'],
];

export function Login() {
  const { user, login } = useAuth(); const { toast } = useUi();
  const navigate = useNavigate(); const loc = useLocation();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (user) return <Navigate to={loc.state?.from || '/dashboard'} replace />;

  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    try {
      const u = await login(email.trim(), password);
      toast.success(`Welcome back, ${u.fullName.split(' ')[0]}`);
      const first = u.permissions.includes('dashboard.view') ? '/dashboard' : u.permissions.includes('products.view') ? '/inventory' : '/profile';
      navigate(loc.state?.from || first, { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <Aside />
      <div className="auth-main">
        <div className="auth-card">
          <Link to="/" className="muted small row" style={{ gap: 6, marginBottom: 22 }}><ArrowLeft size={14} /> Back to home</Link>
          <h1>Sign in</h1>
          <p className="muted">Use your SmartProcure account to continue.</p>
          <form onSubmit={submit} noValidate>
            <Field label="Email address"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus /></Field>
            <Field label="Password">
              <div className="pw-wrap"><input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
                <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
            </Field>
            {error && <div className="alert alert-danger" role="alert">{error}</div>}
            <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? <Spinner label="Signing in..." /> : 'Sign in'}</button>
            <Link to="/forgot-password" className="small" style={{ textAlign: 'center' }}>Forgot your password?</Link>
            <p className="muted small" style={{ textAlign: 'center' }}>New here? <Link to="/signup" className="strong">Sign up</Link> or <Link to="/create-account" className="strong">create a full account</Link></p>
          </form>
          <div className="demo-accounts">
            <h4>Demo accounts (password: Password@123)</h4>
            {DEMO.map(([em, role]) => <button type="button" key={em} className="demo-chip" onClick={() => { setEmail(em); setPassword('Password@123'); }}>{em}<span>{role}</span></button>)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState(null); const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { setResult(await api.post('/auth/forgot-password', { email })); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-page">
      <Aside />
      <div className="auth-main"><div className="auth-card">
        <Link to="/login" className="muted small row" style={{ gap: 6, marginBottom: 22 }}><ArrowLeft size={14} /> Back to sign in</Link>
        <h1>Forgot password</h1><p className="muted">Enter your account email and we'll generate a reset link.</p>
        {result ? (
          <div className="stack mt">
            <div className="alert alert-success"><CheckCircle2 size={18} /><span>{result.message}</span></div>
            {result.devResetLink && <div className="alert alert-info"><span><b>Development mode:</b> no mail server is configured, so use this link directly:<br /><a href={result.devResetLink.replace(/^https?:\/\/[^/]+/, '')}>Open reset page</a></span></div>}
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <Field label="Email address"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus /></Field>
            {error && <div className="alert alert-danger">{error}</div>}
            <button className="btn btn-primary btn-lg" disabled={busy || !email}>{busy ? 'Sending...' : 'Send reset link'}</button>
          </form>
        )}
      </div></div>
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams(); const navigate = useNavigate(); const { toast } = useUi();
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try { await api.post('/auth/reset-password', { token: params.get('token'), password }); toast.success('Password reset. Please sign in.'); navigate('/login'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-page">
      <Aside />
      <div className="auth-main"><div className="auth-card">
        <h1>Set a new password</h1><p className="muted">At least 8 characters, with a letter and a number.</p>
        <form onSubmit={submit} noValidate>
          <Field label="New password"><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></Field>
          <Field label="Confirm password"><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          {error && <div className="alert alert-danger">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy || !params.get('token')}>{busy ? 'Saving...' : 'Reset password'}</button>
          {!params.get('token') && <div className="alert alert-warning">This link is missing its token. Request a new reset link.</div>}
        </form>
      </div></div>
    </div>
  );
}
