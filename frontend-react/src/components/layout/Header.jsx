import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelectedJob } from '../../state/selectedJob';
import { useAuth } from '../../state/auth';
import { useTheme } from '../../state/theme';
import { apiGet } from '../../services/api';
import ChangePasswordModal from '../modals/ChangePasswordModal';
import NotificationBell from './NotificationBell';

const ROLE_META = {
  admin:     ['Admin', '#5b21b6', '#ede9fe'],
  recruiter: ['Recruiter', '#1e40af', '#dbeafe'],
  viewer:    ['Viewer · read-only', '#475569', '#f1f5f9'],
};

export default function Header() {
  const navigate = useNavigate();
  const { selectedJob, setSelectedJob, clearSelectedJob, jobsNonce } = useSelectedJob();
  const { user, role, isAdmin, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    apiGet('/job-openings').then(r => setJobs(r.data || [])).catch(() => {});
  }, [jobsNonce]);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Settings/account menu — outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setMenuOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const initials = (user?.full_name || user?.email || '?').trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();

  function pick(job) {
    setSelectedJob(job); // single source of truth — every tab mirrors this
    setOpen(false);
  }

  return (
    <div className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/logo.jpg" alt="Diyar" style={{ height: 30, width: 'auto', borderRadius: 6, display: 'block' }} />
        <h1><span>Diyar</span> HR</h1>
      </div>

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

      {user && <div style={{ marginLeft: 'auto' }}><NotificationBell /></div>}

      {user && (() => {
        const [rlabel, rcolor, rbg] = ROLE_META[role] || ['', 'var(--gray-500)', 'var(--gray-100)'];
        return (
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              title="Account & settings"
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 10px 5px 6px', borderRadius: 22, border: '1px solid var(--gray-200)', background: menuOpen ? 'var(--gray-50)' : 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#1e40af', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</span>
              <span style={{ textAlign: 'left', lineHeight: 1.2 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>{user.full_name || user.email}</span>
                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 600, color: rcolor }}>{rlabel}</span>
              </span>
              <span style={{ fontSize: 16, color: 'var(--gray-400)', lineHeight: 1 }}>⚙</span>
            </button>

            {menuOpen && (
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 300, width: 244, background: 'var(--surface)', border: '1px solid var(--gray-200)', borderRadius: 12, boxShadow: '0 10px 34px rgba(0,0,0,0.14)', overflow: 'hidden' }}>
                {/* Account header */}
                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--gray-100)', display: 'flex', gap: 11, alignItems: 'center' }}>
                  <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#1e40af', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gray-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.full_name || user.email}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--gray-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
                    <span style={{ display: 'inline-block', marginTop: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 10, background: rbg, color: rcolor }}>{rlabel}</span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ padding: '6px 0' }}>
                  <button onClick={(e) => { e.stopPropagation(); toggleTheme(); }} style={menuItem}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    <span style={menuIcon}>{isDark ? '🌙' : '☀️'}</span> Dark mode
                    <span aria-hidden style={{ marginLeft: 'auto', width: 38, height: 22, borderRadius: 11, background: isDark ? '#3b82f6' : 'var(--gray-300)', position: 'relative', flexShrink: 0, transition: 'background 0.2s ease' }}>
                      <span style={{ position: 'absolute', top: 2, left: isDark ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left 0.2s ease' }} />
                    </span>
                  </button>
                  <button onClick={() => { setMenuOpen(false); setPwOpen(true); }} style={menuItem}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    <span style={menuIcon}>🔑</span> Change password
                  </button>
                  {isAdmin && (
                    <button onClick={() => { setMenuOpen(false); navigate('/users'); }} style={menuItem}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <span style={menuIcon}>👥</span> Users &amp; Access
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => { setMenuOpen(false); navigate('/email-templates'); }} style={menuItem}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <span style={menuIcon}>✉</span> Email templates
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => { setMenuOpen(false); navigate('/audit-log'); }} style={menuItem}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <span style={menuIcon}>🧾</span> Audit log
                    </button>
                  )}
                  <button onClick={() => { setMenuOpen(false); logout(); }} style={{ ...menuItem, color: '#b91c1c' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    <span style={menuIcon}>⎋</span> Log out
                  </button>
                </div>

                {/* Info footer */}
                <div style={{ padding: '9px 16px', borderTop: '1px solid var(--gray-100)', background: 'var(--gray-50)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)' }}>Diyar HR</div>
                  <div style={{ fontSize: 10.5, color: 'var(--gray-400)', marginTop: 1 }}>Local-first hiring workspace</div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <ChangePasswordModal isOpen={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

const menuItem = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 16px', fontSize: 13.5, fontWeight: 500, color: 'var(--gray-700)', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit' };
const menuIcon = { fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 };
