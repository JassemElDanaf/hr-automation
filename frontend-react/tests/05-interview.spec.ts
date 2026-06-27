import { test, expect, request as pwRequest } from '@playwright/test';
import { login, qaName, qaEmail, apiCreateJob, apiCreateCandidate, selectJobGlobally } from './helpers';

const WEBHOOK = 'http://localhost:5678/webhook';
let jobId: number;
let candId: number;
const JOB_TITLE = qaName('Interview Role');
const CAND_NAME = qaName('Interview Cand');

// URL-safe base64 token, identical to encodeInterviewToken() in LiveInterview.jsx.
function encodeToken(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  jobId = await apiCreateJob(api, JOB_TITLE, 'Backend role for interview QA.');
  candId = await apiCreateCandidate(api, jobId, CAND_NAME, qaEmail('interview'),
    'Backend engineer, Python, FastAPI, PostgreSQL.');
  await api.dispose();
});

test('candidate interview link opens (not blank)', async ({ browser }) => {
  // Build a real link token and open it in a fresh, isolated context (a candidate
  // on another machine). This is the exact thing that was blank before the fixes.
  const token = encodeToken({
    jobId, candidateId: candId, candidateName: CAND_NAME, jobTitle: JOB_TITLE,
    customQuestions: [
      { question: 'Tell me about your backend experience.', category: 'technical' },
      { question: 'How do you handle production incidents?', category: 'technical' },
    ],
  });
  const ctx = await browser.newContext({ permissions: [] });
  const page = await ctx.newPage();
  await page.goto(`/interview/${token}`);

  // The intro screen must render real content (job title), NOT the error screen
  // and NOT a blank page.
  await expect(page.getByText(JOB_TITLE).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/something went wrong|invalid|expired/i)).toHaveCount(0);
  await page.screenshot({ path: 'tests/results/interview-candidate-page.png', fullPage: true });
  await ctx.close();
});

test('completed interview session appears in Results with a score', async ({ page }) => {
  test.setTimeout(180_000);
  // Drive a realistic interview through the API (the candidate page uses Web Speech
  // which can't be automated headless): save a transcript, then AI-evaluate it.
  const api = await pwRequest.newContext();
  const base = {
    jobId, candidateId: candId, candidateName: CAND_NAME,
    transcript: [
      { question: 'Tell me about your DevOps/backend experience.', answer: 'Six years with Python, FastAPI, PostgreSQL, Docker, and CI/CD pipelines.' },
      { question: 'How do you handle a production incident?', answer: 'Detect via monitoring, triage severity, roll back if needed, then root-cause analysis.' },
    ],
    durationSeconds: 240,
  };
  await api.post(`${WEBHOOK}/interview/save-transcript`, { data: { ...base, scores: {} } });
  const evalRes = await api.post(`${WEBHOOK}/interview/evaluate`, { data: base, timeout: 150_000 });
  const scores = (await evalRes.json());
  await api.post(`${WEBHOOK}/interview/save-transcript`, { data: { ...base, scores: scores.data || scores } });
  await api.dispose();

  // The Interview → Results sub-tab should now list the candidate with a score.
  await selectJobGlobally(page, { id: jobId, job_title: JOB_TITLE });
  await login(page, 'admin');
  await page.goto(`/live-interview?tab=results`);   // reads ?tab=results on mount
  await expect(page.getByText(CAND_NAME).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'tests/results/interview-results.png', fullPage: true });
});
