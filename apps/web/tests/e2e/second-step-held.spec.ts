// POLY-150 criterion C4 (ruling R9 specs 3, 4, 5; R7, R10): an enrolled user is held at /sign-in until the second step passes, in a browser.
// Tess has a TOTP factor and Kay a passkey only (both seeded by serve.ts through the service's own code path). Each file's tests run in order and
// share Tess; her wrong codes here are 1, well under the 5 a hold allows. Titles end [red if: <mutation>].
import { expect, test } from '@playwright/test';
import { totp } from '../../../../tests/db/helpers/totp.ts';
import { appendFlow, base, cookieNames, expectNoSecretsKept, seed, signInUi, slot, watchUrls } from './support.ts';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const tess = () => seed<{ email: string; password: string; secret: string; backupCodes: string[] }>('tess.json');

test('spec 3: Tess signs in, is held at /sign-in/second-step with no handle, a wrong code leaves her held, the right code sets the handle and reaches next  [red if: the held page is missing, or a session exists before the second step]', async ({ page }) => {
  const t = tess();
  const urls = watchUrls(page);
  await signInUi(page, t.email, t.password, '/dashboard');
  await page.waitForURL('**/sign-in/second-step**');
  expect(await cookieNames(page), 'no handle while held').not.toContain('__Host-poly_handle');
  const direct = await page.request.get(`${base}/dashboard`, { maxRedirects: 0 });
  expect(direct.status(), '/dashboard while held').toBe(303);
  expect(direct.headers()['location']).toContain('/sign-in');
  // A wrong code leaves her held, with one message and no count of tries.
  await page.getByLabel('6-digit code').fill(totp(t.secret, Date.now() + 5 * 60_000)); // a code from another window
  await slot('/two-factor/verify-totp');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).not.toContainText(/\b[0-9]+\s+(tries|attempts|left)/i);
  expect(await cookieNames(page)).not.toContain('__Host-poly_handle');
  expect(new URL(page.url()).pathname).toBe('/sign-in/second-step');
  // The right code.
  await page.getByLabel('6-digit code').fill(totp(t.secret));
  await slot('/two-factor/verify-totp');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/dashboard');
  expect(await cookieNames(page)).toContain('__Host-poly_handle');
  await expectNoSecretsKept(page, urls, [t.secret, ...t.backupCodes, t.password], 'after the held sign-in');
  appendFlow('flows.jsonl', { user: 'tess', secret: t.secret, codes: t.backupCodes });
});

test('spec 4: a backup code signs her in once; the same code in a fresh hold is refused and she stays held  [red if: a backup code is reusable or the held page has no backup path]', async ({ page, browser }) => {
  const t = tess();
  const code = t.backupCodes[0]!;
  await signInUi(page, t.email, t.password);
  await page.waitForURL('**/sign-in/second-step**');
  await page.getByRole('button', { name: /use a backup code/i }).or(page.getByRole('link', { name: /use a backup code/i })).first().click();
  await page.getByLabel('Backup code').fill(code);
  await slot('/two-factor/verify-backup-code');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/dashboard');
  expect(await cookieNames(page)).toContain('__Host-poly_handle');
  const again = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p2 = await again.newPage();
  await signInUi(p2, t.email, t.password);
  await p2.waitForURL('**/sign-in/second-step**');
  await p2.getByRole('button', { name: /use a backup code/i }).or(p2.getByRole('link', { name: /use a backup code/i })).first().click();
  await p2.getByLabel('Backup code').fill(code);
  await slot('/two-factor/verify-backup-code');
  await p2.getByRole('button', { name: 'Continue' }).click();
  await expect(p2.getByRole('alert')).toBeVisible();
  expect(await cookieNames(p2)).not.toContain('__Host-poly_handle');
  expect(new URL(p2.url()).pathname).toBe('/sign-in/second-step');
  await again.close();
});

test('spec 5: Kay (a passkey only) signs in by password and lands on ?with=passkey with no handle; the passkey reaches /dashboard  [red if: a passkey-only user gets a session from the password alone, or the passkey state is missing]', async ({ page }) => {
  const k = seed<{ email: string; password: string; credentialId: string; privateKey: string; userHandle: string; rpId: string }>('kay.json');
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await client.send('WebAuthn.addCredential', { authenticatorId, credential: { credentialId: k.credentialId, isResidentCredential: true, rpId: k.rpId, privateKey: k.privateKey, userHandle: k.userHandle, signCount: 0 } });
  await signInUi(page, k.email, k.password);
  await page.waitForURL('**/sign-in/second-step**');
  expect(new URL(page.url()).searchParams.get('with'), 'the display hint').toBe('passkey');
  expect(await cookieNames(page), 'no handle after the password alone').not.toContain('__Host-poly_handle');
  expect((await page.request.get(`${base}/dashboard`, { maxRedirects: 0 })).status()).toBe(303);
  await slot('/passkey/verify-authentication');
  await page.getByRole('button', { name: /use a passkey/i }).click();
  await page.waitForURL('**/dashboard');
  expect(await cookieNames(page)).toContain('__Host-poly_handle');
});
