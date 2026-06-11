import { useState, useEffect, useMemo } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useUI } from '../state/uiState';
import StatCard from '../components/common/StatCard';
import Loading from '../components/common/Loading';
import EmptyState from '../components/common/EmptyState';
import { formatDate } from '../utils/helpers';

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Highlight every search term inside a string (case-insensitive).
function Highlighted({ text, terms }) {
  if (!terms.length || !text) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
  const parts = String(text).split(re);
  return (
    <>
      {parts.map((p, i) =>
        terms.some(t => p.toLowerCase() === t.toLowerCase())
          ? <mark key={i} style={{ background: '#fde047', color: '#713f12', borderRadius: 3, padding: '0 2px', fontWeight: 600 }}>{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

// Pull up to `max` snippets of ±70 chars around term hits in the CV text.
function extractSnippets(cvText, terms, max = 2) {
  if (!cvText || !terms.length) return [];
  const lower = cvText.toLowerCase();
  const snippets = [];
  const used = [];
  for (const term of terms) {
    let idx = lower.indexOf(term.toLowerCase());
    while (idx !== -1 && snippets.length < max) {
      if (!used.some(([s, e]) => idx >= s && idx <= e)) {
        const start = Math.max(0, idx - 70);
        const end = Math.min(cvText.length, idx + term.length + 70);
        used.push([start, end]);
        snippets.push((start > 0 ? '…' : '') + cvText.slice(start, end).replace(/\s+/g, ' ').trim() + (end < cvText.length ? '…' : ''));
      }
      idx = lower.indexOf(term.toLowerCase(), idx + 1);
      if (snippets.length >= max) break;
    }
    if (snippets.length >= max) break;
  }
  return snippets;
}

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#db2777'];
function avatarColor(name) {
  let h = 0;
  for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

export default function TalentPool() {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [shortlisting, setShortlisting] = useState(null);
  // candidate id → { open, loading, url (blob, PDF available), isText (fallback) }
  const [cvPanel, setCvPanel] = useState({});

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet('/talent-pool');
      setRows((res.data || []).filter(r => r.id));
    } catch { showToast('Failed to load talent pool', 'error'); }
    finally { setLoading(false); }
  }

  // Ctrl+F semantics: space-separated terms, ALL must appear somewhere in the
  // candidate's CV text, name, email, or job title.
  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const matches = useMemo(() => {
    if (!terms.length) return rows;
    return rows.filter(r => {
      const hay = `${r.candidate_name || ''}\n${r.email || ''}\n${r.job_title || ''}\n${r.cv_text || ''}`.toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }, [rows, terms]);

  // Toggle the inline CV dropdown — embeds the actual PDF (like the AI
  // Interviews CV panel); falls back to the extracted text when no file is stored.
  async function toggleCV(r) {
    const cur = cvPanel[r.id] || {};
    if (cur.open) { setCvPanel(p => ({ ...p, [r.id]: { ...cur, open: false } })); return; }
    if (cur.url || cur.isText) { setCvPanel(p => ({ ...p, [r.id]: { ...cur, open: true } })); return; }
    if (!r.cv_file_available) {
      setCvPanel(p => ({ ...p, [r.id]: { open: true, isText: true } }));
      return;
    }
    setCvPanel(p => ({ ...p, [r.id]: { open: true, loading: true } }));
    try {
      const res = await apiGet(`/cv-file?candidate_id=${r.id}`);
      const d = res?.data?.data || res?.data || {};
      if (!d.cv_file_data) throw new Error('no file');
      const b64 = d.cv_file_data.includes(',') ? d.cv_file_data.split(',')[1] : d.cv_file_data;
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: d.cv_file_mime || 'application/pdf' }));
      setCvPanel(p => ({ ...p, [r.id]: { open: true, url, loading: false } }));
    } catch {
      // PDF fetch failed — fall back to text view
      setCvPanel(p => ({ ...p, [r.id]: { open: true, isText: true, loading: false } }));
    }
  }

  async function shortlist(r) {
    setShortlisting(r.id);
    try {
      const res = await apiPost('/add-to-shortlist', { candidate_id: r.id, job_opening_id: r.job_opening_id, notes: 'Shortlisted from Talent Pool search' });
      if (res.data.success) {
        setRows(prev => prev.map(x => x.id === r.id ? { ...x, shortlist_status: 'shortlisted' } : x));
        showToast(`${r.candidate_name} shortlisted for ${r.job_title}`, 'success');
      } else showToast(res.data.error || 'Failed to shortlist', 'error');
    } catch { showToast('Failed to shortlist', 'error'); }
    finally { setShortlisting(null); }
  }

  const withFile = rows.filter(r => r.cv_file_available).length;

  return (
    <div className="container">
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)' }}>Talent Pool</h2>
        <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>
          Search every CV ever uploaded — find the skill, open the CV, shortlist.
        </p>
      </div>

      {/* Search hero */}
      <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 12, padding: '20px 24px', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'var(--gray-400)', pointerEvents: 'none' }}>🔍</span>
          <input
            type="text"
            autoFocus
            placeholder='Search a skill or keyword — e.g. power bi, excel, kubernetes…'
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ width: '100%', padding: '13px 16px 13px 42px', fontSize: 15, border: '1.5px solid var(--gray-300)', borderRadius: 10, outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s' }}
            onFocus={e => { e.target.style.borderColor = '#2563eb'; }}
            onBlur={e => { e.target.style.borderColor = 'var(--gray-300)'; }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12.5, color: 'var(--gray-500)' }}>
            {terms.length === 0
              ? <>Searches across <strong>{rows.length}</strong> candidates · {withFile} with original PDF on file</>
              : <>
                  <strong style={{ color: '#1e40af' }}>{matches.length}</strong> of {rows.length} candidates match{' '}
                  {terms.map(t => (
                    <span key={t} style={{ display: 'inline-block', margin: '0 3px', padding: '2px 9px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{t}</span>
                  ))}
                </>}
          </div>
          {query && <button className="btn btn-sm btn-secondary" onClick={() => setQuery('')}>Clear</button>}
        </div>
      </div>

      {loading ? <Loading /> : rows.length === 0 ? (
        <EmptyState>No candidates uploaded yet. Upload CVs in CV Evaluation first.</EmptyState>
      ) : matches.length === 0 ? (
        <EmptyState>No CV mentions {terms.map(t => `"${t}"`).join(' and ')}. Try fewer or broader terms.</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {matches.map(r => {
            const snippets = extractSnippets(r.cv_text, terms);
            const panel = cvPanel[r.id] || {};
            const status = r.shortlist_status;
            const score = r.overall_score != null ? parseFloat(r.overall_score) : null;
            const scoreColor = score == null ? 'var(--gray-300)' : score >= 7 ? '#16a34a' : score >= 4 ? '#d97706' : '#dc2626';
            const initials = (r.candidate_name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
            return (
              <div key={r.id} style={{ background: '#fff', border: `1px solid ${panel.open ? '#bfdbfe' : 'var(--gray-200)'}`, borderRadius: 12, overflow: 'hidden', boxShadow: panel.open ? '0 2px 10px rgba(37,99,235,0.07)' : '0 1px 2px rgba(0,0,0,0.03)', transition: 'border-color 0.15s, box-shadow 0.15s' }}>
                {/* Row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', flexWrap: 'wrap' }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: avatarColor(r.candidate_name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, color: 'var(--gray-900)' }}>
                        <Highlighted text={r.candidate_name} terms={terms} />
                      </strong>
                      {r.cv_file_available && (
                        <span title="Original PDF on file" style={{ fontSize: 12, color: 'var(--gray-400)' }}>📄</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--gray-500)', marginTop: 3 }}>
                      <Highlighted text={r.email || '—'} terms={terms} />
                      <span style={{ margin: '0 6px', color: 'var(--gray-300)' }}>·</span>
                      <Highlighted text={r.job_title} terms={terms} />{r.department ? ` (${r.department})` : ''}
                      <span style={{ margin: '0 6px', color: 'var(--gray-300)' }}>·</span>
                      {formatDate(r.submitted_at)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 52 }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{score != null ? score.toFixed(1) : '—'}</div>
                    <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>Score</div>
                  </div>
                  {/* Fixed two-slot action grid so View CV lines up vertically on
                      every row, whether the second slot holds the Shortlist
                      button or the candidate's status pill. */}
                  <div style={{ display: 'grid', gridTemplateColumns: '116px 116px', gap: 8, alignItems: 'center' }}>
                    <button
                      onClick={() => toggleCV(r)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 600,
                        height: 36, borderRadius: 8, width: '100%',
                        border: `1.5px solid ${panel.open ? '#2563eb' : 'var(--gray-300)'}`,
                        background: panel.open ? '#eff6ff' : '#fff',
                        color: panel.open ? '#2563eb' : 'var(--gray-700)',
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap',
                      }}
                    >
                      📄 {panel.loading ? 'Loading…' : panel.open ? 'Hide CV' : 'View CV'}
                    </button>
                    {!status ? (
                      <button
                        disabled={shortlisting === r.id}
                        onClick={() => shortlist(r)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 600,
                          height: 36, borderRadius: 8, width: '100%',
                          border: '1.5px solid #86efac', background: '#f0fdf4', color: '#16a34a',
                          cursor: shortlisting === r.id ? 'wait' : 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap',
                        }}
                      >
                        {shortlisting === r.id ? '…' : '✓ Shortlist'}
                      </button>
                    ) : (
                      <span style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        height: 36, borderRadius: 8, width: '100%',
                        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                        background: status === 'rejected' ? '#fee2e2' : status === 'hired' ? '#dcfce7' : '#dbeafe',
                        color: status === 'rejected' ? '#991b1b' : status === 'hired' ? '#166534' : '#1e40af',
                        border: `1.5px solid ${status === 'rejected' ? '#fecaca' : status === 'hired' ? '#bbf7d0' : '#bfdbfe'}`,
                      }}>
                        {status === 'rejected' ? '✗' : '✓'} {status}
                      </span>
                    )}
                  </div>
                </div>

                {/* Match snippets */}
                {snippets.length > 0 && (
                  <div style={{ padding: '0 20px 14px 76px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {snippets.map((s, i) => (
                      <div key={i} style={{ fontSize: 12.5, color: 'var(--gray-600)', background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '3px solid #f59e0b', borderRadius: 6, padding: '7px 11px', lineHeight: 1.6 }}>
                        <Highlighted text={s} terms={terms} />
                      </div>
                    ))}
                  </div>
                )}

                {/* CV dropdown — embedded PDF (or text fallback), AI Interviews style */}
                {panel.open && (
                  <div style={{ borderTop: '1px solid var(--gray-100)' }}>
                    <div style={{ padding: '8px 14px', background: '#f9fafb', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        📄 {r.candidate_name} — CV{panel.isText ? ' (extracted text — no PDF on file)' : ''}
                      </span>
                      {panel.url && (
                        <a href={panel.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>
                          Open in new tab ↗
                        </a>
                      )}
                    </div>
                    {panel.loading ? (
                      <div style={{ padding: 40, textAlign: 'center', color: 'var(--gray-400)', fontSize: 13 }}>Loading PDF…</div>
                    ) : panel.url ? (
                      <iframe src={panel.url} style={{ width: '100%', height: 520, border: 'none', display: 'block' }} title={`CV — ${r.candidate_name}`} />
                    ) : (
                      <div style={{ padding: '16px 20px', background: '#fff', maxHeight: 420, overflowY: 'auto', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--gray-700)' }}>
                        <Highlighted text={r.cv_text} terms={terms} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
