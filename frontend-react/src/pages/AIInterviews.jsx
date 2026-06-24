import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../services/api';
import { useUI } from '../state/uiState';
import { useEvalStatus } from '../state/evalStatus';
import { useSelectedJob } from '../state/selectedJob';
import { sendEmailRequest, getEmailStatus } from '../services/email';
import { buildInterviewReportPdf } from '../utils/pdfReport';
import { scoreColor } from '../utils/helpers';

function looksLikeEmail(s) { return typeof s === 'string' && /@/.test(s) && /\./.test(s.split('@').pop() || ''); }

// ── Recording player with question overlay synced to playback time ───────────

function RecordingPlayer({ src, qaPairs }) {
  const [time, setTime] = useState(0);
  const timed = (qaPairs || []).filter(p => p.t != null);
  let active = null, activeIdx = -1;
  for (let i = 0; i < (qaPairs || []).length; i++) {
    const p = qaPairs[i];
    if (p.t != null && p.t <= time) { active = p; activeIdx = i; }
  }
  return (
    <div style={{ position: 'relative' }}>
      <video
        src={src}
        controls
        style={{ width: '100%', maxHeight: 480, display: 'block', background: '#000' }}
        onTimeUpdate={e => setTime(e.target.currentTime)}
      />
      {active && (
        <div style={{
          position: 'absolute', top: 10, left: 12, right: 12, pointerEvents: 'none',
          background: 'rgba(17,24,39,0.82)', borderRadius: 8, padding: '8px 12px',
          color: '#f9fafb', fontSize: 13, lineHeight: 1.5, backdropFilter: 'blur(2px)',
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 8 }}>
            Q{activeIdx + 1}
          </span>
          {active.question}
        </div>
      )}
      {timed.length === 0 && (
        <div style={{ position: 'absolute', bottom: 48, left: 12, pointerEvents: 'none', fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
          (No question timestamps — recorded before sync was added)
        </div>
      )}
    </div>
  );
}

// Relative — proxied by the vite dev server to the recording sidecar (:8903).
const RECORDING_SERVER = '';

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

// `embedded` renders without the page container/heading so the whole view can
// live as the "Results" sub-tab inside the Interview page.
export default function AIInterviews({ embedded = false }) {
  const navigate = useNavigate();
  const { showToast, openEmailComposer } = useUI();
  const { runAiTask } = useEvalStatus();
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
  const [sortBy, setSortBy]               = useState('date'); // date | score | name
  const [manualEditing, setManualEditing] = useState({}); // sessionId → { comm, tech, conf, culture, overall, recommendation, summary }
  const pollingRef = useRef(null);
  const autoEvalRef = useRef(new Set()); // session ids we've already auto-evaluated (no loops)
  const focusedRef = useRef(false);      // deep-link ?focus=<candidateId> applied once

  // Deep-link from the Shortlist "Results" button: ?focus=<candidateId> expands
  // and scrolls to that candidate's interview session.
  useEffect(() => {
    if (focusedRef.current || sessions.length === 0) return;
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (!focus) return;
    const s = sessions.find(x => String(x.candidateId) === String(focus));
    if (s && !isPending(s)) {
      focusedRef.current = true;
      setExpandedId(s.id);
      setTimeout(() => document.getElementById(`session-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    }
  }, [sessions]);

  // Auto-evaluate: whenever a pending session with a transcript appears (the
  // candidate's background eval may have failed or never run), kick off the
  // evaluation HR-side automatically — no manual "Re-evaluate" click needed.
  useEffect(() => {
    for (const s of sessions) {
      if (!isPending(s)) continue;
      if (autoEvalRef.current.has(s.id) || reEvaluating[s.id]) continue;
      const qa = parseJSON(s.qaPairs);
      if (!Array.isArray(qa) || qa.length === 0) continue; // nothing to score
      autoEvalRef.current.add(s.id);
      reEvaluate(s);
    }
  }, [sessions]);

  useEffect(() => { loadJobs(); return () => clearInterval(pollingRef.current); }, []);

  // Follow the global job picked in the header (applies universally across tabs).
  useEffect(() => {
    if (!selectedJob || jobs.length === 0 || String(selectedJob.id) === String(jobId)) return;
    const match = jobs.find(j => String(j.JobId) === String(selectedJob.id));
    if (match) handleJobChange(String(match.JobId));
  }, [selectedJob, jobs]);

  async function loadJobs() {
    setLoadingJobs(true);
    try {
      const res = await apiGet('/job-openings');
      const list = Array.isArray(res) ? res : (res.data || []);
      setJobs(list.map(j => ({ JobId: j.id ?? j.JobId, job_title: j.job_title, department: j.department, is_active: j.is_active })));
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
      const list = Array.isArray(res) ? res : (res.data || []);
      setSessions(list);
      if (list.some(s => isPending(s))) startPolling(val);
    } catch { showToast('Failed to load interview sessions', 'error'); }
    finally { setLoadingSessions(false); }
  }

  // Pending = not yet evaluated. A real evaluation always writes a summary, so
  // "no summary" is the reliable signal. NOTE: scoreOverall comes back as a
  // STRING from Postgres ("0.0"), and !"0.0" is false — so we must parse it,
  // otherwise a failed/zero eval looks "done" and auto-eval skips it.
  function isPending(s) { return !s.summary && (parseFloat(s.scoreOverall) || 0) === 0; }

  function startPolling(jId) {
    setPolling(true);
    clearInterval(pollingRef.current);
    let ticks = 0;
    pollingRef.current = setInterval(async () => {
      ticks++;
      if (ticks > 75) { clearInterval(pollingRef.current); setPolling(false); return; } // 10 min max
      try {
        const res = await apiGet(`/interview/sessions?jobId=${jId}`);
        const list = Array.isArray(res) ? res : (res.data || []);
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
      const evalRes = await runAiTask('Re-scoring interview…', () => apiPost('/interview/evaluate', base),
        { to: '/live-interview?tab=results', hint: s.candidateName ? `Back to ${s.candidateName}'s results` : 'Back to Interview Results' });
      const scores = evalRes.data || evalRes;
      await apiPost('/interview/save-transcript', { ...base, scores, recordingPath: s.recordingPath || '', requirementsMatch: parseJSON(s.requirementsMatch) });
      showToast('Evaluation complete', 'success');
      const res = await apiGet(`/interview/sessions?jobId=${jobId}`);
      setSessions(Array.isArray(res) ? res : (res.data || []));
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

  // ── Email interview results to the hiring manager (with selectable attachments) ──
  function emailHM(s) {
    const qaPairs = parseJSON(s.qaPairs);
    const perQ = parseJSON(s.perQuestion);
    const reqs = parseJSON(s.requirementsMatch);
    const fmt = v => { const n = parseFloat(v); return isNaN(n) ? '—' : n.toFixed(1); };
    const defaultBody =
`Hi,

Sharing the AI interview results for ${s.candidateName || s.candidateEmail || 'the candidate'} — ${jobTitle}.

Scores
• Communication: ${fmt(s.scoreComm)} / 10
• Technical: ${fmt(s.scoreTech)} / 10
• Confidence: ${fmt(s.scoreConf)} / 10
• Culture fit: ${fmt(s.scoreCulture)} / 10
• Overall: ${fmt(s.scoreOverall)} / 10

${s.summary ? 'AI summary\n' + s.summary + '\n\n' : ''}${s.recommendation ? 'Recommendation\n' + s.recommendation + '\n\n' : ''}The selected documents are attached. Let me know if you need anything else.

Best regards,
HR Department`;

    openEmailComposer({
      title: 'Email Interview Results to Hiring Manager',
      description: `Send ${s.candidateName || 'the candidate'}'s AI interview results, with optional attachments.`,
      candidate: { id: s.candidateId, name: s.candidateName, email: s.candidateEmail },
      job: { id: s.jobOpeningId, title: jobTitle },
      emailType: 'recommendation',
      recipientLabel: 'Hiring manager',
      recipientEmail: '',
      editableRecipient: true,
      defaultSubject: `AI interview results: ${s.candidateName || s.candidateEmail} — ${jobTitle}`,
      defaultBody,
      sendLabel: 'Send to HM',
      sendClass: 'btn-primary',
      attachmentOptions: [
        { key: 'pdf', label: 'PDF interview report', sublabel: 'Scores, summary, requirements check, full transcript', checked: true },
        { key: 'cv', label: 'Candidate CV', sublabel: s.hasCv ? 'Original uploaded file' : 'No CV file on record for this candidate', checked: !!s.hasCv, disabled: !s.hasCv },
        { key: 'recording', label: 'Interview recording', sublabel: s.recordingPath ? 'Video (.webm) — skipped automatically if over the email size limit' : 'No recording for this session', checked: false, disabled: !s.recordingPath },
      ],
      onSend: async ({ subject, body, recipientEmail, attachments: sel = [], attachmentFiles = [] }) => {
        if (!looksLikeEmail(recipientEmail)) {
          showToast('Enter a valid hiring manager email', 'error');
          throw new Error('invalid recipient');
        }
        const files = [...attachmentFiles];
        if (sel.includes('pdf')) {
          const b64 = buildInterviewReportPdf({ session: s, qaPairs, perQuestion: perQ, requirements: reqs, jobTitle });
          files.push({ filename: `Interview Report - ${s.candidateName || 'candidate'}.pdf`, content_b64: b64, mime: 'application/pdf' });
        }
        if (sel.includes('cv')) {
          try {
            const res = await apiGet(`/cv-file?candidate_id=${s.candidateId}`);
            const d = res?.data?.data || res?.data || {};
            if (d.cv_file_data) {
              const b64 = d.cv_file_data.includes(',') ? d.cv_file_data.split(',')[1] : d.cv_file_data;
              files.push({ filename: d.cv_file_name || 'cv.pdf', content_b64: b64, mime: d.cv_file_mime || 'application/pdf' });
            }
          } catch { /* CV fetch failed — send without it */ }
        }
        const res = await sendEmailRequest({
          candidateId: s.candidateId, jobId: s.jobOpeningId, emailType: 'recommendation',
          recipientEmail, candidateName: s.candidateName || '', jobTitle, subject, body,
          attachments: files,
          recordingFile: sel.includes('recording') ? s.recordingPath : '',
        });
        const status = getEmailStatus(res);
        const skipped = res.data?.attachments_skipped;
        showToast(status.message + (Array.isArray(skipped) && skipped.length ? ` — skipped: ${skipped.join(', ')}` : ''), status.type);
      },
    });
  }

  return (
    <div className={embedded ? undefined : 'container'}>
      {!embedded && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)' }}>AI Interviews</h2>
          <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>
            Review completed self-assessment interviews — watch recordings, view CVs, check requirements, and read AI evaluations.
          </p>
        </div>
      )}

      {/* Job is driven by the global "Current Job" picker in the header — no
          separate selector here (the Results tab mirrors it). */}
      {!embedded && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: 24, display: 'flex', gap: 16, alignItems: 'flex-end', maxWidth: 640 }}>
          <div className="form-group" style={{ marginBottom: 0, flex: 1, maxWidth: 360 }}>
            <label>Job Opening</label>
            <select value={jobId} onChange={e => handleJobChange(e.target.value)} disabled={loadingJobs}>
              <option value="">{loadingJobs ? 'Loading…' : 'Select a job opening'}</option>
              {jobs.filter(j => j.is_active !== false).map(j => <option key={j.JobId} value={j.JobId}>{j.job_title}{j.department ? ` — ${j.department}` : ''}</option>)}
              {jobs.some(j => j.is_active === false) && (
                <optgroup label="Closed (reactivate in Job Openings to use)">
                  {jobs.filter(j => j.is_active === false).map(j => <option key={j.JobId} value={j.JobId} disabled>{j.job_title}{j.department ? ` — ${j.department}` : ''}</option>)}
                </optgroup>
              )}
            </select>
          </div>
        </div>
      )}

      {!jobId ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gray-400)', fontSize: 14 }}>Select a job from the header to see completed interviews</div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 12.5, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>Search by</span>
            <input
              type="text"
              placeholder="Name or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 240, padding: '9px 14px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
            />
            <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>Sort by</span>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{ width: 160, flexShrink: 0, padding: '9px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--surface)', cursor: 'pointer' }}
            >
              <option value="date">Most recent</option>
              <option value="score">Highest score</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(() => {
              const filtered = sessions.filter(s => {
                if (!search.trim()) return true;
                const q = search.toLowerCase();
                return (s.candidateName || '').toLowerCase().includes(q) || (s.candidateEmail || '').toLowerCase().includes(q);
              });
              const sorted = [...filtered].sort((a, b) => {
                if (sortBy === 'score') return (parseFloat(b.scoreOverall) || 0) - (parseFloat(a.scoreOverall) || 0);
                if (sortBy === 'name') return (a.candidateName || '').localeCompare(b.candidateName || '');
                return new Date(b.completedAt || 0) - new Date(a.completedAt || 0); // date (most recent)
              });
              return sorted;
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
                <div key={s.id} id={`session-${s.id}`} style={{
                  background: 'var(--surface)', border: `1px solid ${isOpen ? '#bfdbfe' : 'var(--gray-200)'}`,
                  borderRadius: 12, overflow: 'hidden',
                  boxShadow: isOpen ? '0 4px 16px rgba(37,99,235,0.08)' : '0 1px 2px rgba(0,0,0,0.04)',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}>
                  {/* Header row (Decision-style) */}
                  <div onClick={() => !pending && setExpandedId(isOpen ? null : s.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: pending ? 'default' : 'pointer', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 15, color: 'var(--gray-900)' }}>{s.candidateName || s.candidateEmail}</strong>
                        {hasRec && <span title="Recording available" style={{ fontSize: 12, color: '#7c3aed' }}>🎥</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
                        {s.candidateName && s.candidateEmail ? `${s.candidateEmail} · ` : ''}{s.completedAt ? formatDate(s.completedAt) : ''}{!pending ? ` · ⏱ ${formatDuration(s.durationSeconds)}` : ''}
                      </div>
                    </div>

                    {pending ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200, justifyContent: 'flex-end' }}>
                        {reEvaluating[s.id] || polling ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 160 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1.5s ease-in-out infinite' }} />
                              <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>AI evaluating…</span>
                            </div>
                            <div style={{ height: 5, width: '100%', background: '#fef3c7', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: '40%', background: '#f59e0b', borderRadius: 3, animation: 'indeterminate 1.2s ease-in-out infinite' }} />
                            </div>
                          </div>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); reEvaluate(s); }}
                            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid #d97706', background: 'var(--surface)', color: '#b45309', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                            ↻ Retry evaluation
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={ev => { ev.stopPropagation(); navigate(`/decision?job=${s.jobOpeningId}&focus=${s.candidateId}`); }}
                          className="btn btn-sm btn-primary"
                          title="Open this candidate in the Decision tab to hire / reject / send to HM"
                          style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                        >⚖ Decide</button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
                          {[
                            { lbl: 'Communication', score: s.scoreComm },
                            { lbl: 'Technical', score: s.scoreTech },
                            { lbl: 'Confidence', score: s.scoreConf },
                          ].map(({ lbl, score }) => {
                            const n = parseFloat(score);
                            return (
                              <div key={lbl} style={{ textAlign: 'center', minWidth: 64 }}>
                                <div style={{ fontWeight: 800, fontSize: 16, color: scoreColor(score) }}>{isNaN(n) ? '—' : n.toFixed(1)}</div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3, whiteSpace: 'nowrap' }}>{lbl}</div>
                              </div>
                            );
                          })}
                          <div style={{ textAlign: 'center', minWidth: 52, borderLeft: '1px solid var(--gray-200)', paddingLeft: 16 }}>
                            {(() => { const n = parseFloat(s.scoreOverall); return <div style={{ fontSize: 23, fontWeight: 800, color: scoreColor(s.scoreOverall), lineHeight: 1 }}>{isNaN(n) ? '—' : n.toFixed(1)}</div>; })()}
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>Overall</div>
                          </div>
                        </div>
                        <span style={{ color: 'var(--gray-400)', fontSize: 13, flexShrink: 0, transition: 'transform 0.25s ease', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                      </>
                    )}
                  </div>

                  {/* ── Expanded detail (smooth grid-rows expand) ── */}
                  <div style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.28s ease' }}>
                    <div style={{ overflow: 'hidden' }}>
                    <div style={{ borderTop: '1px solid var(--gray-100)' }}>

                      {/* Media + share toolbar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--gray-100)', background: 'var(--surface-2)', flexWrap: 'wrap' }}>
                        {/* Left — media. Only render what's actually attached (no dead buttons). */}
                        {hasRec && (
                          <>
                            <button onClick={() => toggleRecording(s.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 7, border: `1.5px solid ${mp.recording ? '#7c3aed' : 'var(--gray-300)'}`, background: mp.recording ? 'rgba(124,58,237,0.16)' : 'var(--surface)', color: mp.recording ? '#a684f5' : 'var(--gray-700)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                              🎥 {mp.recording ? 'Hide Recording' : 'Watch Recording'}
                            </button>
                            <a href={recUrl} download={s.recordingPath}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 7, border: '1.5px solid var(--gray-300)', background: 'var(--surface)', color: 'var(--gray-700)', textDecoration: 'none', fontFamily: 'inherit' }}>
                              ⬇ Download
                            </a>
                          </>
                        )}
                        {s.hasCv && (
                          <button onClick={() => toggleCV(s)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 7, border: `1.5px solid ${mp.cv ? '#2563eb' : 'var(--gray-300)'}`, background: mp.cv ? 'var(--tint-info)' : 'var(--surface)', color: mp.cv ? 'var(--primary)' : 'var(--gray-700)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                            📄 {mp.cvLoading ? 'Loading CV…' : mp.cv ? 'Hide CV' : 'View CV'}
                          </button>
                        )}
                        {!hasRec && !s.hasCv && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--gray-400)', background: 'var(--surface)', border: '1px dashed var(--gray-200)', borderRadius: 7, padding: '6px 12px' }}>
                            <span style={{ fontSize: 14, opacity: 0.7 }}>🎬</span> No recording or CV attached
                          </span>
                        )}

                        {/* Right — Export PDF for HR's own record. The HM hand-off (with all
                            attachments) lives in the Decision tab, not here — Results is HR-level review. */}
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button onClick={() => { setExpandedId(s.id); setTimeout(() => window.print(), 100); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 7, border: '1.5px solid var(--gray-300)', background: 'var(--surface)', color: 'var(--gray-700)', cursor: 'pointer', fontFamily: 'inherit' }}>
                            🖨 Export PDF
                          </button>
                        </div>
                      </div>

                      {/* Media panels — side by side when both open */}
                      {(mp.recording || (mp.cv && mp.cvUrl)) && (
                        <div style={{ display: 'grid', gridTemplateColumns: mp.recording && mp.cv && mp.cvUrl ? '1fr 1fr' : '1fr', gap: 0, borderBottom: '1px solid var(--gray-100)' }}>
                          {mp.recording && (
                            <div style={{ background: '#111827', display: 'flex', flexDirection: 'column' }}>
                              <div style={{ padding: '8px 12px', background: '#1f2937', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>🎥 Interview Recording</span>
                              </div>
                              <RecordingPlayer src={recUrl} qaPairs={qaPairs} />
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

                      <div style={{ padding: '20px 24px', background: 'var(--surface-2)' }}>

                        {/* Requirements check */}
                        {reqs.length > 0 && (
                          <div style={{ marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
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
                          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 16px', marginBottom: 12, fontSize: 14, color: '#1e40af', lineHeight: 1.7 }}>
                            <strong style={{ display: 'block', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#3b82f6' }}>AI Summary</strong>
                            {s.summary}
                          </div>
                        )}

                        {/* Evaluation actions — re-evaluate + manual edit, side by side under the summary */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => reEvaluate(s)}
                            disabled={reEvaluating[s.id]}
                            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid #d97706', background: 'var(--surface)', color: '#b45309', cursor: reEvaluating[s.id] ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                            {reEvaluating[s.id] ? 'Evaluating…' : '↻ Re-evaluate with AI'}
                          </button>
                          {!manualEditing[s.id] && (
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
                              style={{ fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6, border: '1px solid var(--gray-300)', background: 'var(--surface)', color: 'var(--gray-600)', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              ✏️ Edit Evaluation Manually
                            </button>
                          )}
                        </div>
                        {manualEditing[s.id] && (
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
                              setSessions(Array.isArray(res) ? res : (res.data || []));
                            }}
                          />
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
                                  <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
                                    <div style={{ padding: '10px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                      <div style={{ flex: 1 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 8 }}>Q{i + 1}</span>
                                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--gray-900)', lineHeight: 1.6 }}>{pair.question}</span>
                                      </div>
                                      {pq.score != null && (
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', whiteSpace: 'nowrap', paddingTop: 2 }}>{pq.score}/10</span>
                                      )}
                                    </div>
                                    <div style={{ padding: '10px 16px', background: 'var(--surface-2)' }}>
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
                    </div>
                  </div>
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
    <div style={{ background: 'var(--surface)', border: '1.5px solid #2563eb', borderRadius: 8, padding: '16px 20px', marginBottom: 16 }}>
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
          <option value="Hire — Strong candidate, recommend proceeding.">Recommended</option>
          <option value="Consider — Candidate shows potential but has gaps.">Consider</option>
          <option value="Don't Recommend — Candidate does not meet requirements.">Not Recommended</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={async () => { setSaving(true); try { await onSave(); } finally { setSaving(false); } }}
          disabled={saving}
          style={{ padding: '7px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel}
          style={{ padding: '7px 16px', background: 'var(--surface)', color: 'var(--gray-600)', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
