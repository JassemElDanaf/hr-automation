import { test, expect, Page } from '@playwright/test';
import { login, gotoTab } from './helpers';

// Full UI audit: tour every page, click every (safe) button, screenshot each
// page, and FAIL if any JS/console error fires. Destructive / external-effect
// buttons are skipped by label so the audit doesn't delete data or send email.
// Destructive / external-effect / long-running (Gemini) buttons — skipped here
// (functional specs 01–07 already exercise create/evaluate/send/interview).
const SKIP = /log ?out|sign out|delete|remove|reject|hire|deactivate|archive|send|clear|reset|discard|unshortlist|revert|start your interview|hand ?off|offer|×|✕|close|generate|run eval|evaluate|upload|import|export|download|invite|create job|save|re-?evaluate|publish/i;

// Known-benign console noise (favicon, third-party) we don't want to fail on.
const IGNORE = /favicon|net::ERR_|Download the React DevTools|webkit|ResizeObserver|Blocked script execution in 'about:srcdoc'/i;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`CONSOLE: ${m.text()}`); });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  return errors;
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

// Click every visible, enabled, non-destructive button on the current page,
// closing any modal and returning to the page after each.
async function clickAllButtons(page: Page, returnTo: string, errors: string[], maxClicks = 30) {
  const clicked: string[] = [];
  let idx = 0;
  for (let guard = 0; guard < maxClicks; guard++) {
    const buttons = page.getByRole('button');
    const count = await buttons.count();
    if (idx >= count) break;
    const b = buttons.nth(idx);
    idx++;
    let label = '';
    try {
      if (!(await b.isVisible()) || !(await b.isEnabled())) continue;
      label = ((await b.innerText()).trim() || (await b.getAttribute('aria-label')) || (await b.getAttribute('title')) || '').slice(0, 40);
    } catch { continue; }
    if (!label || SKIP.test(label)) continue;
    clicked.push(label);
    try { await b.click({ timeout: 4000 }); } catch { /* not actionable — record nothing, errors[] catches throws */ }
    await page.waitForTimeout(250);
    // Close any modal/menu that opened.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
    // If a click navigated us off the tab, return.
    if (!page.url().includes(returnTo)) {
      await gotoTab(page, returnTo === '/' ? 'Dashboard' : returnTo).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  return clicked;
}

const TABS = ['Dashboard', 'Job Openings', 'CV Pool', 'CV Evaluation', 'Shortlist', 'Interview', 'Decision', 'Emails'];

for (const tab of TABS) {
  test(`audit nav tab: ${tab}`, async ({ page }) => {
    const errors = collectErrors(page);
    await login(page, 'admin');
    await gotoTab(page, tab);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `tests/screenshots/audit-${slug(tab)}.png`, fullPage: true });
    const clicked = await clickAllButtons(page, tab, errors);
    await page.screenshot({ path: `tests/screenshots/audit-${slug(tab)}-after.png`, fullPage: true });
    console.log(`[${tab}] clicked ${clicked.length} buttons: ${clicked.join(' | ')}`);
    expect(errors, `JS errors on ${tab}:\n${errors.join('\n')}`).toEqual([]);
  });
}

test('audit admin pages + header menu', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = collectErrors(page);
  await login(page, 'admin');
  for (const route of ['/users', '/email-templates', '/audit-log']) {
    await page.goto(route);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `tests/screenshots/audit${slug(route)}.png`, fullPage: true });
    await clickAllButtons(page, route, errors, 8); // sample — these pages have many list buttons
  }
  expect(errors, `JS errors on admin pages:\n${errors.join('\n')}`).toEqual([]);
});
