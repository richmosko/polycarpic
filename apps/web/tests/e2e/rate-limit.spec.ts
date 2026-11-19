// POLY-150 R8 and R10, in the `rate-limit` project: it depends on the main project, so it runs after every other spec.
//  - the real limit holds in e2e: six wrong /second-step/confirm-code calls inside a minute, the 6th is 429 with BetterAuth's standard body, and the
//    page shows its rate-limit message (S26). It waits for the bucket to empty first (support.quiet) and never raises the limit, forges an address or resets it.
//  - no log line of web or the service holds a code, a secret or a password from any spec of this run (R10, S3).
import { expect, test } from '@playwright/test';
import { allEmailedCodes, base, flows, PASSWORD, quiet, readLog, seed, outboxMark, codeFor, slot } from './support.ts';

test('the 6th wrong confirm-code is 429, the page says so, and the limit is the real one  [red if: the limit is off, raised or per-user, or the page shows nothing for a 429]', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`${base}/settings/second-step`);
  await page.getByLabel('Password').fill(PASSWORD);
  const mark = outboxMark();
  await quiet('/second-step/confirm-code'); // every other spec is done; let their calls age out so all six fall in one window
  await slot('/second-step/send-code');
  await page.getByRole('button', { name: 'Continue' }).click();
  await codeFor('ada@e2e.test', mark); // the code exists; the spec never uses it
  const statuses: { status: number; body: string }[] = [];
  page.on('response', async (r) => { if (r.url().endsWith('/api/auth/second-step/confirm-code')) statuses.push({ status: r.status(), body: await r.text().catch(() => '') }); });
  for (let i = 1; i <= 6; i++) {
    await page.getByLabel('Code from the email').fill('000000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(() => statuses.length, { timeout: 10_000 }).toBe(i);
  }
  expect(statuses.slice(0, 5).map((s) => s.status), 'five counted calls').toEqual([403, 403, 403, 403, 403]);
  expect(statuses[5]!.status, 'the sixth').toBe(429);
  expect(statuses[5]!.body).toMatch(/too many requests/i);
  await expect(page.getByRole('alert')).toContainText(/too many|try again|wait/i);
});

test('no log line of web or the service holds a password, an emailed code, a TOTP key or a backup code from this run  [red if: a secret reaches a log (R10, S3)]', async () => {
  const needles = new Set<string>([PASSWORD, ...allEmailedCodes()]);
  const t = seed<{ secret: string; backupCodes: string[] }>('tess.json');
  const u = seed<{ secret: string; backupCodes: string[] }>('una-secrets.json');
  for (const x of [t, u]) { needles.add(x.secret); x.backupCodes.forEach((c) => needles.add(c)); }
  for (const f of flows('flows.jsonl')) { if (f.key) needles.add(f.key); if (f.secret) needles.add(f.secret); (f.codes ?? []).forEach((c: string) => needles.add(c)); }
  expect(needles.size, 'there is something to look for').toBeGreaterThan(20);
  const holds = (log: string, n: string) => (/^\d{6}$/.test(n) ? new RegExp(`(?<!\\d)${n}(?!\\d)`).test(log) : log.includes(n));
  // The scan finds what it looks for: a planted needle of each kind is seen, so a clean log below means clean, not blind.
  for (const n of [PASSWORD, ...allEmailedCodes().slice(0, 1), t.secret, t.backupCodes[0]!]) expect(holds(`2026-01-01 line ${n} end`, n), `control: ${n.length}-char needle`).toBe(true);
  for (const file of ['web.log', 'auth.log'] as const) {
    const log = readLog(file);
    expect(log.length, `${file} is captured`).toBeGreaterThan(0);
    for (const n of needles) expect(holds(log, n), `${file} holds a secret (${n.length} chars, starts ${n.slice(0, 2)}…)`).toBe(false);
  }
});
