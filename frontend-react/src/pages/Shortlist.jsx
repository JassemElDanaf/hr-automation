import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import StatCard from '../components/common/StatCard';
import Badge from '../components/common/Badge';
import ScoreBadge from '../components/common/ScoreBadge';
import EmptyState from '../components/common/EmptyState';
import Loading from '../components/common/Loading';
import { sendEmailRequest, getShortlistTemplate, getInterviewTemplate, getOfferTemplate, getRejectionTemplate, getEmailStatus } from '../services/email';
import { emailTypeLabel } from '../utils/helpers';
import EvalDetailModal from '../components/modals/EvalDetailModal';
import InterviewQuestionsModal from '../components/modals/InterviewQuestionsModal';

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

export default function Shortlist() {
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast, openEmailComposer } = useUI();
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
  const [interviewPrep, setInterviewPrep] = useState(null); // { candidate, job } for the prep-before-handoff modal
  const [transitioning, setTransitioning] = useState({}); // id -> true while animation plays
  const [retainedInView, setRetainedInView] = useState(new Set()); // keep card visible after state change

  useEffect(() => { loadJobs(); }, []);

  useEffect(() => {
    if (selectedJob && !jobId) {
      setJobId(String(selectedJob.id));
    }
  }, [selectedJob]);

  useEffect(() => {
    if (jobId) loadShortlist();
  }, [jobId]);

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
      const [slRes, emRes] = await Promise.all([
        apiGet(`/shortlist?job_id=${jobId}`),
        apiGet(`/email-history?job_id=${jobId}`).catch(() => ({ data: { data: [] } })),
      ]);
      setData(slRes.data || []);
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

  function sendEmail(candidateId, jobOpeningId, candidateName, email, emailType) {
    const jobSel = jobs.find(j => j.id === parseInt(jobId));
    const jobTitle = jobSel?.job_title || 'the position';
    let title, sendType, tmpl;
    if (emailType === 'shortlisted') { title = 'Send Shortlist Notification'; sendType = 'custom'; tmpl = getShortlistTemplate(candidateName, jobTitle); }
    else if (emailType === 'interview_invite') { title = 'Send Interview Invitation'; sendType = 'interview_invite'; tmpl = getInterviewTemplate(candidateName, jobTitle); }
    else if (emailType === 'offer') { title = 'Send Job Offer'; sendType = 'offer'; tmpl = getOfferTemplate(candidateName, jobTitle); }
    else return;

    openEmailComposer({
      title, description: `Send this email to ${candidateName}.`,
      candidate: { id: candidateId, name: candidateName, email },
      job: { id: jobOpeningId, title: jobTitle }, emailType: sendType,
      defaultSubject: tmpl.subject, defaultBody: tmpl.body,
      sendLabel: 'Send Email', sendClass: 'btn-success', showSendToggle: false,
      editableRecipient: !email, recipientLabel: 'Candidate',
      onSend: async ({ subject, body, recipientEmail: resolvedEmail }) => {
        const to = resolvedEmail || email;
        const res = await sendEmailRequest({ candidateId, jobId: jobOpeningId, emailType: sendType, recipientEmail: to, candidateName, jobTitle, subject, body });
        const status = res.data?.status;
        const errMsg = res.data?.error_message || res.data?.error || null;
        const newEntry = { email_type: sendType, status: status || 'failed', sent_at: new Date().toISOString(), subject, body, recipient_email: to, error_message: errMsg, direction: 'outbound' };
        setEmailMap(prev => ({ ...prev, [candidateId]: [newEntry, ...(prev[candidateId] || [])] }));
        if (status === 'sent') showToast(`Email sent to ${to}`, 'success');
        else if (status === 'logged') showToast('Email not sent \u2014 SMTP not configured. Email was saved to log only.', 'error');
        else if (status === 'failed') showToast(`Email failed to send: ${errMsg || 'unknown error'}`, 'error');
        else showToast('Email delivery uncertain \u2014 check Emails tab for status', 'error');
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
      onSend: async ({ subject, body, sendEmail, recipientEmail: resolvedEmail }) => {
        await updateStatus(s.id, 'rejected');
        // Use the address resolved by the composer (HR may have typed one for a
        // candidate with no email on file) — not the empty closure variable.
        const to = resolvedEmail || s.email;
        if (sendEmail && to) {
          const res = await sendEmailRequest({ candidateId: s.candidate_id, jobId: s.job_opening_id, emailType: 'rejection', recipientEmail: to, candidateName: s.candidate_name, jobTitle, subject, body });
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

  // Hand Off chains through the interview-prep modal (set meeting + generate questions)
  // and then opens the email composer with the full pack. The HM email is the moment HR
  // formally transfers ownership, so we want HR to walk through prep first instead of
  // sending a bare evaluation summary.
  function handOffToHM(s) {
    const jobSel = jobs.find(j => j.id === parseInt(jobId)) || {};
    const candidateForModal = {
      id: s.candidate_id,
      candidate_name: s.candidate_name,
      email: s.email,
      overall_score: s.overall_score,
      skills_score: s.skills_score,
      experience_score: s.experience_score,
      education_score: s.education_score,
      strengths: s.strengths,
      weaknesses: s.weaknesses,
      reasoning: s.reasoning,
    };
    setInterviewPrep({ candidate: candidateForModal, job: jobSel });
  }

  function handlePackSent(candidateId, newEntry) {
    setEmailMap(prev => ({ ...prev, [candidateId]: [newEntry, ...(prev[candidateId] || [])] }));
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

  // "Handed off to HM" is a derived stage — any candidate with at least one
  // successfully-sent recommendation email is considered handed off, regardless
  // of their underlying shortlist.status. Lets us add the new tab without a
  // schema migration. The Shortlisted / Interviewed pills exclude these
  // candidates so they aren't double-counted.
  const isHandedOff = (candidateId) => {
    const emails = emailMap[candidateId];
    // Only outbound recommendation rows count — an inbound row threaded back to
    // a recommendation parent must not toggle handoff state on its own.
    return !!(emails && emails.some(e => e.email_type === 'recommendation' && e.status === 'sent' && e.direction !== 'inbound'));
  };

  // Sort: most recently updated first
  const sortedData = [...data].sort((a, b) => {
    const dateA = new Date(a.updated_at || a.shortlisted_at || 0);
    const dateB = new Date(b.updated_at || b.shortlisted_at || 0);
    return dateB - dateA;
  });

  // Filter data
  const filteredData = sortedData.filter(s => {
    if (retainedInView.has(s.id)) return true;
    const archived = isSlArchived(s.id);
    const handedOff = isHandedOff(s.candidate_id);
    if (slFilter === 'all') return true;
    if (slFilter === 'archived') return archived;
    if (slFilter === 'handed_off') return !archived && handedOff && s.status !== 'hired' && s.status !== 'rejected';
    // Shortlisted / Interviewed pills hide handed-off cards so the same candidate
    // doesn't appear in two pipeline stages at once. Hired / Rejected are terminal
    // verdicts and trump handoff state.
    if (slFilter === 'shortlisted') return !archived && !handedOff && s.status === 'shortlisted';
    if (slFilter === 'interviewed') return !archived && !handedOff && s.status === 'interviewed';
    if (slFilter === 'hired') return !archived && s.status === 'hired';
    if (slFilter === 'rejected') return !archived && s.status === 'rejected';
    return true;
  });

  const handedOffCount = data.filter(d => !isSlArchived(d.id) && isHandedOff(d.candidate_id) && d.status !== 'hired' && d.status !== 'rejected').length;
  const shortlisted = data.filter(d => d.status === 'shortlisted' && !isHandedOff(d.candidate_id)).length;
  const interviewed = data.filter(d => d.status === 'interviewed' && !isHandedOff(d.candidate_id)).length;
  const hired = data.filter(d => d.status === 'hired').length;
  const rejected = data.filter(d => d.status === 'rejected').length;

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Shortlist & Interview Tracking</h2>
          <p style={{ fontSize: '13px', color: 'var(--gray-500)' }}>Manage shortlisted candidates through the hiring pipeline.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
        <label style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap' }}>Select Job:</label>
        <select value={jobId} onChange={e => handleJobChange(e.target.value)} style={{ maxWidth: '350px' }}>
          <option value="">-- Select a job opening --</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.job_title} &mdash; {j.department}</option>)}
        </select>
        <button className="btn btn-secondary btn-sm" onClick={loadShortlist}>Refresh</button>
      </div>

      <div className="stats">
        <StatCard label="Shortlisted" value={shortlisted || '-'} />
        <StatCard label="Interviewed" value={interviewed || '-'} />
        <StatCard label="Handed off" value={handedOffCount || '-'} />
        <StatCard label="Hired" value={hired || '-'} />
        <StatCard label="Rejected" value={rejected || '-'} />
      </div>

      {!loading && jobId && data.length > 0 && (
        <div className="results-filter-bar">
          <span className="results-filter-label">Show:</span>
          {[
            { key: 'all', label: 'All', count: data.length },
            { key: 'shortlisted', label: 'Shortlisted', count: data.filter(d => !isSlArchived(d.id) && !isHandedOff(d.candidate_id) && d.status === 'shortlisted').length },
            { key: 'interviewed', label: 'Interviewed', count: data.filter(d => !isSlArchived(d.id) && !isHandedOff(d.candidate_id) && d.status === 'interviewed').length },
            { key: 'handed_off', label: 'Handed off', count: data.filter(d => !isSlArchived(d.id) && isHandedOff(d.candidate_id) && d.status !== 'hired' && d.status !== 'rejected').length },
            { key: 'hired', label: 'Hired', count: data.filter(d => !isSlArchived(d.id) && d.status === 'hired').length },
            { key: 'rejected', label: 'Rejected', count: data.filter(d => !isSlArchived(d.id) && d.status === 'rejected').length },
            { key: 'archived', label: 'Archived', count: data.filter(d => isSlArchived(d.id)).length },
          ].map(f => (
            <button key={f.key} className={`results-filter-btn${slFilter === f.key ? ' active' : ''}`} onClick={() => switchSlFilter(f.key)}>
              {f.label}
              <span className="results-filter-count">{f.count}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? <Loading /> : !jobId ? <EmptyState>Select a job opening to view shortlisted candidates.</EmptyState> : data.length === 0 ? <EmptyState>No shortlisted candidates yet. Go to CV Evaluation to shortlist candidates.</EmptyState> : filteredData.length === 0 ? <EmptyState>No candidates match this filter.</EmptyState> : (
        <div>
          {filteredData.map(s => {
            const score = s.overall_score != null ? parseFloat(s.overall_score).toFixed(1) : '\u2014';
            const scoreClsName = s.overall_score >= 7 ? 'score-high' : s.overall_score >= 4 ? 'score-mid' : 'score-low';
            const isAnimating = !!transitioning[s.id];
            const candidateEmails = emailMap[s.candidate_id];
            const hasEmailSent = candidateEmails && candidateEmails.some(e => e.status === 'sent' && e.direction !== 'inbound');
            const handedOff = isHandedOff(s.candidate_id) && s.status !== 'hired' && s.status !== 'rejected';
            const cardCls = [
              'candidate-card',
              `candidate-card--${s.status}`,
              handedOff ? 'candidate-card--handed-off' : '',
              hasEmailSent && s.status === 'shortlisted' && !handedOff ? 'candidate-card--notified' : '',
              isAnimating ? 'candidate-card--transitioning' : '',
            ].filter(Boolean).join(' ');

            return (
              <div key={s.id} className={cardCls}>
                {/* Status chip in top-right corner */}
                {(s.status !== 'shortlisted' || isAnimating) && !isSlArchived(s.id) && (
                  <span className={`card-status-chip card-status-chip--${s.status}`}>
                    {s.status === 'shortlisted' ? '\u2713 Shortlisted' : s.status === 'interviewed' ? '\u2713 Interviewed' : s.status === 'hired' ? '\u2713 Hired' : '\u2717 Rejected'}
                  </span>
                )}
                <div className="candidate-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h3>{s.candidate_name}</h3>
                    <Badge type={s.status}>{s.status}</Badge>
                    {handedOff
                      ? <span className="card-handoff-chip">{'\u2709'} Handed off to HM</span>
                      : (hasEmailSent && <span className="card-notified-chip">{'\u2709'} Notified</span>)
                    }
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => setProfileCandidate(s)}>View Profile</button>
                    <span className={`score-badge ${scoreClsName}`}>{score}</span>
                  </div>
                </div>
                <div className="candidate-meta">
                  {s.email || '\u2014'} &middot; Shortlisted {new Date(s.shortlisted_at).toLocaleDateString()}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '12px' }}>
                  {[{ label: 'SKILLS', val: s.skills_score }, { label: 'EXPERIENCE', val: s.experience_score }, { label: 'EDUCATION', val: s.education_score }].map(sc => (
                    <div key={sc.label} style={{ background: 'var(--gray-50)', padding: '8px 12px', borderRadius: 'var(--radius)', textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: 'var(--gray-500)', fontWeight: 600 }}>{sc.label}</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--gray-800)' }}>{sc.val != null ? parseFloat(sc.val).toFixed(1) : '\u2014'}</div>
                    </div>
                  ))}
                </div>
                {s.strengths && <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--gray-600)' }}><strong style={{ color: '#166534' }}>Strengths:</strong> {s.strengths}</div>}
                {(() => {
                  const emails = emailMap[s.candidate_id];
                  if (!emails || emails.length === 0) return null;
                  const em = emails[0]; // latest
                  const getStatusText = (e) => e.status === 'sent' ? 'sent' : e.status === 'failed' ? 'failed' : e.status === 'logged' ? 'not sent (logged only)' : e.status;
                  const isInbound = em.direction === 'inbound';
                  const isSent = em.status === 'sent';
                  const isFailed = em.status === 'failed';
                  const isLogged = em.status === 'logged';
                  const isHandoffEmail = em.email_type === 'recommendation' && isSent;
                  const time = em.sent_at ? new Date(em.sent_at).toLocaleString() : '';
                  const isExpanded = !!expandedEmail[s.candidate_id];
                  const bannerCls = isInbound ? 'sl-email-inbound'
                    : isFailed || isLogged ? 'sl-email-failed'
                    : isHandoffEmail ? 'sl-email-handoff'
                    : isSent ? 'sl-email-sent' : '';
                  return (
                    <div className="sl-email-wrapper">
                      <div
                        className={`sl-email-status sl-email-clickable ${bannerCls}`}
                        onClick={() => setExpandedEmail(prev => ({ ...prev, [s.candidate_id]: !prev[s.candidate_id] }))}
                      >
                        <span className="sl-email-icon">{isInbound ? '\u{1F4E5}' : isSent ? '\u2709' : '\u26A0'}</span>
                        <span style={{ flex: 1 }}>
                          {isInbound ? (
                            <><strong>Reply from {em.recipient_email || 'sender'}</strong>{em.subject && <span style={{ color: 'var(--gray-600)' }}> &middot; {em.subject}</span>}</>
                          ) : (
                            <><strong>{emailTypeLabel(em.email_type)}</strong> {getStatusText(em)}</>
                          )}
                          {time && <span className="sl-email-time"> &middot; {time}</span>}
                        </span>
                        <span className="sl-email-toggle">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                      </div>
                      {isExpanded && (
                        <div className="sl-email-details">
                          {emails.map((e, i) => {
                            const inbound = e.direction === 'inbound';
                            const itemCls = inbound ? 'sl-detail-inbound'
                              : e.status === 'sent' ? 'sl-detail-sent'
                              : e.status === 'failed' || e.status === 'logged' ? 'sl-detail-failed' : '';
                            return (
                              <div key={i} className={`sl-email-detail-item ${itemCls}`}>
                                <div className="sl-email-detail-header">
                                  <strong>{inbound ? 'Reply received' : emailTypeLabel(e.email_type)}</strong>
                                  <span className={`sl-email-detail-badge sl-email-detail-badge--${inbound ? 'inbound' : e.status}`}>
                                    {inbound ? '\u{1F4E5} Inbound' : e.status === 'sent' ? '\u2713 Sent' : e.status === 'failed' ? '\u2717 Failed' : e.status === 'logged' ? '\u26A0 Logged only' : e.status}
                                  </span>
                                </div>
                                {e.recipient_email && <div className="sl-email-detail-row"><span className="sl-email-detail-label">{inbound ? 'From:' : 'To:'}</span> {e.recipient_email}</div>}
                                {e.subject && <div className="sl-email-detail-row"><span className="sl-email-detail-label">Subject:</span> {e.subject}</div>}
                                {e.sent_at && <div className="sl-email-detail-row"><span className="sl-email-detail-label">Date:</span> {new Date(e.sent_at).toLocaleString()}</div>}
                                {e.error_message && <div className="sl-email-detail-row sl-email-detail-error"><span className="sl-email-detail-label">Error:</span> {e.error_message}</div>}
                                {e.body && <div className="sl-email-detail-body"><pre>{e.body}</pre></div>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="card-actions-area">
                  {isSlArchived(s.id) ? (
                    <>
                      <span style={{ fontSize: '13px', color: 'var(--gray-400)', fontWeight: 600 }}>Archived ({slArchivedMap[s.id] || s.status})</span>
                      <button className="btn btn-sm btn-secondary" onClick={() => restoreSlArchive(s.id)}>Restore</button>
                    </>
                  ) : handedOff ? (<>
                    {/* Once handed off to HM, decisions belong here. Hire / Reject are
                        the HM-driven verdicts. Re-send Pack lets HR forward the same
                        materials again (e.g. after fixing an interviewer email). */}
                    <button className="btn btn-sm btn-success" onClick={() => updateStatus(s.id, 'hired')}>{'\u2713'} Hire</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => sendEmail(s.candidate_id, s.job_opening_id, s.candidate_name, s.email, 'offer')}>Send Offer</button>
                    <button className="btn btn-sm btn-danger" onClick={() => rejectFromShortlist(s)}>{'\u2717'} Reject</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handOffToHM(s)}>Re-send Pack</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => archiveShortlistItem(s.id, s.status)}>Archive</button>
                  </>) : (<>
                    {s.status === 'shortlisted' && <>
                      <button className="btn btn-sm btn-primary" onClick={() => updateStatus(s.id, 'interviewed')}>Mark Interviewed</button>
                      <button className="btn btn-sm btn-success" onClick={() => sendEmail(s.candidate_id, s.job_opening_id, s.candidate_name, s.email, 'shortlisted')}>Email Shortlist</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => sendEmail(s.candidate_id, s.job_opening_id, s.candidate_name, s.email, 'interview_invite')}>Interview Invite</button>
                      <button className="btn btn-sm btn-primary" onClick={() => handOffToHM(s)}>{'\u2709'} Hand Off to HM</button>
                      <button className="btn btn-sm btn-danger" onClick={() => rejectFromShortlist(s)}>{'\u2717'} Reject</button>
                    </>}
                    {s.status === 'interviewed' && <>
                      <button className="btn btn-sm btn-primary" onClick={() => handOffToHM(s)}>{'\u2709'} Hand Off to HM</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(s.id, 'shortlisted')}>Back to Shortlist</button>
                      <button className="btn btn-sm btn-danger" onClick={() => rejectFromShortlist(s)}>{'\u2717'} Reject</button>
                    </>}
                    {s.status === 'hired' && <>
                      <span className="card-state-badge card-state-badge--hired card-state-badge--enter">{'\u2713'} Hired</span>
                      <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(s.id, 'interviewed')}>Revert to Interviewed</button>
                    </>}
                    {s.status === 'rejected' && <>
                      <span className="card-state-badge card-state-badge--rejected card-state-badge--enter">{'\u2717'} Rejected</span>
                      <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(s.id, 'shortlisted')}>Reconsider</button>
                    </>}
                    <button className="btn btn-sm btn-ghost" onClick={() => archiveShortlistItem(s.id, s.status)}>Archive</button>
                  </>)}
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

      <InterviewQuestionsModal
        candidate={interviewPrep?.candidate}
        job={interviewPrep?.job}
        isOpen={!!interviewPrep}
        onClose={() => setInterviewPrep(null)}
        onPackSent={handlePackSent}
      />
    </div>
  );
}
