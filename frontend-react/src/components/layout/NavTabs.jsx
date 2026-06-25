import { useState, useEffect } from 'react';
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
//
// Desktop: the tab list renders as a horizontal row exactly as before (the
// hamburger is hidden via CSS, so desktop is byte-identical). Mobile (≤768px):
// the row collapses and the hamburger toggles a vertical drop-down of all tabs.
export default function NavTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const activeLabel = tabs.find(t => t.path === location.pathname)?.label || 'Menu';

  function go(path) { navigate(path); setOpen(false); }

  return (
    <div className="nav-tabs" style={{ display: 'flex', alignItems: 'center' }}>
      {/* Hamburger — mobile only (CSS hides it on desktop). Shows the current
          tab name so the user always knows where they are. */}
      <button
        type="button"
        className="nav-hamburger"
        aria-label="Open navigation menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="nav-hamburger-icon" aria-hidden>{open ? '✕' : '☰'}</span>
        <span className="nav-hamburger-current">{activeLabel}</span>
      </button>

      {/* Mobile-only slot — the header portals the global job picker here so it
          sits on the same row as the hamburger (CSS hides it on desktop). */}
      <div id="nav-job-slot" className="nav-job-slot" />

      <div className={`nav-tab-list ${open ? 'open' : ''}`}>
        {tabs.map(tab => (
          <button
            key={tab.path}
            className={`nav-tab ${location.pathname === tab.path ? 'active' : ''}`}
            onClick={() => go(tab.path)}
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
