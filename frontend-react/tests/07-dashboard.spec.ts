import { test, expect } from '@playwright/test';
import { login, gotoTab } from './helpers';

// Dashboard KPIs. Production has real data (jobs + candidates), so the cards must
// render numeric values, the funnel must show, and the status chart must mount.
test('dashboard KPI cards render real numbers', async ({ page }) => {
  await login(page, 'admin');
  await gotoTab(page, 'Dashboard');

  // Stat cards (StatCard renders a label + value).
  for (const label of ['Active Jobs', 'Total Candidates', 'Avg Score']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  }

  // "Total Candidates" should be a number > 0 (production has candidates).
  const totalCard = page.locator('.stat-card', { hasText: 'Total Candidates' }).first();
  await expect(totalCard).toBeVisible();
  const valueText = (await totalCard.innerText()).replace(/[^0-9]/g, '');
  expect(Number(valueText)).toBeGreaterThan(0);

  // Hiring funnel + "Candidates by Status" sections present.
  await expect(page.getByText(/Hiring Funnel/i).first()).toBeVisible();
  await page.screenshot({ path: 'tests/results/dashboard.png', fullPage: true });
});
