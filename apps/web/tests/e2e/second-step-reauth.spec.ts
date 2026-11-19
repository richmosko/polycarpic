// POLY-150h (Addendum 3 T10, A2; R3.0 and R3.5 for this dialog): Confirm it's you in the browser, on Settings' step-up actions. Rex and Kit each hold an
// authenticator app and a passkey, are signed in, and their step-up stamp is an hour old, so every action opens the dialog. The backup-code path is not
// written (D7). Selector contract: the dialog is `role="dialog"` named "Confirm it's you"; labels `Password` and `6-digit code`; button `Continue`; a button
// named /passkey/ for the passkey method; the failure text "That password or code didn't work"; Settings rows hold the method's name and a button named /remove/. Titles end [red if: <mutation>].
import { expect, test } from '@playwright/test';
import { totp } from '../../../../tests/db/helpers/totp.ts';
import { base, seed, slot, watchUrls, watchWebWrites, expectNoSecretsKept } from './support.ts';

type R = { email: string; secret: string; passkeyName: string; credentialId: string; privateKey: string; userHandle: string; rpId: string };
const who = (k: 'rex' | 'kit') => seed<Record<string, R>>('reauth-users.json')[k]!;
// The panel row holding the method's name and its Remove button: the innermost such element, whatever the markup (a div or a list item).
const row = (page: import('@playwright/test').Page, name: string) => page.locator('div, li').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: /remove/i }) }).last();

test.describe('T10 by code (Rex)', () => {
  test.use({ storageState: 'tests/e2e/.auth/rex.json' });

  test('past her window, Remove opens Confirm it\'s you; a wrong code shows the one message with no count and the passkey stays; the right code removes it  [red if: the dialog is missing, counts tries, or the action runs after a failure]', async ({ page }) => {
    const r = who('rex');
    const urls = watchUrls(page);
    const writes = watchWebWrites(page);
    await page.goto(`${base}/settings/second-step`);
    await expect(row(page, r.passkeyName)).toBeVisible();
    await slot('/second-step/reauth/begin'); // opening the dialog sends `begin`
    await row(page, r.passkeyName).getByRole('button', { name: /remove/i }).click();
    const dlg = page.getByRole('dialog', { name: /confirm it's you/i });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('Password', { exact: true })).toBeVisible();
    // A wrong code: the one message, no count, and the action does not run.
    await dlg.getByLabel('Password', { exact: true }).fill('e2e correct horse battery staple');
    await dlg.getByLabel('6-digit code').fill(totp(r.secret, Date.now() + 5 * 60_000)); // another window: wrong
    await slot('/second-step/reauth');
    await dlg.getByRole('button', { name: 'Continue' }).click();
    await expect(dlg).toContainText("That password or code didn't work");
    await expect(dlg).not.toContainText(/\b\d+\s*(tries|attempts|left|remaining)\b/i);
    await expect(row(page, r.passkeyName)).toBeVisible();
    // The right code: the dialog closes, the action runs as a new request, the passkey is gone.
    await dlg.getByLabel('6-digit code').fill(totp(r.secret));
    await slot('/second-step/reauth');
    await dlg.getByRole('button', { name: 'Continue' }).click();
    await expect(dlg).toBeHidden();
    await expect(row(page, r.passkeyName)).toHaveCount(0);
    expect(writes, 'the dialog writes only to /api/auth (R3.0)').toEqual([]);
    await expectNoSecretsKept(page, urls, [r.secret, 'e2e correct horse battery staple'], 'after Confirm it\'s you');
  });

  test('closing Confirm it\'s you by Close, Escape and a backdrop click clears what was typed (R3.5)  [red if: a typed password or code survives a way out]', async ({ page }) => {
    await page.goto(`${base}/settings/second-step`);
    for (const how of ['close', 'escape', 'backdrop'] as const) {
      await slot('/second-step/reauth/begin');
      await page.getByRole('button', { name: /make new codes/i }).click();
      const dlg = page.getByRole('dialog', { name: /confirm it's you/i });
      await expect(dlg).toBeVisible();
      await dlg.getByLabel('Password', { exact: true }).fill(`typed-${how}`);
      await dlg.getByLabel('6-digit code').fill('123456');
      if (how === 'close') await dlg.getByRole('button', { name: /^(close|cancel)$/i }).first().click();
      else if (how === 'escape') await page.keyboard.press('Escape');
      else await page.mouse.click(2, 2);
      await expect(dlg).toBeHidden();
      await slot('/second-step/reauth/begin');
      await page.getByRole('button', { name: /make new codes/i }).click();
      await expect(page.getByRole('dialog', { name: /confirm it's you/i }).getByLabel('Password', { exact: true })).toHaveValue('');
      await expect(page.getByRole('dialog', { name: /confirm it's you/i }).getByLabel('6-digit code')).toHaveValue('');
      await page.keyboard.press('Escape');
    }
  });
});

test.describe('T10 by passkey (Kit)', () => {
  test.use({ storageState: 'tests/e2e/.auth/kit.json' });

  test('past his window, Remove opens Confirm it\'s you and a passkey re-check (virtual authenticator, user-verified) lets the action run  [red if: the passkey re-check is missing, or does not pass requireUserVerification]', async ({ page }) => {
    const k = who('kit');
    const client = await page.context().newCDPSession(page);
    await client.send('WebAuthn.enable');
    const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await client.send('WebAuthn.addCredential', { authenticatorId, credential: { credentialId: Buffer.from(k.credentialId, 'base64url').toString('base64'), isResidentCredential: true, rpId: k.rpId, privateKey: k.privateKey, userHandle: k.userHandle, signCount: 0 } });
    const writes = watchWebWrites(page);
    await page.goto(`${base}/settings/second-step`);
    await slot('/second-step/reauth/begin');
    await page.getByRole('button', { name: /remove/i }).first().click();
    const dlg = page.getByRole('dialog', { name: /confirm it's you/i });
    await expect(dlg).toBeVisible();
    await slot('/second-step/reauth/passkey');
    await dlg.getByRole('button', { name: /passkey/i }).click();
    await expect(dlg).toBeHidden({ timeout: 15_000 });
    expect(writes).toEqual([]);
  });
});
