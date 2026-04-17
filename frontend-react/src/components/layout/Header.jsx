import { useSelectedJob } from '../../state/selectedJob';

export default function Header() {
  const { selectedJob, clearSelectedJob } = useSelectedJob();

  return (
    <div className="header">
      <h1><span>Diyar</span> HR Automation</h1>
      {selectedJob ? (
        <div className="global-job-badge">
          <span className="global-job-label">Current Job:</span>
          <span className="global-job-title">{selectedJob.job_title}</span>
          {selectedJob.department && (
            <span className="global-job-dept">&middot; {selectedJob.department}</span>
          )}
          <button className="global-job-clear" title="Clear selection" onClick={clearSelectedJob}>&times;</button>
        </div>
      ) : (
        <div className="global-job-badge empty">
          <span className="global-job-label">Select a job opening to continue</span>
        </div>
      )}
    </div>
  );
}
