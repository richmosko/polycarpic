// POLY-161c R7 / S8 (verdict A3, B8, B10, B11, B12): the startup zone check against a fake resolver over real UDP. The product's own
// `dns.promises.Resolver` asks two servers and the fake answers on the wire; nothing here stubs `verifyZone` or its result.
// Red today: src/ops/zone.ts does not exist.
import { Writable } from 'node:stream';
import { createLogger } from '@poly/config/log';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeDns, type Behaviour, type FakeDns } from '../../tests/helpers/fake-dns.ts';

type Verify = (zone: string | undefined, opts: { log: unknown; resolvers?: string[]; timeoutMs?: number; retryMs?: number }) => Promise<'verified' | 'unverified' | 'refused' | 'skipped'>;
const verifyZone = async (): Promise<Verify> => (await import('./zone.ts')).verifyZone as never;

const ZONE = 'example.com';
const live: FakeDns[] = [];
afterEach(async () => { for (const f of live.splice(0)) await f.close(); });

async function fakes(a: Behaviour, b: Behaviour): Promise<[FakeDns, FakeDns]> {
  const pair = [await startFakeDns(a), await startFakeDns(b)] as [FakeDns, FakeDns];
  live.push(...pair);
  return pair;
}
function capture() {
  const raw: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { raw.push(String(c)); cb(); } });
  const log = createLogger({ service: 'web', stream });
  const lines = () => raw.flatMap((s) => s.split('\n').filter(Boolean)).map((l) => JSON.parse(l) as { event: string; level: string; outcome?: string; err?: { type: string; code?: string } });
  return { log, lines, text: () => raw.join('') };
}
const events = (c: ReturnType<typeof capture>) => c.lines().map((l) => l.event);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('verifyZone: the answer table (R7, B10)', () => {
  it.each<[Behaviour, Behaviour, string, string, string]>([
    ['nxdomain', 'nxdomain', 'refused', 'zone.refused', 'fatal'],
    ['nxdomain', 'silent', 'unverified', 'zone.unverified', 'warn'],
    ['silent', 'nxdomain', 'unverified', 'zone.unverified', 'warn'],
    ['nxdomain', 'servfail', 'unverified', 'zone.unverified', 'warn'],
    ['nxdomain', 'refused', 'unverified', 'zone.unverified', 'warn'],
    ['nxdomain', 'nodata', 'unverified', 'zone.unverified', 'warn'],
    ['nxdomain', 'soa', 'verified', 'zone.verified', 'info'],
    ['soa', 'nxdomain', 'verified', 'zone.verified', 'info'],
    ['soa', 'soa', 'verified', 'zone.verified', 'info'],
    ['soa', 'silent', 'verified', 'zone.verified', 'info'],
    ['nodata', 'nodata', 'unverified', 'zone.unverified', 'warn'],
    ['servfail', 'servfail', 'unverified', 'zone.unverified', 'warn'],
    ['refused', 'refused', 'unverified', 'zone.unverified', 'warn'],
    ['silent', 'silent', 'unverified', 'zone.unverified', 'warn'],
  ])('%s + %s -> %s, logs %s at %s [red if: the pairing rule differs: one NXDOMAIN refuses, or two do not]', async (a, b, result, event, level) => {
    const [x, y] = await fakes(a, b);
    const c = capture();
    const out = await (await verifyZone())(ZONE, { log: c.log, resolvers: [x.address, y.address], timeoutMs: 600 });
    expect(out).toBe(result);
    const hits = c.lines().filter((l) => l.event.startsWith('zone.'));
    expect(hits.map((l) => [l.event, l.level])).toEqual([[event, level]]);
    if (result === 'refused') expect(hits[0]!.outcome).toBe('refused');
  });
});

describe('verifyZone: what is asked and what is logged (S8, B11)', () => {
  it('both resolvers get one SOA query for exactly the zone given, nothing prefixed  [red if: app. or staging. is asked, or the type is not SOA]', async () => {
    const [x, y] = await fakes('soa', 'soa');
    await (await verifyZone())(ZONE, { log: capture().log, resolvers: [x.address, y.address], timeoutMs: 600 });
    expect(x.names).toEqual([ZONE]);
    expect(y.names).toEqual([ZONE]);
    expect([...x.types, ...y.types]).toEqual([6, 6]);
  });

  it('undefined zone is skipped with zero queries and no zone line  [red if: private-ca or localhost is looked up]', async () => {
    const [x, y] = await fakes('nxdomain', 'nxdomain');
    const c = capture();
    expect(await (await verifyZone())(undefined, { log: c.log, resolvers: [x.address, y.address], timeoutMs: 300 })).toBe('skipped');
    await sleep(100);
    expect([x.names, y.names]).toEqual([[], []]);
    expect(events(c).filter((e) => e === 'zone.refused' || e === 'zone.unverified')).toEqual([]);
  });

  it('a refused start logs once and the zone name is in no line  [red if: refused logs twice or quotes the domain]', async () => {
    const [x, y] = await fakes('nxdomain', 'nxdomain');
    const c = capture();
    await (await verifyZone())(ZONE, { log: c.log, resolvers: [x.address, y.address], timeoutMs: 600 });
    expect(events(c).filter((e) => e === 'zone.refused')).toHaveLength(1);
    expect(c.text()).not.toContain('example');
  });

  it('a verified and an unverified line also leave the zone name out  [red if: the name is logged on success or warning]', async () => {
    for (const [a, b] of [['soa', 'soa'], ['silent', 'silent']] as const) {
      const [x, y] = await fakes(a, b);
      const c = capture();
      await (await verifyZone())(ZONE, { log: c.log, resolvers: [x.address, y.address], timeoutMs: 300 });
      expect(c.text(), `${a}+${b}`).not.toContain('example');
    }
  });
});

describe('verifyZone: the bound (R7)', () => {
  it('two silent resolvers: unverified at the timer, not before it, not long after  [red if: the bound is the resolver\'s own, or absent]', async () => {
    const [x, y] = await fakes('silent', 'silent');
    const t0 = Date.now();
    expect(await (await verifyZone())(ZONE, { log: capture().log, resolvers: [x.address, y.address], timeoutMs: 400 })).toBe('unverified');
    const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(380);
    expect(dt).toBeLessThan(900);
  });

  it('a late NXDOMAIN pair after the timer cannot change the result  [red if: the answer is awaited past the bound]', async () => {
    const [x, y] = await fakes('nxdomain', 'nxdomain');
    x.delayMs = 900;
    y.delayMs = 900;
    const c = capture();
    expect(await (await verifyZone())(ZONE, { log: c.log, resolvers: [x.address, y.address], timeoutMs: 300 })).toBe('unverified');
    await sleep(1200);
    expect(events(c)).not.toContain('zone.refused');
  });

  it('a late SOA after the timer does not turn into verified either  [red if: a late answer is applied]', async () => {
    const [x, y] = await fakes('soa', 'silent');
    x.delayMs = 900;
    const c = capture();
    expect(await (await verifyZone())(ZONE, { log: c.log, resolvers: [x.address, y.address], timeoutMs: 300 })).toBe('unverified');
    await sleep(1200);
    expect(events(c)).not.toContain('zone.verified');
  });
});

describe('verifyZone: the retry (R7, B12)', () => {
  it('after unverified, a second query arrives on the timer, and a later NXDOMAIN pair logs zone.missing and never throws or exits  [red if: no retry, or a late refusal ends the process]', async () => {
    const [x, y] = await fakes('silent', 'silent');
    const c = capture();
    expect(await (await verifyZone())(ZONE, { log: c.log, resolvers: [x.address, y.address], timeoutMs: 150, retryMs: 250 })).toBe('unverified');
    const first = x.names.length;
    expect(first).toBe(1);
    x.behaviour = 'nxdomain';
    y.behaviour = 'nxdomain';
    await sleep(1000);
    expect(x.names.length, 'a second query arrived').toBeGreaterThan(first);
    expect(events(c)).toContain('zone.missing');
    expect(c.lines().find((l) => l.event === 'zone.missing')!.level).toBe('error');
    expect(events(c)).not.toContain('zone.refused');
    const seen = x.names.length;
    await sleep(700);
    expect(x.names.length, 'it keeps retrying after zone.missing').toBeGreaterThan(seen);
  });

  it('after unverified, a later SOA logs zone.verified and the retries stop  [red if: it retries forever, or never reports success]', async () => {
    const [x, y] = await fakes('silent', 'silent');
    const c = capture();
    await (await verifyZone())(ZONE, { log: c.log, resolvers: [x.address, y.address], timeoutMs: 150, retryMs: 250 });
    x.behaviour = 'soa';
    await sleep(900);
    expect(events(c)).toContain('zone.verified');
    const n = x.names.length;
    await sleep(700);
    expect(x.names.length).toBe(n);
  });

  it('a verified or refused start sets no retry  [red if: a timer is left for a settled answer]', async () => {
    const [x, y] = await fakes('soa', 'soa');
    await (await verifyZone())(ZONE, { log: capture().log, resolvers: [x.address, y.address], timeoutMs: 300, retryMs: 100 });
    await sleep(500);
    expect(x.names).toHaveLength(1);
  });
});
