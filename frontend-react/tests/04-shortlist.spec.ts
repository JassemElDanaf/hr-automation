import { test, expect, request as pwRequest } from '@playwright/test';
import { login, qaName, qaEmail, apiCreateJob, apiCreateCandidate, selectJobGlobally } from './helpers';

const WEBHOOK = 'http://localhost:5678/webhook';
let jobId: number;
let candId: number;
const JOB_TITLE = qaName('Shortlist Role');
const CAND_NAME = qaName('Shortlist Cand');

// Seed a job + a shortlisted candidate via the API; the UI test verifies the
// Shortlist tab displays it and a status transition reflects.
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  jobId = await apiCreateJob(api, JOB_TITLE, 'Backend role for shortlist QA: Python, PostgreSQL, Docker.');
  candId = await apiCreateCandidate(api, jobId, CAND_NAME, qaEmail('sl'),
    'Backend engineer, 5 years Python, PostgreSQL, Docker, REST APIs.');
  await api.post(`${WEBHOOK}/add-to-shortlist`, { data: { candidate_id: candId, job_opening_id: jobId } });
  await api.dispose();
});

test('shortlisted candidate shows on the Shortlist tab', async ({ page }) => {
  await selectJobGlobally(page, { id: jobId, job_title: JOB_TITLE });
  await login(page, 'admin');
  await page.goto(`/shortlist?focus=${candId}`);

  const card = page.locator(`#sl-cand-${candId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Shortlist Cand');
  await page.screenshot({ path: 'tests/results/shortlist-card.png', fullPage: true });
});

test('status auto-advances to Interviewed when a session exists', async ({ page }) => {
  // A completed interview session should auto-advance shortlisted → interviewed.
  const api = await pwRequest.newContext();
  await api.post(`${WEBHOOK}/interview/save-transcript`, { data: {
    jobId, candidateId: candId, candidateName: CAND_NAME,
    transcript: [{ question: 'Tell me about your backend experience.', answer: 'Five years of Python and PostgreSQL.' }],
    durationSeconds: 120, scores: {},
  }});
  await api.dispose();

  await selectJobGlobally(page, { id: jobId, job_title: JOB_TITLE });
  await login(page, 'admin');
  await page.goto(`/shortlist?focus=${candId}`);

  const card = page.locator(`#sl-cand-${candId}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText(/interviewed/i, { timeout: 12_000 });
  await page.screenshot({ path: 'tests/results/shortlist-interviewed.png', fullPage: true });
});
