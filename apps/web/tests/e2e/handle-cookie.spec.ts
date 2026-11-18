// POLY-153 R8 (C4), R10: after a REAL sign-in in Chromium, web receives the handle cookie and none of BetterAuth's. The cookie names and paths
// are read from the browser's own jar and from the headers it sent, never guessed. Titles end [red if: <mutation>].
// The seeded user is serve.ts's (Ada Lovelace). serve.ts also revokes poly_app's grants on BetterAuth's tables and on
// enter_asserted_user (R7.4), so every page here also proves web enters by handle alone.
import { expect, test } from '@playwright/test';

const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
const EMAIL = 'ada@e2e.test';
const PASSWORD = 'e2e correct horse battery staple';

test.describe('a real sign-in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sets __Host-poly_handle at Path=/ and BetterAuth\'s cookies __Secure- at Path=/api/auth [red if: BetterAuth\'s cookie is still __Host- at /, or no handle is set]', async ({ page, context }) => {
    await page.goto(`${base}/sign-in?next=/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    const jar = await context.cookies(base);
    const handle = jar.find((c) => c.name === '__Host-poly_handle');
    expect(handle, 'the handle cookie').toBeDefined();
    expect(handle!.path).toBe('/');
    expect(handle!.httpOnly).toBe(true);
    expect(handle!.secure).toBe(true);
    expect(handle!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ba = jar.filter((c) => /better-auth/.test(c.name));
    expect(ba.length).toBeGreaterThan(0);
    for (const c of ba) {
      expect(c.name, c.name).toMatch(/^__Secure-better-auth\./);
      expect(c.path, c.name).toBe('/api/auth');
    }
  });

  test('a page request carries __Host-poly_handle and no cookie whose name contains better-auth [red if: web still receives BetterAuth\'s cookie]', async ({ page }) => {
    await page.goto(`${base}/sign-in?next=/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    const sent: string[] = [];
    page.on('request', async (r) => { if (r.resourceType() === 'document') sent.push((await r.allHeaders()).cookie ?? ''); });
    await page.goto(`${base}/settings/sessions`);
    await page.waitForLoadState('networkidle');
    expect(sent.length).toBeGreaterThan(0);
    for (const cookie of sent) {
      expect(cookie).toMatch(/__Host-poly_handle=[A-Za-z0-9_-]{43}/);
      expect(cookie).not.toMatch(/better-auth/);
    }
    await expect(page.getByTestId('sidebar')).toBeVisible();
  });
});

test.describe('the seeded browser state (R10)', () => {
  test('a signed-in page request with the seeded storageState carries the handle and no better-auth cookie [red if: the seed signs in outside handleAuthRequest, so no handle exists]', async ({ page }) => {
    const sent: string[] = [];
    page.on('request', async (r) => { if (r.resourceType() === 'document') sent.push((await r.allHeaders()).cookie ?? ''); });
    const res = await page.goto(`${base}/dashboard`);
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    expect(sent[0]).toMatch(/__Host-poly_handle=/);
    expect(sent[0]).not.toMatch(/better-auth/);
  });
  test('a hand-made BetterAuth cookie alone does not sign anyone in: web redirects to /sign-in [red if: web reads the BetterAuth cookie]', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await ctx.addCookies([{ name: '__Secure-better-auth.session_token', value: 'abc.def', domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    const page = await ctx.newPage();
    await page.goto(`${base}/dashboard`);
    expect(new URL(page.url()).pathname).toBe('/sign-in');
    await ctx.close();
  });
});
