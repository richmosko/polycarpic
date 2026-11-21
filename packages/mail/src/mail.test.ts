// POLY-137 R1 (ruling @ a5e9ce4f): @poly/mail, the Resend adapter, the fake, and the per-recipient cap. Pure: no database, no network.
// Today the package does not exist, so every test here is red with "Failed to resolve import ./index.ts" (the module is loaded inside each
// test so that each case reports on its own). Titles end [red if: <mutation>].
import { describe, expect, it } from 'vitest';

const mod = () => import('./index.ts') as Promise<any>;
const fake = () => import('./fake.ts') as Promise<any>;
const MAIL = { to: 'a@qa.test', subject: 'S', text: 'T' };
type Call = { url: string; init: any };
const recorder = (answer: () => Response | Promise<Response> = () => new Response('{"id":"x"}', { status: 200 })) => {
  const calls: Call[] = [];
  const f = async (url: any, init: any) => { calls.push({ url: String(url), init }); return answer(); };
  return { calls, f: f as unknown as typeof fetch };
};

describe('R1.2 the Resend adapter', () => {
  it('POSTs https://api.resend.com/emails with Bearer key, JSON, and body {from, to:[to], subject, text}, and nothing else [red if: a different URL, header or body field (an html part) is sent]', async () => {
    const { resendMailer } = await mod();
    const r = recorder();
    await resendMailer({ apiKey: 'k-123', from: 'polycarpic <no-reply@qa.test>', fetch: r.f }).send(MAIL);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(r.calls[0]!.init.method).toBe('POST');
    const h = new Headers(r.calls[0]!.init.headers);
    expect(h.get('authorization')).toBe('Bearer k-123');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('idempotency-key')).toBeNull();
    expect(JSON.parse(r.calls[0]!.init.body)).toEqual({ from: 'polycarpic <no-reply@qa.test>', to: ['a@qa.test'], subject: 'S', text: 'T' });
  });
  it('sends Idempotency-Key when the caller gives one [red if: the key is dropped]', async () => {
    const { resendMailer } = await mod();
    const r = recorder();
    await resendMailer({ apiKey: 'k', from: 'a@qa.test', fetch: r.f }).send({ ...MAIL, idempotencyKey: 'mail-1-1' });
    expect(new Headers(r.calls[0]!.init.headers).get('idempotency-key')).toBe('mail-1-1');
  });
  it('a non-2xx answer throws MailError carrying the status and never the response body [red if: the body or the key reaches the error]', async () => {
    const { resendMailer, MailError } = await mod();
    const r = recorder(() => new Response('{"message":"SECRET-BODY a@qa.test k-123"}', { status: 422 }));
    const x: any = await resendMailer({ apiKey: 'k-123', from: 'a@qa.test', fetch: r.f }).send(MAIL).catch((e: unknown) => e);
    expect(x).toBeInstanceOf(MailError);
    expect(x.status).toBe(422);
    expect(String(x.message) + JSON.stringify(x)).not.toMatch(/SECRET-BODY|k-123|a@qa\.test/);
  });
  it('a network fault throws MailError with status null [red if: the raw fetch error escapes]', async () => {
    const { resendMailer, MailError } = await mod();
    const f = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const x: any = await resendMailer({ apiKey: 'k', from: 'a@qa.test', fetch: f }).send(MAIL).catch((e: unknown) => e);
    expect(x).toBeInstanceOf(MailError);
    expect(x.status).toBeNull();
  });
  it('a send that outlives timeoutMs aborts and throws MailError(null); the default is 5 s [red if: no timeout, so a slow provider holds the request transaction]', async () => {
    const { resendMailer, MailError } = await mod();
    const hang = (async (_u: any, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'TimeoutError'))))) as unknown as typeof fetch;
    const t0 = Date.now();
    const x: any = await resendMailer({ apiKey: 'k', from: 'a@qa.test', fetch: hang, timeoutMs: 50 }).send(MAIL).catch((e: unknown) => e);
    expect(x).toBeInstanceOf(MailError);
    expect(x.status).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
    const seen: AbortSignal[] = [];
    const spy = (async (_u: any, init: any) => { seen.push(init.signal); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    await resendMailer({ apiKey: 'k', from: 'a@qa.test', fetch: spy }).send(MAIL);
    expect(seen[0], 'a default timeout signal is always passed').toBeInstanceOf(AbortSignal);
  });
  it('logs nothing itself (no console output on success or failure) [red if: the adapter logs an address or a key]', async () => {
    const { resendMailer } = await mod();
    const out: unknown[] = [];
    const real = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const k of Object.keys(real)) (console as any)[k] = (...a: unknown[]) => out.push(a);
    try {
      await resendMailer({ apiKey: 'k', from: 'a@qa.test', fetch: recorder().f }).send(MAIL);
      await resendMailer({ apiKey: 'k', from: 'a@qa.test', fetch: recorder(() => new Response('x', { status: 500 })).f }).send(MAIL).catch(() => {});
    } finally { Object.assign(console, real); }
    expect(out).toEqual([]);
  });
});

describe('R1.6 the fake', () => {
  it('records each Mail in sent; { fail: true } throws MailError(502) and records nothing [red if: the fake swallows or mis-codes a failure]', async () => {
    const { fakeMailer } = await fake();
    const { MailError } = await mod();
    const m = fakeMailer();
    await m.send(MAIL);
    expect(m.sent).toEqual([MAIL]);
    const bad = fakeMailer({ fail: true });
    const x: any = await bad.send(MAIL).catch((e: unknown) => e);
    expect(x).toBeInstanceOf(MailError);
    expect(x.status).toBe(502);
  });
});

describe('R1.6 no production file imports @poly/mail/fake', () => {
  it('no non-test file under any src/ tree names the fake [red if: a service imports the fake]', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(import.meta.dirname, '..', '..', '..');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        if (n === 'node_modules' || n === '.claude' || n === 'dist' || n === '.svelte-kit') continue;
        const p = join(d, n);
        if (statSync(p).isDirectory()) { if (n === 'tests') continue; walk(p); continue; }
        if (/\.(ts|js|mjs|svelte)$/.test(n) && !/\.test\.ts$/.test(n) && /\/src\//.test(p) && /@poly\/mail\/fake|mail\/src\/fake|\.\/fake\.ts/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length));
      }
    };
    for (const top of ['packages', 'apps']) walk(join(root, top));
    // The fake's own module and the package's index may name it; nothing else may.
    expect(hits.filter((h) => !/^\/packages\/mail\/src\/(fake|index)\.ts$/.test(h))).toEqual([]);
    expect((await fake()).fakeMailer, 'the fake exists').toBeTypeOf('function');
  });
});

describe('R1.8 the per-recipient cap: class RecipientCap { take(address, now?) }', () => {
  const MIN = 60_000;
  it('10 per rolling 60 minutes: the 11th take is refused, and a refused take does not extend the window [red if: the cap is 11, or a clock hour instead of a sliding log]', async () => {
    const { RecipientCap } = await mod();
    const c = new RecipientCap();
    const t0 = Date.UTC(2026, 10, 21, 10, 59);
    for (let i = 0; i < 10; i++) expect(c.take('a@qa.test', t0 + i * 1000), `take ${i + 1}`).toBe(true);
    expect(c.take('a@qa.test', t0 + 11_000)).toBe(false);
    // crossing a clock-hour boundary (11:00) does not reset it: a fixed hour would allow 20
    expect(c.take('a@qa.test', t0 + 2 * MIN)).toBe(false);
  });
  it('at 61 minutes the address can be mailed again; the sliding log frees old entries one by one [red if: the window never slides, or frees all at once late]', async () => {
    const { RecipientCap } = await mod();
    const c = new RecipientCap();
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 10; i++) c.take('a@qa.test', t0 + i * MIN); // takes at minute 0..9
    expect(c.take('a@qa.test', t0 + 59 * MIN)).toBe(false);
    expect(c.take('a@qa.test', t0 + 61 * MIN), 'the minute-0 take has aged out').toBe(true);
    const d = new RecipientCap();
    for (let i = 0; i < 10; i++) d.take('b@qa.test', t0);
    expect(d.take('b@qa.test', t0 + 61 * MIN)).toBe(true);
  });
  it('the key is the address trimmed and lower-cased: A@QA.test, " a@qa.test " and a@qa.test share one counter; other addresses are independent [red if: the key is case- or space-sensitive]', async () => {
    const { RecipientCap } = await mod();
    const c = new RecipientCap();
    const t = 1_000_000_000_000;
    for (let i = 0; i < 5; i++) expect(c.take('A@QA.test', t)).toBe(true);
    for (let i = 0; i < 5; i++) expect(c.take(' a@qa.test ', t)).toBe(true);
    expect(c.take('a@qa.test', t)).toBe(false);
    expect(c.take('other@qa.test', t)).toBe(true);
  });
  it('take() with no clock argument uses the real clock [red if: now is required]', async () => {
    const { RecipientCap } = await mod();
    const c = new RecipientCap();
    for (let i = 0; i < 10; i++) expect(c.take('c@qa.test')).toBe(true);
    expect(c.take('c@qa.test')).toBe(false);
  });
});
