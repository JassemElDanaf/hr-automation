import { useState, useEffect } from 'react';
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
      const res = await apiGet(`/shortlist?job_id=${jobId}`);
      setData(res.data || []);
    } catch (err) { showToast('Failed to load shortlist', 'error'); }
    finally { setLoading(false); }
  }

  async function updateStatus(id, status) {
    try {
      const res = await apiPost('/update-shortlist-status', { id, status });
      if (res.data.success) {
        setData(prev => prev.map(s => s.id === id ? { ...s, status, updated_at: new Date().toISOString() } : s));
        showToast(`Status updated to "${status}"`, 'success');
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
        if (status === 'sent') showToast('Email sent', 'success');
        else showToast('Email logged only', 'error');
      },
    });
  }

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

      {loading ? <Loading /> : !jobId ? <EmptyState>Select a job opening to view shortlisted candidates.</EmptyState> : data.length === 0 ? <EmptyState>No shortlisted candidates yet. Go to CV Evaluation to shortlist candidates.</EmptyState> : (
        <div>
          {data.map(s => {
            const score = s.overall_score != null ? parseFloat(s.overall_score).toFixed(1) : '\u2014';
            const scoreClsName = s.overall_score >= 7 ? 'score-high' : s.overall_score >= 4 ? 'score-mid' : 'score-low';
            const hasEmail = s.email && s.email.includes('@');

            return (
              <div key={s.id} className="candidate-card">
                <div className="candidate-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h3>{s.candidate_name}</h3>
                    <Badge type={s.status}>{s.status}</Badge>
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--gray-100)' }}>
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
                    <span style={{ fontSize: '13px', color: 'var(--success)', fontWeight: 600 }}>Candidate Hired</span>
                    <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(s.id, 'interviewed')}>Revert to Interviewed</button>
                  </>}
                  {s.status === 'rejected' && <>
                    <span style={{ fontSize: '13px', color: 'var(--danger)', fontWeight: 600 }}>Candidate Rejected</span>
                    <button className="btn btn-sm btn-secondary" onClick={() => updateStatus(s.id, 'shortlisted')}>Reconsider</button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
