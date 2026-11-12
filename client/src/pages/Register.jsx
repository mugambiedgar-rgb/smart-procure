import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { Field, Spinner } from '../components/ui.jsx';
import { Aside } from './Auth.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s.]{6,30}$/;

function strength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return [['Too weak', '#ef4444'], ['Weak', '#f97316'], ['Fair', '#eab308'], ['Good', '#22c55e'], ['Strong', '#10b981']][score];
}

function PasswordInput({ value, onChange, placeholder, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input type={show ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus} />
      <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
  );
}

function useRegister() {
  const { user, register } = useAuth(); const { toast } = useUi(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async (data) => {
    setError(''); setBusy(true);
    try {
      const u = await register(data);
      toast.success(`Welcome to SmartProcure, ${u.fullName.split(' ')[0]}`);
      navigate(u.permissions.includes('dashboard.view') ? '/dashboard' : '/profile', { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return { user, busy, error, setError, submit };
}

const RoleNote = () => (
  <div className="alert alert-info" style={{ alignItems: 'flex-start' }}>
    <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
    <span>New accounts start with <b>read-only (Viewer)</b> access. An administrator can grant a different role later.</span>
  </div>
);

/** Quick sign up: name, email, password. */
export function SignUp() {
  const { user, busy, error, setError, submit } = useRegister();
  const [f, setF] = useState({ fullName: '', email: '', password: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (user) return <Navigate to="/dashboard" replace />;
  const onSubmit = (e) => {
    e.preventDefault();
    if (f.fullName.trim().length < 2) return setError('Enter your full name.');
    if (!EMAIL_RE.test(f.email.trim())) return setError('Enter a valid email address.');
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) return setError('Password must be at least 8 characters with a letter and a number.');
    submit({ fullName: f.fullName.trim(), email: f.email.trim(), password: f.password });
  };
  return (
    <div className="auth-page">
      <Aside />
      <div className="auth-main"><div className="auth-card">
        <Link to="/" className="muted small row" style={{ gap: 6, marginBottom: 22 }}><ArrowLeft size={14} /> Back to home</Link>
        <h1>Sign up</h1>
        <p className="muted">Get started in under a minute.</p>
        <form onSubmit={onSubmit} noValidate>
          <Field label="Full name"><input value={f.fullName} onChange={set('fullName')} autoComplete="name" placeholder="Jane Doe" autoFocus /></Field>
          <Field label="Email address"><input type="email" value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@company.com" /></Field>
          <Field label="Password" hint="At least 8 characters, with a letter and a number."><PasswordInput value={f.password} onChange={set('password')} placeholder="Choose a password" /></Field>
          <RoleNote />
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? <Spinner label="Signing up..." /> : 'Sign up'}</button>
          <p className="muted small" style={{ textAlign: 'center' }}>Already have an account? <Link to="/login" className="strong">Sign in</Link></p>
          <p className="muted small" style={{ textAlign: 'center' }}>Want to add a phone number? <Link to="/create-account" className="strong">Create a full account</Link></p>
        </form>
      </div></div>
    </div>
  );
}

/** Full account creation: adds phone, password confirmation, strength meter and terms. */
export function CreateAccount() {
  const { user, busy, error, setError, submit } = useRegister();
  const [f, setF] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '', agree: false });
  const [fe, setFe] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  if (user) return <Navigate to="/dashboard" replace />;
  const st = strength(f.password);
  const onSubmit = (e) => {
    e.preventDefault(); setError('');
    const errs = {};
    if (f.fullName.trim().length < 2) errs.fullName = 'Enter your full name.';
    if (!EMAIL_RE.test(f.email.trim())) errs.email = 'Enter a valid email address.';
    if (f.phone.trim() && !PHONE_RE.test(f.phone.trim())) errs.phone = 'Enter a valid phone number.';
    if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) errs.password = 'Use 8+ characters including a letter and a number.';
    if (f.confirm !== f.password) errs.confirm = 'Passwords do not match.';
    if (!f.agree) errs.agree = 'Please accept the terms to continue.';
    setFe(errs);
    if (Object.keys(errs).length) return;
    submit({ fullName: f.fullName.trim(), email: f.email.trim(), phone: f.phone.trim(), password: f.password });
  };
  return (
    <div className="auth-page">
      <Aside />
      <div className="auth-main"><div className="auth-card" style={{ maxWidth: 460 }}>
        <Link to="/" className="muted small row" style={{ gap: 6, marginBottom: 22 }}><ArrowLeft size={14} /> Back to home</Link>
        <h1><UserPlus size={22} style={{ verticalAlign: '-3px', marginRight: 8 }} />Create account</h1>
        <p className="muted">Set up your SmartProcure profile.</p>
        <form onSubmit={onSubmit} noValidate>
          <Field label="Full name" error={fe.fullName}><input value={f.fullName} onChange={set('fullName')} autoComplete="name" placeholder="Jane Doe" autoFocus /></Field>
          <Field label="Work email" error={fe.email}><input type="email" value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@company.com" /></Field>
          <Field label="Phone (optional)" error={fe.phone}><input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" placeholder="+1 555 0100" /></Field>
          <Field label="Password" error={fe.password}>
            <PasswordInput value={f.password} onChange={set('password')} placeholder="Choose a strong password" />
            {f.password && <span className="small" style={{ color: st[1] }} data-testid="strength">Strength: {st[0]}</span>}
          </Field>
          <Field label="Confirm password" error={fe.confirm}><PasswordInput value={f.confirm} onChange={set('confirm')} placeholder="Repeat your password" /></Field>
          <label style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={f.agree} onChange={set('agree')} style={{ marginTop: 3, width: 'auto', flexShrink: 0 }} />
            <span className="small">I agree to use this system responsibly and understand my activity is recorded in the audit log.</span>
          </label>
          {fe.agree && <small className="field-error">{fe.agree}</small>}
          <RoleNote />
          {error && <div className="alert alert-danger" role="alert">{error}</div>}
          <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? <Spinner label="Creating account..." /> : 'Create account'}</button>
          <p className="muted small" style={{ textAlign: 'center' }}>Already registered? <Link to="/login" className="strong">Sign in</Link></p>
        </form>
      </div></div>
    </div>
  );
}
