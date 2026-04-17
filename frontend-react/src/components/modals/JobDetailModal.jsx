import { useState, useEffect } from 'react';
import Modal from './Modal';
import Badge from '../common/Badge';
import Loading from '../common/Loading';
import { apiGet, apiPost } from '../../services/api';
import { useUI } from '../../state/uiState';
import { formatDateTime } from '../../utils/helpers';

export default function JobDetailModal({ jobId, isOpen, onClose, onToggle }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const { showToast } = useUI();

  useEffect(() => {
    if (isOpen && jobId) {
      setLoading(true);
      apiGet(`/job-opening?id=${jobId}`)
        .then(res => setJob(res.data))
        .catch(() => showToast('Failed to load job details', 'error'))
        .finally(() => setLoading(false));
    }
  }, [isOpen, jobId]);

  const handleToggle = async () => {
    try {
      const res = await apiPost(`/job-opening-toggle?id=${jobId}`, {});
      if (res.data.success) {
        showToast(`Job is now ${res.data.data.is_active ? 'active' : 'inactive'}`, 'success');
        onToggle?.();
        onClose();
      }
    } catch { showToast('Failed to toggle', 'error'); }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={job?.job_title || 'Job Details'}
      footer={job && (
        <>
          <button className={`btn ${job.is_active ? 'btn-danger' : 'btn-success'}`} onClick={handleToggle}>
            {job.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </>
      )}
    >
      {loading ? <Loading /> : job && (
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
            <div className="value">{job.job_description}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
