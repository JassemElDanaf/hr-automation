import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import { useEvalStatus } from '../state/evalStatus';
import Badge from '../components/common/Badge';
import ScoreBadge from '../components/common/ScoreBadge';
import EmptyState from '../components/common/EmptyState';
import Loading from '../components/common/Loading';
import Select from '../components/common/Select';
import { sendEmailRequest, getInterviewTemplate, getOfferTemplate, getRejectionTemplate, getEmailStatus } from '../services/email';
import { emailTypeLabel, scoreColor } from '../utils/helpers';
import EvalDetailModal from '../components/modals/EvalDetailModal';

const HM_LS_KEY = 'hr_hiring_manager_emails';
function loadHMEmails() {
  try { return JSON.parse(localStorage.getItem(HM_LS_KEY) || '{}'); } catch { return {}; }
}
function saveHMEmail(jobOpeningId, email) {
  if (!jobOpeningId || !email) return;
  const m = loadHMEmails();
  m[jobOpeningId] = email;
  try { localStorage.setItem(HM_LS_KEY, JSON.stringify(m)); } catch {}
}
function looksLikeEmail(s) { return typeof s === 'string' && /@/.test(s) && /\./.test(s.split('@').pop() || ''); }

// Compact "⋯ more actions" dropdown — keeps each card to 1–2 primary buttons
// and tucks secondary actions (view profile, reject, archive, status reverts)
// out of the way. Closes on outside click or Escape.
function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!items || items.length === 0) return null;
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button className="btn btn-sm btn-ghost" title="More actions" onClick={() => setOpen(o => !o)}
        style={{ minWidth: 34, padding: '4px 10px', fontWeight: 800, fontSize: 17, lineHeight: 1, letterSpacing: '1px' }}>⋯</button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50, background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 8, boxShadow: '0 8px 28px rgba(0,0,0,0.13)', minWidth: 168, overflow: 'hidden', padding: '4px 0' }}>
          {items.map((it, i) => (
            <button key={i} role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', fontSize: 13, border: 'none', background: 'none', cursor: 'pointer', color: it.danger ? '#dc2626' : 'var(--gray-700)', fontFamily: 'inherit', fontWeight: 500 }}
              onMouseEnter={e => { e.currentTarget.style.background = it.danger ? '#fef2f2' : 'var(--gray-50)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SL_CHIP = (bg, color) => ({ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '3px 9px', borderRadius: 10, background: bg, color });

// Compact score chip used inside the expanded detail (Decision-style).
function SlChip({ value, label }) {
  const v = value != null ? parseFloat(value) : null;
  return (
    <div style={{ flex: 1, textAlign: 'center', background: 'var(--gray-50)', borderRadius: 8, padding: '8px 6px' }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: scoreColor(v), lineHeight: 1 }}>{v != null ? v.toFixed(1) : '—'}</div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--gray-400)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function SlCallout({ label, text, color }) {
  return (
    <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--gray-700)', lineHeight: 1.5 }}>
      <strong style={{ color }}>{label}:</strong> {text}
    </div>
  );
}

export default function Shortlist() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteHandledRef = useRef(false);
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast, openEmailComposer } = useUI();
  const { runAiTask } = useEvalStatus();
  const autoEvalRef = useRef(new Set()); // session ids already auto-evaluated (no loops)
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [slFilter, setSlFilter] = useState('shortlisted');
  const [slArchivedMap, setSlArchivedMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hr_shortlist_archived') || '{}'); } catch { return {}; }
  });
  const [slPendingArchive, setSlPendingArchive] = useState(null);
  const slArchiveTimerRef = useRef(null);
  const [emailMap, setEmailMap] = useState({}); // candidate_id -> [{ email_type, status, sent_at, subject, body, recipient_email, error_message }, ...]
  const [expandedEmail, setExpandedEmail] = useState({}); // candidate_id -> true if email details expanded
  const [profileCandidate, setProfileCandidate] = useState(null); // candidate for detail modal
  const [transitioning, setTransitioning] = useState({}); // id -> true while animation plays
  const [retainedInView, setRetainedInView] = useState(new Set()); // keep card visible after state change
  const [expanded, setExpanded] = useState(null); // shortlist row id of the expanded card (Decision-style)
  const [slSort, setSlSort] = useState('recent'); // recent | score | name

  useEffect(() => { loadJobs(); }, []);

  // Follow the global job picked in the header (applies universally across tabs).
  useEffect(() => {
    if (selectedJob) setJobId(String(selectedJob.id));
  }, [selectedJob]);

  useEffect(() => {
    if (jobId) loadShortlist();
  }, [jobId]);

  // Deep-link from the Interview tab "Email this link" button:
  // /shortlist?emailInvite=<candidateId>&job=<jobId> — switch to that job if
  // needed, then once its shortlist data is loaded, open the interview-invite
  // composer for the candidate (the link auto-fills from localStorage).
  useEffect(() => {
    const inviteCand = searchParams.get('emailInvite');
    const inviteJob = searchParams.get('job');
    if (!inviteCand || inviteHandledRef.current) return;
    if (inviteJob && jobs.length && String(jobId) !== String(inviteJob)) {
      const j = jobs.find(j => String(j.id) === String(inviteJob));
      if (j) setSelectedJob({ id: j.id, job_title: j.job_title, department: j.department });
      return; // wait for data to reload for the right job
    }
    if (data.length === 0) return;
    const row = data.find(s => String(s.candidate_id) === String(inviteCand));
    if (!row) return;
    inviteHandledRef.current = true;
    sendEmail(row.candidate_id, row.job_opening_id, row.candidate_name, row.email, 'interview_invite');
    searchParams.delete('emailInvite'); searchParams.delete('job');
    setSearchParams(searchParams, { replace: true });
  }, [data, jobs, jobId, searchParams]);

  async function loadJobs() {
    try {
      const res = await apiGet('/job-openings');
      setJobs(res.data || []);
    } catch {}
  }

  function handleJobChange(val) {
    setJobId(val);
    if (val) {
      const job = jobs.find(j => j.id === parseInt(val));
      if (job) setSelectedJob(job);
    }
  }

  async function loadShortlist() {
    if (!jobId) { setData([]); return; }
    setLoading(true);
    try {
      const [slRes, emRes, sessRes] = await Promise.all([
        apiGet(`/shortlist?job_id=${jobId}`),
        apiGet(`/email-history?job_id=${jobId}`).catch(() => ({ data: { data: [] } })),
        apiGet(`/interview/sessions?jobId=${jobId}`).catch(() => []),
      ]);
      // A candidate who has completed the AI interview (a session row exists) is
      // "interviewed". Auto-advance them — reflect it immediately and persist in
      // the background — so the pipeline stage stays accurate without a manual
      // "Mark Interviewed" button.
      const sessList = Array.isArray(sessRes) ? sessRes : (sessRes.data || []);
      const interviewedCands = new Set(sessList.map(s => s.candidateId));
      // Auto-evaluate completed interviews that never got scored (e.g. the
      // candidate closed their tab before the background eval finished). Runs
      // HR-side where Ollama lives, so no manual "Re-evaluate" click is needed.
      autoEvaluatePendingSessions(sessList);
      const bump = [];
      const rows = (slRes.data || []).map(r => {
        if (r.status === 'shortlisted' && interviewedCands.has(r.candidate_id)) {
          bump.push(r.id);
          return { ...r, status: 'interviewed' };
        }
        return r;
      });
      setData(rows);
      for (const id of bump) apiPost('/update-shortlist-status', { id, status: 'interviewed' }).catch(() => {});
      // Build email map: all emails per candidate, sorted newest first
      const emails = (emRes.data?.data || emRes.data || []).filter(e => e.candidate_id);
      const map = {};
      for (const e of emails) {
        const cid = e.candidate_id;
        if (!map[cid]) map[cid] = [];
        map[cid].push({ email_type: e.email_type, status: e.status, sent_at: e.sent_at, subject: e.subject, body: e.body, recipient_email: e.recipient_email, error_message: e.error_message });
      }
      for (const cid of Object.keys(map)) {
        map[cid].sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
      }
      setEmailMap(map);
    } catch (err) { showToast('Failed to load shortlist', 'error'); }
    finally { setLoading(false); }
  }

  // Score any completed-but-unscored interview sessions in the background.
  function autoEvaluatePendingSessions(sessList) {
    const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || []); } catch { return []; } };
    for (const s of sessList) {
      const pending = !s.scoreOverall && !s.summary;
      const qa = parse(s.qaPairs);
      if (!pending || !Array.isArray(qa) || qa.length === 0) continue;
      if (autoEvalRef.current.has(s.id)) continue;
      autoEvalRef.current.add(s.id);
      const base = { jobId: s.jobOpeningId, evaluationId: s.evaluationId, candidateId: s.candidateId, candidateName: s.candidateName, transcript: qa, durationSeconds: s.durationSeconds };
      runAiTask(`Evaluating ${s.candidateName || 'interview'}…`, async () => {
        const evalRes = await apiPost('/interview/evaluate', base);
        const scores = evalRes.data || evalRes;
        await apiPost('/interview/save-transcript', { ...base, scores, recordingPath: s.recordingPath || '', requirementsMatch: parse(s.requirementsMatch) });
      }, { to: '/live-interview?tab=results', hint: s.candidateName ? `${s.candidateName}'s interview results` : 'Interview results' })
        .catch(() => {});
    }
  }

  async function updateStatus(id, status) {
    try {
      const res = await apiPost('/update-shortlist-status', { id, status });
      if (res.data.success) {
        setData(prev => prev.map(s => s.id === id ? { ...s, status, updated_at: new Date().toISOString() } : s));
        // Trigger card transition animation
        setTransitioning(prev => ({ ...prev, [id]: true }));
        setTimeout(() => setTransitioning(prev => { const n = { ...prev }; delete n[id]; return n; }), 600);
        // Keep card visible in current filter until filter switch
        setRetainedInView(prev => new Set(prev).add(id));
        // Toasts: green for positive, red for rejection
        if (status === 'rejected') showToast('Candidate rejected', 'error');
        else if (status === 'hired') showToast('Candidate hired!', 'success');
        else if (status === 'interviewed') showToast('Marked as interviewed', 'info');
        else showToast(`Status updated to "${status}"`, 'success');
      } else showToast(res.data.error || 'Update failed', 'error');
    } catch (err) { showToast('Update failed', 'error'); }
  }

  // Jump to the Interview tab with this candidate pre-selected so HR can build
  // questions + generate the link, then come back here to send the invite.
  function setUpInterview(s) {
    const jobSel = jobs.find(j => j.id === parseInt(jobId));
    if (jobSel) setSelectedJob({ id: jobSel.id, job_title: jobSel.job_title, department: jobSel.department });
    navigate(`/live-interview?setupCandidate=${s.candidate_id}&setupJob=${s.job_opening_id}`);
  }

  function sendEmail(candidateId, jobOpeningId, candidateName, email, emailType) {
    const jobSel = jobs.find(j => j.id === parseInt(jobId));
    const jobTitle = jobSel?.job_title || 'the position';
    let title, sendType, tmpl;
    if (emailType === 'interview_invite') {
      title = 'Send Interview Invitation'; sendType = 'interview_invite';
      // Auto-fill the link generated earlier in the Interview tab, if any.
      let savedLink = '';
      try { savedLink = localStorage.getItem(`hr_interview_link_${candidateId}`) || ''; } catch {}
      tmpl = getInterviewTemplate(candidateName, jobTitle, savedLink);
      if (!savedLink) showToast('No interview link found yet — set up the interview first, then the link auto-fills here.', 'info');
    }
    else if (emailType === 'offer') { title = 'Send Job Offer'; sendType = 'offer'; tmpl = getOfferTemplate(candidateName, jobTitle); }
    else return;

    openEmailComposer({
      title, description: `Send this email to ${candidateName}.`,
      candidate: { id: candidateId, name: candidateName, email },
      job: { id: jobOpeningId, title: jobTitle }, emailType: sendType,
      defaultSubject: tmpl.subject, defaultBody: tmpl.body,
      sendLabel: 'Send Email', sendClass: 'btn-success', showSendToggle: false,
      editableRecipient: !email, recipientLabel: 'Candidate',
      onSend: async ({ subject, body, recipientEmail: resolvedEmail, attachmentFiles }) => {
        const to = resolvedEmail || email;
        const res = await sendEmailRequest({ candidateId, jobId: jobOpeningId, emailType: sendType, recipientEmail: to, candidateName, jobTitle, subject, body, attachments: attachmentFiles });
        const status = res.data?.status;
        const errMsg = res.data?.error_message || res.data?.error || null;
        const newEntry = { email_type: sendType, status: status || 'failed', sent_at: new Date().toISOString(), subject, body, recipient_email: to, error_message: errMsg, direction: 'outbound' };
        setEmailMap(prev => ({ ...prev, [candidateId]: [newEntry, ...(prev[candidateId] || [])] }));
        if (status === 'sent') showToast(`Email sent to ${to}`, 'success');
        else if (status === 'logged') showToast('Email not sent — SMTP not configured. Email was saved to log only.', 'error');
        else if (status === 'failed') showToast(`Email failed to send: ${errMsg || 'unknown error'}`, 'error');
        else showToast('Email delivery uncertain — check Emails tab for status', 'error');
      },
    });
  }

  function rejectFromShortlist(s) {
    const jobSel = jobs.find(j => j.id === parseInt(jobId)) || {};
    const jobTitle = jobSel?.job_title || 'the position';
    const tmpl = getRejectionTemplate(s.candidate_name, jobTitle);
    openEmailComposer({
      title: 'Reject Candidate', description: `Reject ${s.candidate_name}?`,
      candidate: { id: s.candidate_id, name: s.candidate_name, email: s.email },
      job: { id: s.job_opening_id, title: jobTitle }, emailType: 'rejection',
      defaultSubject: tmpl.subject, defaultBody: tmpl.body,
      sendLabel: 'Reject Candidate', sendClass: 'btn-danger', showSendToggle: true,
      onSend: async ({ subject, body, sendEmail, recipientEmail: resolvedEmail, attachmentFiles }) => {
        await updateStatus(s.id, 'rejected');
        // Use the address resolved by the composer (HR may have typed one for a
        // candidate with no email on file) — not the empty closure variable.
        const to = resolvedEmail || s.email;
        if (sendEmail && to) {
          const res = await sendEmailRequest({ candidateId: s.candidate_id, jobId: s.job_opening_id, emailType: 'rejection', recipientEmail: to, candidateName: s.candidate_name, jobTitle, subject, body, attachments: attachmentFiles });
          const status = res.data?.status;
          const newEntry = { email_type: 'rejection', status: status || 'failed', sent_at: new Date().toISOString(), subject, body, recipient_email: to, error_message: res.data?.error || null, direction: 'outbound' };
          setEmailMap(prev => ({ ...prev, [s.candidate_id]: [newEntry, ...(prev[s.candidate_id] || [])] }));
          if (status === 'sent') showToast(`Rejection email sent to ${to}`, 'error');
          else if (status === 'logged') showToast('Rejected — SMTP not configured, email saved to log only.', 'error');
          else showToast(`Rejected — email failed: ${res.data?.error || 'unknown error'}`, 'error');
        } else {
          showToast('Candidate rejected', 'error');
        }
      },
    });
  }


  // Archive helpers
  const isSlArchived = (id) => !!slArchivedMap[id] || (slPendingArchive && slPendingArchive.id === id);

  function commitSlArchive(id, prevStatus) {
    setSlArchivedMap(prev => {
      const next = { ...prev, [id]: prevStatus };
      localStorage.setItem('hr_shortlist_archived', JSON.stringify(next));
      return next;
    });
  }

  function archiveShortlistItem(id, currentStatus) {
    if (slArchiveTimerRef.current) clearTimeout(slArchiveTimerRef.current);
    if (slPendingArchive) commitSlArchive(slPendingArchive.id, slPendingArchive.prevStatus);
    setSlPendingArchive({ id, prevStatus: currentStatus });
    showToast(
      <span>Candidate archived &mdash; <button className="toast-undo-btn" onClick={() => undoSlArchive()}>Undo</button></span>,
      'info', 5500
    );
    slArchiveTimerRef.current = setTimeout(() => {
      commitSlArchive(id, currentStatus);
      setSlPendingArchive(null);
      slArchiveTimerRef.current = null;
    }, 5000);
  }

  function undoSlArchive() {
    if (!slPendingArchive) return;
    if (slArchiveTimerRef.current) { clearTimeout(slArchiveTimerRef.current); slArchiveTimerRef.current = null; }
    setSlPendingArchive(null);
    showToast('Candidate restored', 'success');
  }

  function restoreSlArchive(id) {
    setSlArchivedMap(prev => {
      const next = { ...prev };
      delete next[id];
      localStorage.setItem('hr_shortlist_archived', JSON.stringify(next));
      return next;
    });
    showToast('Candidate restored', 'success');
  }

  function switchSlFilter(f) { setSlFilter(f); setRetainedInView(new Set()); }

  // Sort: most recently updated first
  const sortedData = [...data].sort((a, b) => {
    if (slSort === 'score') return (parseFloat(b.overall_score) || -1) - (parseFloat(a.overall_score) || -1);
    if (slSort === 'name') return (a.candidate_name || '').localeCompare(b.candidate_name || '');
    const dateA = new Date(a.updated_at || a.shortlisted_at || 0);
    const dateB = new Date(b.updated_at || b.shortlisted_at || 0);
    return dateB - dateA; // most recent (default)
  });

  // "Invited / awaiting interview" is a derived stage (no DB column): a candidate
  // who has had an interview invite emailed but hasn't completed the AI interview
  // yet (still 'shortlisted' — completing one auto-advances them to 'interviewed').
  const invitedSet = new Set(
    Object.entries(emailMap)
      .filter(([, list]) => list.some(e => e.email_type === 'interview_invite' && e.status === 'sent'))
      .map(([cid]) => Number(cid))
  );
  const isInvited = (s) => s.status === 'shortlisted' && invitedSet.has(Number(s.candidate_id));

  // Filter data
  const filteredData = sortedData.filter(s => {
    if (retainedInView.has(s.id)) return true;
    const archived = isSlArchived(s.id);
    if (slFilter === 'all') return true;
    if (slFilter === 'archived') return archived;
    // Shortlisted excludes those already invited so they don't show in two stages.
    if (slFilter === 'shortlisted') return !archived && s.status === 'shortlisted' && !isInvited(s);
    if (slFilter === 'invited') return !archived && isInvited(s);
    if (slFilter === 'interviewed') return !archived && s.status === 'interviewed';
    if (slFilter === 'hired') return !archived && s.status === 'hired';
    if (slFilter === 'rejected') return !archived && s.status === 'rejected';
    return true;
  });

  const shortlisted = data.filter(d => d.status === 'shortlisted' && !isInvited(d)).length;
  const invited = data.filter(d => isInvited(d)).length;
  const interviewed = data.filter(d => d.status === 'interviewed').length;
  const hired = data.filter(d => d.status === 'hired').length;
  const rejected = data.filter(d => d.status === 'rejected').length;

  return (
    <div className="container">
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <label style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap' }}>Select Job:</label>
        <Select
          value={jobId}
          onChange={handleJobChange}
          placeholder="Select a job opening…"
          style={{ minWidth: 280, maxWidth: 360 }}
          options={[
            ...jobs.filter(j => j.is_active).map(j => ({ value: j.id, label: `${j.job_title} — ${j.department}` })),
            ...jobs.filter(j => !j.is_active).map(j => ({ value: j.id, label: `${j.job_title} — ${j.department}`, badge: 'inactive', disabled: true })),
          ]}
        />
        <button className="btn btn-secondary btn-sm" onClick={loadShortlist}>Refresh</button>
      </div>

      {!loading && jobId && data.length > 0 && (
        <div className="results-filter-bar">
          <span className="results-filter-label">Show:</span>
          {[
            { key: 'all', label: 'All', count: data.length },
            { key: 'shortlisted', label: 'Shortlisted', count: data.filter(d => !isSlArchived(d.id) && d.status === 'shortlisted' && !isInvited(d)).length },
            { key: 'invited', label: 'Invited', count: data.filter(d => !isSlArchived(d.id) && isInvited(d)).length },
            { key: 'interviewed', label: 'Interviewed', count: data.filter(d => !isSlArchived(d.id) && d.status === 'interviewed').length },
            { key: 'hired', label: 'Hired', count: data.filter(d => !isSlArchived(d.id) && d.status === 'hired').length },
            { key: 'rejected', label: 'Rejected', count: data.filter(d => !isSlArchived(d.id) && d.status === 'rejected').length },
            { key: 'archived', label: 'Archived', count: data.filter(d => isSlArchived(d.id)).length },
          ].map(f => (
            <button key={f.key} className={`results-filter-btn${slFilter === f.key ? ' active' : ''}`} onClick={() => switchSlFilter(f.key)}>
              {f.label}
              <span className="results-filter-count">{f.count}</span>
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>Sort by</span>
            <select value={slSort} onChange={e => setSlSort(e.target.value)}
              style={{ width: 150, flexShrink: 0, padding: '7px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--surface)', cursor: 'pointer' }}>
              <option value="recent">Most recent</option>
              <option value="score">Highest score</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
        </div>
      )}

      {loading ? <Loading /> : !jobId ? <EmptyState>Select a job opening to view shortlisted candidates.</EmptyState> : data.length === 0 ? <EmptyState>No shortlisted candidates yet. Go to CV Evaluation to shortlist candidates.</EmptyState> : filteredData.length === 0 ? <EmptyState>No candidates match this filter.</EmptyState> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredData.map(s => {
            const archived = isSlArchived(s.id);
            const invited = isInvited(s);
            const isOpen = expanded === s.id;
            const emails = emailMap[s.candidate_id] || [];
            const hasEmailSent = emails.some(e => e.status === 'sent' && e.direction !== 'inbound');
            const overall = s.overall_score != null ? parseFloat(s.overall_score) : null;
            const tint = s.status === 'hired' ? 'var(--tint-success)' : s.status === 'rejected' ? 'var(--tint-danger)' : 'var(--surface)';
            const statusLabel = archived ? 'archived' : invited ? 'invited' : s.status;
            return (
              <div key={s.id} style={{
                background: tint, border: `1px solid ${isOpen ? '#bfdbfe' : 'var(--gray-200)'}`,
                borderRadius: 12, overflow: 'hidden',
                boxShadow: isOpen ? '0 4px 16px rgba(37,99,235,0.08)' : '0 1px 2px rgba(0,0,0,0.04)',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}>
                {/* Header row */}
                <div onClick={() => setExpanded(isOpen ? null : s.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: 'pointer', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, color: 'var(--gray-900)' }}>{s.candidate_name}</strong>
                      <Badge type={s.status}>{statusLabel}</Badge>
                      {invited && <span style={SL_CHIP('#fef3c7', '#92400e')}>✉ Awaiting interview</span>}
                      {hasEmailSent && !invited && <span style={SL_CHIP('#dcfce7', '#166534')}>✉ Notified</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 2 }}>
                      {s.email || '—'} · Shortlisted {new Date(s.shortlisted_at).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Stage actions — inline (no overflow menu, which gets clipped by
                      the card's overflow:hidden). Secondary actions live in the
                      expanded panel, consistent with the other tabs. */}
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                    {archived ? (
                      <button className="btn btn-sm btn-secondary" onClick={() => restoreSlArchive(s.id)}>Restore</button>
                    ) : (s.status === 'shortlisted' || s.status === 'interviewed') ? (
                      <>
                        {s.status === 'interviewed' && <button className="btn btn-sm btn-primary" onClick={() => navigate('/live-interview?tab=results')} title="See the interview scores, transcript and recording">📊 Results</button>}
                        <button className={`btn btn-sm ${s.status === 'interviewed' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setUpInterview(s)}>⚙ Set Up Interview</button>
                        <button className="btn btn-sm btn-success" onClick={() => sendEmail(s.candidate_id, s.job_opening_id, s.candidate_name, s.email, 'interview_invite')}>Send Invite</button>
                        <button className="btn btn-sm btn-danger" onClick={() => rejectFromShortlist(s)}>Reject</button>
                      </>
                    ) : s.status === 'hired' ? (
                      <>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>✓ Hired</span>
                        <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(s.id, 'interviewed')} title="Undo — move back to Interviewed">↩ Revert</button>
                      </>
                    ) : s.status === 'rejected' ? (
                      <>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#991b1b' }}>✗ Rejected</span>
                        <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(s.id, 'shortlisted')}>Reconsider</button>
                      </>
                    ) : null}
                  </div>

                  {/* CV score */}
                  <div style={{ textAlign: 'center', minWidth: 50, borderLeft: '1px solid var(--gray-200)', paddingLeft: 14 }}>
                    {overall != null
                      ? <div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(overall), lineHeight: 1 }}>{overall.toFixed(1)}</div>
                      : <div style={{ fontSize: 18, color: 'var(--gray-300)' }}>—</div>}
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--gray-400)', marginTop: 3 }}>CV</div>
                  </div>
                  <span style={{ color: 'var(--gray-400)', fontSize: 13, flexShrink: 0, transition: 'transform 0.25s ease', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                </div>

                {/* Smooth-expanding detail */}
                <div style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.28s ease' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ borderTop: '1px solid var(--gray-100)', background: 'var(--surface-2)', padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {/* CV side */}
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>CV Evaluation</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <SlChip value={s.skills_score} label="Skills" />
                          <SlChip value={s.experience_score} label="Experience" />
                          <SlChip value={s.education_score} label="Education" />
                        </div>
                        {s.strengths && <SlCallout label="Strengths" text={s.strengths} color="#166534" />}
                        {s.weaknesses && <SlCallout label="Weaknesses" text={s.weaknesses} color="#991b1b" />}
                        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => setProfileCandidate(s)}>View full profile</button>
                          {!archived && <button className="btn btn-sm btn-ghost" onClick={() => archiveShortlistItem(s.id, s.status)}>Archive</button>}
                        </div>
                      </div>
                      {/* Communication side */}
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 10, padding: 16 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Communication</div>
                        {emails.length === 0 ? (
                          <p style={{ fontSize: 13, color: 'var(--gray-400)', fontStyle: 'italic', margin: 0 }}>No emails yet.</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {emails.map((e, i) => {
                              const inbound = e.direction === 'inbound';
                              const accent = inbound ? '#7c3aed' : e.status === 'sent' ? '#16a34a' : '#dc2626';
                              return (
                                <div key={i} style={{ fontSize: 12.5, borderLeft: `3px solid ${accent}`, paddingLeft: 10 }}>
                                  <div style={{ fontWeight: 600, color: 'var(--gray-800)' }}>
                                    {inbound ? `📥 Reply from ${e.recipient_email || 'sender'}` : emailTypeLabel(e.email_type)}
                                    <span style={{ fontWeight: 500, color: 'var(--gray-400)' }}> · {inbound ? 'inbound' : e.status}{e.sent_at ? ` · ${new Date(e.sent_at).toLocaleDateString()}` : ''}</span>
                                  </div>
                                  {e.subject && <div style={{ color: 'var(--gray-500)' }}>{e.subject}</div>}
                                  {e.error_message && <div style={{ color: '#991b1b' }}>{e.error_message}</div>}
                                </div>
                              );
                            })}
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
      )}

      {/* Shortlist rows use id = shortlist row id; the modal (and its
          Email-Recommendation flow) expects id = candidate id, plus the job
          for /send-email's job_opening_id. Remap before passing down. */}
      <EvalDetailModal
        candidate={profileCandidate ? { ...profileCandidate, id: profileCandidate.candidate_id } : null}
        allCandidates={data}
        job={jobs.find(j => j.id === parseInt(jobId)) || null}
        isOpen={!!profileCandidate}
        onClose={() => setProfileCandidate(null)}
      />

    </div>
  );
}
