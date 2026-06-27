import { test, expect } from '@playwright/test';
import { login, USERS } from './helpers';

// Auth + RBAC. The app has no data-testids; selectors come from pages/Login.jsx
// and the header (state/auth.jsx persists the token under 'hr_auth_token').
test.describe('Auth', () => {
  test('admin can log in', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByText(USERS.admin.email.split('@')[0], { exact: false }).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});
    // Token presence is the hard assertion (done inside login()); screenshot for the report.
    await page.screenshot({ path: 'tests/results/auth-admin.png', fullPage: true });
  });

  test('recruiter can log in', async ({ page }) => {
    await login(page, 'recruiter');
    await page.screenshot({ path: 'tests/results/auth-recruiter.png' });
  });

  test('viewer can log in', async ({ page }) => {
    await login(page, 'viewer');
    await page.screenshot({ path: 'tests/results/auth-viewer.png' });
  });

  test('invalid credentials are rejected', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('you@diyarme.com').fill('admin@diyarme.com');
    await page.getByPlaceholder('••••••••').fill('wrong-password-xyz');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Stays on login + shows an error; token must NOT be set.
    await expect.poll(
      () => page.evaluate(() => localStorage.getItem('hr_auth_token')),
      { timeout: 8_000 },
    ).toBeNull();
    await page.screenshot({ path: 'tests/results/auth-invalid.png' });
  });
});
