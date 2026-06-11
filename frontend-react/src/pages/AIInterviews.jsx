import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useUI } from '../state/uiState';
import { useSelectedJob } from '../state/selectedJob';

const RECORDING_SERVER = 'http://localhost:8903';

const REQ_META = {
  salary:   { label: 'Salary',        color: '#d97706', bg: '#fffbeb', icon: '💰' },
  iqama:    { label: 'Iqama / Visa',  color: '#7c3aed', bg: '#f5f3ff', icon: '📋' },
  notice:   { label: 'Notice Period', color: '#dc2626', bg: '#fef2f2', icon: '📅' },
  location: { label: 'Location',      color: '#0891b2', bg: '#ecfeff', icon: '📍' },
};

function formatDuration(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function ScoreBar({ score, color }) {
  const n = parseFloat(score);
  const pct = isNaN(n) ? 0 : Math.min(100, Math.max(0, (n / 10) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', minWidth: 24 }}>{isNaN(n) ? '—' : n.toFixed(1)}</span>
    </div>
  );
}
function RecoPill({ text }) {
  if (!text) return null;
  const t = text.toLowerCase();
  const isHire = t.includes('hire') && !t.includes("don't") && !t.includes('not');
  const isDont = t.includes("don't") || t.includes('not recommend');
  const bg    = isHire ? '#dcfce7' : isDont ? '#fee2e2' : '#fef9c3';
  const color = isHire ? '#16a34a' : isDont ? '#dc2626' : '#b45309';
  const label = isHire ? '✓ Hire' : isDont ? "✗ Don't Recommend" : '~ Consider';
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: bg, color }}>{label}</span>;
}

export default function AIInterviews() {
  const { showToast } = useUI();
  const { selectedJob } = useSelectedJob();
  const [jobs, setJobs]                   = useState([]);
  const [jobId, setJobId]                 = useState('');
  const [jobTitle, setJobTitle]           = useState('');
  const [sessions, setSessions]           = useState([]);
  const [loadingJobs, setLoadingJobs]     = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [expandedId, setExpandedId]       = useState(null);
  const [polling, setPolling]             = useState(false);
  const [reEvaluating, setReEvaluating]   = useState({});
  const [mediaPanel, setMediaPanel]       = useState({}); // id → { recording: bool, cv: bool, cvUrl, cvLoading }
  const [search, setSearch]               = useState('');
  const [manualEditing, setManualEditing] = useState({}); // sessionId → { comm, tech, conf, culture, overall, recommendation, summary }
  const pollingRef = useRef(null);

  useEffect(() => { loadJobs(); return () => clearInterval(pollingRef.current); }, []);

  useEffect(() => {
    if (!selectedJob || jobId || jobs.length === 0) return;
    const match = jobs.find(j => String(j.JobId) === String(selectedJob.id));
    if (match) handleJobChange(String(match.JobId));
  }, [selectedJob, jobs]);

  async function loadJobs() {
    setLoadingJobs(true);
    try {
      const res = await apiGet('/job-openings');
      const list = res.data || res || [];
      setJobs(list.map(j => ({ JobId: j.id ?? j.JobId, job_title: j.job_title, department: j.department })));
    } catch { showToast('Failed to load jobs', 'error'); }
    finally { setLoadingJobs(false); }
  }

  async function handleJobChange(val) {
    setJobId(val); setSessions([]); setExpandedId(null); setMediaPanel({}); setSearch('');
    clearInterval(pollingRef.current); setPolling(false);
    const j = jobs.find(j => String(j.JobId) === val);
    setJobTitle(j?.job_title || '');
    if (!val) return;
    setLoadingSessions(true);
    try {
      const res = await apiGet(`/interview/sessions?jobId=${val}`);
      const list = res.data || res || [];
      setSessions(list);
      if (list.some(s => isPending(s))) startPolling(val);
    } catch { showToast('Failed to load interview sessions', 'error'); }
    finally { setLoadingSessions(false); }
  }

  function isPending(s) { return !s.scoreOverall && !s.summary; }

  function startPolling(jId) {
    setPolling(true);
    clearInterval(pollingRef.current);
    let ticks = 0;
    pollingRef.current = setInterval(async () => {
      ticks++;
      if (ticks > 75) { clearInterval(pollingRef.current); setPolling(false); return; } // 10 min max
      try {
        const res = await apiGet(`/interview/sessions?jobId=${jId}`);
        const list = res.data || res || [];
        setSessions(list);
        if (!list.some(s => isPending(s))) { clearInterval(pollingRef.current); setPolling(false); }
      } catch { clearInterval(pollingRef.current); setPolling(false); }
    }, 8000);
  }

  async function reEvaluate(s) {
    setReEvaluating(p => ({ ...p, [s.id]: true }));
    try {
      const qaPairs = parseJSON(s.qaPairs);
      const base = { jobId: s.jobOpeningId, evaluationId: s.evaluationId, candidateId: s.candidateId, candidateName: s.candidateName, transcript: qaPairs, durationSeconds: s.durationSeconds };
      const evalRes = await apiPost('/interview/evaluate', base);
      const scores = evalRes.data || evalRes;
      await apiPost('/interview/save-transcript', { ...base, scores, recordingPath: s.recordingPath || '', requirementsMatch: parseJSON(s.requirementsMatch) });
      showToast('Evaluation complete', 'success');
      const res = await apiGet(`/interview/sessions?jobId=${jobId}`);
      setSessions(res.data || res || []);
    } catch { showToast('Re-evaluation failed — is Ollama running?', 'error'); }
    finally { setReEvaluating(p => ({ ...p, [s.id]: false })); }
  }

  function toggleRecording(id) {
    setMediaPanel(p => ({ ...p, [id]: { ...(p[id] || {}), recording: !(p[id]?.recording) } }));
  }

  async function toggleCV(s) {
    const current = mediaPanel[s.id] || {};
    if (current.cvUrl) {
      setMediaPanel(p => ({ ...p, [s.id]: { ...current, cv: !current.cv } }));
      return;
    }
    if (current.cvLoading) return;
    setMediaPanel(p => ({ ...p, [s.id]: { ...current, cvLoading: true, cv: true } }));
    try {
      const res = await apiGet(`/cv-file?candidate_id=${s.candidateId}`);
      const d = res?.data?.data || res?.data || {};
      if (!d.cv_file_data) throw new Error('no file');
      const b64 = d.cv_file_data.includes(',') ? d.cv_file_data.split(',')[1] : d.cv_file_data;
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: d.cv_file_mime || 'application/pdf' });
      const cvUrl = URL.createObjectURL(blob);
      setMediaPanel(p => ({ ...p, [s.id]: { ...(p[s.id] || {}), cvUrl, cv: true, cvLoading: false } }));
    } catch {
      showToast('CV file not available for this candidate', 'error');
      setMediaPanel(p => ({ ...p, [s.id]: { ...(p[s.id] || {}), cv: false, cvLoading: false } }));
    }
  }

  function parseJSON(val) {
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val || '[]'); } catch { return []; }
  }

  return (
    <div className="container">
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)' }}>AI Interviews</h2>
        <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>
          Review completed self-assessment interviews — watch recordings, view CVs, check requirements, and read AI evaluations.
        </p>
      </div>

      {/* Job selector */}
      <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: 24, maxWidth: 400 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Job Opening</label>
          <select value={jobId} onChange={e => handleJobChange(e.target.value)} disabled={loadingJobs}>
            <option value="">{loadingJobs ? 'Loading…' : 'Select a job opening'}</option>
            {jobs.map(j => <option key={j.JobId} value={j.JobId}>{j.job_title}{j.department ? ` — ${j.department}` : ''}</option>)}
          </select>
        </div>
      </div>

      {!jobId ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gray-400)', fontSize: 14 }}>Select a job to see completed interviews</div>
      ) : loadingSessions ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gray-400)', fontSize: 14 }}>Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gray-400)', fontSize: 14 }}>No completed AI interviews for <strong>{jobTitle}</strong> yet.</div>
      ) : (
        <div>
          {polling && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: '#2563eb' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb', animation: 'pulse 1.5s ease-in-out infinite' }} />
              AI evaluation in progress — refreshing automatically…
            </div>
          )}
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '9px 14px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', fontSize: 13, marginBottom: 16, fontFamily: 'inherit', outline: 'none' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(() => {
              const filtered = sessions.filter(s => {
                if (!search.trim()) return true;
                const q = search.toLowerCase();
                return (s.candidateName || '').toLowerCase().includes(q) || (s.candidateEmail || '').toLowerCase().includes(q);
              });
              return filtered;
            })().map(s => {
              const pending    = isPending(s);
              const isOpen     = !pending && expandedId === s.id;
              const qaPairs    = parseJSON(s.qaPairs);
              const perQ       = parseJSON(s.perQuestion);
              const reqs       = parseJSON(s.requirementsMatch);
              const mp         = mediaPanel[s.id] || {};
              const hasRec     = !!s.recordingPath;
              const recUrl     = hasRec ? `${RECORDING_SERVER}/recording/${s.recordingPath}` : null;

              return (
                <div key={s.id} style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>

                  {/* ── Summary row ── */}
                  <div
                    onClick={() => !pending && setExpandedId(isOpen ? null : s.id)}
                    style={{ display: 'grid', gridTemplateColumns: pending ? '1fr auto' : `1fr ${hasRec ? '28px ' : ''}100px 100px 90px 90px 90px 120px 36px`, alignItems: 'center', gap: 12, padding: '16px 20px', cursor: pending ? 'default' : 'pointer', userSelect: 'none' }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--gray-900)' }}>{s.candidateName || s.candidateEmail}</span>
                        {hasRec && <span title="Recording available" style={{ fontSize: 11, color: '#7c3aed' }}>🎥</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>
                        {s.candidateName && s.candidateEmail ? s.candidateEmail : ''}{s.completedAt ? ` · ${formatDate(s.completedAt)}` : ''}
                      </div>
                    </div>

                    {pending ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {polling && !reEvaluating[s.id] && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1.5s ease-in-out infinite' }} />
                            <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>Evaluating…</span>
                          </div>
                        )}
                        <button onClick={e => { e.stopPropagation(); reEvaluate(s); }} disabled={reEvaluating[s.id]}
                          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid #d97706', background: '#fff', color: '#b45309', cursor: reEvaluating[s.id] ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                          {reEvaluating[s.id] ? 'Evaluating…' : 'Re-evaluate'}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>⏱ {formatDuration(s.durationSeconds)}</div>
                        {[
                          { lbl: 'Communication', score: s.scoreComm,    color: '#2563eb' },
                          { lbl: 'Technical',     score: s.scoreTech,    color: '#16a34a' },
                          { lbl: 'Confidence',    score: s.scoreConf,    color: '#d97706' },
                          { lbl: 'Overall',       score: s.scoreOverall, color: '#111827' },
                        ].map(({ lbl, score, color }) => {
                          const n = parseFloat(score);
                          return (
                            <div key={lbl} style={{ textAlign: 'center', padding: '0 4px' }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{lbl}</div>
                              <div style={{ fontWeight: 800, fontSize: lbl === 'Overall' ? 18 : 16, color }}>{isNaN(n) ? '—' : n.toFixed(1)}</div>
                            </div>
                          );
                        })}
                        <div><RecoPill text={s.recommendation} /></div>
                        <div style={{ color: 'var(--gray-400)', fontSize: 16, textAlign: 'center', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</div>
                      </>
                    )}
                  </div>

                  {/* ── Expanded detail ── */}
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--gray-100)' }}>

                      {/* Media toolbar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--gray-100)', background: '#fafafa' }}>
                        <button onClick={() => toggleRecording(s.id)} disabled={!hasRec}
                          title={hasRec ? '' : 'No recording available for this session'}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 7, border: `1.5px solid ${mp.recording ? '#7c3aed' : 'var(--gray-300)'}`, background: mp.recording ? '#f5f3ff' : '#fff', color: mp.recording ? '#7c3aed' : hasRec ? 'var(--gray-700)' : 'var(--gray-300)', cursor: hasRec ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                          🎥 {mp.recording ? 'Hide Recording' : 'Watch Recording'}
                        </button>
                        {hasRec && (
                          <a
                            href={recUrl}
                            download={s.recordingPath}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 7, border: '1.5px solid var(--gray-300)', background: '#fff', color: 'var(--gray-700)', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' }}
                          >
                            ⬇ Download
                          </a>
                        )}
                        <button onClick={() => s.hasCv && toggleCV(s)}
                          disabled={!s.hasCv}
                          title={s.hasCv ? '' : 'No CV on file for this candidate'}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 7, border: `1.5px solid ${!s.hasCv ? 'var(--gray-200)' : mp.cv ? '#2563eb' : 'var(--gray-300)'}`, background: !s.hasCv ? '#f9fafb' : mp.cv ? '#eff6ff' : '#fff', color: !s.hasCv ? 'var(--gray-300)' : mp.cv ? '#2563eb' : 'var(--gray-700)', cursor: s.hasCv ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                          📄 {mp.cvLoading ? 'Loading CV…' : mp.cv ? 'Hide CV' : 'View CV'}
                        </button>
                        <button
                          onClick={() => { setExpandedId(s.id); setTimeout(() => window.print(), 100); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 7, border: '1.5px solid var(--gray-300)', background: '#fff', color: 'var(--gray-700)', cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto' }}
                        >
                          🖨 Export PDF
                        </button>
                        {!hasRec && (
                          <span style={{ fontSize: 12, color: 'var(--gray-400)', marginLeft: 4 }}>No recording — interview was completed before recording was enabled</span>
                        )}
                      </div>

                      {/* Media panels — side by side when both open */}
                      {(mp.recording || (mp.cv && mp.cvUrl)) && (
                        <div style={{ display: 'grid', gridTemplateColumns: mp.recording && mp.cv && mp.cvUrl ? '1fr 1fr' : '1fr', gap: 0, borderBottom: '1px solid var(--gray-100)' }}>
                          {mp.recording && (
                            <div style={{ background: '#111827', display: 'flex', flexDirection: 'column' }}>
                              <div style={{ padding: '8px 12px', background: '#1f2937', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>🎥 Interview Recording</span>
                              </div>
                              <video
                                src={recUrl}
                                controls
                                style={{ width: '100%', maxHeight: 480, display: 'block', background: '#000' }}
                              />
                            </div>
                          )}
                          {mp.cv && mp.cvUrl && (
                            <div style={{ display: 'flex', flexDirection: 'column', borderLeft: mp.recording ? '1px solid var(--gray-200)' : 'none' }}>
                              <div style={{ padding: '8px 12px', background: '#f9fafb', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>📄 Candidate CV</span>
                              </div>
                              <iframe src={mp.cvUrl} style={{ width: '100%', height: 480, border: 'none', display: 'block' }} title="Candidate CV" />
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ padding: '20px 24px', background: '#fafafa' }}>

                        {/* Score bars */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px 24px', marginBottom: 20, background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '16px 20px' }}>
                          {[
                            { label: 'Communication', score: s.scoreComm,    color: '#2563eb' },
                            { label: 'Technical',     score: s.scoreTech,    color: '#16a34a' },
                            { label: 'Confidence',    score: s.scoreConf,    color: '#d97706' },
                            { label: 'Culture Fit',   score: s.scoreCulture, color: '#7c3aed' },
                          ].map(d => (
                            <div key={d.label}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 6 }}>{d.label}</div>
                              <ScoreBar score={d.score} color={d.color} />
                            </div>
                          ))}
                        </div>

                        {/* Re-evaluate + Manual eval */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                          <button
                            onClick={() => reEvaluate(s)}
                            disabled={reEvaluating[s.id]}
                            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid #d97706', background: '#fff', color: '#b45309', cursor: reEvaluating[s.id] ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                            {reEvaluating[s.id] ? 'Evaluating…' : '↻ Re-evaluate with AI'}
                          </button>
                        </div>

                        {!manualEditing[s.id] ? (
                          <button
                            onClick={() => setManualEditing(p => ({ ...p, [s.id]: {
                              comm: parseFloat(s.scoreComm) || '',
                              tech: parseFloat(s.scoreTech) || '',
                              conf: parseFloat(s.scoreConf) || '',
                              culture: parseFloat(s.scoreCulture) || '',
                              overall: parseFloat(s.scoreOverall) || '',
                              recommendation: s.recommendation || '',
                              summary: s.summary || '',
                            }}))}
                            style={{ fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--gray-300)', background: '#fff', color: 'var(--gray-600)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 16 }}
                          >
                            ✏️ Edit Evaluation Manually
                          </button>
                        ) : (
                          <ManualEvalForm
                            data={manualEditing[s.id]}
                            onChange={(field, val) => setManualEditing(p => ({ ...p, [s.id]: { ...p[s.id], [field]: val } }))}
                            onCancel={() => setManualEditing(p => { const n = { ...p }; delete n[s.id]; return n; })}
                            onSave={async () => {
                              const d = manualEditing[s.id];
                              // Key names must match what the n8n IntTx - Prep node reads
                              // (communication/technical/confidence/cultureFit/overall) —
                              // anything else silently saves as 0.
                              const scores = {
                                communication: parseFloat(d.comm) || 0, technical: parseFloat(d.tech) || 0,
                                confidence: parseFloat(d.conf) || 0, cultureFit: parseFloat(d.culture) || 0,
                                overall: parseFloat(d.overall) || 0,
                                summary: d.summary, recommendation: d.recommendation,
                                perQuestion: parseJSON(s.perQuestion),
                              };
                              await apiPost('/interview/save-transcript', {
                                jobId: s.jobOpeningId, evaluationId: s.evaluationId,
                                candidateId: s.candidateId, candidateName: s.candidateName,
                                transcript: parseJSON(s.qaPairs), durationSeconds: s.durationSeconds,
                                scores, recordingPath: s.recordingPath || '',
                                requirementsMatch: parseJSON(s.requirementsMatch),
                              });
                              showToast('Evaluation updated', 'success');
                              setManualEditing(p => { const n = { ...p }; delete n[s.id]; return n; });
                              const res = await apiGet(`/interview/sessions?jobId=${jobId}`);
                              setSessions(res.data || res || []);
                            }}
                          />
                        )}

                        {/* Requirements check */}
                        {reqs.length > 0 && (
                          <div style={{ marginBottom: 20, background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
                            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-700)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Requirements Check</span>
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: reqs.every(r => r.met) ? '#dcfce7' : '#fee2e2', color: reqs.every(r => r.met) ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                                {reqs.filter(r => r.met).length}/{reqs.length} met
                              </span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                              {reqs.map((r, i) => {
                                const meta = REQ_META[r.category] || { label: r.category, color: '#6b7280', bg: '#f9fafb', icon: '•' };
                                return (
                                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 100px 1fr 1fr auto', alignItems: 'start', gap: 12, padding: '12px 16px', borderBottom: i < reqs.length - 1 ? '1px solid var(--gray-100)' : 'none', background: r.met ? '#f0fdf4' : '#fff5f5' }}>
                                    <div style={{ fontSize: 16, paddingTop: 2 }}>{r.met ? '✅' : '❌'}</div>
                                    <div>
                                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}30` }}>
                                        {meta.icon} {meta.label}
                                      </span>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', marginBottom: 3, textTransform: 'uppercase' }}>Required</div>
                                      <div style={{ fontSize: 13, color: 'var(--gray-700)' }}>{r.requirement}</div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', marginBottom: 3, textTransform: 'uppercase' }}>Candidate stated</div>
                                      <div style={{ fontSize: 13, color: r.met ? '#16a34a' : '#dc2626', fontWeight: 500 }}>{r.extracted || '—'}</div>
                                    </div>
                                    {r.note && <div style={{ fontSize: 12, color: 'var(--gray-400)', fontStyle: 'italic', paddingTop: 2 }}>{r.note}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* AI Summary */}
                        {s.summary && (
                          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 14, color: '#1e40af', lineHeight: 1.7 }}>
                            <strong style={{ display: 'block', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#3b82f6' }}>AI Summary</strong>
                            {s.summary}
                          </div>
                        )}

                        {/* Recommendation */}
                        {s.recommendation && (
                          <div style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 20, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <RecoPill text={s.recommendation} />
                            <span style={{ lineHeight: 1.6, paddingTop: 2 }}>{s.recommendation.replace(/^(Hire|Consider|Don't Recommend)\s*[—-]\s*/i, '')}</span>
                          </div>
                        )}

                        {/* Transcript */}
                        {qaPairs.length > 0 && (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
                              Interview Transcript ({qaPairs.length} questions)
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {qaPairs.map((pair, i) => {
                                const pq = perQ.find(p => p.index === i + 1) || perQ[i] || {};
                                return (
                                  <div key={i} style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
                                    <div style={{ padding: '10px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                      <div style={{ flex: 1 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 8 }}>Q{i + 1}</span>
                                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--gray-900)', lineHeight: 1.6 }}>{pair.question}</span>
                                      </div>
                                      {pq.score != null && (
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', whiteSpace: 'nowrap', paddingTop: 2 }}>{pq.score}/10</span>
                                      )}
                                    </div>
                                    <div style={{ padding: '10px 16px', background: '#fafafa' }}>
                                      <p style={{ fontSize: 13, color: '#374151', margin: 0, lineHeight: 1.65 }}>{pair.answer || <em style={{ color: 'var(--gray-400)' }}>No answer captured</em>}</p>
                                      {pq.feedback && (
                                        <p style={{ fontSize: 12, color: 'var(--gray-400)', margin: '7px 0 0', fontStyle: 'italic', lineHeight: 1.6 }}>
                                          AI: {pq.feedback}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ManualEvalForm({ data, onChange, onCancel, onSave }) {
  const [saving, setSaving] = useState(false);
  const field = (label, key, color) => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <input type="number" min="0" max="10" step="0.1" value={data[key]} onChange={e => onChange(key, e.target.value)}
        style={{ width: '100%', padding: '7px 10px', border: `1.5px solid ${color}40`, borderRadius: 6, fontSize: 14, fontWeight: 700, color, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }} />
    </div>
  );
  return (
    <div style={{ background: '#fff', border: '1.5px solid #2563eb', borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Manual Evaluation</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 14 }}>
        {field('Communication', 'comm', '#2563eb')}
        {field('Technical', 'tech', '#16a34a')}
        {field('Confidence', 'conf', '#d97706')}
        {field('Culture Fit', 'culture', '#7c3aed')}
        {field('Overall', 'overall', '#111827')}
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase' }}>Summary</div>
        <textarea value={data.summary} onChange={e => onChange('summary', e.target.value)} rows={3}
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 4, textTransform: 'uppercase' }}>Recommendation</div>
        <select value={data.recommendation} onChange={e => onChange('recommendation', e.target.value)}
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}>
          <option value="">— Select —</option>
          <option value="Hire — Strong candidate, recommend proceeding.">✓ Hire</option>
          <option value="Consider — Candidate shows potential but has gaps.">~ Consider</option>
          <option value="Don't Recommend — Candidate does not meet requirements.">✗ Don't Recommend</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={async () => { setSaving(true); try { await onSave(); } finally { setSaving(false); } }}
          disabled={saving}
          style={{ padding: '7px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel}
          style={{ padding: '7px 16px', background: '#fff', color: 'var(--gray-600)', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
