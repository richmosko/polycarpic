// POLY-89 criteria 1 and 6 in the real app (ruling R7): the sign-in gate and the placeholder page. Titles end with [red if: <mutation>].
// Ada is serve.ts's user: her only entity is her own Person, so no step is asked. Manny is the state `reset-mfa` leaves a manager in.
import { expect, test } from '@playwright/test';

const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
const PASSWORD = 'e2e correct horse battery staple';

test.describe('C1: a new user with only the own Person', () => {
  test('signs in and reaches /dashboard with no redirect and no enrolment prompt  [red if: the gate fires for the own-Person exemption]', async ({ page }) => {
    await page.goto(`${base}/dashboard`);
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    await expect(page.getByText(/second step|authenticator|enrol/i)).toHaveCount(0);
  });
});

test.describe('C6: a manager with no second step (after reset-mfa)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('signs in, and every page redirects to /settings/second-step  [red if: the gate is not in the session loader]', async ({ page }) => {
    await page.goto(`${base}/sign-in?next=/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/email/i).fill('manager@e2e.test');
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/settings/second-step');
    for (const path of ['/dashboard', '/settings/sessions', '/']) {
      await page.goto(`${base}${path}`);
      expect(new URL(page.url()).pathname, path).toBe('/settings/second-step');
    }
  });

  test('the placeholder page names the state and has no form  [red if: the page is absent or carries a form]', async ({ page }) => {
    await page.goto(`${base}/sign-in`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/email/i).fill('manager@e2e.test');
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/settings/second-step');
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /second step/i })).toBeVisible();
  });
});
