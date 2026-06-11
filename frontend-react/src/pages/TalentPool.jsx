import { useState, useEffect, useMemo } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useUI } from '../state/uiState';
import StatCard from '../components/common/StatCard';
import Loading from '../components/common/Loading';
import EmptyState from '../components/common/EmptyState';
import ScoreBadge from '../components/common/ScoreBadge';
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
          ? <mark key={i} style={{ background: '#fef08a', color: '#713f12', borderRadius: 2, padding: '0 1px' }}>{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  );
}

// Pull up to `max` snippets of ±60 chars around term hits in the CV text.
function extractSnippets(cvText, terms, max = 2) {
  if (!cvText || !terms.length) return [];
  const lower = cvText.toLowerCase();
  const snippets = [];
  const used = [];
  for (const term of terms) {
    let idx = lower.indexOf(term.toLowerCase());
    while (idx !== -1 && snippets.length < max) {
      if (!used.some(([s, e]) => idx >= s && idx <= e)) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(cvText.length, idx + term.length + 60);
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

export default function TalentPool() {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null); // candidate id with CV text open
  const [shortlisting, setShortlisting] = useState(null);

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

  async function viewCV(r) {
    const win = window.open('about:blank', '_blank');
    try {
      const res = await apiGet(`/cv-file?candidate_id=${r.id}`);
      const d = res?.data?.data || res?.data || {};
      if (!d.cv_file_data) { if (win) win.close(); showToast('Original CV file not stored for this candidate', 'error'); return; }
      const b64 = d.cv_file_data.includes(',') ? d.cv_file_data.split(',')[1] : d.cv_file_data;
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: d.cv_file_mime || 'application/pdf' });
      if (win) win.location.href = URL.createObjectURL(blob);
    } catch { if (win) win.close(); showToast('Failed to load CV', 'error'); }
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
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)' }}>Talent Pool</h2>
        <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>
          Search across every CV ever uploaded — like Ctrl+F over your whole candidate base.
        </p>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <StatCard label="Candidates" value={rows.length || '-'} />
        <StatCard label="With CV file" value={withFile || '-'} />
        <StatCard label={terms.length ? 'Matches' : 'Jobs covered'} value={terms.length ? matches.length : new Set(rows.map(r => r.job_opening_id)).size || '-'} />
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '16px 20px', marginBottom: 16 }}>
        <input
          type="text"
          autoFocus
          placeholder='Search skills, tools, keywords… e.g. "power bi", excel, kubernetes'
          value={query}
          onChange={e => { setQuery(e.target.value); setExpanded(null); }}
          style={{ width: '100%', padding: '12px 16px', fontSize: 15, border: '1.5px solid var(--gray-300)', borderRadius: 8, outline: 'none', fontFamily: 'inherit' }}
        />
        {terms.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gray-500)' }}>
            Matching all of: {terms.map(t => (
              <span key={t} style={{ display: 'inline-block', margin: '0 4px 0 0', padding: '2px 8px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{t}</span>
            ))} · <strong>{matches.length}</strong> of {rows.length} candidates
          </div>
        )}
      </div>

      {loading ? <Loading /> : rows.length === 0 ? (
        <EmptyState>No candidates uploaded yet. Upload CVs in CV Evaluation first.</EmptyState>
      ) : matches.length === 0 ? (
        <EmptyState>No CV mentions {terms.map(t => `"${t}"`).join(' and ')}. Try fewer or broader terms.</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {matches.map(r => {
            const snippets = extractSnippets(r.cv_text, terms);
            const isOpen = expanded === r.id;
            const status = r.shortlist_status;
            return (
              <div key={r.id} style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, color: 'var(--gray-900)' }}>
                        <Highlighted text={r.candidate_name} terms={terms} />
                      </strong>
                      {status && (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: status === 'rejected' ? '#fee2e2' : '#dcfce7', color: status === 'rejected' ? '#991b1b' : '#166534' }}>
                          {status}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>
                      <Highlighted text={r.email || '—'} terms={terms} /> · applied for <strong><Highlighted text={r.job_title} terms={terms} /></strong>{r.department ? ` (${r.department})` : ''} · {formatDate(r.submitted_at)}
                    </div>
                  </div>
                  <ScoreBadge score={r.overall_score} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => setExpanded(isOpen ? null : r.id)}>
                      {isOpen ? 'Hide CV text' : 'Read CV'}
                    </button>
                    {r.cv_file_available && (
                      <button className="btn btn-sm btn-secondary" onClick={() => viewCV(r)}>View PDF</button>
                    )}
                    {!status && (
                      <button className="btn btn-sm btn-success" disabled={shortlisting === r.id} onClick={() => shortlist(r)}>
                        {shortlisting === r.id ? '…' : 'Shortlist'}
                      </button>
                    )}
                  </div>
                </div>

                {snippets.length > 0 && !isOpen && (
                  <div style={{ padding: '0 18px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {snippets.map((s, i) => (
                      <div key={i} style={{ fontSize: 12.5, color: 'var(--gray-600)', background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: 6, padding: '6px 10px', lineHeight: 1.6 }}>
                        <Highlighted text={s} terms={terms} />
                      </div>
                    ))}
                  </div>
                )}

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--gray-100)', padding: '14px 18px', background: 'var(--gray-50)', maxHeight: 360, overflowY: 'auto', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--gray-700)' }}>
                    <Highlighted text={r.cv_text} terms={terms} />
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
