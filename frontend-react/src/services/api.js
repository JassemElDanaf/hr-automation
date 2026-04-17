const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5678/webhook';

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function apiPost(path, data) {
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
  return { status: res.status, data: parsed };
}
