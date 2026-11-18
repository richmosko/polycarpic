// POLY-153 R8 (C4), R10: after a REAL sign-in in Chromium, web receives the handle cookie and none of BetterAuth's. The cookie names and paths
// are read from the browser's own jar and from the headers it sent, never guessed. Titles end [red if: <mutation>].
// The seeded user is serve.ts's (Ada Lovelace). serve.ts also revokes poly_app's grants on BetterAuth's tables and on
// enter_asserted_user (R7.4), so every page here also proves web enters by handle alone.
import { expect, test } from '@playwright/test';

const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
const EMAIL = 'ada@e2e.test';
const PASSWORD = 'e2e correct horse battery staple';

// The real-sign-in assertions (cookie names, paths, what a page request carries) are in sign-in-flow.spec.ts, on its existing sign-in: the service
// rate-limits /sign-in/email to 5 a minute for every caller here, so a further UI sign-in in this file starves the specs around it.

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
