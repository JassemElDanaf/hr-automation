import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import StatCard from '../components/common/StatCard';
import Badge from '../components/common/Badge';
import ScoreBadge from '../components/common/ScoreBadge';
import EmptyState from '../components/common/EmptyState';
import Loading from '../components/common/Loading';
import { sendEmailRequest, getShortlistTemplate, getInterviewTemplate, getOfferTemplate } from '../services/email';

export default function Shortlist() {
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast, openEmailComposer } = useUI();
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [slFilter, setSlFilter] = useState('all');
  const [slArchivedMap, setSlArchivedMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hr_shortlist_archived') || '{}'); } catch { return {}; }
  });
  const [slPendingArchive, setSlPendingArchive] = useState(null);
  const slArchiveTimerRef = useRef(null);
  const [emailMap, setEmailMap] = useState({}); // candidate_id -> [{ email_type, status, sent_at, subject, body, recipient_email, error_message }, ...]
  const [expandedEmail, setExpandedEmail] = useState({}); // candidate_id -> true if email details expanded
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
      onSend: async ({ subject, body }) => {
        const res = await sendEmailRequest({ candidateId, jobId: jobOpeningId, emailType: sendType, recipientEmail: email, candidateName, jobTitle, subject, body });
        const status = res.data?.status;
        // Update email map immediately for this candidate
        const newEntry = { email_type: sendType, status: status || 'failed', sent_at: new Date().toISOString(), subject, body, recipient_email: email, error_message: res.data?.error || null };
        setEmailMap(prev => ({ ...prev, [candidateId]: [newEntry, ...(prev[candidateId] || [])] }));
        if (status === 'sent') showToast(`Email sent to ${email}`, 'success');
        else if (status === 'logged') showToast('Email not sent \u2014 SMTP not configured. Email was saved to log only.', 'error');
        else if (status === 'failed') showToast(`Email failed to send: ${res.data?.error || 'unknown error'}`, 'error');
        else showToast('Email delivery uncertain \u2014 check Emails tab for status', 'error');
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
    const dateA = new Date(a.updated_at || a.shortlisted_at || 0);
    const dateB = new Date(b.updated_at || b.shortlisted_at || 0);
    return dateB - dateA;
  });

  // Filter data
  const filteredData = sortedData.filter(s => {
    if (retainedInView.has(s.id)) return true;
    const archived = isSlArchived(s.id);
    if (slFilter === 'all') return true;
    if (slFilter === 'archived') return archived;
    if (slFilter === 'shortlisted') return !archived && s.status === 'shortlisted';
    if (slFilter === 'interviewed') return !archived && s.status === 'interviewed';
    if (slFilter === 'hired') return !archived && s.status === 'hired';
    if (slFilter === 'rejected') return !archived && s.status === 'rejected';
    return true;
  });

  const shortlisted = data.filter(d => d.status === 'shortlisted').length;
  const interviewed = data.filter(d => d.status === 'interviewed').length;
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
        <StatCard label="Hired" value={hired || '-'} />
        <StatCard label="Rejected" value={rejected || '-'} />
      </div>

      {!loading && jobId && data.length > 0 && (
        <div className="results-filter-bar">
          <span className="results-filter-label">Show:</span>
          {[
            { key: 'all', label: 'All', count: data.length },
            { key: 'shortlisted', label: 'Shortlisted', count: data.filter(d => !isSlArchived(d.id) && d.status === 'shortlisted').length },
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
        </div>
      )}

      {loading ? <Loading /> : !jobId ? <EmptyState>Select a job opening to view shortlisted candidates.</EmptyState> : data.length === 0 ? <EmptyState>No shortlisted candidates yet. Go to CV Evaluation to shortlist candidates.</EmptyState> : filteredData.length === 0 ? <EmptyState>No candidates match this filter.</EmptyState> : (
        <div>
          {filteredData.map(s => {
            const score = s.overall_score != null ? parseFloat(s.overall_score).toFixed(1) : '\u2014';
            const scoreClsName = s.overall_score >= 7 ? 'score-high' : s.overall_score >= 4 ? 'score-mid' : 'score-low';
            const hasEmail = s.email && s.email.includes('@');
            const isDecided = s.status === 'hired' || s.status === 'rejected';
            const isAnimating = !!transitioning[s.id];
            const candidateEmails = emailMap[s.candidate_id];
            const hasEmailSent = candidateEmails && candidateEmails.some(e => e.status === 'sent');
            const cardCls = [
              'candidate-card',
              `candidate-card--${s.status}`,
              hasEmailSent && s.status === 'shortlisted' ? 'candidate-card--notified' : '',
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
                    {hasEmailSent && <span className="card-notified-chip">{'\u2709'} Notified</span>}
                  </div>
                  <span className={`score-badge ${scoreClsName}`}>{score}</span>
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
                  const getTypeLabel = (e) => e.email_type === 'custom' ? 'Shortlist email' : e.email_type === 'interview_invite' ? 'Interview invite' : e.email_type === 'offer' ? 'Job offer' : e.email_type === 'rejection' ? 'Rejection email' : e.email_type || 'Email';
                  const getStatusText = (e) => e.status === 'sent' ? 'sent' : e.status === 'failed' ? 'failed' : e.status === 'logged' ? 'not sent (logged only)' : e.status;
                  const isSent = em.status === 'sent';
                  const isFailed = em.status === 'failed';
                  const isLogged = em.status === 'logged';
                  const time = em.sent_at ? new Date(em.sent_at).toLocaleString() : '';
                  const isExpanded = !!expandedEmail[s.candidate_id];
                  return (
                    <div className="sl-email-wrapper">
                      <div
                        className={`sl-email-status sl-email-clickable ${isFailed || isLogged ? 'sl-email-failed' : isSent ? 'sl-email-sent' : ''}`}
                        onClick={() => setExpandedEmail(prev => ({ ...prev, [s.candidate_id]: !prev[s.candidate_id] }))}
                      >
                        <span className="sl-email-icon">{isSent ? '\u2709' : '\u26A0'}</span>
                        <span style={{ flex: 1 }}>
                          <strong>{getTypeLabel(em)}</strong> {getStatusText(em)}
                          {time && <span className="sl-email-time"> &middot; {time}</span>}
                        </span>
                        <span className="sl-email-toggle">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                      </div>
                      {isExpanded && (
                        <div className="sl-email-details">
                          {emails.map((e, i) => (
                            <div key={i} className={`sl-email-detail-item ${e.status === 'sent' ? 'sl-detail-sent' : e.status === 'failed' || e.status === 'logged' ? 'sl-detail-failed' : ''}`}>
                              <div className="sl-email-detail-header">
                                <strong>{getTypeLabel(e)}</strong>
                                <span className={`sl-email-detail-badge sl-email-detail-badge--${e.status}`}>{e.status === 'sent' ? '\u2713 Sent' : e.status === 'failed' ? '\u2717 Failed' : e.status === 'logged' ? '\u26A0 Logged only' : e.status}</span>
                              </div>
                              {e.recipient_email && <div className="sl-email-detail-row"><span className="sl-email-detail-label">To:</span> {e.recipient_email}</div>}
                              {e.subject && <div className="sl-email-detail-row"><span className="sl-email-detail-label">Subject:</span> {e.subject}</div>}
                              {e.sent_at && <div className="sl-email-detail-row"><span className="sl-email-detail-label">Date:</span> {new Date(e.sent_at).toLocaleString()}</div>}
                              {e.error_message && <div className="sl-email-detail-row sl-email-detail-error"><span className="sl-email-detail-label">Error:</span> {e.error_message}</div>}
                              {e.body && <div className="sl-email-detail-body"><pre>{e.body}</pre></div>}
                            </div>
                          ))}
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
                  ) : (<>
                    {s.status === 'shortlisted' && <>
                      <button className="btn btn-sm btn-primary" onClick={() => updateStatus(s.id, 'interviewed')}>Mark Interviewed</button>
                      {hasEmail && <button className="btn btn-sm btn-success" onClick={() => sendEmail(s.candidate_id, s.job_opening_id, s.candidate_name, s.email, 'shortlisted')}>Email Shortlist</button>}
                      {hasEmail && <button className="btn btn-sm btn-secondary" onClick={() => sendEmail(s.candidate_id, s.job_opening_id, s.candidate_name, s.email, 'interview_invite')}>Interview Invite</button>}
                      <button className="btn btn-sm btn-danger" onClick={() => updateStatus(s.id, 'rejected')}>Reject</button>
                    </>}
                    {s.status === 'interviewed' && <>
                      <button className="btn btn-sm btn-success" onClick={() => updateStatus(s.id, 'hired')}>Hire</button>
                      {hasEmail && <button className="btn btn-sm btn-success" onClick={() => sendEmail(s.candidate_id, s.job_opening_id, s.candidate_name, s.email, 'offer')}>Send Offer</button>}
                      <button className="btn btn-sm btn-danger" onClick={() => updateStatus(s.id, 'rejected')}>Reject</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(s.id, 'shortlisted')}>Back to Shortlist</button>
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
    </div>
  );
}
