// POLY-86 criteria 14, 15 (the half of POLY-128 criterion 3 that moved here; ruling R6, R7, R10; seceng S1, S2, S18).
// CONTRACT with the builder's Playwright globalSetup (R10): it migrates a database, seeds ONE user in the test process only
// (S18: no switch in the app), signs that user in through BetterAuth in process, and writes the browser state to
//   apps/web/tests/e2e/.auth/user.json            (Playwright storageState; cookies for localhost)
// with the user's name 'Ada Lovelace' and image null. Nothing in apps/web or packages/auth reads an env var for this.
// Cookies are never read with document.cookie here (cookies are shared across localhost ports): the cookie value comes from
// the storageState file. Titles end with [red if: <mutation>].
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const STATE = join(here, '.auth', 'user.json');
const NAME = 'Ada Lovelace';
const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
const cookies: { name: string; value: string }[] = JSON.parse(readFileSync(STATE, 'utf8')).cookies;

test.describe('signed in', () => {
  test.use({ storageState: STATE });

  test('the shell loads signed in, with the user\'s name and avatar at the sidebar foot  [red if: locals.session unset, the loader redirects a valid session, or the foot still reads "Account"]', async ({ page }) => {
    await page.goto(`${base}/dashboard`);
    await page.waitForLoadState('networkidle');
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();
    const trigger = sidebar.getByRole('button', { name: NAME });
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText('A'); // the avatar: initials while image is null (R7)
    await expect(sidebar.getByRole('button', { name: 'Account', exact: true })).toHaveCount(0);
  });

  test('the avatar is served from our own origin: no remote image is requested and no CSP violation is raised  [red if: a provider picture URL is stored and rendered, or img-src is widened to allow it]', async ({ page }) => {
    const violations: string[] = [];
    const remote: string[] = [];
    page.on('console', (m) => { if (/content security policy|refused to load/i.test(m.text())) violations.push(m.text()); });
    page.on('request', (r) => { if (r.resourceType() === 'image' && new URL(r.url()).origin !== new URL(base).origin && !r.url().startsWith('data:')) remote.push(r.url()); });
    const res = await page.goto(`${base}/dashboard`);
    await page.waitForLoadState('networkidle');
    expect(remote).toEqual([]);
    expect(violations).toEqual([]);
    const csp = res!.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/img-src 'self' data:(;|$)/);
    expect(csp).not.toMatch(/img-src[^;]*(https?:|\*)/);
    for (const src of await page.locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))) expect(new URL(src, base).origin, src).toBe(new URL(base).origin);
  });

  test('S1/S2: the SSR HTML and the serialised page data carry neither the session cookie value nor the token  [red if: the root layout returns the session, or a load function serialises it]', async ({ request }) => {
    const res = await request.get(`${base}/dashboard`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const sess = cookies.find((c) => /session_token/.test(c.name))!;
    const raw = decodeURIComponent(sess.value);
    const token = raw.split('.')[0];
    expect(token.length).toBeGreaterThan(16);
    for (const secret of [sess.value, raw, token]) expect(html).not.toContain(secret);
    expect(html).not.toMatch(/"token"\s*:/);
    expect(html).toContain(NAME); // the projection is there: name only, no token
  });

  test('the blocked routes answer 404 to the browser even with a valid session  [red if: /get-session or /list-sessions is reachable over HTTP]', async ({ request }) => {
    for (const p of ['/api/auth/get-session', '/api/auth/list-sessions', '/api/auth/get-session/', '/api/auth/no-such-route']) {
      expect((await request.get(`${base}${p}`)).status(), p).toBe(404);
    }
  });
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a page request is redirected to /sign-in with next, and the sign-in page renders  [red if: no redirect, or a loop]', async ({ page }) => {
    await page.goto(`${base}/dashboard`);
    expect(new URL(page.url()).pathname).toBe('/sign-in');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard');
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('S12: a protocol-relative next never leaves the origin  [red if: next is honoured raw]', async ({ page }) => {
    await page.goto(`${base}//evil.example/x`);
    expect(new URL(page.url()).origin).toBe(new URL(base).origin);
    expect(new URL(page.url()).searchParams.get('next') ?? '/').toBe('/');
  });
});
