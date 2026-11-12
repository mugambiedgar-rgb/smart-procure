import { useState } from 'react';
import { KeyRound, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api, setToken } from '../services/api.js';
import { Badge, Card, Field, PageHeader } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser } = useAuth(); const { toast } = useUi();
  const [f, setF] = useState({ fullName: user.fullName, phone: user.phone || '' }); const [busy, setBusy] = useState(false);
  const [p, setP] = useState({ currentPassword: '', newPassword: '', confirm: '' }); const [pbusy, setPbusy] = useState(false); const [perr, setPerr] = useState('');

  const save = async () => { if (f.fullName.trim().length < 2) return toast.error('Enter your name.'); setBusy(true); try { const r = await api.put('/auth/me', f); setUser(r.user); toast.success('Profile updated'); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const change = async () => {
    setPerr(''); if (p.newPassword !== p.confirm) return setPerr('The new passwords do not match.');
    if (p.newPassword.length < 8 || !/[A-Za-z]/.test(p.newPassword) || !/\d/.test(p.newPassword)) return setPerr('Use at least 8 characters with a letter and a number.');
    setPbusy(true); try { const r = await api.put('/auth/me/password', { currentPassword: p.currentPassword, newPassword: p.newPassword }); setToken(r.token); toast.success('Password changed. Other devices were signed out.'); setP({ currentPassword: '', newPassword: '', confirm: '' }); } catch (e) { setPerr(e.message); } finally { setPbusy(false); }
  };
  return (
    <>
      <PageHeader title="My profile" subtitle="Manage your details and password." />
      <div className="grid grid-2">
        <Card title="Profile" subtitle={user.email}>
          <div className="stack">
            <div className="row"><span className="avatar" style={{ width: 46, height: 46, fontSize: 16 }}>{user.fullName.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span><div><b>{user.fullName}</b><div><Badge tone="violet" dot={false}>{user.role}</Badge></div></div></div>
            <Field label="Full name"><input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
            <Field label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <div><button className="btn btn-primary" disabled={busy} onClick={save}><Save size={15} /> Save profile</button></div>
          </div>
        </Card>
        <Card title="Change password" subtitle="At least 8 characters with a letter and a number">
          <div className="stack">
            <Field label="Current password"><input type="password" autoComplete="current-password" value={p.currentPassword} onChange={(e) => setP({ ...p, currentPassword: e.target.value })} /></Field>
            <Field label="New password"><input type="password" autoComplete="new-password" value={p.newPassword} onChange={(e) => setP({ ...p, newPassword: e.target.value })} /></Field>
            <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={p.confirm} onChange={(e) => setP({ ...p, confirm: e.target.value })} /></Field>
            {perr && <div className="alert alert-danger">{perr}</div>}
            <div><button className="btn btn-primary" disabled={pbusy || !p.currentPassword || !p.newPassword} onClick={change}><KeyRound size={15} /> Update password</button></div>
          </div>
        </Card>
      </div>
      <Card title="Your permissions" className="mt"><div className="row" style={{ gap: 8 }}>{user.permissions.map((x) => <Badge key={x} tone="neutral" dot={false}>{x}</Badge>)}</div></Card>
    </>
  );
}
