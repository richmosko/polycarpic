// POLY-89 criteria 1 and 6 (the sign-in gate) and POLY-150 criterion C5 (ruling R9 specs 1 and 2, R1.3, R3.0, R3.5, R3.6, R10): a held manager is sent to the one
// Settings page and enrols in the set-up DIALOG, end to end against the real handler, by authenticator app and by passkey. Titles end [red if: <mutation>].
// Ada is serve.ts's user: her only entity is her own Person, so no step is asked. Manny is the state `reset-mfa` leaves a manager in.
// Enid (manages "Shared Co") and Pia (no manager seat, so never held) are used by one spec each; their signed-in state is written by serve.ts, because the
// sign-in limiter is the service's real one (5 a minute for the one address every request here shares) and a spec that is not about signing in does not spend it.
import { expect, test } from '@playwright/test';
import { appendFlow, base, cookieNames, enrolByAppToCodes, expectNoSecretsKept, openSetup, outboxMark, codeFor, PASSWORD, seed, signInUi, slot, watchUrls, watchWebWrites } from './support.ts';

/** The gate's redirect (R1.3, P2): the one Settings page, `setup=1`, and `next` = the path asked for, through safe-next. */
const expectGate = (location: string | null | undefined, nextPath: string, label: string) => {
  const u = new URL(location ?? '', base);
  expect(u.pathname, `${label}: path`).toBe('/settings/second-step');
  expect(u.searchParams.get('setup'), `${label}: setup`).toBe('1');
  expect(u.searchParams.get('next'), `${label}: next`).toBe(nextPath);
};

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

  test('signs in, and every page redirects to /settings/second-step?setup=1  [red if: the gate is not in the session loader, or drops the setup hint (R1.3)]', async ({ page }) => {
    await signInUi(page, 'manager@e2e.test', PASSWORD, '/dashboard');
    await page.waitForURL('**/settings/second-step**');
    for (const path of ['/dashboard', '/settings/sessions', '/entities', '/']) {
      await page.goto(`${base}${path}`);
      expectGate(page.url(), path, path);
    }
  });
});

test.describe('C5 spec 1: enrol by authenticator app from the gate (Enid)', () => {
  test.use({ storageState: 'tests/e2e/.auth/enid.json' });

  test('the gate, the dialog, password, emailed code, password again, TOTP, ten codes, leaving by a sidebar link, back and forward, the panel, Make new codes  [red if: any step of the set-up is missing, or a code survives a way out]', async ({ page, browser }) => {
    const shared = seed<{ sharedEntityId: string; sharedEntityName: string }>('seeds.json');
    const urls = watchUrls(page);
    const writes = watchWebWrites(page);
    const responses: { url: string; cache: string | null }[] = [];
    page.on('response', (r) => responses.push({ url: r.url(), cache: r.headers()['cache-control'] ?? null }));
    // Held: every page answers 303 to the one Settings page, and its __data.json names no shared entity (R1.3, GA).
    for (const path of ['/dashboard', '/entities', '/settings/sessions']) {
      const r = await page.request.get(`${base}${path}`, { maxRedirects: 0 });
      expect(r.status(), path).toBe(303);
      expectGate(r.headers()['location'], path, path);
    }
    // P2: an off-origin `next` is carried as `/`: a request for //evil.example is held and its redirect names no such host.
    const evil = await page.request.get(`${base}//evil.example/x`, { maxRedirects: 0 });
    // Every outcome is explicit: a refusal (400 or 404), or a 303 to this origin's Settings page with next=/; anything else, a redirect to another host included, fails.
    expect([303, 400, 404], `//evil.example/x answered ${evil.status()}`).toContain(evil.status());
    if (evil.status() === 303) {
      const to = new URL(evil.headers()['location'] ?? '', base);
      expect(to.origin, 'never a redirect to another host').toBe(new URL(base).origin);
      expectGate(evil.headers()['location'], '/', 'a //evil next');
    }
    const data = await (await page.request.get(`${base}/settings/second-step/__data.json`)).text();
    expect(data, 'the held page loads no entity data, the shell included').not.toContain(shared.sharedEntityName);
    expect(data).not.toContain(shared.sharedEntityId);
    await page.goto(`${base}/dashboard`);
    await page.waitForURL('**/settings/second-step?setup=1&next=**');
    await expect(page.getByRole('dialog')).toBeVisible(); // ?setup=1 opens it
    // P1: the held page's selector shows the user's own name as its only label, and no entity's (no entity query runs on that route).
    await expect(page.getByText('Enid Enrol (Person)').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(shared.sharedEntityName);
    const { key, codes } = await enrolByAppToCodes(page, 'enid@e2e.test');
    appendFlow('flows.jsonl', { user: 'enid', key, codes });
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('button', { name: 'Finish' })).toBeDisabled();
    const noCodes = async (where: string, list: string[]) => { for (const c of list) await expect(page.locator('body'), where).not.toContainText(c); };
    // Finish needs the check; then the dialog goes to safeNext(next): she asked for /dashboard and lands on it (P2, R3.6).
    await dlg.getByLabel(/I have saved these codes/i).check();
    await dlg.getByRole('button', { name: 'Finish' }).click();
    await dlg.getByRole('button', { name: 'Done' }).click().catch(() => {});
    await page.waitForURL('**/dashboard');
    await noCodes('after Finish', codes);
    await page.goBack();
    await noCodes('after back', codes);
    await page.goForward();
    await noCodes('after forward', codes);
    // The panel now: Settings shows the methods, no code; a full reload, then back, shows none.
    await page.goto(`${base}/settings/second-step`);
    await expect(page.getByText(/authenticator app/i).first()).toBeVisible();
    await page.reload();
    await noCodes('after reload', codes);
    await page.goBack();
    await noCodes('after reload then back', codes);
    await page.goto(`${base}/settings/second-step`);
    // Make new codes, inside her 5-minute window: it asks her password and shows ten codes that differ from the first set (Addendum 2.3).
    await page.getByRole('button', { name: /make new codes/i }).click();
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /^(continue|make new codes)$/i }).last().click();
    await expect(page.getByTestId('backup-code')).toHaveCount(10);
    const fresh10 = (await page.getByTestId('backup-code').allTextContents()).map((c) => c.trim());
    expect(fresh10.filter((c) => codes.includes(c)), 'the new codes differ from the first set').toEqual([]);
    appendFlow('flows.jsonl', { user: 'enid-new-codes', codes: fresh10 });
    // A sidebar link with the NEW codes on screen: the dialog asks first (G2); on confirming, the link is followed (client-side: no pagehide fires).
    await page.getByRole('link', { name: 'Dashboard' }).first().dispatchEvent('click');
    await expect(page.getByText(/leave|discard|before you go|not saved/i).first()).toBeVisible();
    expect(new URL(page.url()).pathname, 'not followed yet').toBe('/settings/second-step');
    await page.getByRole('button', { name: /leave|discard|yes/i }).first().click();
    await page.waitForURL('**/dashboard');
    await noCodes('new codes after the link', fresh10);
    await page.goBack();
    await noCodes('new codes after back', fresh10);
    await page.goForward();
    await page.goBack();
    await page.reload();
    await noCodes('new codes after reload', fresh10);
    // `/dashboard` loads with no redirect now that she is enrolled (R3.6: carry-on is a new request on the rotated session).
    const r = await page.request.get(`${base}/dashboard`, { maxRedirects: 0 });
    expect(r.status(), '/dashboard after enrolment').toBe(200);
    // Nothing the dialog did wrote to web: only /api/auth/* (R3.0, G1); nothing secret survives in the browser (R10).
    expect(writes, 'non-GET requests to web outside /api/auth').toEqual([]);
    await expectNoSecretsKept(page, urls, [key, ...codes, ...fresh10, PASSWORD], 'after the flow');
    // `/api/auth` responses and web's signed-in pages are not storable (R10).
    for (const p of ['/two-factor/enable', '/two-factor/generate-backup-codes', '/two-factor/verify-totp']) expect(responses.find((x) => x.url.endsWith(`/api/auth${p}`))?.cache ?? '', p).toContain('no-store');
    expect((await page.request.get(`${base}/settings/second-step`)).headers()['cache-control'] ?? '', '/settings/second-step').toContain('no-store');
    // A later held sign-in refuses one of the FIRST codes: Make new codes replaced them.
    const fresh = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p2 = await fresh.newPage();
    await signInUi(p2, 'enid@e2e.test', PASSWORD);
    await p2.waitForURL('**/sign-in/second-step**');
    expect(await cookieNames(p2)).not.toContain('__Host-poly_handle');
    await p2.getByRole('button', { name: /use a backup code/i }).or(p2.getByRole('link', { name: /use a backup code/i })).first().click();
    await p2.getByLabel('Backup code').fill(codes[0]!);
    await slot('/two-factor/verify-backup-code');
    await p2.getByRole('button', { name: 'Continue' }).click();
    await expect(p2.getByRole('alert')).toBeVisible();
    expect(await cookieNames(p2)).not.toContain('__Host-poly_handle');
    await fresh.close();
  });
});

test.describe('C5 spec 2: enrol by passkey from the Entities message (Pia)', () => {
  test.use({ storageState: 'tests/e2e/.auth/pia.json' });

  test('Pia opens /entities, sees the message, opens the dialog and makes a passkey in a Chromium virtual authenticator; no backup-code step, no createSession, no write to web  [red if: the Entities message or the passkey path is missing, or it asks for a session (POLY-89 S16)]', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('WebAuthn.enable');
    await client.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    const registrations: string[] = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/auth/passkey/verify-registration')) registrations.push(r.postData() ?? ''); });
    const writes = watchWebWrites(page);
    await page.goto(`${base}/entities`);
    expect(new URL(page.url()).pathname, 'Pia is not held').toBe('/entities');
    await expect(page.getByText(/second step/i).first()).toBeVisible(); // DESIGN's message
    const dlg = await openSetup(page);
    await dlg.getByLabel('Password', { exact: true }).fill(PASSWORD);
    const mark = outboxMark();
    await slot('/second-step/send-code');
    await dlg.getByRole('button', { name: 'Continue' }).click();
    await dlg.getByLabel('Code from the email').fill(await codeFor('pia@e2e.test', mark));
    await slot('/second-step/confirm-code');
    await dlg.getByRole('button', { name: 'Continue' }).click();
    await dlg.getByLabel('Name this passkey').fill('Pia laptop');
    await dlg.getByRole('button', { name: 'Create passkey' }).click();
    await expect.poll(() => registrations.length, { timeout: 15_000 }).toBeGreaterThan(0);
    for (const b of registrations) expect(b, 'the dialog never sends createSession').not.toMatch(/createSession/);
    await expect(dlg.getByTestId('backup-code'), 'no backup-code step on the passkey path (D5 a)').toHaveCount(0);
    await dlg.getByRole('button', { name: 'Done' }).click();
    await expect(dlg).toBeHidden();
    expect(writes, 'non-GET requests to web outside /api/auth').toEqual([]);
  });
});
