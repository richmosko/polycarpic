// POLY-86 seceng S19 (seceng-client-ip.md @ a7a22c3): the client IP behind Caddy and the C-04 limits. Real Postgres, as poly_app.
// Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PW, boot, hdr, teardown, url, type Env } from './helpers/auth';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let limited: any; // limiter on, no IP requirement
let strict: any; // limiter off, requireClientIp
let lax: any; // limiter off, requireClientIp false
beforeAll(async () => {
  e = await boot();
  limited = await e.mk('real-domain', (o) => ({ ...o, rateLimit: e.optionsOf().rateLimit }));
  strict = await e.mk('real-domain', (o) => ({ ...o, requireClientIp: true }));
  lax = await e.mk('real-domain', (o) => ({ ...o, requireClientIp: false }));
});
afterAll(() => teardown(e));

const signIn = (email: string, password: string, ip?: string) =>
  new Request(url('/sign-in/email'), { method: 'POST', headers: { ...hdr, ...(ip === undefined ? {} : { 'x-forwarded-for': ip }) }, body: JSON.stringify({ email, password }) });

describe('limits per IP (C-04: 5 a minute)', () => {
  it('the 6th wrong password from one IP is 429 while another IP still gets 401  [red if: no customRules, or one shared bucket]', async () => {
    const u = e.seedUser();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await e.handle(signIn(u.email, 'wrong password 1', '203.0.113.5'), limited)).status);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    expect((await e.handle(signIn(u.email, 'wrong password 1', '203.0.113.6'), limited)).status).toBe(401);
  });

  it('IPv6 addresses share a bucket per /64  [red if: ipv6Subnet is not 64]', async () => {
    const u = e.seedUser();
    for (let i = 0; i < 5; i++) await e.handle(signIn(u.email, 'wrong password 1', '2001:db8::1'), limited);
    expect((await e.handle(signIn(u.email, 'wrong password 1', '2001:db8::2'), limited)).status).toBe(429);
    expect((await e.handle(signIn(u.email, 'wrong password 1', '2001:db8:0:1::1'), limited)).status).toBe(401);
  });
});

describe('requireClientIp', () => {
  for (const [label, value] of [['no header', undefined], ['two entries', '198.51.100.1, 203.0.113.5'], ['not an IP', 'not-an-ip'], ['a zone id', 'fe80::1%eth0']] as const)
    it(`${label}: 503, no row, auth.handler not reached  [red if: an unresolved IP is pooled or served]`, async () => {
      const u = e.seedUser();
      const before = e.count('SELECT 1 FROM public.session');
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const r = await e.handle(signIn(u.email, PW, value), strict);
        expect(r.status).toBe(503);
        expect(log.mock.calls.flat().join(' ')).not.toContain(String(value ?? '\u0000'));
      } finally { log.mockRestore(); }
      expect(e.count('SELECT 1 FROM public.session')).toBe(before);
    });

  it('IPv4, IPv6 and IPv4-mapped single entries pass  [red if: the check is stricter than BetterAuth and refuses a good client]', async () => {
    for (const ip of ['203.0.113.5', '2001:db8::1', '::ffff:192.0.2.1']) {
      const u = e.seedUser();
      expect((await e.handle(signIn(u.email, PW, ip), strict)).status, ip).toBe(200);
    }
  });

  it('one valid entry passes  [red if: the check refuses a good header]', async () => {
    const u = e.seedUser();
    expect((await e.handle(signIn(u.email, PW, '203.0.113.5'), strict)).status).toBe(200);
  });

  it('with requireClientIp false a request with no header proceeds  [red if: the flag is ignored]', async () => {
    const u = e.seedUser();
    expect((await e.handle(signIn(u.email, PW), lax)).status).toBe(200);
  });

  it('a session created with X-Forwarded-For lists that address in Settings → Sessions  [red if: session.ip_address is not filled from the header]', async () => {
    const u = e.seedUser();
    expect((await e.handle(signIn(u.email, PW, '203.0.113.5'), strict)).status).toBe(200);
    expect(e.count(`SELECT 1 FROM public.session WHERE user_id = '${u.id}'`)).toBe(1);
    const list = await e.dbm.withTenant(e.dbs.sessionUserId(u.id), (await e.sessionRow(u.email)).id ?? '', (tx: any) => e.A.listSessions(tx));
    expect(list[0].ipAddress).toBe('203.0.113.5');
  });
});
