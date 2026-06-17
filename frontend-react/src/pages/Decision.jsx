import { useState, useEffect, useMemo, useRef } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import StatCard from '../components/common/StatCard';
import Loading from '../components/common/Loading';
import EmptyState from '../components/common/EmptyState';
import Modal from '../components/modals/Modal';
import { sendEmailRequest, getOfferTemplate, getRejectionTemplate, getEmailStatus } from '../services/email';
import { buildInterviewReportPdf } from '../utils/pdfReport';

const RECORDING_SERVER = ''; // relative — vite proxies /recording to the sidecar

function scoreColor(n) {
  if (n == null || isNaN(n)) return 'var(--gray-300)';
  return n >= 7 ? '#16a34a' : n >= 4 ? '#d97706' : '#dc2626';
}
function ScoreCell({ value, label }) {
  const n = value != null ? parseFloat(value) : null;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: scoreColor(n), lineHeight: 1 }}>{n != null && !isNaN(n) ? n.toFixed(1) : '—'}</div>
      {label && <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>{label}</div>}
    </div>
  );
}
// Per-dimension score as a bordered chip (used in the expanded eval panels).
function StatChip({ value, label }) {
  const n = value != null ? parseFloat(value) : null;
  return (
    <div style={{ flex: 1, minWidth: 56, background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '8px 6px', textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: scoreColor(n), lineHeight: 1 }}>{n != null && !isNaN(n) ? n.toFixed(1) : '—'}</div>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 }}>{label}</div>
    </div>
  );
}
// Tinted callout for strengths / weaknesses / summary text.
function Callout({ label, text, tone = 'neutral' }) {
  const tones = {
    pos:     { border: '#86efac', bg: '#f0fdf4', label: '#166534' },
    neg:     { border: '#fca5a5', bg: '#fef2f2', label: '#991b1b' },
    neutral: { border: '#cbd5e1', bg: '#f8fafc', label: 'var(--gray-500)' },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <div style={{ borderLeft: `3px solid ${t.border}`, background: t.bg, borderRadius: '0 6px 6px 0', padding: '8px 12px', margin: '10px 0 0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: t.label, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--gray-700)', lineHeight: 1.55 }}>{text}</div>
    </div>
  );
}

const COL_LABEL = { fontSize: 9.5, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 };

export default function Decision() {
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast, openEmailComposer } = useUI();
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [rows, setRows] = useState([]);        // shortlist rows (carry CV scores)
  const [sessions, setSessions] = useState([]); // interview_sessions
  const [loading, setLoading] = useState(false);
  const [weight, setWeight] = useState(50);       // committed weight — drives ranking + combined score
  const [sliderVal, setSliderVal] = useState(50); // live slider position + % display (decoupled so dragging is smooth)
  const weightCommitRef = useRef(null);
  const [expanded, setExpanded] = useState(null);
  const [sentToHM, setSentToHM] = useState(new Set());   // candidate_ids with a sent recommendation email
  const [compareIds, setCompareIds] = useState(new Set()); // candidate_ids picked for side-by-side
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => { loadJobs(); }, []);
  // Follow the global job picked in the header.
  useEffect(() => { if (selectedJob) setJobId(String(selectedJob.id)); }, [selectedJob]);
  useEffect(() => { if (jobId) loadData(); }, [jobId]);

  async function loadJobs() {
    try { const res = await apiGet('/job-openings'); setJobs(res.data || []); } catch {}
  }

  function handleJobChange(val) {
    setJobId(val); setExpanded(null); setCompareIds(new Set()); setShowCompare(false);
    if (val) { const j = jobs.find(j => j.id === parseInt(val)); if (j) setSelectedJob(j); }
  }

  async function loadData() {
    if (!jobId) { setRows([]); setSessions([]); return; }
    setLoading(true);
    try {
      const [slRes, sessRes, emRes] = await Promise.all([
        apiGet(`/shortlist?job_id=${jobId}`),
        apiGet(`/interview/sessions?jobId=${jobId}`).catch(() => []),
        apiGet(`/email-history?job_id=${jobId}`).catch(() => ({ data: [] })),
      ]);
      setRows(slRes.data || []);
      setSessions(Array.isArray(sessRes) ? sessRes : (sessRes.data || []));
      // "Sent to HM" = a successfully-sent recommendation email exists for the candidate.
      const emails = emRes.data?.data || emRes.data || [];
      const set = new Set();
      for (const e of emails) {
        if (e.candidate_id && e.email_type === 'recommendation' && e.status === 'sent' && e.direction !== 'inbound') set.add(e.candidate_id);
      }
      setSentToHM(set);
    } catch { showToast('Failed to load decision data', 'error'); }
    finally { setLoading(false); }
  }

  const wInt = weight / 100;
  const sessByCand = useMemo(() => {
    const m = {};
    for (const s of sessions) m[s.candidateId] = s;
    return m;
  }, [sessions]);

  // Build + rank: interviewed candidates (have a combined score) first by combined,
  // then CV-only candidates by CV score, then anyone with neither.
  const ranked = useMemo(() => {
    const list = rows.map(r => {
      const sess = sessByCand[r.candidate_id] || null;
      const cv = r.overall_score != null ? parseFloat(r.overall_score) : null;
      const intv = sess && sess.scoreOverall != null ? parseFloat(sess.scoreOverall) : null;
      const combined = (cv != null && intv != null) ? (wInt * intv + (1 - wInt) * cv) : null;
      return { ...r, _sess: sess, _cv: cv, _intv: intv, _combined: combined };
    });
    return list.sort((a, b) => {
      const ta = a._intv != null ? 0 : (a._cv != null ? 1 : 2);
      const tb = b._intv != null ? 0 : (b._cv != null ? 1 : 2);
      if (ta !== tb) return ta - tb;
      if (ta === 0) return b._combined - a._combined;
      if (ta === 1) return b._cv - a._cv;
      return 0;
    });
  }, [rows, sessByCand, wInt]);

  const interviewedCount = ranked.filter(r => r._intv != null).length;
  const jobTitle = jobs.find(j => j.id === parseInt(jobId))?.job_title || 'the position';
  const compareList = ranked.filter(r => compareIds.has(r.candidate_id));

  function toggleCompare(candidateId) {
    setCompareIds(prev => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else if (next.size >= 3) { showToast('Compare up to 3 candidates at a time', 'info'); return prev; }
      else next.add(candidateId);
      return next;
    });
  }

  // Export the current ranking (with the live weighting applied) to CSV.
  function exportCsv() {
    const fmt = v => (v == null || isNaN(parseFloat(v))) ? '' : parseFloat(v).toFixed(1);
    const esc = v => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ['Rank', 'Candidate', 'Email', 'CV score', 'Interview score', `Combined (CV ${100 - weight}% / Int ${weight}%)`, 'Status'];
    const lines = ranked.map((r, i) => [
      i + 1, r.candidate_name, r.email || '', fmt(r._cv), fmt(r._intv), fmt(r._combined),
      r.status || 'pending',
    ].map(esc).join(','));
    const csv = [headers.map(esc).join(','), ...lines].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ranking-${jobTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${ranked.length} candidate${ranked.length === 1 ? '' : 's'} to CSV`, 'success');
  }

  async function updateStatus(shortlistId, status) {
    try {
      const res = await apiPost('/update-shortlist-status', { id: shortlistId, status });
      if (res.data.success) {
        setRows(prev => prev.map(r => r.id === shortlistId ? { ...r, status, updated_at: new Date().toISOString() } : r));
        if (status === 'hired') showToast('Candidate hired!', 'success');
        else if (status === 'rejected') showToast('Candidate rejected', 'error');
        else showToast(`Status updated to "${status}"`, 'success');
      } else showToast(res.data.error || 'Update failed', 'error');
    } catch { showToast('Update failed', 'error'); }
  }

  function sendOffer(r) {
    const tmpl = getOfferTemplate(r.candidate_name, jobTitle);
    openEmailComposer({
      title: 'Send Job Offer', description: `Send this offer to ${r.candidate_name}.`,
      candidate: { id: r.candidate_id, name: r.candidate_name, email: r.email },
      job: { id: r.job_opening_id, title: jobTitle }, emailType: 'offer',
      defaultSubject: tmpl.subject, defaultBody: tmpl.body,
      sendLabel: 'Send Offer', sendClass: 'btn-success', showSendToggle: false,
      editableRecipient: !r.email, recipientLabel: 'Candidate',
      onSend: async ({ subject, body, recipientEmail: resolved, attachmentFiles }) => {
        const to = resolved || r.email;
        const res = await sendEmailRequest({ candidateId: r.candidate_id, jobId: r.job_opening_id, emailType: 'offer', recipientEmail: to, candidateName: r.candidate_name, jobTitle, subject, body, attachments: attachmentFiles });
        const st = getEmailStatus(res); showToast(st.message, st.type);
      },
    });
  }

  function rejectCandidate(r) {
    const tmpl = getRejectionTemplate(r.candidate_name, jobTitle);
    openEmailComposer({
      title: 'Reject Candidate', description: `Reject ${r.candidate_name}?`,
      candidate: { id: r.candidate_id, name: r.candidate_name, email: r.email },
      job: { id: r.job_opening_id, title: jobTitle }, emailType: 'rejection',
      defaultSubject: tmpl.subject, defaultBody: tmpl.body,
      sendLabel: 'Reject Candidate', sendClass: 'btn-danger', showSendToggle: true,
      onSend: async ({ subject, body, sendEmail, recipientEmail: resolved, attachmentFiles }) => {
        await updateStatus(r.id, 'rejected');
        const to = resolved || r.email;
        if (sendEmail && to) {
          const res = await sendEmailRequest({ candidateId: r.candidate_id, jobId: r.job_opening_id, emailType: 'rejection', recipientEmail: to, candidateName: r.candidate_name, jobTitle, subject, body, attachments: attachmentFiles });
          const st = res.data?.status;
          if (st === 'sent') showToast(`Rejection email sent to ${to}`, 'error');
          else if (st === 'logged') showToast('Rejected — SMTP not configured, logged only', 'error');
          else showToast(`Rejected — email failed: ${res.data?.error || 'unknown error'}`, 'error');
        } else showToast('Candidate rejected', 'error');
      },
    });
  }

  // Send the full screening package (CV + interview) to the hiring manager for
  // the final interview — this is the hand-off, now AFTER the AI interview.
  function sendToHM(r) {
    const sess = sessByCand[r.candidate_id] || null;
    const fmt = v => { const n = parseFloat(v); return isNaN(n) ? '—' : n.toFixed(1); };
    const reqs = Array.isArray(sess?.requirementsMatch) ? sess.requirementsMatch : (() => { try { return JSON.parse(sess?.requirementsMatch || '[]'); } catch { return []; } })();
    const intBlock = sess
      ? `Interview scores
  Communication: ${fmt(sess.scoreComm)} / 10
  Technical: ${fmt(sess.scoreTech)} / 10
  Confidence: ${fmt(sess.scoreConf)} / 10
  Culture fit: ${fmt(sess.scoreCulture)} / 10
  Overall: ${fmt(sess.scoreOverall)} / 10${reqs.length ? `\nRequirements: ${reqs.filter(x => x.met).length}/${reqs.length} met${reqs.filter(x => !x.met).length ? ' (missing: ' + reqs.filter(x => !x.met).map(x => x.category || x.requirement).join(', ') + ')' : ''}` : ''}${sess.summary ? '\n\nInterview summary\n' + sess.summary : ''}${sess.recommendation ? '\n\nAI recommendation\n' + sess.recommendation : ''}`
      : 'This candidate has not completed an AI interview yet.';
    const defaultBody = `Hi,

Handing off ${r.candidate_name} for the ${jobTitle} role for your final interview. Below is the full screening package — CV evaluation and AI interview results. A PDF report, the recording, and the CV can be attached.

CV evaluation
  Overall: ${fmt(r.overall_score)} / 10  (skills ${fmt(r.skills_score)} · experience ${fmt(r.experience_score)} · education ${fmt(r.education_score)})${r.strengths ? '\n\nStrengths\n' + r.strengths : ''}${r.weaknesses ? '\n\nAreas to probe\n' + r.weaknesses : ''}

${intBlock}

Please run the final interview and let me know your decision.

Best regards,
HR Department`;
    openEmailComposer({
      title: 'Send candidate to Hiring Manager',
      description: `Send ${r.candidate_name}'s full screening package to the hiring manager for the final interview.`,
      candidate: { id: r.candidate_id, name: r.candidate_name, email: r.email },
      job: { id: r.job_opening_id, title: jobTitle },
      emailType: 'recommendation', recipientLabel: 'Hiring manager', recipientEmail: '', editableRecipient: true,
      defaultSubject: `Final interview — ${r.candidate_name} (${jobTitle})`,
      defaultBody,
      sendLabel: 'Send to Hiring Manager', sendClass: 'btn-primary',
      attachmentOptions: [
        { key: 'pdf', label: 'Interview report (PDF)', sublabel: sess ? 'Scores, summary, requirements, transcript' : 'No interview on record', checked: !!sess, disabled: !sess },
        { key: 'cv', label: 'Candidate CV', sublabel: r.cv_file_name ? 'Original uploaded file' : 'No CV file on record', checked: !!r.cv_file_name, disabled: !r.cv_file_name },
        { key: 'recording', label: 'Interview recording', sublabel: sess?.recordingPath ? 'Video (.webm)' : 'No recording', checked: false, disabled: !sess?.recordingPath },
      ],
      onSend: async ({ subject, body, recipientEmail, attachments: sel = [], attachmentFiles = [] }) => {
        if (!/@/.test(recipientEmail) || !/\./.test(recipientEmail.split('@').pop() || '')) { showToast('Enter a valid hiring manager email', 'error'); throw new Error('invalid recipient'); }
        const files = [...attachmentFiles];
        if (sel.includes('pdf') && sess) {
          const qaPairs = (() => { try { return Array.isArray(sess.qaPairs) ? sess.qaPairs : JSON.parse(sess.qaPairs || '[]'); } catch { return []; } })();
          const perQ = (() => { try { return Array.isArray(sess.perQuestion) ? sess.perQuestion : JSON.parse(sess.perQuestion || '[]'); } catch { return []; } })();
          const b64 = buildInterviewReportPdf({ session: sess, qaPairs, perQuestion: perQ, requirements: reqs, jobTitle });
          files.push({ filename: `Interview Report - ${r.candidate_name}.pdf`, content_b64: b64, mime: 'application/pdf' });
        }
        if (sel.includes('cv')) {
          try { const res = await apiGet(`/cv-file?candidate_id=${r.candidate_id}`); const d = res?.data?.data || res?.data || {}; if (d.cv_file_data) { const b64 = d.cv_file_data.includes(',') ? d.cv_file_data.split(',')[1] : d.cv_file_data; files.push({ filename: d.cv_file_name || 'cv.pdf', content_b64: b64, mime: d.cv_file_mime || 'application/pdf' }); } } catch {}
        }
        const res = await sendEmailRequest({ candidateId: r.candidate_id, jobId: r.job_opening_id, emailType: 'recommendation', recipientEmail, candidateName: r.candidate_name, jobTitle, subject, body, attachments: files, recordingFile: (sel.includes('recording') && sess?.recordingPath) ? sess.recordingPath : '' });
        const st = getEmailStatus(res);
        const skipped = res.data?.attachments_skipped;
        showToast(st.message + (Array.isArray(skipped) && skipped.length ? ` — skipped: ${skipped.join(', ')}` : ''), st.type);
        if (res.data?.status === 'sent') setSentToHM(prev => new Set(prev).add(r.candidate_id));
      },
    });
  }

  async function viewCV(r) {
    const win = window.open('about:blank', '_blank');
    try {
      const res = await apiGet(`/cv-file?candidate_id=${r.candidate_id}`);
      const d = res?.data?.data || res?.data || {};
      if (!d.cv_file_data) { if (win) win.close(); showToast('No CV file on record', 'error'); return; }
      const b64 = d.cv_file_data.includes(',') ? d.cv_file_data.split(',')[1] : d.cv_file_data;
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      if (win) win.location.href = URL.createObjectURL(new Blob([bytes], { type: d.cv_file_mime || 'application/pdf' }));
    } catch { if (win) win.close(); showToast('Failed to load CV', 'error'); }
  }

  const StatusBadge = ({ status }) => {
    const map = {
      shortlisted: ['#dbeafe', '#1e40af'], interviewed: ['#fef9c3', '#854d0e'],
      hired: ['#dcfce7', '#166534'], rejected: ['#fee2e2', '#991b1b'],
    };
    const [bg, color] = map[status] || ['#f1f5f9', '#475569'];
    return <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'capitalize', padding: '2px 9px', borderRadius: 10, background: bg, color }}>{status}</span>;
  };

  return (
    <div className="container">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)' }}>Decision</h2>
        <p style={{ fontSize: 14, color: 'var(--gray-500)', marginTop: 4 }}>
          CV score and interview score side by side, blended into one ranking — to make the final call.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontWeight: 600, fontSize: 14 }}>Job:</label>
        <select value={jobId} onChange={e => handleJobChange(e.target.value)} style={{ maxWidth: 340 }}>
          <option value="">-- Select a job opening --</option>
          {jobs.filter(j => j.is_active).map(j => <option key={j.id} value={j.id}>{j.job_title} — {j.department}</option>)}
          {jobs.some(j => !j.is_active) && (
            <optgroup label="Closed (reactivate in Job Openings to use)">
              {jobs.filter(j => !j.is_active).map(j => <option key={j.id} value={j.id} disabled>{j.job_title} — {j.department}</option>)}
            </optgroup>
          )}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>Refresh</button>
      </div>

      {jobId && rows.length > 0 && (
        <>
          <div className="stats" style={{ marginBottom: 16 }}>
            <StatCard label="Candidates" value={rows.length} />
            <StatCard label="Interviewed" value={interviewedCount || '-'} />
            <StatCard label="Hired" value={rows.filter(r => r.status === 'hired').length || '-'} />
            <StatCard label="Rejected" value={rows.filter(r => r.status === 'rejected').length || '-'} />
          </div>

          {/* Blend weight slider */}
          <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', padding: '14px 20px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)' }}>Combined score weighting</span>
              <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>
                CV <strong style={{ color: '#2563eb' }}>{100 - sliderVal}%</strong>
                <span style={{ margin: '0 8px', color: 'var(--gray-300)' }}>·</span>
                Interview <strong style={{ color: '#16a34a' }}>{sliderVal}%</strong>
              </span>
            </div>
            <input
              type="range" min="0" max="100" step="1" value={sliderVal}
              className="weight-slider"
              style={{ background: `linear-gradient(to right, #2563eb 0%, #2563eb ${sliderVal}%, var(--gray-200) ${sliderVal}%, var(--gray-200) 100%)` }}
              onChange={e => {
                const v = Number(e.target.value);
                setSliderVal(v);
                // Re-rank only after the user pauses/releases, so cards don't jump on every drag tick.
                clearTimeout(weightCommitRef.current);
                weightCommitRef.current = setTimeout(() => setWeight(v), 120);
              }}
              onPointerUp={e => { clearTimeout(weightCommitRef.current); setWeight(Number(e.currentTarget.value)); }}
              onKeyUp={e => { clearTimeout(weightCommitRef.current); setWeight(Number(e.currentTarget.value)); }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>
              <span style={{ textAlign: 'left' }}>All CV</span>
              <span style={{ textAlign: 'center' }}>Balanced</span>
              <span style={{ textAlign: 'right' }}>All interview</span>
            </div>
          </div>

          {/* Toolbar: export + compare */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-secondary" onClick={exportCsv}>⬇ Export ranking (CSV)</button>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowCompare(true)} disabled={compareIds.size < 2}>
              ⇄ Compare{compareIds.size > 0 ? ` (${compareIds.size})` : ''}
            </button>
            {compareIds.size > 0 && (
              <button className="btn btn-sm" style={{ color: 'var(--gray-500)' }} onClick={() => setCompareIds(new Set())}>Clear selection</button>
            )}
            <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Tick up to 3 candidates to compare side by side.</span>
          </div>
        </>
      )}

      {loading ? <Loading /> : !jobId ? <EmptyState>Select a job opening to compare candidates.</EmptyState> : rows.length === 0 ? <EmptyState>No shortlisted candidates for this job yet.</EmptyState> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ranked.map((r, i) => {
            const isOpen = expanded === r.id;
            const sess = r._sess;
            const reqs = Array.isArray(sess?.requirementsMatch) ? sess.requirementsMatch : (() => { try { return JSON.parse(sess?.requirementsMatch || '[]'); } catch { return []; } })();
            const decided = r.status === 'hired' || r.status === 'rejected';
            const tint = r.status === 'hired' ? '#f0fdf4' : r.status === 'rejected' ? '#fef2f2' : '#fff';
            const isSent = sentToHM.has(r.candidate_id);
            return (
              <div key={r.id} style={{
                background: tint,
                border: `1px solid ${isOpen ? '#bfdbfe' : 'var(--gray-200)'}`,
                borderRadius: 12, overflow: 'hidden',
                boxShadow: isOpen ? '0 4px 16px rgba(37,99,235,0.08)' : '0 1px 2px rgba(0,0,0,0.04)',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}>
                {/* Header row */}
                <div onClick={() => setExpanded(isOpen ? null : r.id)} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', cursor: 'pointer', flexWrap: 'wrap' }}>
                  <input
                    type="checkbox"
                    title="Select to compare"
                    checked={compareIds.has(r.candidate_id)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggleCompare(r.candidate_id)}
                    style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }}
                  />
                  <div style={{ width: 22, textAlign: 'center', fontWeight: 800, color: 'var(--gray-300)', fontSize: 15, flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, color: 'var(--gray-900)' }}>{r.candidate_name}</strong>
                      <StatusBadge status={r.status} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>{r.email || '—'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
                    <div style={{ textAlign: 'center', minWidth: 42 }}>
                      <ScoreCell value={r._cv} /><div style={COL_LABEL}>CV</div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 82 }}>
                      {r._intv != null
                        ? <ScoreCell value={r._intv} />
                        : <div style={{ fontSize: 11, color: 'var(--gray-400)', fontStyle: 'italic', lineHeight: 1.1 }}>Not<br />interviewed</div>}
                      <div style={COL_LABEL}>Interview</div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 56, borderLeft: '1px solid var(--gray-200)', paddingLeft: 16 }}>
                      {r._combined != null
                        ? <div style={{ fontSize: 23, fontWeight: 800, color: scoreColor(r._combined), lineHeight: 1 }}>{r._combined.toFixed(1)}</div>
                        : <div style={{ fontSize: 18, color: 'var(--gray-300)' }}>—</div>}
                      <div style={{ ...COL_LABEL, color: '#2563eb' }}>Combined</div>
                    </div>
                  </div>
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                    {!decided && isSent && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 10, background: '#ede9fe', color: '#5b21b6' }}>✉ Sent to HM</span>
                    )}
                    {decided ? (
                      <>
                        <span style={{ fontSize: 13, fontWeight: 700, color: r.status === 'hired' ? '#166534' : '#991b1b' }}>
                          {r.status === 'hired' ? '✓ Hired' : '✗ Rejected'}
                        </span>
                        {r.status === 'hired' && <button className="btn btn-sm btn-secondary" onClick={() => sendOffer(r)}>Send Offer</button>}
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => sendToHM(r)} title="Send the full screening pack (CV + interview scores · recording · transcript · PDF report) to the hiring manager">✉ {isSent ? 'Re-send to HM' : 'Send to HM'}</button>
                        <button className="btn btn-sm btn-success" onClick={() => updateStatus(r.id, 'hired')}>Hire</button>
                        <button className="btn btn-sm btn-danger" onClick={() => rejectCandidate(r)}>Reject</button>
                      </>
                    )}
                  </div>
                  <span style={{ color: 'var(--gray-400)', fontSize: 13, flexShrink: 0, transition: 'transform 0.25s ease', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                </div>

                {/* Smooth-expanding detail (grid-rows 0fr→1fr animates height) */}
                <div style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.28s ease' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ borderTop: '1px solid var(--gray-100)', background: '#fafbff', padding: '18px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {/* CV side */}
                      <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 10, padding: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>CV Evaluation</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <StatChip value={r.skills_score} label="Skills" />
                          <StatChip value={r.experience_score} label="Experience" />
                          <StatChip value={r.education_score} label="Education" />
                        </div>
                        {r.strengths && <Callout label="Strengths" text={r.strengths} tone="pos" />}
                        {r.weaknesses && <Callout label="Weaknesses" text={r.weaknesses} tone="neg" />}
                        <button className="btn btn-sm btn-secondary" style={{ marginTop: 12 }} onClick={() => viewCV(r)}>📄 View CV</button>
                      </div>
                      {/* Interview side */}
                      <div style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 10, padding: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Interview Evaluation</div>
                        {sess ? (
                          <>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <StatChip value={sess.scoreComm} label="Comm" />
                              <StatChip value={sess.scoreTech} label="Technical" />
                              <StatChip value={sess.scoreConf} label="Confidence" />
                              <StatChip value={sess.scoreCulture} label="Culture" />
                            </div>
                            {reqs.length > 0 && (
                              <div style={{ fontSize: 12, color: 'var(--gray-700)', marginTop: 10, padding: '7px 11px', borderRadius: 6, background: reqs.every(x => x.met) ? '#f0fdf4' : '#fff7ed', border: `1px solid ${reqs.every(x => x.met) ? '#bbf7d0' : '#fed7aa'}` }}>
                                <strong>Requirements:</strong> {reqs.filter(x => x.met).length}/{reqs.length} met
                                {reqs.filter(x => !x.met).length > 0 && <span style={{ color: '#991b1b' }}> — missing: {reqs.filter(x => !x.met).map(x => x.category || x.requirement).join(', ')}</span>}
                              </div>
                            )}
                            {sess.summary && <Callout label="Summary" text={sess.summary} tone="neutral" />}
                            {sess.recommendation && <Callout label="Recommendation" text={sess.recommendation} tone="neutral" />}
                            {sess.recordingPath && <a className="btn btn-sm btn-secondary" style={{ marginTop: 12, textDecoration: 'none' }} href={`${RECORDING_SERVER}/recording/${sess.recordingPath}`} target="_blank" rel="noreferrer">🎥 Watch recording</a>}
                          </>
                        ) : (
                          <p style={{ fontSize: 13, color: 'var(--gray-400)', fontStyle: 'italic', lineHeight: 1.6, margin: 0 }}>
                            Not interviewed yet. Send an interview link from the Interview tab to get a second signal.
                          </p>
                        )}
                      </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={showCompare && compareList.length >= 2} onClose={() => setShowCompare(false)} title="Compare candidates" wide
        footer={<button className="btn btn-secondary" onClick={() => setShowCompare(false)}>Close</button>}>
        <CompareGrid list={compareList} weight={weight} />
      </Modal>
    </div>
  );
}

// Side-by-side comparison: metrics as rows, candidates as columns. The best
// value in each numeric row is highlighted green so the winner per dimension
// is obvious at a glance.
function CompareGrid({ list, weight }) {
  const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const reqsOf = s => Array.isArray(s?.requirementsMatch) ? s.requirementsMatch : (() => { try { return JSON.parse(s?.requirementsMatch || '[]'); } catch { return []; } })();
  const rows = [
    { label: 'CV — Overall', get: r => num(r._cv) },
    { label: 'CV — Skills', get: r => num(r.skills_score) },
    { label: 'CV — Experience', get: r => num(r.experience_score) },
    { label: 'CV — Education', get: r => num(r.education_score) },
    { label: 'Interview — Overall', get: r => num(r._intv) },
    { label: 'Interview — Communication', get: r => num(r._sess?.scoreComm) },
    { label: 'Interview — Technical', get: r => num(r._sess?.scoreTech) },
    { label: 'Interview — Confidence', get: r => num(r._sess?.scoreConf) },
    { label: 'Interview — Culture fit', get: r => num(r._sess?.scoreCulture) },
    { label: `Combined (CV ${100 - weight}% / Int ${weight}%)`, get: r => num(r._combined), strong: true },
  ];
  const cell = { padding: '8px 12px', borderBottom: '1px solid var(--gray-100)', fontSize: 13, textAlign: 'center', whiteSpace: 'nowrap' };
  const labelCell = { ...cell, textAlign: 'left', fontWeight: 600, color: 'var(--gray-600)', position: 'sticky', left: 0, background: '#fff' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 120 + list.length * 150 }}>
        <thead>
          <tr>
            <th style={{ ...labelCell, color: 'var(--gray-400)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.05em' }}>Metric</th>
            {list.map(r => (
              <th key={r.id} style={{ ...cell, fontWeight: 700, color: 'var(--gray-900)', fontSize: 14 }}>
                {r.candidate_name}
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--gray-400)' }}>{r.status || 'pending'}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const vals = list.map(row.get);
            const present = vals.filter(v => v != null);
            const best = present.length ? Math.max(...present) : null;
            return (
              <tr key={row.label}>
                <td style={labelCell}>{row.label}</td>
                {list.map((r, idx) => {
                  const v = vals[idx];
                  const isBest = v != null && best != null && v === best && present.length > 1;
                  return (
                    <td key={r.id} style={{ ...cell, fontWeight: row.strong ? 800 : 600,
                      fontSize: row.strong ? 16 : 13,
                      color: isBest ? '#166534' : v == null ? 'var(--gray-300)' : 'var(--gray-800)',
                      background: isBest ? '#f0fdf4' : 'transparent' }}>
                      {v != null ? v.toFixed(1) : '—'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          <tr>
            <td style={labelCell}>Requirements met</td>
            {list.map(r => {
              const reqs = reqsOf(r._sess);
              return <td key={r.id} style={cell}>{reqs.length ? `${reqs.filter(x => x.met).length}/${reqs.length}` : '—'}</td>;
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
