// POLY-89 criteria 1 and 6 (the sign-in gate) and POLY-150 criterion C5 (ruling R9 specs 1 and 2, R10, RC3): an unenrolled manager is sent to
// /settings/second-step and enrols end to end against the real handler, by authenticator app and by passkey. Titles end [red if: <mutation>].
// Ada is serve.ts's user: her only entity is her own Person, so no step is asked. Manny is the state `reset-mfa` leaves a manager in.
// Enid, Pia and Lou are managers with no second step, each used by one spec only; their signed-in state is written by serve.ts (the sign-in limiter
// is the sign-in service's real one, 5 a minute for the one address every request here shares, so a spec that is not about signing in does not spend it).
import { expect, test } from '@playwright/test';
import { appendFlow, base, cookieNames, enrolByAppToCodes, expectNoSecretsKept, outboxMark, codeFor, PASSWORD, signInUi, slot, watchUrls } from './support.ts';

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

  test('signs in, and every page redirects to /settings/second-step, carrying next  [red if: the gate is not in the session loader, or drops next (R1)]', async ({ page }) => {
    await signInUi(page, 'manager@e2e.test', PASSWORD, '/dashboard');
    await page.waitForURL('**/settings/second-step**');
    expect(new URL(page.url()).searchParams.get('next'), 'the gate carries where the user was going').toBe('/dashboard');
    for (const [path, next] of [['/dashboard', '/dashboard'], ['/settings/sessions', '/settings/sessions']] as const) {
      await page.goto(`${base}${path}`);
      expect(new URL(page.url()).pathname, path).toBe('/settings/second-step');
      expect(new URL(page.url()).searchParams.get('next'), path).toBe(next);
    }
  });
});

test.describe('C5 spec 1: enrol by authenticator app (Enid)', () => {
  test.use({ storageState: 'tests/e2e/.auth/enid.json' });

  test('held page, password, emailed code, password again, TOTP, ten codes, Finish only after the check, then next; a reload and back show no code; a re-sign-in is held  [red if: any screen of the set-up is missing or out of order]', async ({ page, browser }) => {
    const urls = watchUrls(page);
    const responses: { url: string; cache: string | null }[] = [];
    page.on('response', (r) => responses.push({ url: r.url(), cache: r.headers()['cache-control'] ?? null }));
    await page.goto(`${base}/dashboard`);
    await page.waitForURL('**/settings/second-step**');
    expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard');
    await expect(page.getByText(/needs a second step|before you can go on/i)).toBeVisible(); // #held: the gate sent her
    const { key, codes } = await enrolByAppToCodes(page, 'enid@e2e.test');
    appendFlow('flows.jsonl', { user: 'enid', key, codes });
    await expect(page.getByRole('button', { name: 'Finish' })).toBeDisabled();
    await page.getByLabel(/I have saved these codes/i).check();
    await expect(page.getByRole('button', { name: 'Finish' })).toBeEnabled();
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('link', { name: 'Continue' }).click(); // #done
    await page.waitForURL('**/dashboard');
    // The key, the URI and the codes are gone from the page, and nothing the browser keeps holds them (R3.3, R10, RC3).
    await expectNoSecretsKept(page, urls, [key, ...codes, PASSWORD], 'after Finish');
    await page.goto(`${base}/settings/second-step`);
    await expect(page.getByText(key)).toHaveCount(0);
    for (const c of codes) await expect(page.locator('body')).not.toContainText(c);
    await page.reload();
    for (const c of codes) await expect(page.locator('body')).not.toContainText(c);
    await page.goBack();
    await page.goForward();
    for (const c of codes) await expect(page.locator('body')).not.toContainText(c);
    // /api/auth/two-factor/enable answered no-store, and /settings/second-step is not storable (RC3, S6).
    const enable = responses.find((r) => r.url.endsWith('/api/auth/two-factor/enable'));
    expect(enable?.cache ?? '', 'enable: Cache-Control').toContain('no-store');
    const settings = await page.request.get(`${base}/settings/second-step`);
    expect(settings.headers()['cache-control'] ?? '', '/settings/second-step: Cache-Control').toContain('no-store');
    // A re-sign-in as Enid is held: the second step is on now.
    const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p2 = await fresh.newPage();
    await signInUi(p2, 'enid@e2e.test', PASSWORD);
    await p2.waitForURL('**/sign-in/second-step**');
    expect(await cookieNames(p2)).not.toContain('__Host-poly_handle');
    await fresh.close();
  });
});

test.describe('RC3: backup codes do not come back (Rae)', () => {
  test.use({ storageState: 'tests/e2e/.auth/rae.json' });

  test('leaving the codes screen by any way but Finish, then back, forward or reload, shows no code  [red if: the codes are kept in page data, history or the page cache]', async ({ page }) => {
    const urls = watchUrls(page);
    await page.goto(`${base}/dashboard`);
    await page.waitForURL('**/settings/second-step**');
    const { key, codes } = await enrolByAppToCodes(page, 'rae@e2e.test');
    appendFlow('flows.jsonl', { user: 'rae', key, codes });
    await page.goto(`${base}/dashboard`); // away, never pressing Finish
    await page.goBack(); // the browser's back button (and its back-forward cache)
    for (const c of codes) await expect(page.locator('body')).not.toContainText(c);
    await expect(page.getByTestId('backup-code')).toHaveCount(0);
    await page.goForward();
    await page.goBack();
    await page.reload();
    for (const c of codes) await expect(page.locator('body')).not.toContainText(c);
    await expect(page.getByTestId('backup-code')).toHaveCount(0);
    await expectNoSecretsKept(page, urls, [key, ...codes], 'after leaving the codes screen');
  });
});

test.describe('C5 spec 2: enrol by passkey (Pia)', () => {
  test.use({ storageState: 'tests/e2e/.auth/pia.json' });

  test('password, emailed code, a Chromium virtual authenticator makes the passkey, and the request carries no createSession  [red if: the passkey path is missing or asks for a session (POLY-89 S16)]', async ({ page }) => {
    // D2 (does the passkey path show backup codes) is held until the Principal answers; this spec asserts nothing about it.
    const client = await page.context().newCDPSession(page);
    await client.send('WebAuthn.enable');
    await client.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    const registrations: string[] = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/auth/passkey/verify-registration')) registrations.push(r.postData() ?? ''); });
    await page.goto(`${base}/dashboard`);
    await page.waitForURL('**/settings/second-step**');
    await page.getByLabel('Password').fill(PASSWORD);
    const mark = outboxMark();
    await slot('/second-step/send-code');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Code from the email').fill(await codeFor('pia@e2e.test', mark));
    await slot('/second-step/confirm-code');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/passkey/i).first().click();
    await page.getByLabel('Name this passkey').fill('Pia laptop');
    await page.getByRole('button', { name: 'Create passkey' }).click();
    await expect.poll(() => registrations.length, { timeout: 15_000 }).toBeGreaterThan(0);
    for (const b of registrations) expect(b, 'the page never sends createSession').not.toMatch(/createSession/);
    await expect(page.getByRole('link', { name: 'Continue' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Continue' }).click();
    await page.waitForURL('**/dashboard');
  });
});
