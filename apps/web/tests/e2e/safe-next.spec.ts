// POLY-161 R13 (addendum 1; seceng B1, verdict A12, B32): the first real-browser evidence for `safeNext`. The finding was measured in Node's URL parser only;
// Chromium strips tab, LF and CR from a URL before it parses it, so `/\t/evil.example` becomes `//evil.example` and means another origin.
// A REAL sign-in from `/sign-in?next=<crafted>` must end on our own origin, and nothing may be requested from the foreign host.
// Red on the module before R13 (the redirect goes to http://evil.example/). Titles end [red if: ...].
import { expect, test, type Page } from '@playwright/test';
import { totp } from '../../../../tests/db/helpers/totp.ts';
import { base, seed, signInUi, slot } from './support.ts';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const EMAIL = 'ada@e2e.test';
const PASSWORD = 'e2e correct horse battery staple';
const CRAFTED = '/\t/evil.example';

/** Every request to the foreign host is recorded and refused, so the test can say the browser tried, and never leaves our machine. */
async function foreign(page: Page): Promise<string[]> {
  const hits: string[] = [];
  await page.route(/^https?:\/\/evil\.example\//, (route) => { hits.push(route.request().url()); void route.abort(); });
  return hits;
}
const ours = (page: Page) => new URL(page.url()).origin === base;

test('a real sign-in from next=/<TAB>/evil.example ends on our origin, and the browser never asks evil.example  [red if: safeNext passes a control character and the page hands it to location.assign]', async ({ page }) => {
  const hits = await foreign(page);
  await signInUi(page, EMAIL, PASSWORD, CRAFTED);
  await page.waitForURL((u) => u.origin === base && u.pathname !== '/sign-in', { timeout: 30_000 });
  expect(hits, 'requests to the foreign host').toEqual([]);
  expect(ours(page)).toBe(true);
  expect(await page.context().cookies(base)).toEqual(expect.arrayContaining([expect.objectContaining({ name: '__Host-poly_handle' })]));
});

test('the same with LF and CR, and with a backslash after the control  [red if: any control or the backslash survives]', async ({ page }) => {
  for (const next of ['/\n/evil.example', '/\r/evil.example', '/\t\\evil.example', '/x/..//evil.example']) {
    const hits = await foreign(page);
    await page.context().clearCookies();
    await signInUi(page, EMAIL, PASSWORD, next);
    await page.waitForURL((u) => u.origin === base && u.pathname !== '/sign-in', { timeout: 60_000 });
    expect(hits, JSON.stringify(next)).toEqual([]);
    expect(ours(page), JSON.stringify(next)).toBe(true);
    await page.unroute(/^https?:\/\/evil\.example\//);
  }
});

test('a plain next still lands where it says: next=/settings/sessions  [red if: the guard over-refuses and drops every next]', async ({ page }) => {
  await signInUi(page, EMAIL, PASSWORD, '/settings/sessions');
  await page.waitForURL((u) => u.origin === base && u.pathname === '/settings/sessions', { timeout: 30_000 });
});

test('through /sign-in/second-step: a held user whose page is opened with next=/<TAB>/evil.example finishes on our origin  [red if: the second-step page hands the raw next to location.assign]', async ({ page }) => {
  const s = seed<{ email: string; password: string; secret: string }>('safe.json');
  const hits = await foreign(page);
  await signInUi(page, s.email, s.password, '/dashboard');
  await page.waitForURL('**/sign-in/second-step**');
  // The hold cookie is set. The crafted value arrives the way a crafted link would: in the page's own URL.
  await page.goto(`${base}/sign-in/second-step?next=${encodeURIComponent(CRAFTED)}`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('6-digit code').fill(totp(s.secret));
  await slot('/two-factor/verify-totp');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((u) => u.origin === base && u.pathname !== '/sign-in/second-step', { timeout: 30_000 });
  expect(hits, 'requests to the foreign host').toEqual([]);
  expect(ours(page)).toBe(true);
  expect(await page.context().cookies(base)).toEqual(expect.arrayContaining([expect.objectContaining({ name: '__Host-poly_handle' })]));
});
