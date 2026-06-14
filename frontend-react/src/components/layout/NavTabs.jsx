import { useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';

const tabs = [
  { path: '/', label: 'Dashboard' },
  { path: '/jobs', label: 'Job Openings' },
  { path: '/talent-pool', label: 'CV Pool' },
  { path: '/cv-eval', label: 'CV Evaluation' },
  { path: '/shortlist', label: 'Shortlist' },
  { path: '/live-interview', label: 'Interview' },
  { path: '/emails', label: 'Emails' },
];

const SERVICES = [
  {
    key: 'n8n',
    label: 'n8n',
    desc: 'Workflow engine — all API calls route through here',
    offlineHint: 'Run start.sh to bring n8n online.',
    check: async () => {
      // /healthz has no CORS headers — use a webhook endpoint instead
      await fetch('http://localhost:5678/webhook/interview/jobs', { signal: AbortSignal.timeout(3000) });
      return { ok: true }; // any response (even 500) means n8n is up; fetch throws if truly down
    },
  },
  {
    key: 'ollama',
    label: 'Ollama',
    desc: 'Local AI — CV evaluation and question generation',
    offlineHint: 'Run: ollama serve',
    check: async () => {
      const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return { ok: false };
      const j = await r.json();
      const qwen = (j.models || []).find(m => m.name.includes('qwen'));
      return { ok: true, detail: qwen ? qwen.name.replace(':latest', '') : `${(j.models || []).length} model(s)` };
    },
  },
  {
    key: 'smtp',
    label: 'SMTP',
    desc: 'Email sidecar — handles all candidate email sends',
    offlineHint: 'Run: python scripts/smtp_server.py',
    check: async () => {
      // Sidecar must be up first (fast check)
      const sidecar = await fetch('http://localhost:8901/', { signal: AbortSignal.timeout(3000) });
      if (!sidecar.ok) return { ok: false, detail: 'sidecar offline' };
      const sc = await sidecar.json();
      if (!sc.smtp_configured) return { ok: true, detail: 'not configured' };
      // Ask n8n for real delivery health based on email_log
      try {
        const hr = await fetch('http://localhost:5678/webhook/smtp-health', { signal: AbortSignal.timeout(4000) });
        if (!hr.ok) return { ok: true, detail: 'configured' };
        const hj = await hr.json();
        const statusMap = { healthy: true, failing: false, not_tested: true };
        const ok = statusMap[hj.status] !== false;
        const detail = hj.status === 'healthy' ? `healthy · ${hj.detail}`
          : hj.status === 'failing' ? `failing · ${hj.detail}`
          : 'configured · no sends yet';
        return { ok, detail };
      } catch {
        return { ok: true, detail: 'configured' };
      }
    },
  },
  {
    key: 'db',
    label: 'DB',
    desc: 'PostgreSQL database (via Docker) — stores all hiring data',
    offlineHint: 'Run: docker start hr-postgres',
    check: async () => {
      const r = await fetch('http://localhost:5678/webhook/dashboard-candidates?job_id=all', {
        signal: AbortSignal.timeout(4000),
      });
      const text = await r.text();
      return (!text || text.trim().length < 2) ? { ok: false } : { ok: true };
    },
  },
];

function useServiceStatuses() {
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(SERVICES.map(s => [s.key, { state: 'checking', detail: '' }]))
  );

  const check = useCallback(async () => {
    setStatuses(prev =>
      Object.fromEntries(SERVICES.map(s => [s.key, { ...prev[s.key], state: 'checking' }]))
    );
    await Promise.all(
      SERVICES.map(async svc => {
        try {
          const result = await svc.check();
          setStatuses(prev => ({ ...prev, [svc.key]: { state: result.ok ? 'online' : 'offline', detail: result.detail || '' } }));
        } catch {
          setStatuses(prev => ({ ...prev, [svc.key]: { state: 'offline', detail: '' } }));
        }
      })
    );
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [check]);

  return { statuses, recheck: check };
}

function ServicePill({ svc, status }) {
  const [hover, setHover] = useState(false);

  const isOnline  = status.state === 'online';
  const isOffline = status.state === 'offline';

  const dot    = isOnline ? '#22c55e' : isOffline ? '#ef4444' : '#94a3b8';
  const bg     = isOnline ? '#f0fdf4' : isOffline ? '#fef2f2' : '#f8fafc';
  const border = isOnline ? '#bbf7d0' : isOffline ? '#fecaca' : '#e2e8f0';
  const text   = isOnline ? '#15803d' : isOffline ? '#dc2626'  : '#64748b';

  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 9px 3px 7px', borderRadius: 20,
        border: `1px solid ${border}`, background: bg,
        cursor: 'default', userSelect: 'none',
      }}>
        <span style={{
          display: 'block', width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: dot,
          animation: isOnline ? 'ollamaPulse 2.5s infinite' : status.state === 'checking' ? 'spin 1s linear infinite' : 'none',
        }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: text, whiteSpace: 'nowrap' }}>
          {svc.label}
        </span>
        {status.detail && (
          <span style={{ fontSize: 10, color: text, opacity: 0.65, whiteSpace: 'nowrap' }}>
            · {status.detail}
          </span>
        )}
      </div>

      {/* Tooltip — below the pill */}
      {hover && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 300,
          background: '#1e293b', color: '#f1f5f9', borderRadius: 8,
          padding: '11px 14px', width: 210, fontSize: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.25)', pointerEvents: 'none',
        }}>
          {/* Arrow pointing up */}
          <div style={{
            position: 'absolute', top: -5, right: 18,
            width: 10, height: 10, background: '#1e293b',
            transform: 'rotate(45deg)', borderRadius: 2,
          }} />
          <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block', flexShrink: 0 }} />
            {svc.label} — {isOnline ? 'running' : isOffline ? 'offline' : 'checking…'}
          </div>
          <div style={{ color: '#94a3b8', lineHeight: 1.5, fontSize: 11 }}>{svc.desc}</div>
          {status.detail && (
            <div style={{ marginTop: 5, color: '#cbd5e1', fontSize: 11 }}>{status.detail}</div>
          )}
          {isOffline && (
            <div style={{ marginTop: 6, padding: '5px 8px', background: '#450a0a', borderRadius: 5, color: '#fca5a5', fontSize: 11, lineHeight: 1.4 }}>
              {svc.offlineHint}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NavTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { statuses, recheck } = useServiceStatuses();
  const [rechecking, setRechecking] = useState(false);

  async function handleRecheck() {
    setRechecking(true);
    await recheck();
    setRechecking(false);
  }

  const offlineCount = Object.values(statuses).filter(s => s.state === 'offline').length;

  return (
    <div className="nav-tabs" style={{ justifyContent: 'space-between' }}>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 2 }}>
        {SERVICES.map(svc => (
          <ServicePill key={svc.key} svc={svc} status={statuses[svc.key]} />
        ))}
        <button
          onClick={handleRecheck}
          disabled={rechecking}
          title="Recheck all services"
          style={{
            width: 26, height: 26, borderRadius: '50%',
            border: `1px solid ${offlineCount > 0 ? '#fecaca' : 'var(--gray-200)'}`,
            background: '#fff', cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: offlineCount > 0 ? '#ef4444' : 'var(--gray-400)',
            animation: rechecking ? 'spin 0.8s linear infinite' : 'none',
            flexShrink: 0,
          }}
        >↺</button>
      </div>
    </div>
  );
}
