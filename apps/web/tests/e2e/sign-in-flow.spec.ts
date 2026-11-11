// POLY-86 visual-leg defects 1-3 (lead @ f99b888): the real app, signed in and out. Titles end with [red if: <mutation>].
// The seeded user is serve.ts's: Ada Lovelace, password below.
import { expect, test } from '@playwright/test';

const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
const EMAIL = 'ada@e2e.test';
const PASSWORD = 'e2e correct horse battery staple';

test.describe('sign-in form', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a wrong password shows the error, and the next submit still sends a request and signs in  [red if: the form is dead after one failure]', async ({ page }) => {
    await page.goto(`${base}/sign-in?next=/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill('not the password at all');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/auth/sign-in/email') && r.method() === 'POST');
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await sent;
    await page.waitForURL('**/dashboard');
  });
});

test.describe('signed in', () => {
  test('Settings → Sessions renders the list with this device and no token  [red if: the load throws on a non-Date column or the page leaks the token]', async ({ page, request }) => {
    const res = await request.get(`${base}/settings/sessions`);
    expect(res.status()).toBe(200);
    await page.goto(`${base}/settings/sessions`);
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await expect(page.getByText('(this device)')).toBeVisible();
  });

  test('Log out is enabled in the account menu and ends the session  [red if: the item is disabled or does not reach /sign-out]', async ({ browser }) => {
    // its own session: signing out must not end the shared storageState session the other specs use
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(`${base}/sign-in?next=/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('sidebar').getByRole('button', { name: 'Ada Lovelace' }).click();
    const item = page.getByRole('menuitem', { name: /log out/i });
    await expect(item).toBeEnabled();
    await item.click();
    await page.waitForURL('**/sign-in**');
    await page.goto(`${base}/dashboard`);
    expect(new URL(page.url()).pathname).toBe('/sign-in');
    await context.close();
  });
});
