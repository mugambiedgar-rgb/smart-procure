import { useState } from 'react';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import useFetch from '../hooks/useFetch.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { Badge, Field, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useUi } from '../context/UiContext.jsx';
import { api } from '../services/api.js';
import { fmtDateTime } from '../utils/format.js';

function UserForm({ u, roles, onClose, onSaved }) {
  const { toast } = useUi(); const editing = !!u?.id;
  const [f, setF] = useState({ fullName: u?.full_name || '', email: u?.email || '', roleId: u?.role_id || '', phone: u?.phone || '', password: '', isActive: u ? !!u.is_active : true });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const e = {}; if (f.fullName.trim().length < 2) e.fullName = 'Enter a name'; if (!editing && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Enter a valid email'; if (!f.roleId) e.roleId = 'Choose a role';
    if (!editing && (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password))) e.password = 'At least 8 characters with a letter and a number'; setErr(e); if (Object.keys(e).length) return;
    setBusy(true); try { if (editing) await api.put(`/users/${u.id}`, { ...f, roleId: Number(f.roleId) }); else await api.post('/users', { ...f, roleId: Number(f.roleId) }); toast.success(editing ? 'User updated' : 'User created'); onSaved(); } catch (x) { toast.error(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? `Edit ${u.full_name}` : 'Register user'} subtitle={editing ? undefined : 'Accounts are created by administrators only.'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save user</button></>}>
      <div className="form-grid">
        <Field label="Full name *" error={err.fullName}><input value={f.fullName} onChange={set('fullName')} /></Field>
        <Field label="Email *" error={err.email}><input type="email" value={f.email} onChange={set('email')} disabled={editing} /></Field>
        <Field label="Role *" error={err.roleId}><select value={f.roleId} onChange={set('roleId')}><option value="">Select...</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
        {!editing && <Field label="Temporary password *" error={err.password} className="span-2"><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>}
        {editing && <label className="check span-2"><input type="checkbox" checked={f.isActive} onChange={set('isActive')} /><span>Account is active (inactive users cannot sign in)</span></label>}
      </div>
    </Modal>
  );
}

export default function Users() {
  const { user: me } = useAuth(); const { toast } = useUi();
  const { data, loading, reload } = useFetch('/users'); const roles = useFetch('/users/roles');
  const [form, setForm] = useState(null); const [pw, setPw] = useState(null); const [newPw, setNewPw] = useState('');
  const resetPw = async () => { try { await api.post(`/users/${pw.id}/reset-password`, { password: newPw }); toast.success('Password reset. All of that user\'s sessions were signed out.'); setPw(null); setNewPw(''); } catch (e) { toast.error(e.message); } };
  const cols = [
    { key: 'full_name', label: 'User', render: (u) => <div><div className="cell-title">{u.full_name}{u.id === me.id && <span className="muted small"> (you)</span>}</div><div className="cell-sub">{u.email}</div></div> },
    { key: 'role', label: 'Role', render: (u) => <Badge tone="violet" dot={false}>{u.role}</Badge> },
    { key: 'is_active', label: 'Status', render: (u) => (u.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>) },
    { key: 'last_login_at', label: 'Last sign-in', render: (u) => (u.last_login_at ? fmtDateTime(u.last_login_at) : <span className="muted">Never</span>) },
    { key: 'a', label: '', sortable: false, searchable: false, align: 'right', render: (u) => <div className="row" style={{ justifyContent: 'flex-end', gap: 2, flexWrap: 'nowrap' }}><button className="icon-btn" aria-label="Edit user" onClick={() => setForm(u)}><Pencil size={15} /></button><button className="icon-btn" aria-label="Reset password" onClick={() => setPw(u)}><KeyRound size={15} /></button></div> },
  ];
  return (
    <>
      <PageHeader title="User management" subtitle="Create accounts, assign roles and deactivate access." actions={<button className="btn btn-primary" onClick={() => setForm({})}><Plus size={16} /> Register user</button>} />
      <DataTable columns={cols} rows={data || []} loading={loading} searchPlaceholder="Search users..." />
      {form && <UserForm u={form.id ? form : null} roles={roles.data || []} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {pw && <Modal title={`Reset password for ${pw.full_name}`} size="sm" onClose={() => setPw(null)} footer={<><button className="btn btn-ghost" onClick={() => setPw(null)}>Cancel</button><button className="btn btn-primary" disabled={newPw.length < 8} onClick={resetPw}>Reset password</button></>}><Field label="New password" hint="At least 8 characters with a letter and a number"><input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></Field></Modal>}
    </>
  );
}
