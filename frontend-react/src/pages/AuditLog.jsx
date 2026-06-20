import { useEffect, useState } from 'react';
import { useUI } from '../state/uiState';
import { listAudit } from '../services/auth';
import Loading from '../components/common/Loading';

// Admin-only activity feed: who did what, when. Events are written at the
// apiPost chokepoint (services/api.js) and by auth/admin actions.
export default function AuditLog() {
  const { showToast } = useUI();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try { setEvents(await listAudit(300)); }
    catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  const q = filter.trim().toLowerCase();
  const filtered = q ? events.filter(e => (e.action || '').toLowerCase().includes(q) || (e.user_email || '').toLowerCase().includes(q)) : events;

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)' }}>Audit Log</h2>
          <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>Who did what, and when — most recent first.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="Filter by action or user…" value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '8px 11px', fontSize: 13.5, border: '1px solid var(--gray-300)', borderRadius: 8, outline: 'none', background: 'var(--surface)', color: 'var(--gray-800)', minWidth: 220 }} />
          <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
        </div>
      </div>
      {loading ? <Loading /> : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)', textAlign: 'left' }}>
                {['When', 'User', 'Action', 'Entity', 'Detail'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: 'var(--gray-400)' }}>No activity{q ? ' matches your filter' : ' logged yet'}.</td></tr>}
              {filtered.map(ev => (
                <tr key={ev.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--gray-500)' }}>{new Date(ev.created_at).toLocaleString()}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--gray-700)', fontWeight: 600 }}>{ev.user_email || '—'}</td>
                  <td style={td}><span style={actionPill(ev.action)}>{ev.action}</span></td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--gray-500)' }}>{ev.entity_type ? `${ev.entity_type}${ev.entity_id ? ' #' + ev.entity_id : ''}` : '—'}</td>
                  <td style={{ ...td, color: 'var(--gray-500)', fontSize: 12 }}>{ev.detail ? JSON.stringify(ev.detail) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function actionPill(action) {
  const a = action || '';
  let bg = 'var(--gray-100)', color = 'var(--gray-600)';
  if (a.includes('hired')) { bg = '#dcfce7'; color = '#166534'; }
  else if (a.includes('reject')) { bg = '#fee2e2'; color = '#991b1b'; }
  else if (a.startsWith('email')) { bg = '#dbeafe'; color = '#1e40af'; }
  else if (a.startsWith('cv')) { bg = '#ede9fe'; color = '#5b21b6'; }
  else if (a.startsWith('job')) { bg = '#fef9c3'; color = '#854d0e'; }
  else if (a.startsWith('user') || a.startsWith('auth')) { bg = '#e0e7ff'; color = '#3730a3'; }
  return { fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: bg, color, whiteSpace: 'nowrap' };
}

const th = { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const td = { padding: '10px 14px', verticalAlign: 'top' };
