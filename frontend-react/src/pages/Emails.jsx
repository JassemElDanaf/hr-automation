import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import Badge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import Loading from '../components/common/Loading';
import Select from '../components/common/Select';
import ShowSelect from '../components/common/ShowSelect';
import Modal from '../components/modals/Modal';
import { sendEmailRequest, getEmailStatus, buildEmailHtml } from '../services/email';
import { formatDate, emailTypeLabel as baseEmailTypeLabel } from '../utils/helpers';

// Emails tab uses a shorter label for the recommendation/handoff type.
const emailTypeLabel = (t) => t === 'recommendation' ? 'Handed to HM' : baseEmailTypeLabel(t);

const emailMenuItem = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 13.5, fontWeight: 500, color: 'var(--gray-700)', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit' };

export default function Emails() {
  const navigate = useNavigate();
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast } = useUI();
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [allJobs, setAllJobs] = useState(false); // "All jobs" cross-view (Emails-only)
  const [emailData, setEmailData] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);       // first load (no cache) → dim + big spinner
  const [revalidating, setRevalidating] = useState(false); // any background fetch → spins the ↺ icon
  const [showSmtpHelp, setShowSmtpHelp] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [showActions, setShowActions] = useState(false); // gear menu (Setup Guide / Test email)
  const actionsRef = useRef(null);
  useEffect(() => {
    if (!showActions) return;
    const onDoc = (e) => { if (actionsRef.current && !actionsRef.current.contains(e.target)) setShowActions(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowActions(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [showActions]);
  const [testTo, setTestTo] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null); // email id of expanded row
  const [retryingId, setRetryingId] = useState(null);   // email_log id currently being re-sent
  // Compose new email
  const [showCompose, setShowCompose] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [compose, setCompose] = useState({ candidateId: '', to: '', subject: '', body: '' });
  const [composing, setComposing] = useState(false);
  // Stale-while-revalidate cache keyed by jobId ('all' or a numeric id). Toggling
  // between "All jobs" and a single job shows the cached rows instantly (no flash,
  // no network wait) while a fresh fetch updates them in the background.
  const cacheRef = useRef({});

  useEffect(() => {
    loadJobs();
  }, []);

  // Follow the global job picked in the header (applies universally across tabs),
  // unless the "All jobs" cross-view toggle is on.
  useEffect(() => {
    if (allJobs) return;
    if (selectedJob) setJobId(String(selectedJob.id));
  }, [selectedJob, allJobs]);

  useEffect(() => {
    if (jobId) loadEmails();
  }, [jobId]);

  async function loadJobs() {
    try {
      const res = await apiGet('/job-openings');
      setJobs(res.data || []);
    } catch {}
  }

  function handleJobChange(val) {
    setJobId(val);
    // 'all' is an Emails-only view (every job's history merged) — don't push it
    // to the global job context, which only holds a single job.
    if (val && val !== 'all') {
      const job = jobs.find(j => j.id === parseInt(val));
      if (job) setSelectedJob(job);
    }
  }

  // Compose a new email to a candidate of the selected job. Tied to a candidate
  // so it logs to email_log (which requires candidate_id + job_opening_id) and
  // appears in the history below.
  async function openCompose() {
    setCompose({ candidateId: '', to: '', subject: '', body: '' });
    setShowCompose(true);
    // Load the selected job's candidates for the optional "link to candidate"
    // dropdown. No job (or "All jobs") selected is fine — send a one-off email.
    if (jobId && jobId !== 'all') {
      try { const res = await apiGet(`/candidates?job_id=${jobId}`); setCandidates(res.data || []); }
      catch { setCandidates([]); }
    } else setCandidates([]);
  }

  // Reply to an inbound message — prefill the composer to the sender, with a
  // "Re:" subject, linked to the candidate so it threads into their history.
  async function replyToInbound(e) {
    const subj = /^re:/i.test((e.subject || '').trim()) ? e.subject : `Re: ${e.subject || ''}`.trim();
    setCompose({ candidateId: e.candidate_id ? String(e.candidate_id) : '', to: e.recipient_email || '', subject: subj, body: '' });
    setShowCompose(true);
    if (jobId && jobId !== 'all') {
      try { const res = await apiGet(`/candidates?job_id=${jobId}`); setCandidates(res.data || []); }
      catch { setCandidates([]); }
    } else setCandidates([]);
  }

  function onComposeCandidate(cid) {
    const c = candidates.find(c => String(c.id) === String(cid));
    // Picking a candidate fills the recipient with their email (still editable).
    setCompose(p => ({ ...p, candidateId: cid, to: c?.email || p.to }));
  }

  async function sendCompose() {
    const { candidateId, to, subject, body } = compose;
    if (!/@/.test(to) || !/\./.test(to.split('@').pop() || '')) { showToast('Enter a valid recipient email', 'error'); return; }
    if (!subject.trim() || !body.trim()) { showToast('Subject and message are required', 'error'); return; }
    setComposing(true);
    try {
      if (candidateId) {
        // Linked to a candidate → route through /send-email so it logs to
        // email_log and shows in this candidate's history.
        const cand = candidates.find(c => String(c.id) === String(candidateId));
        const jobTitle = jobs.find(j => j.id === parseInt(jobId))?.job_title || '';
        const res = await sendEmailRequest({
          candidateId, jobId, emailType: 'custom', recipientEmail: to,
          candidateName: cand?.candidate_name || cand?.full_name || '', jobTitle, subject, body,
        });
        const st = getEmailStatus(res);
        showToast(st.message, st.type);
        if (res.data?.status === 'sent' || res.data?.status === 'logged') { setShowCompose(false); loadEmails(); }
      } else {
        // One-off to anyone → send through the SMTP sidecar (branded HTML, not
        // tied to a candidate so it isn't logged). Same-origin /smtp/ (nginx
        // proxy) so it works through a tunnel/phone, not just localhost.
        const r = await fetch('/smtp/', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, subject, body, html_body: buildEmailHtml(body) }),
        });
        const j = await r.json().catch(() => ({}));
        if (j.status === 'sent') { showToast(`Email sent to ${to}`, 'success'); setShowCompose(false); }
        else if (j.status === 'logged') showToast('SMTP not configured — nothing was sent. See Setup Guide.', 'error');
        else showToast(`Send failed: ${j.error || 'unknown error'}`, 'error');
      }
    } catch { showToast('Failed to send email — is the SMTP sidecar running?', 'error'); }
    finally { setComposing(false); }
  }

  // Re-send a failed (or logged-only) outbound email using its stored fields —
  // routes back through /send-email so it re-logs and the row updates. Useful
  // when a send failed on a transient SMTP timeout.
  async function retrySend(e) {
    setRetryingId(e.id);
    try {
      const jobTitle = jobs.find(j => j.id === e.job_opening_id)?.job_title || '';
      const res = await sendEmailRequest({
        candidateId: e.candidate_id, jobId: e.job_opening_id, emailType: e.email_type,
        recipientEmail: e.recipient_email, candidateName: e.candidate_name, jobTitle,
        subject: e.subject, body: e.body,
      });
      const st = getEmailStatus(res);
      showToast(st.message, st.type);
      if (res.data?.status === 'sent' || res.data?.status === 'logged') loadEmails();
    } catch { showToast('Retry failed — is the SMTP sidecar running?', 'error'); }
    finally { setRetryingId(null); }
  }

  async function loadEmails() {
    if (!jobId) { setEmailData([]); return; }
    const key = String(jobId);
    const cached = cacheRef.current[key];
    // Show cached rows instantly; only dim/spin if we have nothing for this view yet.
    if (cached) setEmailData(cached);
    setLoading(!cached);
    setRevalidating(true);
    try {
      let data;
      if (jobId === 'all') {
        // Merge every job's history so an inbound reply for any job is never missed.
        const lists = await Promise.all(
          jobs.map(j => apiGet(`/email-history?job_id=${j.id}`).then(r => (r.data || []).filter(e => e.id)).catch(() => []))
        );
        data = lists.flat().sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
      } else {
        const res = await apiGet(`/email-history?job_id=${jobId}`);
        data = (res.data || []).filter(e => e.id);
      }
      cacheRef.current[key] = data;
      setEmailData(data);
    } catch (err) { if (!cached) showToast('Failed to load emails', 'error'); }
    finally { setLoading(false); setRevalidating(false); }
  }

  // Test-send straight to the SMTP sidecar (port 8901) — bypasses n8n and
  // email_log so it doesn't pollute the candidate history. Proves the SMTP
  // credential actually delivers before HR relies on it for real sends.
  async function sendTestEmail() {
    const to = testTo.trim();
    if (!/@/.test(to) || !/\./.test(to.split('@').pop() || '')) { showToast('Enter a valid email address', 'error'); return; }
    setTestSending(true);
    try {
      // Same-origin /smtp/ (nginx → SMTP sidecar) so it works on a phone/tunnel,
      // not just on the HR machine's localhost.
      const res = await fetch('/smtp/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject: 'Diyar HR — SMTP test email',
          body: 'This is a test email from the Diyar HR app. If you received it, your SMTP credential is delivering correctly.',
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.status === 'sent') { showToast(`Test email sent to ${to}`, 'success'); setShowTest(false); }
      else if (j.status === 'logged') showToast('SMTP not configured — nothing was sent. See Setup Guide.', 'error');
      else showToast(`Send failed: ${j.error || 'unknown error'}`, 'error');
    } catch {
      showToast('Could not reach the SMTP service. Is the stack running?', 'error');
    } finally { setTestSending(false); }
  }

  // Filter pills now include 'inbound' (replies pulled by the IMAP poller).
  // 'all' shows both directions; 'sent'/'failed' only show outbound rows
  // because direction='inbound' rows are always status='sent' but mean
  // something different — we don't want them mixed into the outbound view.
  const filtered = statusFilter === 'all'
    ? emailData
    : statusFilter === 'inbound'
      ? emailData.filter(e => e.direction === 'inbound')
      : emailData.filter(e => e.direction !== 'inbound' && e.status === statusFilter);
  const outboundOnly = emailData.filter(e => e.direction !== 'inbound');
  const sentCount = outboundOnly.filter(e => e.status === 'sent').length;
  const failedCount = outboundOnly.filter(e => e.status === 'failed').length;
  const inboundCount = emailData.filter(e => e.direction === 'inbound').length;
  const oneWeek = Date.now() - 7 * 86400000;
  const weekCount = emailData.filter(e => new Date(e.sent_at).getTime() > oneWeek).length;

  // SMTP status from recent emails (outbound only — inbound rows are unrelated to SMTP health)
  const recent = outboundOnly.slice(0, 10);
  let smtpIcon = '\u2709', smtpText = 'SMTP status unknown', smtpHint = 'Send an email to check.';
  if (recent.length > 0) {
    const recentSent = recent.filter(e => e.status === 'sent').length;
    if (recentSent > 0) { smtpIcon = '\u2705'; smtpText = 'SMTP is working'; smtpHint = `${recentSent} of last ${recent.length} emails delivered.`; }
    else { smtpIcon = '\u26A0'; smtpText = 'SMTP not configured'; smtpHint = 'Configure SMTP credential in n8n.'; }
  }

  return (
    <div className="container tab-fade-in">
      {/* Row 1: the "All jobs" toggle + the compact action icons share one line.
          Job otherwise comes from the global "Current Job" picker; "All jobs" is
          the Emails-only cross-job merged view. */}
      <div className="emails-toolbar-top" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
        <button
          className={`filter-tab ${allJobs ? 'active' : ''}`}
          onClick={() => {
            const next = !allJobs;
            setAllJobs(next);
            setJobId(next ? 'all' : (selectedJob ? String(selectedJob.id) : ''));
          }}
          title="Show email history merged across every job"
        >🌐 All jobs</button>
        {/* Mobile-only status dropdown (All/Sent/Failed/Inbound) — shares this row
            with All jobs + the action icons. The pill tabs below show on desktop. */}
        <ShowSelect
          filters={[{ key: 'all', label: 'All' }, { key: 'sent', label: 'Sent' }, { key: 'failed', label: 'Failed' }, { key: 'inbound', label: 'Inbound' }]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        {/* Status filter pills (desktop) — share this one line with All jobs +
            actions; on mobile the dropdown above replaces them. */}
        <div className="filter-tabs emails-status-tabs">
          {['all', 'sent', 'failed', 'inbound'].map(f => (
            <button key={f} className={`filter-tab ${statusFilter === f ? 'active' : ''}`} onClick={() => setStatusFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {/* Compact actions: ⚙ tucks away Setup Guide / Test Email, blue + composes. */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto' }}>
          <div ref={actionsRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowActions(o => !o)}
              title="Email settings"
              style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, border: '1px solid var(--gray-200)', background: showActions ? 'var(--gray-50)' : 'var(--surface)', cursor: 'pointer', fontSize: 15, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}
            >⚙</button>
            {showActions && (
              <div className="menu-reveal" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 200, minWidth: 190, background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.16)', overflow: 'hidden' }}>
                <button style={emailMenuItem} onClick={() => { setShowActions(false); setShowSmtpHelp(true); }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <span style={{ width: 18, textAlign: 'center' }}>📘</span> Setup Guide
                </button>
                <button style={emailMenuItem} onClick={() => { setShowActions(false); setShowTest(true); }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <span style={{ width: 18, textAlign: 'center' }}>✉</span> Send Test Email
                </button>
              </div>
            )}
          </div>
          <button
            onClick={openCompose}
            title="New email"
            style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, border: 'none', background: '#2563eb', color: '#fff', fontSize: 22, fontWeight: 500, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}
          >+</button>
          <button
            onClick={loadEmails}
            disabled={revalidating}
            title="Refresh email history"
            style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              border: '1px solid var(--gray-200)', background: 'var(--surface)',
              cursor: 'pointer', fontSize: 15, color: 'var(--gray-500)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: revalidating ? 'spin 0.8s linear infinite' : 'none',
            }}
          >↺</button>
        </div>
      </div>

      <div className="table-wrap">
        {(loading && emailData.length === 0) ? <Loading /> : !jobId ? <EmptyState>Pick a job from the “Current Job” selector at the top (or toggle “All jobs”) to view email history.</EmptyState> : (filtered.length === 0 && !loading) ? <EmptyState>No emails match the current filter.</EmptyState> : (
          // Keep current rows on screen while refetching (e.g. toggling "All jobs")
          // — just dim them — instead of swapping the whole table for a spinner,
          // which caused a flash + layout jump. The ↺ icon spins to show activity.
          <table style={{ width: '100%', tableLayout: 'fixed', opacity: loading ? 0.5 : 1, transition: 'opacity 0.18s ease' }}>
            <thead><tr>
              <th style={{ width: '148px' }}>Date</th>
              <th style={{ width: '138px' }}>Candidate</th>
              <th style={{ width: '130px' }}>Type</th>
              <th style={{ width: '200px' }}>Recipient</th>
              <th>Subject</th>
              <th style={{ width: '108px' }}>Status</th>
            </tr></thead>
            <tbody>
              {filtered.map(e => {
                const inbound = e.direction === 'inbound';
                const rowBg = inbound ? { background: '#faf5ff' } : (e.status === 'failed' ? { background: '#fef2f2' } : {});
                return (
                <React.Fragment key={e.id}>
                  <tr
                    className="email-row-clickable"
                    onClick={() => setExpandedRow(expandedRow === e.id ? null : e.id)}
                    style={rowBg}
                  >
                    <td style={{ fontSize: '13px', color: 'var(--gray-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{new Date(e.sent_at).toLocaleDateString()} {new Date(e.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><strong>{e.candidate_name || '\u2014'}</strong></td>
                    <td style={{ overflow: 'hidden' }}>
                      {inbound
                        ? <span className="badge" style={{ background: '#ede9fe', color: '#6b21a8', border: '1px solid #e9d5ff', whiteSpace: 'nowrap' }}>{'\u{1F4E5}'} Reply</span>
                        : <Badge type={e.email_type === 'recommendation' ? 'interviewed' : 'shortlisted'}>{emailTypeLabel(e.email_type)}</Badge>}
                    </td>
                    <td style={{ fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={(inbound ? 'from ' : '') + (e.recipient_email || '')}>
                      {inbound && <span style={{ color: 'var(--gray-400)', marginRight: '4px' }}>from</span>}
                      {e.recipient_email}
                    </td>
                    <td style={{ fontSize: '13px', color: 'var(--gray-700)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={e.subject || ''}>
                      {e.subject}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                        {inbound
                          ? <span className="badge" style={{ background: '#ede9fe', color: '#6b21a8', border: '1px solid #e9d5ff' }}>inbound</span>
                          : <Badge type={e.status === 'sent' ? 'hired' : e.status === 'failed' ? 'rejected' : 'draft'}>{e.status}</Badge>}
                        <span className={`email-row-toggle${expandedRow === e.id ? ' open' : ''}`}>{'\u25BE'}</span>
                      </div>
                    </td>
                  </tr>
                  <tr className="email-detail-row">
                    <td colSpan={6}>
                      <div style={{ display: 'grid', gridTemplateRows: expandedRow === e.id ? '1fr' : '0fr', transition: 'grid-template-rows 0.28s ease' }}>
                      <div style={{ overflow: 'hidden' }}>
                        <div className="email-detail-panel">
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                          <div className="email-detail-grid" style={{ flex: 1 }}>
                            <div className="email-detail-field"><span className="email-detail-label">{inbound ? 'From:' : 'To:'}</span> {e.recipient_email}</div>
                            <div className="email-detail-field"><span className="email-detail-label">Type:</span> {inbound ? 'Inbound reply' : emailTypeLabel(e.email_type)}</div>
                            <div className="email-detail-field"><span className="email-detail-label">Date:</span> {new Date(e.sent_at).toLocaleString()}</div>
                            <div className="email-detail-field">
                              <span className="email-detail-label">Status:</span>{' '}
                              <span className={`sl-email-detail-badge sl-email-detail-badge--${inbound ? 'inbound' : e.status}`}>
                                {inbound ? '\u{1F4E5} Inbound — pulled by IMAP poller' : e.status === 'sent' ? '\u2713 Delivered to mail server' : e.status === 'failed' ? '\u2717 Failed' : e.status === 'logged' ? '\u26A0 Logged only (SMTP not configured)' : e.status}
                              </span>
                            </div>
                          </div>
                            {/* Retry a failed / logged-only outbound send (e.g. after a transient SMTP timeout). Top-right, beside Status. */}
                            {!inbound && (e.status === 'failed' || e.status === 'logged') && (
                              <button className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} disabled={retryingId === e.id}
                                onClick={(ev) => { ev.stopPropagation(); retrySend(e); }}
                                title="Resend this email using the same recipient, subject and message">
                                {retryingId === e.id ? 'Resending…' : '↻ Retry send'}
                              </button>
                            )}
                          </div>
                          {e.error_message && (
                            <div className="email-detail-error-box">
                              <strong>Error:</strong> {e.error_message}
                            </div>
                          )}
                          <div className="email-detail-field" style={{ marginTop: '8px' }}><span className="email-detail-label">Subject:</span> {e.subject}</div>
                          {e.body && (
                            <div className="email-detail-body-box">
                              <div className="email-detail-label" style={{ marginBottom: '6px' }}>{inbound ? 'Message:' : 'Message preview:'}</div>
                              {inbound
                                ? <pre className="email-detail-body-pre">{e.body}</pre>
                                : <iframe title="Email preview" srcDoc={buildEmailHtml(e.body)} sandbox="" style={{ width: '100%', height: 380, border: '1px solid var(--gray-200)', borderRadius: 8, background: '#fff', display: 'block' }} />}
                            </div>
                          )}
                          {/* Inbound reply → reply directly, or jump to the Decision tab to act on it. */}
                          {inbound && (
                            <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--tint-info)', border: '1px solid #bfdbfe', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                              <div style={{ fontSize: 13, color: 'var(--gray-700)' }}>
                                {e.candidate_id
                                  ? <><strong>Reply to {e.recipient_email || 'the sender'}</strong>, or make the final call on {(e.candidate_name || '').trim().split(/\s+/)[0] || 'this candidate'} in the Decision tab.</>
                                  : <><strong>Reply to {e.recipient_email || 'the sender'}.</strong></>}
                              </div>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button className="btn btn-sm btn-primary" onClick={(ev) => { ev.stopPropagation(); replyToInbound(e); }} title="Reply to this message">
                                  ↩ Reply
                                </button>
                                {e.candidate_id && (
                                  <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/decision?job=${jobId}&focus=${e.candidate_id}`)} title="Open the Decision tab with this candidate ready to hire or reject">
                                    ⚖ Decide on {(e.candidate_name || '').trim().split(/\s+/)[0] || 'candidate'} →
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Compose New Email Modal */}
      <Modal isOpen={showCompose} onClose={() => setShowCompose(false)} title="New Email" wide
        footer={<>
          <button className="btn btn-secondary" onClick={() => setShowCompose(false)} disabled={composing}>Cancel</button>
          <button className="btn btn-primary" onClick={sendCompose} disabled={composing}>{composing ? 'Sending…' : 'Send Email'}</button>
        </>}>
        <div style={{ display: 'grid', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>To</label>
            <input type="email" value={compose.to} onChange={e => setCompose(p => ({ ...p, to: e.target.value }))} placeholder="anyone@example.com" style={{ width: '100%', padding: '8px 10px', fontSize: '14px' }} autoFocus />
            <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>Send to any email address.</div>
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>Link to candidate <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>(optional)</span></label>
            <Select
              value={compose.candidateId}
              onChange={onComposeCandidate}
              disabled={!jobId}
              placeholder="— None (one-off email) —"
              style={{ display: 'block', width: '100%', minWidth: 0 }}
              options={[
                { value: '', label: '— None (one-off email) —' },
                ...candidates.map(c => ({ value: c.id, label: `${c.candidate_name || c.full_name || 'Candidate'}${c.email ? ` · ${c.email}` : ''}` })),
              ]}
            />
            <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>{jobId ? 'Pick a candidate to log this to their history. Leave as None for a one-off.' : 'Select a job in the filter below to link this email to a candidate.'}</div>
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>Subject</label>
            <input type="text" value={compose.subject} onChange={e => setCompose(p => ({ ...p, subject: e.target.value }))} placeholder="Subject" style={{ width: '100%', padding: '8px 10px', fontSize: '14px' }} />
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>Message</label>
            <textarea value={compose.body} onChange={e => setCompose(p => ({ ...p, body: e.target.value }))} placeholder="Write your message…" style={{ width: '100%', minHeight: '160px', padding: '8px 10px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
        </div>
      </Modal>

      {/* Test Email Modal */}
      <Modal isOpen={showTest} onClose={() => setShowTest(false)} title="Send Test Email"
        footer={<>
          <button className="btn btn-secondary" onClick={() => setShowTest(false)} disabled={testSending}>Cancel</button>
          <button className="btn btn-primary" onClick={sendTestEmail} disabled={testSending}>{testSending ? 'Sending…' : 'Send Test'}</button>
        </>}>
        <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: '12px', lineHeight: 1.6 }}>
          Sends a one-off test message through your configured SMTP credential to confirm delivery works.
          It goes straight to the mail server and is <strong>not</strong> logged to candidate history.
        </p>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Send to</label>
        <input type="email" value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@example.com"
          onKeyDown={e => { if (e.key === 'Enter') sendTestEmail(); }}
          style={{ width: '100%', padding: '8px 10px', fontSize: '14px' }} autoFocus />
      </Modal>

      {/* SMTP Help Modal */}
      <Modal isOpen={showSmtpHelp} onClose={() => setShowSmtpHelp(false)} title="SMTP Setup Guide" wide
        footer={<button className="btn btn-secondary" onClick={() => setShowSmtpHelp(false)}>Close</button>}
      >
        <p style={{ marginBottom: '16px', color: 'var(--gray-600)' }}>
          Emails are queued into the database regardless of SMTP config. To actually deliver them, configure an SMTP credential in n8n <strong>once</strong>:
        </p>
        <ol style={{ marginLeft: '20px', lineHeight: 2 }}>
          <li>Open <a href="http://localhost:5678/home/credentials" target="_blank" style={{ color: 'var(--primary)', fontWeight: 600 }}>n8n Credentials</a></li>
          <li>Click <strong>Add credential</strong> &rarr; search <strong>SMTP</strong></li>
          <li>Name it exactly <code style={{ background: 'var(--gray-100)', padding: '2px 6px', borderRadius: '3px' }}>SMTP</code></li>
          <li>Fill in User, Password (app password), Host (smtp.gmail.com), Port (587)</li>
          <li>Click <strong>Save</strong></li>
        </ol>
        <div style={{ marginTop: '20px', padding: '14px', background: '#fef9c3', borderLeft: '3px solid #f59e0b', borderRadius: 'var(--radius)', fontSize: '13px' }}>
          <strong>Gmail users:</strong> create an App Password (requires 2FA). Your normal Google password won't work.
        </div>
      </Modal>
    </div>
  );
}
