import { Page, expect } from '@playwright/test';

// ── Credentials (seeded this environment; all three reset to ChangeMe123!) ──
export const USERS = {
  admin:     { email: 'admin@diyarme.com',     password: 'ChangeMe123!' },
  recruiter: { email: 'recruiter@diyarme.com', password: 'ChangeMe123!' },
  viewer:    { email: 'viewer@diyarme.com',    password: 'ChangeMe123!' },
} as const;

// ── QA data markers — global teardown deletes everything matching these ─────
// Keep ALL test data tagged so cleanup-by-label is exhaustive and safe.
export const QA_TAG = '(TEST)';                 // appended to every job title etc.
export const QA_EMAIL_DOMAIN = '@example.com';  // every synthetic candidate email
export const qaName = (s: string) => `QA ${s} ${QA_TAG}`;
export const qaEmail = (s: string) => `qa.${s}${QA_EMAIL_DOMAIN}`;

// The app stores its session token here (see state/auth.jsx).
const TOKEN_KEY = 'hr_auth_token';

/** Log in through the real login form. The app has no data-testids, so we use
 *  placeholder/role locators derived from pages/Login.jsx. */
export async function login(page: Page, role: keyof typeof USERS = 'admin') {
  const { email, password } = USERS[role];
  await page.goto('/');
  // RequireAuth renders the Login form when there's no valid token.
  await page.getByPlaceholder('you@diyarme.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /sign in|log ?in/i }).click();
  // Logged-in state: token persisted + the header/nav rendered.
  await expect.poll(
    async () => page.evaluate((k) => localStorage.getItem(k), TOKEN_KEY),
    { timeout: 15_000 },
  ).not.toBeNull();
}

/** Click a top-nav tab by its visible label. NavTabs renders <button onClick=navigate>. */
export async function gotoTab(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
}

/** Wait until the global "AI working" indicator (if any) has settled, then a beat. */
export async function settle(page: Page, ms = 500) {
  await page.waitForTimeout(ms);
}

// ── API setup helpers (robust response parsing) ─────────────────────────────
const WEBHOOK = 'http://localhost:5678/webhook';
function row(body: any) { const d = body?.data ?? body; return Array.isArray(d) ? d[0] : d; }

export async function apiCreateJob(api: any, title: string, jobDescription = 'QA automated end-to-end test role for the Diyar HR suite.'): Promise<number> {
  const r = await api.post(`${WEBHOOK}/job-openings`, { data: {
    job_title: title, department: 'Engineering', employment_type: 'Full-time',
    seniority_level: 'Mid-level', location_type: 'Hybrid', reporting_to: 'cto@diyarme.com',
    description_source: 'manual', job_description: jobDescription,
  }, timeout: 30_000 });
  const id = row(await r.json())?.id;
  if (!id) throw new Error(`apiCreateJob failed: ${await r.text()}`);
  return id;
}

export async function apiCreateCandidate(api: any, jobId: number, name: string, email: string, cvText = 'QA automated test candidate with backend experience in Python and PostgreSQL.'): Promise<number> {
  const r = await api.post(`${WEBHOOK}/cv-submit`, { data: {
    job_opening_id: jobId, candidate_name: name, email, cv_text: cvText,
    cv_file_name: null, cv_file_data: null, cv_file_mime: null,
  }, timeout: 30_000 });
  const id = row(await r.json())?.id;
  if (!id) throw new Error(`apiCreateCandidate failed: ${await r.text()}`);
  return id;
}

/** Set the cross-tab "global selected job" the way the app does (localStorage),
 *  so Shortlist/Emails/Interview tabs land on the right job without UI fiddling. */
export async function selectJobGlobally(page: Page, job: { id: number; job_title: string; department?: string }) {
  await page.addInitScript((j) => {
    localStorage.setItem('hr_selected_job', JSON.stringify(j));
  }, { id: job.id, job_title: job.job_title, department: job.department || 'Engineering' });
}
