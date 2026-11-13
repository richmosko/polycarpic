// POLY-87 C29 (S9): the /sign-up page and the invitation token in the URL. Titles end with [red if: <mutation>].
// ASSUMED markup (the ruling names the route, not the labels): fields labelled Name, Email, Password and a submit button
// whose accessible name matches /sign up|create account/i; the page posts { invitationToken } to /api/auth/sign-up/email.
import { expect, test } from '@playwright/test';

const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
const TOKEN = 'A'.repeat(43);

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('/sign-up with an invitation link', () => {
  test('answers Referrer-Policy: no-referrer and Cache-Control: no-store  [red if: the page leaks the token through Referer or a cache]', async ({ request }) => {
    const res = await request.get(`${base}/sign-up?invitation=${TOKEN}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['referrer-policy']).toBe('no-referrer');
    expect(res.headers()['cache-control']).toMatch(/no-store/);
  });

  test('the address bar no longer shows the invitation once the page has read it  [red if: history.replaceState is not called]', async ({ page }) => {
    await page.goto(`${base}/sign-up?invitation=${TOKEN}`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('invitation');
    expect(page.url()).not.toContain(TOKEN);
  });

  test('the form still posts the token it read, as invitationToken  [red if: replaceState happens before the token is read]', async ({ page }) => {
    await page.goto(`${base}/sign-up?invitation=${TOKEN}`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/name/i).fill('Invited Person');
    await page.getByLabel(/email/i).fill('invited@e2e.test');
    await page.getByLabel(/password/i).fill('e2e correct horse battery staple');
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/auth/sign-up/email') && r.method() === 'POST');
    await page.getByRole('button', { name: /sign up|create account/i }).click();
    expect((await sent).postDataJSON().invitationToken).toBe(TOKEN);
  });

  test('offers Google and GitHub  [red if: a provider button is missing]', async ({ page }) => {
    await page.goto(`${base}/sign-up?invitation=${TOKEN}`);
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /github/i })).toBeVisible();
  });
});
