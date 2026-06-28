import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiGet, apiPost } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import Loading from '../components/common/Loading';
import EmptyState from '../components/common/EmptyState';
import Select from '../components/common/Select';
import ShowSelect from '../components/common/ShowSelect';
import { sendEmailRequest, getOfferTemplate, getRejectionTemplate, getEmailStatus } from '../services/email';
import { buildInterviewReportPdf } from '../utils/pdfReport';
import { scoreColor } from '../utils/helpers';

const RECORDING_SERVER = ''; // relative — vite proxies /recording to the sidecar
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
    pos:     { border: 'var(--tint-success-border, #86efac)', bg: 'var(--tint-success)', label: 'var(--color-success, #166534)' },
    neg:     { border: 'var(--tint-danger-border, #fca5a5)',  bg: 'var(--tint-danger)',   label: 'var(--color-danger,  #991b1b)' },
    neutral: { border: 'var(--gray-300)',                     bg: 'var(--surface-2)',      label: 'var(--gray-500)' },
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
  const [sortBy, setSortBy] = useState('recent'); // recent | combined | cv | interview | name
  const [navbarSlot, setNavbarSlot] = useState(null); // nav-row portal target for the score blend
  useEffect(() => { setNavbarSlot(document.getElementById('navbar-slot')); }, []);
  // On a phone the nav-row slot is hidden, so the score blend renders inline at
  // the top of the Decision content instead of being portaled into the nav row.
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [statusFilter, setStatusFilter] = useState('all');  // Decision list status filter pills
  const [pendingFocus, setPendingFocus] = useState(null);   // candidate_id to expand+scroll once rows load
  const focusAppliedRef = useRef(false);

  useEffect(() => { loadJobs(); }, []);
  // Follow the global job picked in the header.
  useEffect(() => { if (selectedJob) setJobId(String(selectedJob.id)); }, [selectedJob]);
  useEffect(() => { if (jobId) loadData(); }, [jobId]);

  // Deep-link from an HM reply in the Emails tab:
  // /decision?job=<id>&focus=<candidateId> — open the right job, switch to the
  // "Sent to HM" filter, and expand+scroll to that candidate so HR can hire/reject.
  useEffect(() => {
    if (focusAppliedRef.current || jobs.length === 0) return;
    const p = new URLSearchParams(window.location.search);
    const job = p.get('job'), focus = p.get('focus'), filter = p.get('filter');
    if (!job && !focus && !filter) return;
    focusAppliedRef.current = true;
    if (job) { const j = jobs.find(j => String(j.id) === String(job)); if (j) { setJobId(String(j.id)); setSelectedJob(j); } }
    if (filter === 'sent-hm' || focus) setStatusFilter('sent-hm');
    if (focus) setPendingFocus(String(focus));
    window.history.replaceState({}, '', '/decision');
  }, [jobs]);

  // Once rows are in, apply the pending focus (expand the card + scroll to it).
  useEffect(() => {
    if (!pendingFocus || rows.length === 0) return;
    const row = rows.find(r => String(r.candidate_id) === String(pendingFocus));
    if (row) {
      // Land on Sent-to-HM if they're actually there; otherwise show All so the
      // focused candidate is never hidden by the filter.
      setStatusFilter(sentToHM.has(row.candidate_id) ? 'sent-hm' : 'all');
      setExpanded(row.id);
      setTimeout(() => document.getElementById(`decision-cand-${row.candidate_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    }
    setPendingFocus(null);
  }, [rows, pendingFocus]);

  async function loadJobs() {
    try { const res = await apiGet('/job-openings'); setJobs(res.data || []); } catch {}
  }

  function handleJobChange(val) {
    setJobId(val); setExpanded(null); setStatusFilter('all');
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
      // Rejected candidates always sink to the bottom of the ranking, whatever
      // their score — the in-play candidates stay up top.
      const ra = a.status === 'rejected' ? 1 : 0;
      const rb = b.status === 'rejected' ? 1 : 0;
      if (ra !== rb) return ra - rb;

      if (sortBy === 'recent') return new Date(b.updated_at || b.shortlisted_at || 0) - new Date(a.updated_at || a.shortlisted_at || 0);
      if (sortBy === 'name') return (a.candidate_name || '').localeCompare(b.candidate_name || '');
      if (sortBy === 'cv') return (b._cv ?? -1) - (a._cv ?? -1);
      if (sortBy === 'interview') return (b._intv ?? -1) - (a._intv ?? -1);
      // combined (default): interviewed (combined) first, then CV-only, nulls last
      const ta = a._intv != null ? 0 : (a._cv != null ? 1 : 2);
      const tb = b._intv != null ? 0 : (b._cv != null ? 1 : 2);
      if (ta !== tb) return ta - tb;
      if (ta === 0) return b._combined - a._combined;
      if (ta === 1) return b._cv - a._cv;
      return 0;
    });
  }, [rows, sessByCand, wInt, sortBy]);

  const interviewedCount = ranked.filter(r => r._intv != null).length;
  const jobTitle = jobs.find(j => j.id === parseInt(jobId))?.job_title || 'the position';

  async function updateStatus(shortlistId, status) {
    try {
      const res = await apiPost('/update-shortlist-status', { id: shortlistId, status });
      if (res.data.success) {
        setRows(prev => prev.map(r => r.id === shortlistId ? { ...r, status, updated_at: new Date().toISOString() } : r));
        if (status === 'hired') showToast('Candidate hired!', 'success');
        else if (status === 'rejected') showToast('Candidate rejected', 'error');
        else showToast(`Decision reverted — moved back to ${status}`, 'info');
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

  const STATUS_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'interviewed', label: 'Interviewed' },
    { key: 'sent-hm', label: 'Sent to HM' },   // not a status — derived from sentToHM (recommendation email sent)
    { key: 'hired', label: 'Hired' },
    { key: 'rejected', label: 'Rejected' },
  ];
  // "Sent to HM" is a derived, ACTIVE-processing stage: a recommendation email was
  // sent AND the candidate hasn't reached a terminal verdict. Once hired/rejected
  // they leave this stage and live only in Hired/Rejected (no double-listing).
  const isSentToHM = r => sentToHM.has(r.candidate_id) && r.status !== 'rejected' && r.status !== 'hired';
  // A row matches the active filter. 'sent-hm' is special (see above).
  const matchesFilter = r => statusFilter === 'all'
    || (statusFilter === 'sent-hm' ? isSentToHM(r) : r.status === statusFilter);

  return (
    <div className="container tab-fade-in">
      {/* Score blend — drag toward CV or Interview (snaps to a clean 50/50). On
          desktop it's portaled into the nav-row's empty right space; on a phone
          (where that slot is hidden) it renders inline at the top of the page. */}
      {jobId && rows.length > 0 && (() => {
        const blend = (
          <div className="dec-blend" style={{ display: 'flex', alignItems: 'center', gap: 9 }} title="Drag toward CV or Interview; snaps to a clean 50/50">
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>Score</span>
            <input
              type="range" min="0" max="100" step="5" value={sliderVal}
              className="weight-slider"
              style={{ width: 130, background: `linear-gradient(to right, #2563eb 0%, #2563eb ${sliderVal}%, var(--gray-200) ${sliderVal}%, var(--gray-200) 100%)` }}
              onChange={e => {
                let v = Number(e.target.value);
                if (Math.abs(v - 50) <= 5) v = 50;
                setSliderVal(v);
                clearTimeout(weightCommitRef.current);
                weightCommitRef.current = setTimeout(() => setWeight(v), 120);
              }}
              onPointerUp={e => { let v = Number(e.currentTarget.value); if (Math.abs(v - 50) <= 5) v = 50; setSliderVal(v); clearTimeout(weightCommitRef.current); setWeight(v); }}
              onKeyUp={e => { clearTimeout(weightCommitRef.current); setWeight(Number(e.currentTarget.value)); }}
            />
            <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>CV <strong style={{ color: '#2563eb' }}>{100 - sliderVal}</strong> : <strong style={{ color: '#16a34a' }}>{sliderVal}</strong> Interview</span>
          </div>
        );
        if (isMobile) {
          return <div className="dec-blend-mobile" style={{ display: 'flex', justifyContent: 'center', padding: '10px 12px', marginBottom: 12, background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 10 }}>{blend}</div>;
        }
        return navbarSlot ? createPortal(blend, navbarSlot) : null;
      })()}

      {jobId && rows.length > 0 && (
        <>
          {/* Top bar like Shortlist: filter pills + sort + refresh */}
          <div className="results-filter-bar" style={{ marginBottom: 14 }}>
            <span className="results-filter-label">Show:</span>
            {(() => {
              const decFilters = STATUS_FILTERS.map(f => ({
                key: f.key, label: f.label,
                count: f.key === 'all' ? ranked.length
                  : f.key === 'sent-hm' ? ranked.filter(isSentToHM).length
                  : ranked.filter(r => r.status === f.key).length,
              }));
              return (<>
                <ShowSelect filters={decFilters} value={statusFilter} onChange={setStatusFilter} />
                {decFilters.map(f => (
                  <button key={f.key} className={`results-filter-btn${statusFilter === f.key ? ' active' : ''}`} onClick={() => setStatusFilter(f.key)}>
                    {f.label}
                    <span className="results-filter-count">{f.count}</span>
                  </button>
                ))}
              </>);
            })()}
            <div className="results-sort" style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span className="results-sort-label" style={{ fontSize: 12.5, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>Sort by</span>
              <select
                className="results-sort-select"
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
              >
                <option value="recent">Most recent</option>
                <option value="combined">Combined score</option>
                <option value="cv">CV score</option>
                <option value="interview">Interview score</option>
                <option value="name">Name (A–Z)</option>
              </select>
              <button onClick={loadData} title="Refresh" className="btn btn-sm btn-secondary results-refresh" style={{ flexShrink: 0 }}>↻</button>
            </div>
          </div>
        </>
      )}

      {loading ? <Loading /> : !jobId ? <EmptyState>Pick a job from the “Current Job” selector at the top to compare candidates.</EmptyState> : rows.length === 0 ? <EmptyState>No shortlisted candidates for this job yet.</EmptyState> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ranked.filter(matchesFilter).length === 0 && (
            <EmptyState>{statusFilter === 'sent-hm' ? 'No candidates have been sent to the hiring manager yet.' : `No ${statusFilter === 'all' ? '' : statusFilter + ' '}candidates for this job.`}</EmptyState>
          )}
          {ranked.map((r, i) => {
            if (!matchesFilter(r)) return null;
            const isOpen = expanded === r.id;
            const sess = r._sess;
            const reqs = Array.isArray(sess?.requirementsMatch) ? sess.requirementsMatch : (() => { try { return JSON.parse(sess?.requirementsMatch || '[]'); } catch { return []; } })();
            const decided = r.status === 'hired' || r.status === 'rejected';
            const tint = r.status === 'hired' ? 'var(--tint-success)' : r.status === 'rejected' ? 'var(--tint-danger)' : 'var(--surface)';
            const isSent = sentToHM.has(r.candidate_id);
            return (
              <div key={r.id} id={`decision-cand-${r.candidate_id}`} style={{
                background: tint,
                border: `1px solid ${isOpen ? '#bfdbfe' : 'var(--gray-200)'}`,
                borderRadius: 12, overflow: 'hidden',
                boxShadow: isOpen ? '0 4px 16px rgba(37,99,235,0.08)' : '0 1px 2px rgba(0,0,0,0.04)',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}>
                {/* Header row */}
                <div onClick={() => setExpanded(isOpen ? null : r.id)} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', cursor: 'pointer', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, color: 'var(--gray-900)' }}>{r.candidate_name}</strong>
                      <StatusBadge status={r.status} />
                      {!decided && isSent && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 10, background: '#ede9fe', color: '#5b21b6' }}>✉ Sent to HM</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>{r.email || '—'}</div>
                  </div>
                  {/* Buttons sit just left of the scores; name fills the left. */}
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                    {decided ? (
                      <>
                        <span style={{ fontSize: 13, fontWeight: 700, color: r.status === 'hired' ? '#166534' : '#991b1b' }}>
                          {r.status === 'hired' ? '✓ Hired' : '✗ Rejected'}
                        </span>
                        {r.status === 'hired' && <button className="btn btn-sm btn-secondary" onClick={() => sendOffer(r)}>Send Offer</button>}
                        {/* Undo an accidental Hire/Reject — back to the in-play stage. */}
                        <button
                          className="btn btn-sm"
                          onClick={() => updateStatus(r.id, r._sess ? 'interviewed' : 'shortlisted')}
                          title={`Undo this decision — move ${r.candidate_name} back to ${r._sess ? 'Interviewed' : 'Shortlisted'}`}
                          style={{ color: 'var(--gray-500)', border: '1px solid var(--gray-200)', background: 'var(--surface)' }}
                        >↩ Revert</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => sendToHM(r)} title="Send the full screening pack (CV + interview scores · recording · transcript · PDF report) to the hiring manager">✉ {isSent ? 'Re-send to HM' : 'Send to HM'}</button>
                        <button className="btn btn-sm btn-success" onClick={() => updateStatus(r.id, 'hired')}>Hire</button>
                        <button className="btn btn-sm btn-danger" onClick={() => rejectCandidate(r)}>Reject</button>
                      </>
                    )}
                  </div>
                  <div className="dec-score-row" style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
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
                  <span className="dec-score-caret" style={{ color: 'var(--gray-400)', fontSize: 13, flexShrink: 0, transition: 'transform 0.25s ease', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                </div>

                {/* Smooth-expanding detail (grid-rows 0fr→1fr animates height) */}
                <div style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.28s ease' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ borderTop: '1px solid var(--gray-100)', background: 'var(--surface-2)', padding: '18px' }}>
                      <div className="expand-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {/* CV side */}
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: 16 }}>
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
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: 16 }}>
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
                              <div style={{ fontSize: 12, color: 'var(--gray-700)', marginTop: 10, padding: '7px 11px', borderRadius: 6, background: reqs.every(x => x.met) ? 'var(--tint-success)' : 'var(--tint-warning)', border: `1px solid ${reqs.every(x => x.met) ? '#bbf7d0' : '#fed7aa'}` }}>
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
    </div>
  );
}
