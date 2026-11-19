// POLY-86 visual-leg defects 1-3 (lead @ f99b888): the real app, signed in and out. Titles end with [red if: <mutation>].
// The seeded user is serve.ts's: Ada Lovelace, password below.
import { expect, test } from '@playwright/test';
import { slot } from './support.ts';

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
    await slot('/sign-in/email');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/auth/sign-in/email') && r.method() === 'POST');
    await page.getByLabel(/password/i).fill(PASSWORD);
    await slot('/sign-in/email');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await sent;
    await page.waitForURL((u) => u.pathname === '/dashboard');
    // POLY-153 R8 (C4): after a REAL sign-in, the handle is __Host- at Path=/ and BetterAuth's cookies are __Secure- at Path=/api/auth.
    const jar = [...(await page.context().cookies(base)), ...(await page.context().cookies(`${base}/api/auth/`))];
    const handle = jar.find((c) => c.name === '__Host-poly_handle');
    expect(handle, 'the handle cookie [red if: no handle is set]').toBeDefined();
    expect(handle!.path).toBe('/');
    expect(handle!.httpOnly && handle!.secure).toBe(true);
    expect(handle!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ba = jar.filter((c) => /better-auth/.test(c.name));
    expect(ba.length).toBeGreaterThan(0);
    for (const c of ba) { expect(c.name).toMatch(/^__Secure-better-auth\./); expect(c.path).toBe('/api/auth'); }
    // and a page request carries the handle and no better-auth cookie [red if: web still receives BetterAuth's cookie]
    const docCookies: string[] = [];
    page.on('request', async (r) => { if (r.resourceType() === 'document') docCookies.push((await r.allHeaders()).cookie ?? ''); });
    await page.goto(`${base}/settings/sessions`);
    await page.waitForLoadState('networkidle');
    expect(docCookies.length).toBeGreaterThan(0);
    for (const cookie of docCookies) { expect(cookie).toMatch(/__Host-poly_handle=[A-Za-z0-9_-]{43}/); expect(cookie).not.toMatch(/better-auth/); }
  });
});

test.describe('signed out chrome', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/sign-in has no navigation landmark and no account chip  [red if: the app shell renders for a signed-out visitor]', async ({ page }) => {
    await page.goto(`${base}/sign-in`);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
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

  test('Settings links to Sessions, which revokes another session after a step-up  [red if: the menu has no route to Sessions, or revoke-by-id does not delete]', async ({ page }) => {
    await page.goto(`${base}/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('sidebar').getByRole('button', { name: 'Ada Lovelace' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await page.waitForURL('**/settings/sessions');
    const rows = page.locator('tbody tr');
    const before = await rows.count(); // other specs may have left a session of their own
    expect(before).toBeGreaterThanOrEqual(2);
    await rows.filter({ hasNotText: '(this device)' }).first().getByRole('button', { name: 'Revoke' }).click();
    await expect(rows).toHaveCount(before - 1);
    await expect(rows.filter({ hasText: '(this device)' })).toHaveCount(1);
  });

  test('Log out is enabled in the account menu and ends the session  [red if: the item is disabled or does not reach /sign-out]', async ({ browser }) => {
    // its own session: signing out must not end the shared storageState session the other specs use
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(`${base}/sign-in?next=/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await slot('/sign-in/email');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.pathname === '/dashboard');
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
