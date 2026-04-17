import { useState, useEffect } from 'react';
import Modal from './Modal';
import Badge from '../common/Badge';
import Loading from '../common/Loading';
import { apiGet, apiPost } from '../../services/api';
import { useUI } from '../../state/uiState';
import { formatDateTime } from '../../utils/helpers';

const DEPARTMENTS = ['Engineering', 'IT', 'Marketing', 'Sales', 'HR', 'Finance', 'Operations', 'Design', 'Product', 'Legal', 'Other'];
const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];
const SENIORITY_LEVELS = ['Junior', 'Mid-level', 'Senior', 'Lead', 'Manager', 'Director', 'VP', 'C-level'];
const LOCATION_TYPES = ['On-site', 'Remote', 'Hybrid'];

export default function JobDetailModal({ jobId, isOpen, onClose, onToggle }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const { showToast } = useUI();

  useEffect(() => {
    if (isOpen && jobId) {
      setLoading(true);
      setEditing(false);
      apiGet(`/job-opening?id=${jobId}`)
        .then(res => { setJob(res.data); setForm(buildForm(res.data)); })
        .catch(() => showToast('Failed to load job details', 'error'))
        .finally(() => setLoading(false));
    }
  }, [isOpen, jobId]);

  function buildForm(j) {
    return {
      job_title: j.job_title || '',
      department: j.department || '',
      employment_type: j.employment_type || '',
      seniority_level: j.seniority_level || '',
      location_type: j.location_type || '',
      reporting_to: j.reporting_to || '',
      job_description: j.job_description || '',
    };
  }

  function startEditing() { setForm(buildForm(job)); setEditing(true); }
  function cancelEditing() { setEditing(false); setForm(buildForm(job)); }

  async function saveChanges() {
    if (!form.job_title.trim()) { showToast('Job title is required', 'error'); return; }
    setSaving(true);
    try {
      const res = await apiPost('/job-opening-update', { id: jobId, ...form });
      if (res.data.success) {
        const updated = res.data.data;
        setJob(prev => ({ ...prev, ...updated }));
        setEditing(false);
        showToast('Job updated', 'success');
        onToggle?.();
      } else {
        showToast(res.data.error || 'Update failed', 'error');
      }
    } catch { showToast('Failed to save changes', 'error'); }
    setSaving(false);
  }

  const handleToggle = async () => {
    try {
      const res = await apiPost(`/job-opening-toggle?id=${jobId}`, {});
      if (res.data.success) {
        const isActive = res.data.data.is_active;
        setJob(prev => ({ ...prev, is_active: isActive, status: isActive ? 'active' : 'inactive' }));
        showToast(`Job is now ${isActive ? 'active' : 'inactive'}`, 'success');
        onToggle?.();
      }
    } catch { showToast('Failed to toggle', 'error'); }
  };

  const updateField = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? 'Edit Job Opening' : (job?.job_title || 'Job Details')}
      wide
      footer={job && (
        <>
          {editing ? (
            <>
              <button className="btn btn-secondary" onClick={cancelEditing} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={saveChanges} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={startEditing}>Edit</button>
              <button className={`btn ${job.is_active ? 'btn-danger' : 'btn-success'}`} onClick={handleToggle}>
                {job.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
            </>
          )}
        </>
      )}
    >
      {loading ? <Loading /> : job && !editing && (
        <div className="detail-grid">
          <div className="detail-item"><div className="label">Department</div><div className="value">{job.department}</div></div>
          <div className="detail-item"><div className="label">Employment Type</div><div className="value">{job.employment_type}</div></div>
          <div className="detail-item"><div className="label">Seniority Level</div><div className="value">{job.seniority_level}</div></div>
          <div className="detail-item"><div className="label">Location</div><div className="value">{job.location_type}</div></div>
          <div className="detail-item"><div className="label">Reporting To</div><div className="value">{job.reporting_to || '\u2014'}</div></div>
          <div className="detail-item"><div className="label">Description Source</div><div className="value">{job.description_source_type}</div></div>
          <div className="detail-item"><div className="label">Status</div><div className="value"><Badge type={job.status}>{job.status}</Badge></div></div>
          <div className="detail-item"><div className="label">Active</div><div className="value"><Badge type={job.is_active ? 'active' : 'inactive'}>{job.is_active ? 'Active' : 'Inactive'}</Badge></div></div>
          <div className="detail-item"><div className="label">Created</div><div className="value">{formatDateTime(job.created_at)}</div></div>
          <div className="detail-item"><div className="label">Updated</div><div className="value">{formatDateTime(job.updated_at)}</div></div>
          <div className="detail-desc">
            <div className="label">Job Description</div>
            <div className="value" style={{ whiteSpace: 'pre-wrap' }}>{job.job_description}</div>
          </div>
        </div>
      )}

      {job && editing && (
        <div>
          <div className="form-group">
            <label>Job Title <span className="required">*</span></label>
            <input type="text" value={form.job_title} onChange={e => updateField('job_title', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Department</label>
              <select value={DEPARTMENTS.includes(form.department) ? form.department : 'Other'} onChange={e => updateField('department', e.target.value === 'Other' ? form.department : e.target.value)}>
                {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
              </select>
              {!DEPARTMENTS.includes(form.department) && (
                <input type="text" value={form.department} onChange={e => updateField('department', e.target.value)} placeholder="Custom department..." style={{ marginTop: '8px' }} />
              )}
            </div>
            <div className="form-group">
              <label>Employment Type</label>
              <select value={form.employment_type} onChange={e => updateField('employment_type', e.target.value)}>
                {EMPLOYMENT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Seniority Level</label>
              <select value={form.seniority_level} onChange={e => updateField('seniority_level', e.target.value)}>
                {SENIORITY_LEVELS.map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Location Type</label>
              <select value={form.location_type} onChange={e => updateField('location_type', e.target.value)}>
                {LOCATION_TYPES.map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Reporting To</label>
            <input type="text" value={form.reporting_to} onChange={e => updateField('reporting_to', e.target.value)} placeholder="e.g. Engineering Manager" />
          </div>
          <div className="form-group">
            <label>Job Description</label>
            <textarea value={form.job_description} onChange={e => updateField('job_description', e.target.value)} style={{ minHeight: '200px' }} />
          </div>
        </div>
      )}
    </Modal>
  );
}
