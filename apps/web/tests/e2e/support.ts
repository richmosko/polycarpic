// Shared by the POLY-150 specs. Plain node ESM (the e2e server runs under node), so imports carry their .ts extension.
//  - the delivery stand-in's outbox (R4): codeFor() reads the line written after a send, by the user's own email;
//  - the seeds serve.ts writes to .auth/ (mode 0600);
//  - slot()/quiet(): the sign-in service rate-limits per path, 5 a minute, for the ONE address every browser request shares (R8). The limit is
//    real in e2e and is never raised, forged or reset. Specs take a slot before the click that fires a limited call, and wait if the bucket is
//    full: BetterAuth's window is quiet-period shaped (a bucket that reached 5 reopens 60 s after its LAST call), and slot() mirrors that
//    in a ledger file shared by every worker.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';
import { totp } from '../../../../tests/db/helpers/totp.ts';

export const base = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
export const PASSWORD = 'e2e correct horse battery staple';
export const AUTH_DIR = join(dirname(fileURLToPath(import.meta.url)), '.auth');
export const seed = <T = any>(name: string): T => JSON.parse(readFileSync(join(AUTH_DIR, name), 'utf8')) as T;
export const readLog = (name: 'web.log' | 'auth.log'): string => readFileSync(join(AUTH_DIR, name), 'utf8');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OUTBOX = join(AUTH_DIR, 'outbox.jsonl');
const lines = (): { email: string; code: string }[] => (existsSync(OUTBOX) ? readFileSync(OUTBOX, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
/** How many codes the stand-in has written so far: take it before the send, pass it to codeFor. */
export const outboxMark = (): number => lines().length;
/** The code the stand-in wrote for `email` after `mark`; polls up to 10 s. A spec reads only its own user's line (the code is not derivable from the database). */
export async function codeFor(email: string, mark: number): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const hit = lines().slice(mark).find((l) => l.email.toLowerCase() === email.toLowerCase());
    if (hit) return hit.code;
    await sleep(100);
  }
  throw new Error(`no emailed code for ${email} in the outbox after line ${mark}`);
}
export const allEmailedCodes = (): string[] => lines().map((l) => l.code);

// ---- the shared limiter ledger ------------------------------------------------------------------------------------------------------
const LEDGER = join(AUTH_DIR, 'limiter.json');
const LOCK = join(AUTH_DIR, 'limiter.lock');
const REOPEN_MS = 61_000; // BetterAuth's window is 60 s since the last counted call; one second of margin
async function withLock<T>(fn: () => T): Promise<T> {
  for (let i = 0; ; i++) {
    try { mkdirSync(LOCK); break; } catch { if (i > 3000) { rmSync(LOCK, { recursive: true, force: true }); } await sleep(10); }
  }
  try { return fn(); } finally { rmSync(LOCK, { recursive: true, force: true }); }
}
type Bucket = { count: number; last: number };
const read = (): Record<string, Bucket> => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {});
/** Reserve one call on `path` (e.g. '/sign-in/email'), waiting while the bucket is full. Call it immediately before the action that sends it. */
export async function slot(path: string, max = 5): Promise<void> {
  let waited = 0;
  for (;;) {
    const wait = await withLock(() => {
      const all = read();
      const b = all[path] ?? { count: 0, last: 0 };
      const now = Date.now();
      if (now - b.last >= REOPEN_MS) b.count = 0;
      if (b.count >= max) return b.last + REOPEN_MS - now;
      all[path] = { count: b.count + 1, last: now };
      writeFileSync(LEDGER, JSON.stringify(all));
      return 0;
    });
    if (wait <= 0) { if (waited > 0) appendFlow('slot-waits.jsonl', { path, waitedMs: waited }); appendFlow('slot-calls.jsonl', { path, at: Date.now() }); return; }
    waited += Math.min(wait, 5000);
    await sleep(Math.min(wait, 5000));
  }
}
/** Wait until `path`'s bucket is empty (the rate-limit spec needs all six calls in one window), then take the whole window: no other spec may call it meanwhile. */
export async function quiet(path: string): Promise<void> {
  for (;;) {
    const wait = await withLock(() => {
      const b = read()[path];
      const now = Date.now();
      return b ? Math.max(0, b.last + REOPEN_MS - now) : 0;
    });
    if (wait <= 0) return;
    await sleep(Math.min(wait, 5000));
  }
}
export const noteCall = async (path: string): Promise<void> => withLock(() => { const all = read(); const b = all[path] ?? { count: 0, last: 0 }; all[path] = { count: b.count + 1, last: Date.now() }; writeFileSync(LEDGER, JSON.stringify(all)); });

// ---- UI helpers ---------------------------------------------------------------------------------------------------------------------
/** The plain sign-in form (the page is POLY-139's, unchanged here). Takes a slot first. */
export async function signInUi(page: Page, email: string, password: string, next = '/dashboard'): Promise<void> {
  await page.goto(`${base}/sign-in?next=${encodeURIComponent(next)}`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await slot('/sign-in/email');
  await page.getByRole('button', { name: 'Sign in' }).click();
}
export const cookieNames = async (page: Page): Promise<string[]> => (await page.context().cookies()).map((c) => c.name);

/** Every URL the page requests, so a spec can assert none carries a secret (R10). */
export function watchUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}
/** Nothing the browser can persist or show again holds `needles`: storage, cookies, IndexedDB names, history state, the URL, every request URL (R10, RC3). */
export async function expectNoSecretsKept(page: Page, urls: string[], needles: string[], where: string): Promise<void> {
  const kept = await page.evaluate(async () => {
    const dbs = (await (indexedDB as any).databases?.().catch(() => [])) ?? [];
    return JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage }, cookie: document.cookie, hist: history.state, url: location.href, idb: dbs.map((d: any) => d.name) });
  });
  for (const n of needles) {
    expect(kept, `${where}: browser storage, cookie, history or URL holds a secret`).not.toContain(n);
    for (const u of urls) expect(u, `${where}: a request URL carries a secret`).not.toContain(n);
  }
}
export const appendFlow = (name: string, v: unknown): void => { mkdirSync(AUTH_DIR, { recursive: true }); appendFileSync(join(AUTH_DIR, name), `${JSON.stringify(v)}\n`, { mode: 0o600 }); };
export const flows = (name: string): any[] => (existsSync(join(AUTH_DIR, name)) ? readFileSync(join(AUTH_DIR, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ---- the set-up flow (R3), by what the screen says (DESIGN second-step-setup.html) ---------------------------------------------------
// Selector contract for the build: labels and button names as DESIGN has them; `data-testid="totp-key"` on the typed-out key and
// `data-testid="backup-code"` on each of the ten codes (DESIGN draws both but names no hook).

/** Opens the set-up dialog if it is not already open (the gate's `?setup=1` opens it on load; Settings has a button). */
export async function openSetup(page: Page): Promise<Locator> {
  const dlg = page.getByRole('dialog');
  if (!(await dlg.isVisible().catch(() => false))) await page.getByRole('button', { name: 'Set up second step' }).first().click();
  await expect(dlg).toBeVisible();
  return dlg;
}

/** Any non-GET request to web's own origin that is not /api/auth/* (R3.0, G1): the dialog posts by fetch to the service only. */
export function watchWebWrites(page: Page): string[] {
  const bad: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === new URL(base).origin && r.method() !== 'GET' && !u.pathname.startsWith('/api/auth/')) bad.push(`${r.method()} ${u.pathname}`); });
  return bad;
}

/** In the dialog: password, emailed code, password again, TOTP: stops with the ten codes on screen. Returns the key and the codes. */
export async function enrolByAppToCodes(page: Page, email: string): Promise<{ key: string; codes: string[] }> {
  const dlg = await openSetup(page);
  await dlg.getByLabel('Password', { exact: true }).fill(PASSWORD);
  const mark = outboxMark();
  await slot('/second-step/send-code');
  await dlg.getByRole('button', { name: 'Continue' }).click();
  const code = await codeFor(email, mark);
  await dlg.getByLabel('Code from the email').fill(code);
  await slot('/second-step/confirm-code');
  await dlg.getByRole('button', { name: 'Continue' }).click();
  await dlg.getByRole('button', { name: /show the qr code|authenticator app/i }).first().click();
  await dlg.getByLabel('Your password, again').fill(PASSWORD); // step 3 asks it again for /two-factor/enable (R3.3)
  const key = ((await dlg.getByTestId('totp-key').textContent()) ?? '').replace(/\s/g, '');
  expect(key, 'the typed-out key').toMatch(/^[A-Z2-7]{16,}$/);
  await dlg.getByLabel('Enter the 6-digit code it shows').fill(totp(key));
  await slot('/two-factor/verify-totp');
  await dlg.getByRole('button', { name: 'Turn on second step' }).click();
  await expect(dlg.getByTestId('backup-code')).toHaveCount(10);
  const codes = (await dlg.getByTestId('backup-code').allTextContents()).map((c) => c.trim());
  return { key, codes };
}
