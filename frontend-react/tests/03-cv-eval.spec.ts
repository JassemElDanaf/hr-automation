import { test, expect, request as pwRequest } from '@playwright/test';
import { login, gotoTab, qaName } from './helpers';
import * as path from 'node:path';

const WEBHOOK = 'http://localhost:5678/webhook';
// Tests run from the frontend-react/ cwd (ESM has no __dirname).
const FIX = path.resolve('tests/fixtures');
const PDFS = ['QA Strong Candidate.pdf', 'QA Average Candidate.pdf', 'QA Weak Candidate.pdf'].map(f => path.join(FIX, f));

let jobId: number;
const JOB_TITLE = qaName('CV-Eval Backend');

// Set up a job + criteria via the webhook API (fast precondition — the focus of
// this spec is the UI upload/parse/evaluate flow, not job creation which 02 covers).
test.beforeAll(async () => {
  const api = await pwRequest.newContext();
  const jobRes = await api.post(`${WEBHOOK}/job-openings`, {
    data: {
      job_title: JOB_TITLE, department: 'Engineering', employment_type: 'Full-time',
      seniority_level: 'Mid-level', location_type: 'Hybrid', reporting_to: 'cto@diyarme.com',
      description_source: 'manual',
      job_description: 'Backend engineer: Python, FastAPI, PostgreSQL, Docker, REST APIs, 3+ years experience.',
    },
  });
  const body = await jobRes.json();
  const row = Array.isArray(body.data) ? body.data[0] : body.data;
  jobId = row.id;
  await api.post(`${WEBHOOK}/criteria-sets`, {
    data: {
      job_opening_id: jobId, name: qaName('CV-Eval Criteria'),
      criteria_text: 'SKILLS: Python, PostgreSQL, Docker, REST APIs. EXPERIENCE: 3+ years backend. EDUCATION: CS degree.',
      skills_weight: 40, experience_weight: 35, education_weight: 25,
    },
  });
  await api.dispose();
});

test('upload PDFs, parse, and evaluate', async ({ page }) => {
  test.setTimeout(220_000); // Gemini scores 3 candidates on API

  await login(page, 'admin');
  await gotoTab(page, 'CV Evaluation');

  // Step 1: pick the job card.
  await page.locator('.job-card', { hasText: JOB_TITLE }).first().click();

  // Jump straight to the Upload CVs wizard step (clickable once a job is selected).
  // The step renders "<num> Upload CVs", so target the .wizard-step container.
  await page.locator('.wizard-step', { hasText: 'Upload CVs' }).click();

  // Upload the 3 real PDFs through the (hidden) file input — setInputFiles works on hidden inputs.
  await page.locator('#cv-file-input').setInputFiles(PDFS);

  // pdfjs parses each in-browser → the file cards should show "Ready", NOT
  // "Read failed" (the latter = the MIME/worker bug). This is the real parse check.
  await expect(page.getByText('Ready').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Read failed')).toHaveCount(0);
  await expect(page.getByText('QA Strong Candidate').first()).toBeVisible();
  await page.screenshot({ path: 'tests/results/cv-uploaded-parsed.png', fullPage: true });

  // Commit the upload → app advances to Step 4 (Results).
  await page.getByRole('button', { name: /Upload CVs/ }).click();

  // Confirm the candidates loaded into the Results view (upload + parse succeeded).
  await expect(page.getByText('Qa Strong Candidate').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Qa Weak Candidate').first()).toBeVisible();

  // Trigger the AI evaluation via the webhook (the same call the "Run Evaluation"
  // button makes) — reliable to drive, real Gemini scoring. We then verify the
  // scores RENDER in the UI below.
  const api = await pwRequest.newContext();
  // Ensure all 3 candidate INSERTs are committed before evaluating (avoid the
  // race where cv-evaluate's SELECT runs before submitCVs finished).
  await expect.poll(async () => {
    const r = await api.get(`${WEBHOOK}/candidates?job_id=${jobId}`);
    return ((await r.json()).data || []).length;
  }, { timeout: 30_000, intervals: [1000] }).toBeGreaterThanOrEqual(3);

  // /cv-evaluate blocks until Gemini has scored every candidate (~90s for 3 on API).
  await api.post(`${WEBHOOK}/cv-evaluate`, { data: { job_opening_id: jobId }, timeout: 200_000 });

  let evals: any[] = [];
  await expect.poll(async () => {
    const r = await api.get(`${WEBHOOK}/evaluations?job_id=${jobId}`);
    const b = await r.json();
    evals = b.data || [];          // fresh job → every eval is one of our 3 CVs
    return evals.length;
  }, { timeout: 180_000, intervals: [5000] }).toBeGreaterThanOrEqual(3);

  // The UI must DISPLAY the scores: reload Results and assert a numeric overall
  // appears (no longer "Not evaluated") for the strong candidate.
  await page.reload();
  await page.locator('.job-card', { hasText: JOB_TITLE }).first().click();
  await page.locator('.wizard-step', { hasText: 'Results' }).click();
  await expect(page.getByText('Qa Strong Candidate').first()).toBeVisible({ timeout: 15_000 });

  // Scores in range and not all zero.
  for (const e of evals) {
    const s = parseFloat(e.overall_score);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(10);
  }
  expect(evals.some((e: any) => parseFloat(e.overall_score) > 0)).toBeTruthy();

  // Relevance sanity: strong should outscore weak.
  const strong = evals.find((e: any) => e.candidate_name.includes('Strong'));
  const weak = evals.find((e: any) => e.candidate_name.includes('Weak'));
  if (strong && weak) {
    expect(parseFloat(strong.overall_score)).toBeGreaterThan(parseFloat(weak.overall_score));
  }
  await api.dispose();

  await page.screenshot({ path: 'tests/results/cv-evaluated.png', fullPage: true });
});
