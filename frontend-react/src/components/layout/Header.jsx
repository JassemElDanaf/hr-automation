import { useState, useEffect, useRef } from 'react';
import { useSelectedJob } from '../../state/selectedJob';
import { useAuth } from '../../state/auth';
import { apiGet } from '../../services/api';

const ROLE_META = {
  admin:     ['Admin', '#5b21b6'],
  recruiter: ['Recruiter', '#1e40af'],
  viewer:    ['Viewer · read-only', '#475569'],
};

export default function Header() {
  const { selectedJob, setSelectedJob, clearSelectedJob } = useSelectedJob();
  const { user, role, logout } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    apiGet('/job-openings').then(r => setJobs(r.data || [])).catch(() => {});
  }, []);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function pick(job) {
    setSelectedJob(job); // single source of truth — every tab mirrors this
    setOpen(false);
  }

  return (
    <div className="header">
      <h1><span>Diyar</span> HR Automation</h1>

      <div className="global-job-picker" ref={ref}>
        <button
          type="button"
          className={`global-job-badge${selectedJob ? '' : ' empty'}`}
          onClick={() => setOpen(o => !o)}
          title="Select the job that all tabs work on"
        >
          {selectedJob ? (
            <>
              <span className="global-job-label">Current Job:</span>
              <span className="global-job-title">{selectedJob.job_title}</span>
              {selectedJob.department && <span className="global-job-dept">&middot; {selectedJob.department}</span>}
            </>
          ) : (
            <span className="global-job-label">Select a job opening to continue</span>
          )}
          <span className="global-job-caret">{open ? '▴' : '▾'}</span>
        </button>

        {open && (() => {
          const activeJobs = jobs.filter(j => j.is_active);
          const inactiveJobs = jobs.filter(j => !j.is_active);
          return (
            <div className="global-job-menu">
              <div className="global-job-menu-head">Work on job</div>
              {jobs.length === 0 && <div className="global-job-menu-empty">No job openings yet</div>}
              {jobs.length > 0 && activeJobs.length === 0 && (
                <div className="global-job-menu-empty">No active jobs — reactivate one in Job Openings.</div>
              )}
              {activeJobs.map(j => (
                <button
                  key={j.id}
                  type="button"
                  className={`global-job-menu-item${selectedJob?.id === j.id ? ' active' : ''}`}
                  onClick={() => pick(j)}
                >
                  <span className="gjm-title">{j.job_title}</span>
                  {j.department && <span className="gjm-dept">{j.department}</span>}
                  {selectedJob?.id === j.id && <span className="gjm-check">{'✓'}</span>}
                </button>
              ))}
              {/* Inactive (closed) jobs can't be worked on — shown for context but
                  not selectable. Reactivate in Job Openings to pick one. */}
              {inactiveJobs.length > 0 && (
                <>
                  <div className="global-job-menu-subhead">Inactive</div>
                  {inactiveJobs.map(j => (
                    <div
                      key={j.id}
                      className="global-job-menu-item disabled"
                      title="This job is inactive — reactivate it in Job Openings to work on it"
                    >
                      <span className="gjm-title">{j.job_title}</span>
                      <span className="gjm-inactive">Inactive</span>
                      {selectedJob?.id === j.id && <span className="gjm-check">{'✓'}</span>}
                    </div>
                  ))}
                </>
              )}
              {selectedJob && (
                <button type="button" className="global-job-menu-clear" onClick={() => { clearSelectedJob(); setOpen(false); }}>
                  {'×'} Clear selection
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {user && (() => {
        const [rlabel, rcolor] = ROLE_META[role] || ['', 'var(--gray-500)'];
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
            <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>{user.full_name || user.email}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: rcolor }}>{rlabel}</div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={logout} title="Sign out">Logout</button>
          </div>
        );
      })()}
    </div>
  );
}
