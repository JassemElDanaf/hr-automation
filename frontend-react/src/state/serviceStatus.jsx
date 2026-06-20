import { useState, useEffect, useCallback } from 'react';

// Health checks for the local services the app depends on. Shared by the header
// notification panel (live status + offline/recovery notifications).
export const SERVICES = [
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

export function useServiceStatuses() {
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
