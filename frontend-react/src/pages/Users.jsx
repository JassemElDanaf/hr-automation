import { useEffect, useState } from 'react';
import { useUI } from '../state/uiState';
import { useAuth } from '../state/auth';
import { listUsers, createUser, updateUser } from '../services/auth';
import Loading from '../components/common/Loading';

const ROLE_META = {
  admin:     { bg: '#ede9fe', color: '#5b21b6', label: 'Admin' },
  recruiter: { bg: '#dbeafe', color: '#1e40af', label: 'Recruiter' },
  viewer:    { bg: '#f1f5f9', color: '#475569', label: 'Viewer' },
};
const blankForm = { email: '', full_name: '', role: 'recruiter', password: '' };

export default function Users() {
  const { showToast } = useUI();
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [resetFor, setResetFor] = useState(null);      // user id pending a password reset
  const [resetPw, setResetPw] = useState('');

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try { setUsers(await listUsers()); }
    catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function addUser() {
    if (!form.email.trim() || !form.password) { showToast('Email and password are required', 'error'); return; }
    if (form.password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    setSaving(true);
    try {
      await createUser({ ...form, email: form.email.trim() });
      showToast(`User ${form.email} created`, 'success');
      setForm(blankForm); setShowNew(false); load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function changeRole(u, role) {
    try { await updateUser({ id: u.id, role }); setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role } : x)); showToast(`${u.email} is now ${role}`, 'success'); }
    catch (e) { showToast(e.message, 'error'); }
  }
  async function toggleActive(u) {
    try { await updateUser({ id: u.id, is_active: !u.is_active }); setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !u.is_active } : x)); showToast(`${u.email} ${u.is_active ? 'deactivated' : 'activated'}`, 'info'); }
    catch (e) { showToast(e.message, 'error'); }
  }
  async function resetPassword() {
    if (!resetPw || resetPw.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    try { await updateUser({ id: resetFor, password: resetPw }); showToast('Password updated', 'success'); setResetFor(null); setResetPw(''); }
    catch (e) { showToast(e.message, 'error'); }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)' }}>Users & Access</h2>
          <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>Manage who can sign in and what they can do.</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowNew(s => !s); setForm(blankForm); }}>{showNew ? 'Cancel' : '+ New User'}</button>
      </div>

      {showNew && (
        <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 10, padding: 16, marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={lbl}>Email</label><input style={inp} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="person@diyarme.com" /></div>
          <div><label style={lbl}>Full name</label><input style={inp} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Full name" /></div>
          <div><label style={lbl}>Role</label>
            <select style={inp} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="recruiter">Recruiter — full hiring pipeline</option>
              <option value="viewer">Viewer — read-only</option>
              <option value="admin">Admin — everything + user management</option>
            </select>
          </div>
          <div><label style={lbl}>Temporary password</label><input style={inp} type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="at least 6 characters" /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-success btn-sm" onClick={addUser} disabled={saving}>{saving ? 'Creating…' : 'Create User'}</button>
          </div>
        </div>
      )}

      {loading ? <Loading /> : (
        <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)', textAlign: 'left' }}>
                {['User', 'Role', 'Status', 'Last login', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const rm = ROLE_META[u.role] || ROLE_META.viewer;
                const isMe = me && u.id === me.id;
                return (
                  <tr key={u.id} style={{ borderTop: '1px solid var(--gray-100)', opacity: u.is_active ? 1 : 0.55 }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{u.full_name || u.email}{isMe && <span style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 500 }}> (you)</span>}</div>
                      <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{u.email}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <select value={u.role} disabled={isMe} onChange={e => changeRole(u, e.target.value)}
                        style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 8, border: 'none', background: rm.bg, color: rm.color, cursor: isMe ? 'not-allowed' : 'pointer' }}>
                        <option value="admin">Admin</option>
                        <option value="recruiter">Recruiter</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: u.is_active ? '#16a34a' : '#9ca3af' }}>{u.is_active ? '● Active' : '○ Disabled'}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--gray-500)' }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'never'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => { setResetFor(u.id); setResetPw(''); }}>Reset password</button>
                        {!isMe && <button className="btn btn-sm btn-ghost" onClick={() => toggleActive(u)}>{u.is_active ? 'Disable' : 'Enable'}</button>}
                      </div>
                      {resetFor === u.id && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                          <input style={{ ...inp, width: 180, marginTop: 0 }} type="text" value={resetPw} onChange={e => setResetPw(e.target.value)} placeholder="new password" autoFocus />
                          <button className="btn btn-sm btn-success" onClick={resetPassword}>Save</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setResetFor(null)}>Cancel</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const lbl = { fontSize: 12.5, fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 5 };
const inp = { width: '100%', padding: '8px 10px', fontSize: 14, border: '1px solid var(--gray-300)', borderRadius: 8, outline: 'none', fontFamily: 'inherit' };
