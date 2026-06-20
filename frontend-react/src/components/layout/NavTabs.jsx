import { useLocation, useNavigate } from 'react-router-dom';

const tabs = [
  { path: '/', label: 'Dashboard' },
  { path: '/jobs', label: 'Job Openings' },
  { path: '/talent-pool', label: 'CV Pool' },
  { path: '/cv-eval', label: 'CV Evaluation' },
  { path: '/shortlist', label: 'Shortlist' },
  { path: '/live-interview', label: 'Interview' },
  { path: '/decision', label: 'Decision' },
  { path: '/emails', label: 'Emails' },
];

// Service health (n8n / Ollama / SMTP / DB) used to live here as pills; it now
// lives in the header notification panel (see NotificationBell + serviceStatus).
export default function NavTabs() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="nav-tabs" style={{ display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex' }}>
        {tabs.map(tab => (
          <button
            key={tab.path}
            className={`nav-tab ${location.pathname === tab.path ? 'active' : ''}`}
            onClick={() => navigate(tab.path)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Right-side slot — pages portal toolbar widgets here (e.g. Decision's
          score blend) so they sit in the empty nav-row space. */}
      <div id="navbar-slot" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }} />
    </div>
  );
}
