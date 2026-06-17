// Auth API client — talks to the auth sidecar (Vite proxies /auth -> :8904).
// The session token is an opaque UUID stored in localStorage and sent as a
// Bearer header. Passwords never touch the client beyond the login POST.

const TOKEN_KEY = 'hr_auth_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

function authHeaders(extra = {}) {
  return { ...extra, Authorization: `Bearer ${getToken()}` };
}

export async function login(email, password) {
  const r = await fetch('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Login failed');
  return j; // { token, user }
}

export async function fetchMe(tok) {
  try {
    const r = await fetch('/auth/me', { headers: { Authorization: `Bearer ${tok || getToken()}` } });
    if (!r.ok) return null;
    return (await r.json()).user;
  } catch { return null; }
}

export async function logoutRequest() {
  try { await fetch('/auth/logout', { method: 'POST', headers: authHeaders() }); } catch {}
}

export async function listUsers() {
  const r = await fetch('/auth/users', { headers: authHeaders() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Failed to load users');
  return j.users;
}

export async function createUser(payload) {
  const r = await fetch('/auth/users', {
    method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Failed to create user');
  return j.user;
}

export async function updateUser(payload) {
  const r = await fetch('/auth/users', {
    method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Failed to update user');
  return j.user;
}
