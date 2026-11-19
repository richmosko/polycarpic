// POLY-150 R7 / D6 (b): the held page's one #locked state names the band the service sends, and falls back to "try again later" when none arrives.
// One user per band, seeded locked by serve.ts (30, 120 and 600 minutes left). The fallback removes the band from the response in the browser, which is
// what the page sees for a forged, expired or missing hold (the service's side of those is tests/db/second-step-lock-band.test.ts). Each spec spends one sign-in
// and one verify-totp slot. Titles end [red if: <mutation>].
import { expect, test } from '@playwright/test';
import { totp } from '../../../../tests/db/helpers/totp.ts';
import { cookieNames, seed, signInUi, slot } from './support.ts';

test.use({ storageState: { cookies: [], origins: [] } });

type U = { email: string; secret: string };
const users = () => seed<Record<string, U>>('lock-users.json');
const BANDS = /under an hour|in a few hours|within a day/i;

async function lockedPage(page: import('@playwright/test').Page, u: U) {
  await signInUi(page, u.email, seed<{ password: string }>('seeds.json').password);
  await page.waitForURL('**/sign-in/second-step**');
  await page.getByLabel('6-digit code').fill(totp(u.secret));
  await slot('/two-factor/verify-totp');
  await page.getByRole('button', { name: 'Continue' }).click();
}

for (const [key, phrase] of [['lock30', /work again in under an hour/i], ['lock120', /work again in a few hours/i], ['lock600', /work again within a day/i]] as const) {
  test(`${key}: the #locked state says "${phrase.source}", names a passkey, and shows no time, no minutes and no count  [red if: the band is not shown or a time is]`, async ({ page }) => {
    const u = users()[key]!;
    await lockedPage(page, u);
    const locked = page.getByText(/codes are paused for this account/i);
    await expect(locked).toBeVisible();
    await expect(page.locator('body')).toContainText(phrase);
    await expect(page.locator('body')).toContainText(/passkey/i);
    const text = await page.locator('body').innerText();
    expect(text, 'no clock time, minutes or tries').not.toMatch(/\b\d{1,2}:\d{2}\b|\b\d+\s*(minutes?|hours?|tries|attempts)\b/i);
    expect(await cookieNames(page), 'still held').not.toContain('__Host-poly_handle');
    expect(new URL(page.url()).pathname).toBe('/sign-in/second-step');
  });
}

test('with no pausedFor in the response the #locked state says "try again later" and names no band  [red if: the page invents a band or has no fallback]', async ({ page }) => {
  const u = users()['lockfb']!;
  await page.route('**/api/auth/two-factor/verify-totp', async (route) => {
    const res = await route.fetch();
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    delete j.pausedFor;
    await route.fulfill({ response: res, body: JSON.stringify(j), headers: { ...res.headers(), 'content-type': 'application/json' } });
  });
  await lockedPage(page, u);
  await expect(page.getByText(/codes are paused for this account/i)).toBeVisible();
  await expect(page.locator('body')).toContainText(/try again later/i);
  await expect(page.locator('body')).not.toContainText(BANDS);
});

test('a locked account with an EXPIRED hold answers 429 with no band, and the page shows the no-band fallback (ruling 3dac70df)  [red if: an expired hold is told a band, or the page invents one]', async ({ page }) => {
  const u = users()['lockexp']!;
  const s = seed<{ testServer: unknown; db: string; password: string }>('seeds.json');
  process.env.POLY_TEST_SERVER = JSON.stringify(s.testServer);
  const { must } = await import('../../../../tests/db/helpers/sql.ts');
  const { createHash } = await import('node:crypto');
  const answers: { status: number; body: string }[] = [];
  page.on('response', async (r) => { if (r.url().endsWith('/api/auth/two-factor/verify-totp')) answers.push({ status: r.status(), body: await r.text().catch(() => '') }); });
  await signInUi(page, u.email, s.password);
  await page.waitForURL('**/sign-in/second-step**');
  // Expire the hold's own verification row, found by the sha-256 (base64url) of the cookie's identifier.
  const hold = (await page.context().cookies()).find((c) => /two_factor/.test(c.name))!;
  const id = decodeURIComponent(hold.value).split('.')[0]!;
  const hit = must(`UPDATE public.verification SET expires_at = now() - interval '1 second' WHERE identifier = '${createHash('sha256').update(id).digest('base64url')}' RETURNING 1`, s.db).rows.length;
  expect(hit, 'the hold row was expired').toBe(1);
  await page.getByLabel('6-digit code').fill(totp(u.secret));
  await slot('/two-factor/verify-totp');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/codes are paused for this account/i)).toBeVisible();
  await expect(page.locator('body')).toContainText(/try again later/i);
  await expect(page.locator('body')).not.toContainText(BANDS);
  expect(answers.at(-1)?.status, 'the refusal').toBe(429);
  expect(answers.at(-1)?.body).not.toContain('pausedFor');
});
