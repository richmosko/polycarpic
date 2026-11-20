// POLY-150 (ruling R5, R6, R7, R8, R9 specs 6-9, R10, RC2, RC4): the service refuses what the screens do out of order; the held page is the same for every
// caller; the address the service records is the proxy's, never the browser's; Settings lists the methods as text; nothing secret is in page data;
// the new pages cannot be framed. Lou, Una and Ada are seeded by serve.ts. Titles end [red if: <mutation>].
import { expect, test, request as pwRequest } from '@playwright/test';
import { base, PASSWORD, seed, slot } from './support.ts';

const una = () => seed<{ email: string; secret: string; backupCodes: string[]; credentialId: string; publicKey: string; passkeyName: string }>('una-secrets.json');

test.describe('spec 6: a step out of order (Lou)', () => {
  test.use({ storageState: 'tests/e2e/.auth/lou.json' });

  test('confirm-code with no challenge, then enable with no grant, by direct fetch from the page: both refused, nothing is enabled, and Lou is still held by the gate  [red if: the service trusts the screen order (S17)]', async ({ page }) => {
    await page.goto(`${base}/settings/second-step`);
    await slot('/second-step/confirm-code');
    const post = (path: string, body: unknown) => page.evaluate(async ([p, b]) => { const r = await fetch(`/api/auth${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, text: await r.text() }; }, [path, body] as const);
    const confirm = await post('/second-step/confirm-code', { code: '123456' });
    expect([400, 403], `confirm-code: ${confirm.text}`).toContain(confirm.status);
    const enable = await post('/two-factor/enable', { password: PASSWORD });
    expect(enable.status, `enable: ${enable.text}`).toBe(403);
    expect(enable.text).toContain('email_confirmation_required');
    const gate = await page.request.get(`${base}/dashboard`, { maxRedirects: 0 });
    expect(gate.status(), 'nothing was enabled: the gate still holds Lou').toBe(303);
    expect(gate.headers()['location']).toContain('/settings/second-step');
  });
});

test.describe('spec 7: the held page is the same for every caller (S10)', () => {
  test('an anonymous visitor, an enrolled user and an unenrolled user open /sign-in/second-step with no hold: the same status, headers that matter, text and states  [red if: the page tells callers apart]', async ({ browser }) => {
    const seen: { status: number; text: string }[] = [];
    for (const state of [{ cookies: [], origins: [] }, 'tests/e2e/.auth/una.json', 'tests/e2e/.auth/vic.json'] as const) {
      const ctx = await browser.newContext({ storageState: state as never });
      const page = await ctx.newPage();
      const res = await page.goto(`${base}/sign-in/second-step`);
      await page.waitForLoadState('networkidle');
      seen.push({ status: res!.status(), text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim() });
      await ctx.close();
    }
    expect(seen[0]!.status).toBe(200);
    expect(seen.every((s) => s.status === seen[0]!.status), 'one status').toBe(true);
    expect(seen.every((s) => s.text === seen[0]!.text), 'one text').toBe(true);
    expect(seen[0]!.text, 'the page is built, not a 404 body').toMatch(/code|passkey|backup/i);
    // With no hold the page's first call is refused; the page shows its expired state and no email, factor list or "passkey available".
    expect(seen[0]!.text).not.toMatch(/@e2e\.test|\bUna\b|\bLou\b|\bTess\b/);
  });
});

test.describe('spec 7b / R8: the address the service records is the proxy\'s', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a real sign-in that carries a forged x-forwarded-for is recorded with the loopback address, not the forged one  [red if: the proxy appends or trusts the browser\'s header (POLY-149 R3)]', async () => {
    const s = seed<{ forgedAddress: string; testServer: unknown; db: string }>('seeds.json');
    process.env.POLY_TEST_SERVER = JSON.stringify(s.testServer);
    const { must } = await import('../../../../tests/db/helpers/sql.ts');
    const api = await pwRequest.newContext({ baseURL: base });
    await slot('/sign-in/email');
    const r = await api.post('/api/auth/sign-in/email', { headers: { origin: base, 'x-forwarded-for': s.forgedAddress }, data: { email: 'ada@e2e.test', password: PASSWORD } });
    expect(r.status(), await r.text()).toBe(200);
    const row = must(`SELECT r.ip_address FROM app.sign_in_record r JOIN public."user" u ON u.id = r.user_id WHERE u.email = 'ada@e2e.test' ORDER BY r.id DESC LIMIT 1`, s.db).rows[0];
    expect(row, 'a sign-in record exists').toBeTruthy();
    expect(row![0]).not.toBe(s.forgedAddress);
    expect(row![0]).toMatch(/^(127\.0\.0\.1|::1|(0{1,4}:){7}0{1,4})$/);
    // And no browser request carries a trusted header of its own: the service answers a bare request with no address 503 (R8), so the proxy sets one.
    const bare = await pwRequest.newContext({ baseURL: `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 4173) + 1000}` });
    expect((await bare.get('/api/auth/ok')).status(), 'the service itself requires an address').toBe(503);
  });
});

test.describe('Settings → Sign-in and second step (Una: an app, and a passkey named like a script)', () => {
  test.use({ storageState: 'tests/e2e/.auth/una.json' });

  test('spec 8: lists the app with its date and the passkey with its name; Remove and Make new codes open Confirm it\'s you with the password and the authenticator code  [red if: the panel is missing, or the dialog is not a working re-check (Addendum 3)]', async ({ page }) => {
    await page.goto(`${base}/settings/second-step`);
    await expect(page.getByText(/authenticator app/i).first()).toBeVisible();
    await expect(page.getByText(una().passkeyName, { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(una().secret);
    await expect(page.locator('body')).not.toContainText(/backup codes left|[0-9]+ (backup )?codes? (left|remaining)/i); // the count is not shown (R2)
    await slot('/second-step/reauth/begin'); // opening the dialog sends `begin`
    await page.getByRole('button', { name: /make new codes/i }).click();
    const dialog = page.getByRole('dialog', { name: /confirm it's you/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/new backup codes|new codes|backup codes/i); // the action's name
    await expect(dialog.getByLabel('Password', { exact: true })).toBeVisible(); // a working re-check (Addendum 3), not the interim state
    await expect(dialog.getByLabel(/code from your authenticator app/i)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await slot('/second-step/reauth/begin');
    await page.getByRole('button', { name: /^remove/i }).first().click();
    await expect(page.getByRole('dialog', { name: /confirm it's you/i }).getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).not.toContainText(/isn't available yet/i);
  });

  test('spec 9 / RC4: the passkey name `<img src=x onerror=…>` renders as literal text and runs nothing  [red if: the name is injected as HTML]', async ({ page }) => {
    await page.goto(`${base}/settings/second-step`);
    await expect(page.getByText(una().passkeyName, { exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), 'the handler ran').toBeUndefined();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });

  test('R10: the rendered HTML and __data.json of both pages hold no secret, backup code, credential id, public key or handle  [red if: page data carries a secret (S2)]', async ({ page }) => {
    const u = una();
    await page.goto(`${base}/settings/second-step`);
    const handle = (await page.context().cookies()).find((c) => c.name === '__Host-poly_handle')?.value;
    expect(handle, 'the seeded handle').toBeTruthy();
    for (const path of ['/entities', '/entities/__data.json', '/settings/second-step', '/settings/second-step/__data.json', '/sign-in/second-step', '/sign-in/second-step/__data.json', '/settings/second-step/__data.json?x-sveltekit-invalidated=01']) {
      const res = await page.request.get(`${base}${path}`);
      const text = await res.text();
      for (const n of [u.secret, u.credentialId, u.publicKey, handle!, ...u.backupCodes]) expect(text, `${path} holds a secret`).not.toContain(n);
    }
  });
});

test.describe('RC2 / R10: headers on the new pages', () => {
  test('both pages answer frame-ancestors \'none\' and script-src \'self\' in the HTTP Content-Security-Policy header, and the Settings page is no-store  [red if: the pages can be framed or cached]', async ({ request }) => {
    for (const path of ['/settings/second-step', '/entities', '/sign-in/second-step']) {
      const res = await request.get(`${base}${path}`, { maxRedirects: 0 });
      expect([200, 303], path).toContain(res.status());
      const csp = res.headers()['content-security-policy'] ?? '';
      expect(csp, `${path}: Content-Security-Policy`).toContain("frame-ancestors 'none'");
      expect(csp, `${path}: script-src`).toMatch(/script-src[^;]*'self'/);
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    }
    const settings = await request.get(`${base}/settings/second-step`, { maxRedirects: 0 });
    expect(settings.headers()['cache-control'] ?? '', 'the set-up page is not storable (RC3)').toContain('no-store');
    // Every signed-in HTML and __data.json response carries it (R10, set once in hooks.server.ts), so a page that mounts the dialog later is covered.
    for (const path of ['/dashboard', '/entities', '/entities/__data.json', '/settings/second-step/__data.json']) {
      expect((await request.get(`${base}${path}`, { maxRedirects: 0 })).headers()['cache-control'] ?? '', path).toContain('no-store');
    }
  });
});

test.describe('R1.3 the gate while held (Lou)', () => {
  test.use({ storageState: 'tests/e2e/.auth/lou.json' });

  test('the two exempt paths answer 200; every other path, a trailing slash, a longer path and a POST to a form action elsewhere answer 303 to /settings/second-step?setup=1  [red if: the exemption is a prefix of /settings, or the redirect lacks setup=1]', async ({ request }) => {
    const held = (loc: string | undefined, next: string, label: string) => {
      const u = new URL(loc ?? '', base);
      expect(u.pathname, label).toBe('/settings/second-step');
      expect(u.searchParams.get('setup'), label).toBe('1');
      expect(u.searchParams.get('next'), `${label}: next`).toBe(next);
    };
    for (const p of ['/settings/second-step', '/settings/second-step/__data.json']) expect((await request.get(`${base}${p}`, { maxRedirects: 0 })).status(), p).toBe(200);
    for (const p of ['/settings', '/settings/sessions', '/settings/second-step/x', '/entities', '/dashboard']) {
      const r = await request.get(`${base}${p}`, { maxRedirects: 0 });
      expect(r.status(), p).toBe(303);
      held(r.headers()['location'], p, p);
    }
    // A data request (`__data.json`): SvelteKit answers a handle redirect there as 200 JSON {type: "redirect", location}, not a 303. What matters: the body is
    // a redirect to the set-up route with setup=1, and it carries no page data (no `nodes`) for the held user.
    for (const p of ['/settings/sessions/__data.json', '/entities/__data.json', '/dashboard/__data.json']) {
      const r = await request.get(`${base}${p}`, { maxRedirects: 0 });
      expect([200, 303], `${p} answered ${r.status()}`).toContain(r.status());
      if (r.status() === 303) { held(r.headers()['location'], p.replace('/__data.json', ''), p); continue; }
      const raw = await r.text();
      const body = JSON.parse(raw) as { type?: string; location?: string; nodes?: unknown };
      expect(Object.keys(body).sort(), `${p}: only type, location and status`).toEqual(['location', 'status', 'type']);
      expect(raw, `${p}: no entity data in the body`).not.toContain(seed<{ sharedEntityName: string }>('seeds.json').sharedEntityName);
      expect(body.type, `${p}: the body is a redirect`).toBe('redirect');
      const to = new URL(body.location ?? '', base);
      expect(to.pathname, `${p}: to the set-up route`).toBe('/settings/second-step');
      expect(to.searchParams.get('setup'), `${p}: setup=1`).toBe('1');
      expect(body.nodes, `${p}: no page data for a held user`).toBeUndefined();
    }
    const slash = await request.get(`${base}/settings/second-step/`, { maxRedirects: 0 });
    expect([200, 303, 308], 'trailing slash: normalised to the exempt path, or held').toContain(slash.status());
    if (slash.status() === 303) expect(new URL(slash.headers()['location'] ?? '', base).searchParams.get('setup')).toBe('1');
    const post = await request.post(`${base}/settings/sessions?/revoke`, { maxRedirects: 0, form: { id: 'x' }, headers: { origin: base } });
    expect(post.status(), 'a POST to a form action elsewhere').toBe(303);
    expect(new URL(post.headers()['location'] ?? '', base).searchParams.get('setup')).toBe('1');
  });
});

test.describe('spec 6b: closing the dialog four ways leaves no state (Lou)', () => {
  test.use({ storageState: 'tests/e2e/.auth/lou.json' });

  test('Close, Escape and a backdrop click each empty the dialog: reopened, the password field is empty  [red if: a typed password survives a way out (R3.5)]', async ({ page }) => {
    for (const how of ['close', 'escape', 'backdrop'] as const) {
      await page.goto(`${base}/settings/second-step?setup=1`);
      const dlg = page.getByRole('dialog');
      await expect(dlg).toBeVisible();
      await dlg.getByLabel('Password', { exact: true }).fill(`typed-${how}-${PASSWORD}`);
      if (how === 'close') await dlg.getByRole('button', { name: /^(close|cancel)$/i }).first().click();
      else if (how === 'escape') await page.keyboard.press('Escape');
      else await page.mouse.click(2, 2);
      await expect(dlg).toBeHidden();
      await page.getByRole('button', { name: 'Set up second step' }).first().click(); // reopened in the same page: no reload to wipe the state for it
      await expect(page.getByRole('dialog').getByLabel('Password', { exact: true })).toHaveValue('');
    }
  });
});
