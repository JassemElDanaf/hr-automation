import { useState, useEffect } from 'react';
import { apiGet } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import StatCard from '../components/common/StatCard';
import Badge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import Loading from '../components/common/Loading';
import Modal from '../components/modals/Modal';
import { formatDate } from '../utils/helpers';

export default function Emails() {
  const { selectedJob, setSelectedJob } = useSelectedJob();
  const { showToast } = useUI();
  const [jobs, setJobs] = useState([]);
  const [jobId, setJobId] = useState('');
  const [emailData, setEmailData] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [smtpStatus, setSmtpStatus] = useState(null);
  const [showSmtpHelp, setShowSmtpHelp] = useState(false);

  useEffect(() => {
    loadJobs();
    checkSmtp();
  }, []);

  useEffect(() => {
    if (selectedJob && !jobId) {
      setJobId(String(selectedJob.id));
    }
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

  async function checkSmtp() {
    try {
      const res = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:5678/webhook') + '/email-history?job_id=0');
      // We'll derive status from actual email data
    } catch {}
  }

  const filtered = statusFilter === 'all' ? emailData : emailData.filter(e => e.status === statusFilter);
  const sentCount = emailData.filter(e => e.status === 'sent').length;
  const failedCount = emailData.filter(e => e.status === 'failed').length;
  const oneWeek = Date.now() - 7 * 86400000;
  const weekCount = emailData.filter(e => new Date(e.sent_at).getTime() > oneWeek).length;

  // SMTP status from recent emails
  const recent = emailData.slice(0, 10);
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
          {jobs.map(j => <option key={j.id} value={j.id}>{j.job_title}</option>)}
        </select>
        <div className="filter-tabs">
          {['all', 'sent', 'failed'].map(f => (
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
        <StatCard label="This Week" value={weekCount || '-'} />
      </div>

      <div className="table-wrap">
        {loading ? <Loading /> : !jobId ? <EmptyState>Select a job opening to view email history.</EmptyState> : filtered.length === 0 ? <EmptyState>No emails match the current filter.</EmptyState> : (
          <table>
            <thead><tr><th>Date</th><th>Candidate</th><th>Type</th><th>Recipient</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} title={e.error_message || ''} style={e.status === 'failed' ? { background: '#fef2f2' } : {}}>
                  <td style={{ fontSize: '13px', color: 'var(--gray-500)' }}>{new Date(e.sent_at).toLocaleDateString()} {new Date(e.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td><strong>{e.candidate_name || '\u2014'}</strong></td>
                  <td><Badge type="shortlisted">{(e.email_type || '').replace('_', ' ')}</Badge></td>
                  <td style={{ fontSize: '13px' }}>{e.recipient_email}</td>
                  <td style={{ fontSize: '13px', color: 'var(--gray-700)', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.subject}</td>
                  <td><Badge type={e.status === 'sent' ? 'hired' : e.status === 'failed' ? 'rejected' : 'draft'}>{e.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
