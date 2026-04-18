import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost } from '../services/api';
import { useSelectedJob } from '../state/selectedJob';
import { useUI } from '../state/uiState';
import Badge from '../components/common/Badge';
import Loading from '../components/common/Loading';
import JobDetailModal from '../components/modals/JobDetailModal';
import { formatDate } from '../utils/helpers';

const DEPARTMENTS = ['Engineering', 'IT', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Design', 'Product', 'Legal', 'Other'];

export default function JobOpenings() {
  const { showToast } = useUI();
  const [allJobs, setAllJobs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailJobId, setDetailJobId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [descSource, setDescSource] = useState('manual');
  const [createProgress, setCreateProgress] = useState(0);
  const progressTimerRef = useRef(null);

  useEffect(() => {
    if (!creating) {
      if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
      return;
    }
    // Asymptotic progress: approaches 95% over expected duration (~45s for AI, ~3s for manual).
    const tau = descSource === 'ai_generate' ? 15000 : 1000;
    const started = Date.now();
    setCreateProgress(0);
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - started;
      const pct = 95 * (1 - Math.exp(-elapsed / tau));
      setCreateProgress(pct);
    }, 150);
    return () => { if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; } };
  }, [creating, descSource]);

  // Form state
  const [form, setForm] = useState({
    title: '', department: '', departmentCustom: '', employment: 'Full-time',
    seniority: 'Mid-level', location: 'On-site', reporting: '', description: '',
  });

  useEffect(() => { loadJobs(); }, []);

  async function loadJobs() {
    setLoading(true);
    try {
      const res = await apiGet('/job-openings');
      setAllJobs(res.data || []);
    } catch (err) {
      showToast('Failed to load jobs', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function toggleJob(id) {
    try {
      const res = await apiPost(`/job-opening-toggle?id=${id}`, {});
      if (res.data.success) {
        const isActive = res.data.data.is_active;
        setAllJobs(prev => prev.map(j => j.id === id ? { ...j, is_active: isActive, status: isActive ? 'active' : 'inactive' } : j));
        showToast(`Job is now ${isActive ? 'active' : 'inactive'}`, 'success');
      }
    } catch { showToast('Failed to toggle status', 'error'); }
  }

  async function createJob() {
    setCreating(true);
    const dept = form.department === 'Other' ? form.departmentCustom : form.department;
    const payload = {
      job_title: form.title.trim(),
      department: dept,
      employment_type: form.employment,
      seniority_level: form.seniority,
      location_type: form.location,
      reporting_to: form.reporting.trim(),
      description_source: descSource,
    };
    if (descSource === 'manual') payload.job_description = form.description.trim();

    try {
      const res = await apiPost('/job-openings', payload);
      if (res.status === 201 || res.data.success) {
        showToast('Job opening created!', 'success');
        setShowCreate(false);
        resetForm();
        loadJobs();
      } else {
        showToast(res.data.error || 'Failed to create', 'error');
      }
    } catch (err) { showToast('Request failed: ' + err.message, 'error'); }
    setCreateProgress(100);
    setTimeout(() => { setCreating(false); setCreateProgress(0); }, 250);
  }

  function resetForm() {
    setForm({ title: '', department: '', departmentCustom: '', employment: 'Full-time', seniority: 'Mid-level', location: 'On-site', reporting: '', description: '' });
    setCreateStep(1);
    setDescSource('manual');
  }

  // Filtering
  let filtered = allJobs;
  if (filter === 'active') filtered = filtered.filter(j => j.is_active);
  else if (filter === 'inactive') filtered = filtered.filter(j => !j.is_active);
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(j => (j.job_title || '').toLowerCase().includes(s) || (j.department || '').toLowerCase().includes(s));
  }

  return (
    <div className="container">
      <div className="table-wrap">
        <div className="table-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Job Openings</h2>
              <span style={{ fontSize: '13px', color: 'var(--gray-400)' }}>{filtered.length} of {allJobs.length} jobs</span>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { resetForm(); setShowCreate(true); }}>+ New Job</button>
        </div>
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--gray-200)', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <input type="text" className="search-bar" placeholder="Search by title, department..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: '400px' }} />
          <div className="filter-tabs">
            {['all', 'active', 'inactive'].map(f => (
              <button key={f} className={`filter-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {loading ? <Loading /> : filtered.length === 0 ? (
          <div className="empty-state"><p>No job openings found.</p></div>
        ) : (
          <table>
            <thead><tr><th>Job Title</th><th>Department / Level</th><th>Created</th><th>Status</th><th>Active</th></tr></thead>
            <tbody>
              {filtered.map(job => {
                const meta = [job.department, job.seniority_level, job.employment_type].filter(Boolean).join(' \u00b7 ');
                return (
                  <tr key={job.id}>
                    <td><strong style={{ cursor: 'pointer', color: 'var(--primary)' }} onClick={() => setDetailJobId(job.id)}>{job.job_title}</strong></td>
                    <td style={{ fontSize: '13px', color: 'var(--gray-500)' }}>{meta}</td>
                    <td style={{ fontSize: '13px', color: 'var(--gray-500)' }}>{formatDate(job.created_at)}</td>
                    <td><Badge type={job.status}>{job.status}</Badge></td>
                    <td>
                      <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={!!job.is_active} onChange={() => toggleJob(job.id)} />
                        <span className="toggle-slider"></span>
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <JobDetailModal jobId={detailJobId} isOpen={!!detailJobId} onClose={() => setDetailJobId(null)} onToggle={loadJobs} />

      {/* Create Job Modal */}
      {showCreate && (
        <div className="modal-overlay active" onClick={e => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2>New Job Opening</h2>
              <button className="modal-close" onClick={() => setShowCreate(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="wizard-steps" style={{ paddingTop: 0, marginBottom: '24px' }}>
                <div className={`wizard-step ${createStep === 1 ? 'active' : 'completed'}`}><span className="step-num">1</span> Job Information</div>
                <div className={`wizard-connector ${createStep >= 2 ? 'completed' : ''}`}></div>
                <div className={`wizard-step ${createStep === 2 ? 'active' : ''}`}><span className="step-num">2</span> Job Description</div>
              </div>

              {createStep === 1 && (
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>Job Information</h3>
                  <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '20px' }}>Fill in the core details for this role.</p>
                  <div className="form-group">
                    <label>Job Title <span className="required">*</span></label>
                    <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Senior Software Engineer" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Department</label>
                      <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
                        <option value="">Select department</option>
                        {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                      </select>
                      {form.department === 'Other' && (
                        <input type="text" value={form.departmentCustom} onChange={e => setForm({ ...form, departmentCustom: e.target.value })} placeholder="Type department name..." style={{ marginTop: '8px' }} />
                      )}
                    </div>
                    <div className="form-group">
                      <label>Employment Type</label>
                      <select value={form.employment} onChange={e => setForm({ ...form, employment: e.target.value })}>
                        {['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Seniority Level</label>
                      <select value={form.seniority} onChange={e => setForm({ ...form, seniority: e.target.value })}>
                        {['Junior', 'Mid-level', 'Senior', 'Lead', 'Manager', 'Director', 'VP', 'C-level'].map(l => <option key={l}>{l}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Location Type</label>
                      <select value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}>
                        {['On-site', 'Remote', 'Hybrid'].map(l => <option key={l}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Reporting To <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>(Optional)</span></label>
                    <input type="text" value={form.reporting} onChange={e => setForm({ ...form, reporting: e.target.value })} placeholder="e.g. Engineering Manager" />
                  </div>
                </div>
              )}

              {createStep === 2 && (
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>Job Description</h3>
                  <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: '20px' }}>Choose how you'd like to provide the Job Description.</p>
                  <div className="source-tabs" style={{ border: 'none', gap: '16px', marginBottom: '20px' }}>
                    {[{ key: 'ai_generate', icon: '\u2728', label: 'Generate with AI' }, { key: 'manual', icon: '\u270F', label: 'Write / Paste' }, { key: 'file_upload', icon: '\uD83D\uDCC4', label: 'Upload File' }].map(s => (
                      <button key={s.key} className={`source-tab ${descSource === s.key ? 'active' : ''}`} onClick={() => setDescSource(s.key)}
                        style={{ flex: 1, padding: '20px 12px', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '20px' }}>{s.icon}</span> {s.label}
                      </button>
                    ))}
                  </div>
                  {descSource === 'manual' && (
                    <div className="form-group">
                      <label>Job Description</label>
                      <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ minHeight: '160px' }} placeholder="Paste or type the full job description here..." />
                    </div>
                  )}
                  {descSource === 'ai_generate' && (
                    <div style={{ background: 'var(--gray-50)', padding: '16px', borderRadius: 'var(--radius)', color: 'var(--gray-600)', fontSize: '14px' }}>
                      <strong>{'\u2728'} AI-Powered Generation</strong><br /><br />
                      The job description will be automatically generated based on the job details from Step 1.
                      <br /><br /><em>Requires Ollama running locally.</em>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
              {creating && (
                <div className="progress-bar" aria-label="Creating job opening">
                  <div className="progress-fill" style={{ width: createProgress + '%', background: 'var(--primary, #3b82f6)' }} />
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="step-info">Step {createStep} of 2</div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {createStep === 2 && <button className="btn btn-secondary" onClick={() => setCreateStep(1)} disabled={creating}>&larr; Back</button>}
                  {createStep === 1 && (
                    <button className="btn btn-primary" onClick={() => {
                      if (!form.title.trim()) { showToast('Job title is required', 'error'); return; }
                      setCreateStep(2);
                    }}>Continue &rarr;</button>
                  )}
                  {createStep === 2 && (
                    <button className="btn btn-primary" onClick={createJob} disabled={creating}>
                      {creating ? (descSource === 'ai_generate' ? `Generating\u2026 ${Math.round(createProgress)}%` : 'Creating\u2026') : 'Create Job Opening'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
