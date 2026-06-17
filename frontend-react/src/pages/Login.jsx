import { useState } from 'react';
import { useAuth } from '../state/auth';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      // AuthProvider state flips to authenticated → App renders the dashboard.
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#eef2ff 0%,#f8fafc 60%)', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, boxShadow: '0 10px 40px rgba(30,64,175,0.10)', overflow: 'hidden' }}>
        <div style={{ background: '#1e40af', padding: '22px 28px' }}>
          <div style={{ color: '#fff', fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em' }}>Diyar <span style={{ fontWeight: 500 }}>HR Automation</span></div>
          <div style={{ color: '#bfdbfe', fontSize: 12.5, marginTop: 3 }}>Sign in to continue</div>
        </div>
        <form onSubmit={submit} style={{ padding: '24px 28px 28px' }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', display: 'block', marginBottom: 6 }}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus required
            placeholder="you@diyarme.com"
            style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--gray-300)', borderRadius: 8, outline: 'none', marginBottom: 16 }} />

          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', display: 'block', marginBottom: 6 }}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            placeholder="••••••••"
            style={{ width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid var(--gray-300)', borderRadius: 8, outline: 'none', marginBottom: error ? 10 : 20 }} />

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={busy}
            style={{ width: '100%', padding: '11px', fontSize: 14.5, fontWeight: 700, color: '#fff', background: busy ? '#93c5fd' : '#2563eb', border: 'none', borderRadius: 8, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
