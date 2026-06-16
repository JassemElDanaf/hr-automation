import React, { useState, useEffect } from 'react';
import { apiGet } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import StatCard from '../components/common/StatCard';
import Badge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import Loading from '../components/common/Loading';
import Modal from '../components/modals/Modal';
import { formatDate, emailTypeLabel as baseEmailTypeLabel } from '../utils/helpers';

// Emails tab uses a shorter label for the recommendation/handoff type.
const emailTypeLabel = (t) => t === 'recommendation' ? 'Handed to HM' : baseEmailTypeLabel(t);

export default function Emails() {
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast } = useUI();
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [emailData, setEmailData] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [showSmtpHelp, setShowSmtpHelp] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null); // email id of expanded row

  useEffect(() => {
    loadJobs();
  }, []);

  // Follow the global job picked in the header (applies universally across tabs).
  useEffect(() => {
    if (selectedJob) setJobId(String(selectedJob.id));
  }, [selectedJob]);

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
    if (val) {
      const job = jobs.find(j => j.id === parseInt(val));
      if (job) setSelectedJob(job);
    }
  }

  async function loadEmails() {
    if (!jobId) { setEmailData([]); return; }
    setLoading(true);
    try {
      const res = await apiGet(`/email-history?job_id=${jobId}`);
      setEmailData((res.data || []).filter(e => e.id));
    } catch (err) { showToast('Failed to load emails', 'error'); }
    finally { setLoading(false); }
  }

  // Test-send straight to the SMTP sidecar (port 8901) — bypasses n8n and
  // email_log so it doesn't pollute the candidate history. Proves the SMTP
  // credential actually delivers before HR relies on it for real sends.
  async function sendTestEmail() {
    const to = testTo.trim();
    if (!/@/.test(to) || !/\./.test(to.split('@').pop() || '')) { showToast('Enter a valid email address', 'error'); return; }
    setTestSending(true);
    try {
      const res = await fetch('http://localhost:8901/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          subject: 'Diyar HR — SMTP test email',
          body: 'This is a test email from the Diyar HR Automation app. If you received it, your SMTP credential is delivering correctly.',
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.status === 'sent') { showToast(`Test email sent to ${to}`, 'success'); setShowTest(false); }
      else if (j.status === 'logged') showToast('SMTP not configured — nothing was sent. See Setup Guide.', 'error');
      else showToast(`Send failed: ${j.error || 'unknown error'}`, 'error');
    } catch {
      showToast('Could not reach the SMTP sidecar (port 8901). Is start.sh running?', 'error');
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
    <div className="container">
      {/* SMTP Banner */}
      <div className="criteria-bar" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '18px' }}>{smtpIcon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '13px', fontWeight: 600 }}>{smtpText}</div>
          <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>{smtpHint}</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowTest(true)}>Send Test Email</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowSmtpHelp(true)}>Setup Guide</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Email History</h2>
          <p style={{ fontSize: '13px', color: 'var(--gray-500)' }}>All emails sent and logged across candidates.</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadEmails}>Refresh</button>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
        <label style={{ fontSize: '13px', fontWeight: 600 }}>Job:</label>
        <select value={jobId} onChange={e => handleJobChange(e.target.value)} style={{ maxWidth: '280px' }}>
          <option value="">-- Select a job --</option>
          {jobs.filter(j => j.is_active).map(j => <option key={j.id} value={j.id}>{j.job_title}</option>)}
          {jobs.some(j => !j.is_active) && (
            <optgroup label="Closed (reactivate in Job Openings to use)">
              {jobs.filter(j => !j.is_active).map(j => <option key={j.id} value={j.id} disabled>{j.job_title}</option>)}
            </optgroup>
          )}
        </select>
        <div className="filter-tabs">
          {['all', 'sent', 'failed', 'inbound'].map(f => (
            <button key={f} className={`filter-tab ${statusFilter === f ? 'active' : ''}`} onClick={() => setStatusFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="stats" style={{ marginBottom: '16px' }}>
        <StatCard label="Total" value={emailData.length || '-'} />
        <StatCard label="Sent" value={sentCount || '-'} style={{ color: 'var(--success)' }} />
        <StatCard label="Failed" value={failedCount || '-'} style={{ color: 'var(--danger)' }} />
        <StatCard label="Inbound" value={inboundCount || '-'} />
        <StatCard label="This Week" value={weekCount || '-'} />
      </div>

      <div className="table-wrap">
        {loading ? <Loading /> : !jobId ? <EmptyState>Select a job opening to view email history.</EmptyState> : filtered.length === 0 ? <EmptyState>No emails match the current filter.</EmptyState> : (
          <table>
            <thead><tr><th>Date</th><th>Candidate</th><th>Type</th><th>Recipient</th><th>Subject</th><th>Status</th><th style={{ width: '28px' }}></th></tr></thead>
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
                    <td style={{ fontSize: '13px', color: 'var(--gray-500)' }}>{new Date(e.sent_at).toLocaleDateString()} {new Date(e.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td><strong>{e.candidate_name || '\u2014'}</strong></td>
                    <td>
                      {inbound
                        ? <span className="badge" style={{ background: '#ede9fe', color: '#6b21a8', border: '1px solid #e9d5ff' }}>{'\u{1F4E5}'} Reply</span>
                        : <Badge type={e.email_type === 'recommendation' ? 'interviewed' : 'shortlisted'}>{emailTypeLabel(e.email_type)}</Badge>}
                    </td>
                    <td style={{ fontSize: '13px' }}>
                      {inbound && <span style={{ color: 'var(--gray-400)', marginRight: '4px' }}>from</span>}
                      {e.recipient_email}
                    </td>
                    <td style={{ fontSize: '13px', color: 'var(--gray-700)', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.subject}
                    </td>
                    <td>
                      {inbound
                        ? <span className="badge" style={{ background: '#ede9fe', color: '#6b21a8', border: '1px solid #e9d5ff' }}>inbound</span>
                        : <Badge type={e.status === 'sent' ? 'hired' : e.status === 'failed' ? 'rejected' : 'draft'}>{e.status}</Badge>}
                    </td>
                    <td style={{ textAlign: 'center' }}><span className="email-row-toggle">{expandedRow === e.id ? '\u25B2' : '\u25BC'}</span></td>
                  </tr>
                  {expandedRow === e.id && (
                    <tr className="email-detail-row">
                      <td colSpan={7}>
                        <div className="email-detail-panel">
                          <div className="email-detail-grid">
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
                          {e.error_message && (
                            <div className="email-detail-error-box">
                              <strong>Error:</strong> {e.error_message}
                            </div>
                          )}
                          <div className="email-detail-field" style={{ marginTop: '8px' }}><span className="email-detail-label">Subject:</span> {e.subject}</div>
                          {e.body && (
                            <div className="email-detail-body-box">
                              <div className="email-detail-label" style={{ marginBottom: '6px' }}>Message:</div>
                              <pre className="email-detail-body-pre">{e.body}</pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

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
