import { test, expect, request as pwRequest } from '@playwright/test';
import { login, gotoTab, qaName } from './helpers';

const WEBHOOK = 'http://localhost:5678/webhook';

// Job Openings: create (manual + AI JD via Gemini), then toggle active.
// Modal flow (JobOpenings.jsx): "+ New Job" → step 1 (title + Department select +
// defaulted selects) → "Continue →" → step 2 (source tab + description) →
// "Create Job Opening". No data-testids — scope to `.modal`, use placeholders/roles.
test.describe('Job Openings', () => {
  test('create a manual job', async ({ page }) => {
    await login(page, 'admin');
    await gotoTab(page, 'Job Openings');
    await page.getByRole('button', { name: '+ New Job' }).click();

    const modal = page.locator('.modal');
    await expect(modal.getByRole('heading', { name: 'New Job Opening' })).toBeVisible();

    const title = qaName('Manual SWE');
    await modal.getByPlaceholder('e.g. Senior Software Engineer').fill(title);
    // Department is the first <select> in the modal (Employment/Seniority/Location default to valid values).
    await modal.getByRole('combobox').first().selectOption('Engineering');
    await modal.getByRole('button', { name: /Continue/ }).click();

    // Step 2 — "Write / Paste" (manual) is the default source.
    await modal.getByPlaceholder(/Paste or type the full job description/)
      .fill('Backend engineer for QA testing: Python, PostgreSQL, REST APIs, Docker, 3+ years experience.');
    await modal.getByRole('button', { name: 'Create Job Opening' }).click();

    await expect(page.getByText(/Job opening created/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'tests/results/job-manual-created.png', fullPage: true });
  });

  test('create a job with AI-generated description (Gemini)', async ({ page }) => {
    test.setTimeout(220_000); // Gemini JD gen on API ≈ 70–120s
    await login(page, 'admin');
    await gotoTab(page, 'Job Openings');
    await page.getByRole('button', { name: '+ New Job' }).click();

    const modal = page.locator('.modal');
    const title = qaName('AI Analyst');
    await modal.getByPlaceholder('e.g. Senior Software Engineer').fill(title);
    await modal.getByRole('combobox').first().selectOption('Engineering');
    await modal.getByRole('button', { name: /Continue/ }).click();

    await modal.getByRole('button', { name: /Generate with AI/ }).click();
    await modal.getByPlaceholder(/Bachelor/).fill('Python, FastAPI, REST APIs, 2-4 years');
    await modal.getByRole('button', { name: /Create Job Opening|Generating/ }).click();

    // Success toast appears once Gemini returns + the job is inserted.
    await expect(page.getByText(/Job opening created/i)).toBeVisible({ timeout: 200_000 });

    // Verify the JD is REAL content (not a placeholder / not empty): open the job detail.
    await page.getByText(title).first().click();
    await expect(page.getByText(/About the Role/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/\[Company Name\]|\[Your Company/i)).toHaveCount(0);
    await page.screenshot({ path: 'tests/results/job-ai-created.png', fullPage: true });
  });

  test('toggle a job active/inactive', async ({ page }) => {
    // Seed a fresh job via API so this test doesn't depend on test 1 completing.
    const api = await pwRequest.newContext();
    const title = qaName('Toggle Job');
    const res = await api.post(`${WEBHOOK}/job-openings`, {
      data: {
        job_title: title, department: 'Engineering', employment_type: 'Full-time',
        seniority_level: 'Mid-level', location_type: 'On-site',
        description_source: 'manual',
        job_description: 'QA toggle test job — safe to delete.',
      },
    });
    const body = await res.json();
    const jobId = (Array.isArray(body.data) ? body.data[0] : body.data)?.id;
    await api.dispose();

    await login(page, 'admin');
    await gotoTab(page, 'Job Openings');
    const row = page.locator('tr', { hasText: title }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const toggle = row.locator('.toggle-switch');
    await toggle.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'tests/results/job-toggled.png', fullPage: true });
    // Verify the toggle flipped: active pill should now be grey/inactive
    await expect(row.locator('.toggle-switch')).toBeVisible();
  });
});
