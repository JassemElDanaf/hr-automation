// Relative by default — the vite dev server proxies /webhook to n8n (:5678),
// so the same page works on localhost and through a tunnel for candidates.
import { logAudit } from './auth';

const API_BASE = import.meta.env.VITE_API_URL || '/webhook';

// Viewer read-only gate. Every write goes through apiPost, so blocking it here
// is a single enforcement point for the 'viewer' role (UI-level RBAC). The
// AuthProvider registers the role; UIProvider registers the toast fn.
let _authRole = null;
let _toastFn = null;
export function setAuthRole(role) { _authRole = role; }
export function setToastFn(fn) { _toastFn = fn; }
export function isReadOnly() { return _authRole === 'viewer'; }

// Audit: meaningful writes are logged (who did what) at this single chokepoint.
const AUDIT_MAP = {
  '/update-shortlist-status': (p) => ({ action: `status:${p.status}`, entity_type: 'shortlist', entity_id: p.id, detail: { status: p.status } }),
  '/send-email': (p) => ({ action: 'email:sent', entity_type: 'candidate', entity_id: p.candidate_id, detail: { type: p.email_type, to: p.recipient_email } }),
  '/cv-evaluate': (p) => ({ action: 'cv:evaluated', entity_type: 'job', entity_id: p.job_opening_id, detail: p.candidate_id ? { candidate_id: p.candidate_id } : { batch: true } }),
  '/job-opening-toggle': (p, parsed) => ({ action: parsed?.data?.is_active ? 'job:activated' : 'job:deactivated', entity_type: 'job', entity_id: parsed?.data?.id ?? null, detail: null }),
};

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function apiPost(path, data) {
  if (_authRole === 'viewer') {
    if (_toastFn) _toastFn('Read-only access — ask an admin for Recruiter rights to make changes.', 'error');
    return { status: 403, data: { success: false, error: 'read_only' } };
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; }
  catch { parsed = { success: false, error: `Invalid response from server (HTTP ${res.status})` }; }
  if (!res.ok && !parsed.error) parsed.error = `Server returned HTTP ${res.status}`;
  // Fire-and-forget audit for meaningful writes.
  try {
    const fn = AUDIT_MAP[path.split('?')[0]];
    if (fn && (res.ok || parsed.success)) {
      const ev = fn(data || {}, parsed);
      if (ev && ev.action) logAudit(ev.action, ev.entity_type, ev.entity_id, ev.detail);
    }
  } catch {}
  return { status: res.status, data: parsed };
}
