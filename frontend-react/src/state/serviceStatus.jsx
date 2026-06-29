import { useState, useEffect, useCallback, useRef } from 'react';

// While an AI task runs (CV eval / generation), n8n may be briefly busy.
// Pause "offline" detection for the duration so we don't false-alarm.
// The EvalStatus provider flips this via setServiceChecksPaused().
let _serviceChecksPaused = false;
export function setServiceChecksPaused(v) { _serviceChecksPaused = !!v; }

// Health checks for the local services the app depends on. Shared by the header
// notification panel (live status + offline/recovery notifications).
export const SERVICES = [
  {
    key: 'n8n',
    label: 'n8n',
    desc: 'Workflow engine — all API calls route through here',
    offlineHint: 'Run: docker compose up -d (or start.sh for local dev).',
    check: async () => {
      // Relative (same-origin) so it works on localhost AND through a tunnel/phone.
      await fetch('/webhook/interview/jobs', { signal: AbortSignal.timeout(9000) });
      return { ok: true }; // any response (even 500) means n8n is up; fetch throws if truly down
    },
  },
  {
    key: 'gemini',
    label: 'Gemini',
    desc: 'Gemini API — CV evaluation and question generation',
    offlineHint: (detail) => detail === 'quota exhausted'
      ? 'Daily limit reached — resets at midnight PT (08:00 UTC).'
      : 'Check GEMINI_API_KEY in .env and restart docker compose.',
    check: async () => {
      const r = await fetch('/webhook/gemini-health', { signal: AbortSignal.timeout(12000) });
      const j = await r.json().catch(() => ({}));
      if (j.ok) return { ok: true, detail: j.model || 'gemini-2.5-flash' };
      if (j.error === 'quota_exhausted') return { ok: false, detail: 'quota exhausted' };
      return { ok: false, detail: j.error || 'unreachable' };
    },
  },
  {
    key: 'smtp',
    label: 'SMTP',
    desc: 'Email sidecar — handles all candidate email sends',
    offlineHint: 'Run: python scripts/smtp_server.py',
    check: async () => {
      // Same-origin /webhook/smtp-health (n8n) so it works through a tunnel/phone.
      // It reports delivery health from email_log; a thrown fetch = backend offline.
      const hr = await fetch('/webhook/smtp-health', { signal: AbortSignal.timeout(9000) });
      if (!hr.ok) return { ok: true, detail: 'configured' };
      const hj = await hr.json().catch(() => ({}));
      const statusMap = { healthy: true, failing: false, not_tested: true, not_configured: true };
      const ok = statusMap[hj.status] !== false;
      const detail = hj.status === 'healthy' ? `healthy · ${hj.detail || ''}`
        : hj.status === 'failing' ? `failing · ${hj.detail || ''}`
        : hj.status === 'not_configured' ? 'not configured'
        : 'configured';
      return { ok, detail };
    },
  },
  {
    key: 'db',
    label: 'DB',
    desc: 'PostgreSQL database (via Docker) — stores all hiring data',
    offlineHint: 'Run: docker compose up -d postgres',
    check: async () => {
      const r = await fetch('/webhook/dashboard-candidates?job_id=all', {
        signal: AbortSignal.timeout(9000),
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

  // Debounce flapping: a single slow/timed-out check must NOT flip a service to
  // "offline". Only after TWO consecutive failed checks do we mark it offline.
  const failCounts = useRef(Object.fromEntries(SERVICES.map(s => [s.key, 0])));

  // IMPORTANT: the periodic poll must NOT reset every pill to "checking" first —
  // doing that made all the lights blink off then back on every 30s ("everything
  // shuts down then comes back"). Instead we keep the last known state and only
  // change a pill when its real status changes. `showChecking` (manual recheck)
  // is the only time we surface the transient spinner.
  const check = useCallback(async ({ showChecking = false } = {}) => {
    if (showChecking) {
      setStatuses(prev => Object.fromEntries(SERVICES.map(s => [s.key, { ...prev[s.key], state: 'checking' }])));
    }
    await Promise.all(
      SERVICES.map(async svc => {
        let ok = false, detail = '';
        try {
          const result = await svc.check();
          ok = !!result.ok; detail = result.detail || '';
        } catch { ok = false; }

        if (ok) {
          failCounts.current[svc.key] = 0;
          setStatuses(prev => (prev[svc.key]?.state === 'online' && prev[svc.key]?.detail === detail
            ? prev
            : { ...prev, [svc.key]: { state: 'online', detail } }));
        } else if (_serviceChecksPaused) {
          // AI task running → expected slowness. Don't count it against the service;
          // just settle the very-first-load spinner so it doesn't spin forever.
          failCounts.current[svc.key] = 0;
          setStatuses(prev => (prev[svc.key]?.state === 'checking'
            ? { ...prev, [svc.key]: { state: 'online', detail } }
            : prev));
        } else {
          failCounts.current[svc.key] += 1;
          setStatuses(prev => {
            // Tolerate transient blips: only a 3rd consecutive miss (~90s of solid
            // failure) flips a pill to offline. One success clears it.
            if (failCounts.current[svc.key] < 3) {
              return prev[svc.key]?.state === 'checking'
                ? { ...prev, [svc.key]: { state: 'online', detail } }
                : prev;
            }
            return prev[svc.key]?.state === 'offline' ? prev : { ...prev, [svc.key]: { state: 'offline', detail } };
          });
        }
      })
    );
  }, []);

  useEffect(() => {
    check();                                   // silent first load (init shows 'checking')
    const id = setInterval(() => check(), 300000); // poll every 5 min — Gemini quota guard
    return () => clearInterval(id);
  }, [check]);

  // Manual recheck (the ↺ button) is the one place we show the transient spinner.
  return { statuses, recheck: () => check({ showChecking: true }) };
}
