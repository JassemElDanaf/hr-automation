import { useLocation, useNavigate } from 'react-router-dom';

const tabs = [
  { path: '/', label: 'Dashboard' },
  { path: '/jobs', label: 'Job Openings' },
  { path: '/cv-eval', label: 'CV Evaluation' },
  { path: '/shortlist', label: 'Shortlist' },
  { path: '/emails', label: 'Emails' },
];

export default function NavTabs() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="nav-tabs">
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
  );
}
