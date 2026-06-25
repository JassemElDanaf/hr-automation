import { test, expect } from '@playwright/test';
import { login, selectJobGlobally } from './helpers';

const SHOTS = 'tests/screenshots';

// iPhone-class emulation on chromium (avoids needing the webkit browser binary).
const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
};

// ── Mobile (iPhone-class viewport) ───────────────────────────────────────────
test.describe('Mobile (iPhone)', () => {
  test.use(IPHONE);

  test('hamburger nav works and pages fit the screen', async ({ page }) => {
    await login(page, 'admin');

    // On a phone the hamburger shows and the horizontal tab row is collapsed.
    await expect(page.locator('.nav-hamburger')).toBeVisible();
    await expect(page.locator('.nav-tab-list')).toBeHidden();
    await page.screenshot({ path: `${SHOTS}/mobile-01-dashboard.png`, fullPage: true });

    // Tapping the hamburger reveals all tabs vertically.
    await page.locator('.nav-hamburger').click();
    await expect(page.locator('.nav-tab-list.open')).toBeVisible();
    for (const label of ['Dashboard', 'Job Openings', 'CV Pool', 'CV Evaluation', 'Shortlist', 'Interview', 'Decision', 'Emails']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: `${SHOTS}/mobile-02-menu-open.png`, fullPage: true });

    // Navigating from the menu works and closes it.
    await page.getByRole('button', { name: 'Emails', exact: true }).click();
    await expect(page).toHaveURL(/emails/);
    await expect(page.locator('.nav-tab-list')).toBeHidden();
    await page.screenshot({ path: `${SHOTS}/mobile-03-emails.png`, fullPage: true });
  });

  test('candidate interview link is mobile-friendly', async ({ page }) => {
    // Candidates open interview links on their phones — the intro must render and fit.
    const token = Buffer.from(JSON.stringify({
      jobId: 1, candidateId: 1, candidateName: 'Mobile QA', jobTitle: 'QA Mobile Role',
      customQuestions: [{ question: 'Tell me about yourself.', category: 'hr' }],
    })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await page.goto(`/interview/${token}`);
    await expect(page.getByText('QA Mobile Role').first()).toBeVisible({ timeout: 12_000 });
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `candidate page overflows by ${overflow}px`).toBeLessThanOrEqual(3);
    await page.screenshot({ path: `${SHOTS}/mobile-candidate-interview.png`, fullPage: true });
  });

  test('no horizontal overflow on any page', async ({ page }) => {
    await login(page, 'admin');
    const pages = [
      { tab: 'Dashboard', file: 'dashboard' },
      { tab: 'Job Openings', file: 'jobs' },
      { tab: 'CV Pool', file: 'cv-pool' },
      { tab: 'CV Evaluation', file: 'cv-eval' },
      { tab: 'Shortlist', file: 'shortlist' },
      { tab: 'Interview', file: 'interview' },
      { tab: 'Decision', file: 'decision' },
      { tab: 'Emails', file: 'emails' },
    ];
    for (const p of pages) {
      await page.locator('.nav-hamburger').click();
      await page.getByRole('button', { name: p.tab, exact: true }).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/mobile-page-${p.file}.png`, fullPage: true });
      // The page itself must not scroll sideways (wide tables scroll inside their wrap).
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${p.tab} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(3);
    }
  });

  // Interactive sub-states (not just the landing view of each tab) must also fit —
  // these are where overflow bugs hide: the AI-generate / write-my-own question
  // builders, expanded result cards, and the Emails action toolbar.
  test('interactive panels + expanded cards fit (no overflow)', async ({ page }) => {
    await selectJobGlobally(page, { id: 1, job_title: 'DevOps Engineer', department: 'Engineering' });
    await login(page, 'admin');
    const ov = () => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);

    async function gotoTab(tab: string) {
      await page.locator('.nav-hamburger').click();
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(700);
    }

    // Interview question builder: AI Generate + Write My Own panels
    await gotoTab('Interview');
    await page.getByText(/Omar Haddad/).first().waitFor({ timeout: 30_000 });
    await page.getByText(/Omar Haddad/).first().click();
    await page.waitForTimeout(500);
    await page.locator('.sticky-continue, .wizard-footer button').first().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /AI Generate/i }).first().click();
    await page.waitForTimeout(400);
    expect(await ov(), 'AI Generate panel overflows').toBeLessThanOrEqual(3);
    await page.screenshot({ path: `${SHOTS}/mobile-int-ai-generate.png`, fullPage: true });
    await page.getByRole('button', { name: /Write My Own/i }).first().click();
    await page.waitForTimeout(400);
    expect(await ov(), 'Write My Own panel overflows').toBeLessThanOrEqual(3);

    // Emails compact toolbar (gear menu + blue +)
    await gotoTab('Emails');
    expect(await ov(), 'Emails toolbar overflows').toBeLessThanOrEqual(3);
    await page.locator('button[title="Email settings"]').click().catch(() => {});
    await page.waitForTimeout(300);
    expect(await ov(), 'Emails gear menu overflows').toBeLessThanOrEqual(3);

    // Expanded result cards on each list tab
    for (const [tab, sel] of [['Shortlist', '[id^="sl-cand-"]'], ['Decision', '[id^="decision-cand-"]']] as const) {
      await gotoTab(tab);
      const card = page.locator(sel).first();
      if (await card.count()) {
        await card.locator('strong').first().click().catch(() => {});
        await page.waitForTimeout(600);
        expect(await ov(), `${tab} expanded card overflows`).toBeLessThanOrEqual(3);
      }
    }
  });
});

// ── Desktop regression — the hamburger must NOT appear; tabs stay a row ──────
test.describe('Desktop unaffected', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('hamburger hidden, tab row visible', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.locator('.nav-hamburger')).toBeHidden();
    await expect(page.locator('.nav-tab-list')).toBeVisible();
    // All 8 tabs visible in the row (not behind a menu).
    await expect(page.getByRole('button', { name: 'CV Evaluation', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Decision', exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/desktop-nav-regression.png` });
  });
});
