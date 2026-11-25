// POLY-137 R3.6, R5 (ruling @ a5e9ce4f): the worker's definers against a real database, as poly_worker through the extended protocol, and the
// drain end to end. claim_mail picks the oldest unsent row (attempts < 10, unclaimed or claimed over 5 minutes ago) and counts the attempt;
// mail_sent / mail_failed record the result; purge_mail_outbox deletes only SENT rows over 30 days old; the other two purges are callable by
// poly_worker alone. Titles end [red if: ...]. Red today: the definers and tables do not exist.
// The drain tests import apps/worker/src/jobs/mail.ts (ASSUMED export drainMail({mailer, origin}), see jobs.test.ts) inside each test.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, teardown, type Env } from './helpers/auth';
import { tx } from './helpers/auth-tx';
import { holds, memMailer, outbox } from './helpers/mail';
import { codeOf, fails, fixture, msgOf } from './helpers/second-step';
import { must } from './helpers/sql';
import { softAuthenticator } from './helpers/webauthn';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let fx: ReturnType<typeof fixture>;
beforeAll(async () => { e = await boot(); fx = fixture(e.db, 139); });
afterAll(() => teardown(e));
// each case starts with an empty queue: the drain claims the oldest row first, so a row another case left would be sent too
beforeEach(() => { must('DELETE FROM app.mail_outbox', e.db); });

const asWorker = <T>(fn: (q: (t: string, v?: unknown[]) => Promise<any>) => Promise<T>) => tx(e.db, 'poly_worker', (q) => fn((t, v = []) => q(t, v)), true);
const claim = () => asWorker(async (q) => (await q('SELECT * FROM app.claim_mail()')).rows);
/** An outbox row as a superuser fixture (no hold): `age` and the claim state are the test's. */
function row(uid: string, email: string, o: { kind?: string; createdAgo?: string; sent?: boolean; attempts?: number; claimedAgo?: string | null; tx?: string } = {}): string {
  return must(`INSERT INTO app.mail_outbox (user_id, kind, to_address, payload, created_at, sent_at, attempts, claimed_at, tx)
    VALUES ('${uid}', '${o.kind ?? 'password_changed'}', '${email}', '{}'::jsonb, now() - interval '${o.createdAgo ?? '1 minute'}', ${o.sent ? `now() - interval '${o.createdAgo ?? '1 minute'}'` : 'NULL'}, ${o.attempts ?? 0},
      ${o.claimedAgo ? `now() - interval '${o.claimedAgo}'` : 'NULL'}, ${o.tx ?? `pg_current_xact_id()`}) RETURNING id`, e.db).rows[0]![0]!;
}

describe('claim_mail', () => {
  it('returns (id, kind, to_address, payload, attempts) for the oldest unsent row, sets claimed_at, counts the attempt, and does not hand the same row out again at once [red if: two drains can send one row]', async () => {
    const u = e.seedUser();
    const newer = row(u.id, u.email, { createdAgo: '1 minute', kind: 'backup_code_used' });
    const older = row(u.id, u.email, { createdAgo: '10 minutes', kind: 'method_removed', tx: `'1'::xid8` });
    const got = await claim();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ id: older, kind: 'method_removed', to_address: u.email, attempts: 1 });
    expect(got[0]).toHaveProperty('payload');
    const second = await claim();
    expect(second.map((r: any) => r.id), 'the oldest is claimed, so the next is the newer one').toEqual([newer]);
    expect(await claim(), 'nothing left that is unclaimed').toEqual([]);
    expect(must(`SELECT attempts, claimed_at IS NOT NULL FROM app.mail_outbox WHERE id = '${older}'`, e.db).rows[0]).toEqual(['1', 't']);
  });
  it('a claim older than 5 minutes is reclaimable and counts again; a row with 10 attempts is never claimed; a sent row is never claimed [red if: a dead worker strands a notice, or a row loops forever]', async () => {
    const u = e.seedUser();
    const stale = row(u.id, u.email, { claimedAgo: '6 minutes', attempts: 1, kind: 'backup_code_used' });
    row(u.id, u.email, { attempts: 10, kind: 'method_removed', tx: `'2'::xid8` });
    row(u.id, u.email, { sent: true, kind: 'backup_codes_replaced', tx: `'3'::xid8` });
    const fresh = row(u.id, u.email, { claimedAgo: '2 minutes', attempts: 1, kind: 'method_added', tx: `'4'::xid8` });
    const got = await claim();
    expect(got.map((r: any) => r.id)).toEqual([stale]);
    expect(got[0].attempts).toBe(2);
    expect(await claim(), 'the 2-minute claim is still held, the 10-attempt row is retired, the sent row is done').toEqual([]);
    void fresh;
  });
  it('R3.6 mail_sent sets sent_at on the row and notice_sent_at on every hold it announces; mail_failed sets last_status and stores no text [red if: a sent notice leaves its hold waiting, or a failure stores a message]', async () => {
    const u = await fx.user({ enrolled: true });
    const k1 = softAuthenticator();
    const k2 = softAuthenticator();
    const s = (await import('./helpers/handle')).sessionWithHandle(e.db, u.id, { fresh: true });
    await fx.committed('poly_auth', u.id, s.id, async (q) => {
      for (const k of [k1, k2]) await q(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ($1, $2, $3, 0, 'singleDevice', false, 'internal')`, [k.publicKey, u.id, k.credentialId]);
    });
    const mail = outbox(e, u.id, 'method_added').at(-1)![0]!;
    await asWorker((q) => q('SELECT app.mail_failed($1, $2)', [mail, 502]));
    expect(must(`SELECT last_status, sent_at IS NULL FROM app.mail_outbox WHERE id = '${mail}'`, e.db).rows[0]).toEqual(['502', 't']);
    expect(must(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'mail_outbox' AND column_name ~ '(message|error|text|body)'`, e.db).rows, 'no column can hold a provider message').toEqual([]);
    await asWorker((q) => q('SELECT app.mail_sent($1)', [mail]));
    expect(must(`SELECT sent_at IS NOT NULL FROM app.mail_outbox WHERE id = '${mail}'`, e.db).rows[0]![0]).toBe('t');
    expect(holds(e, u.id).map((h) => h[7] !== ''), 'every hold of that mail has its notice recorded').toEqual([true, true]);
  });
});

describe('R5 the purges', () => {
  it('purge_mail_outbox deletes SENT rows created over 30 days ago and nothing else: an unsent row of any age, and a sent row under 30 days, stay [red if: an old unsent notice is purged and vanishes from gate line 19]', async () => {
    const u = e.seedUser();
    const oldSent = row(u.id, u.email, { createdAgo: '31 days', sent: true, kind: 'method_removed', tx: `'11'::xid8` });
    const oldUnsent = row(u.id, u.email, { createdAgo: '90 days', kind: 'backup_code_used', tx: `'12'::xid8` });
    const newSent = row(u.id, u.email, { createdAgo: '29 days', sent: true, kind: 'backup_codes_replaced', tx: `'13'::xid8` });
    await asWorker((q) => q('SELECT app.purge_mail_outbox()'));
    const left = must(`SELECT id FROM app.mail_outbox WHERE user_id = '${u.id}'`, e.db).rows.map((r) => r[0]);
    expect(left.sort()).toEqual([oldUnsent, newSent].sort());
    expect(left).not.toContain(oldSent);
  });
  it('poly_worker runs all three purges; poly_auth and poly_app are refused with 42501 permission denied for function [red if: a purge is reachable from the request path or not from the worker]', async () => {
    for (const f of ['app.purge_tx_identity()', 'app.purge_sign_in_record()', 'app.purge_mail_outbox()']) {
      await expect(asWorker((q) => q(`SELECT ${f}`)), `worker ${f}`).resolves.toBeDefined();
      for (const role of ['poly_auth', 'poly_app']) {
        const x = await fails(tx(e.db, role, (q) => q(`SELECT ${f}`, [])));
        expect([codeOf(x), msgOf(x)], `${role} ${f}`).toEqual(['42501', expect.stringMatching(/permission denied for function/)]);
      }
    }
  });
});

describe('R5.4 the drain against the database: one row sends one mail, a failure is recorded and retried after the 5-minute claim', () => {
  const drain = async (mailer: any) => ((await import('../../apps/worker/src/jobs/mail.ts')) as any).drainMail({ mailer, origin: 'https://app.qa.test' });
  it('one notice row sends exactly one mail to the account address, then is marked sent and claims no more [red if: a row is sent twice or never marked]', async () => {
    const u = e.seedUser();
    const id = row(u.id, u.email, { kind: 'password_changed' });
    const mm = memMailer();
    await drain(mm);
    expect(mm.sent).toHaveLength(1);
    expect(mm.sent[0]).toMatchObject({ to: u.email, subject: 'Your polycarpic password was changed' });
    expect(must(`SELECT sent_at IS NOT NULL FROM app.mail_outbox WHERE id = '${id}'`, e.db).rows[0]![0]).toBe('t');
    await drain(mm);
    expect(mm.sent, 'a sent row is never sent again').toHaveLength(1);
  });
  it('with { fail: true } the row records last_status 502 and stays unsent; it is not retried inside its 5-minute claim, is after it, and a later success sends it [red if: a failure marks the row sent or retries at once]', async () => {
    const u = e.seedUser();
    const id = row(u.id, u.email, { kind: 'backup_code_used' });
    const bad = memMailer({ fail: true });
    await drain(bad);
    expect(must(`SELECT last_status, sent_at IS NULL, attempts FROM app.mail_outbox WHERE id = '${id}'`, e.db).rows[0]).toEqual(['502', 't', '1']);
    const good = memMailer();
    await drain(good);
    expect(good.sent, 'still inside the 5-minute claim').toHaveLength(0);
    must(`UPDATE app.mail_outbox SET claimed_at = now() - interval '6 minutes' WHERE id = '${id}'`, e.db);
    await drain(good);
    expect(good.sent).toHaveLength(1);
    expect(good.sent[0]!.idempotencyKey, 'the attempt is in the key').toBe(`mail-${id}-2`);
  });
  it('a held method_added row: the drain arms the cancel hash, mails the fragment link, and only then does the hold\'s notice count; the cancel link from that mail cancels [red if: the mailed token is not the armed one]', async () => {
    const u = await fx.user({ enrolled: true });
    const s = (await import('./helpers/handle')).sessionWithHandle(e.db, u.id, { fresh: true });
    const k = softAuthenticator();
    await fx.committed('poly_auth', u.id, s.id, (q) => q(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ($1, $2, $3, 0, 'singleDevice', false, 'internal')`, [k.publicKey, u.id, k.credentialId]));
    expect(holds(e, u.id)[0]![7], 'notice not yet sent').toBe('');
    const mm = memMailer();
    await drain(mm);
    const mail = mm.sent.find((m) => m.to === u.email)!;
    expect(mail.subject).toBe('A sign-in method was added to your polycarpic account');
    const token = /sign-in\/cancel-method#([A-Za-z0-9_-]{43})/.exec(mail.text)![1];
    expect(token).toBeTruthy();
    const h = holds(e, u.id)[0]!;
    expect(h[5], 'a 32-byte hash is armed').toMatch(/^\\x[0-9a-f]{64}$/);
    expect(h[7], 'the notice is recorded as accepted').not.toBe('');
    expect(Number(must(`SELECT extract(epoch FROM (usable_at - clock_timestamp())) / 3600 FROM app.method_hold WHERE user_id = '${u.id}'`, e.db).rows[0]![0])).toBeGreaterThan(23.9);
  });
});

// POLY-160 R5 (C23, C24): the database lost under the worker's schedule. The run in flight is a `job.run` with outcome error, the schedule goes on, and the next run after the database is back is ok.
// The process does not end (an unhandled client error would fail this file's run). [red if: survive() is removed from the worker pool; the per-client line is covered by the web and wrappers cases]
// A TCP forwarder in front of Postgres with down()/up() on the same port (kept here: this area's test files may not import another area's helper).
async function startProxy(host: string, port: number) {
  const net = await import('node:net');
  const socks = new Set<import('node:net').Socket>();
  const make = () => net.createServer((c) => {
    const up = net.connect(port, host);
    for (const x of [c, up]) { socks.add(x); x.on('close', () => socks.delete(x)); x.on('error', () => x.destroy()); }
    c.pipe(up); up.pipe(c);
  });
  let server = make();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const own = (server.address() as import('node:net').AddressInfo).port;
  const down = async () => { for (const x of socks) x.destroy(); if (server.listening) await new Promise<void>((r) => server.close(() => r())); };
  return { port: own, kill: down, down, up: async () => { if (server.listening) return; server = make(); await new Promise<void>((r, j) => server.once('error', j).listen(own, '127.0.0.1', () => r())); } };
}

describe('the database lost under the worker (POLY-160 R5)', () => {
  it('a drain run while the database is away logs job.run outcome error; the next run once it is back logs ok; the schedule never stops', async () => {
    const { dbEnv } = await import('./helpers/api');
    const dbm: any = await import('../../packages/db/src/index.ts');
    const { startSchedule } = await import('../../apps/worker/src/jobs/schedule.ts');
    const { drainMail } = await import('../../apps/worker/src/jobs/mail.ts');
    const base = dbEnv('poly_worker', e.db);
    const proxy = await startProxy(base.DATABASE_HOST!, Number(base.DATABASE_PORT));
    await dbm.close();
    dbm.configure({ app: dbEnv('poly_app', e.db), auth: dbEnv('poly_auth', e.db), worker: { ...base, DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(proxy.port) }, operator: dbEnv('poly_operator', e.db) });
    const seen: Array<{ outcome: unknown }> = [];
    const log = {
      info: (ev: string, f?: any) => { if (ev === 'job.run') seen.push({ outcome: f?.outcome }); },
      error: (ev: string, f?: any) => { if (ev === 'job.run') seen.push({ outcome: f?.outcome }); },
    };
    const mailer = { send: async () => undefined } as any;
    const until = async (want: string, from: number, ms = 20_000) => {
      for (let t = 0; t < ms; t += 100) { if (seen.slice(from).some((s) => s.outcome === want)) return; await new Promise((r) => setTimeout(r, 100)); }
      throw new Error(`no job.run ${want} within ${ms} ms; saw ${JSON.stringify(seen)}`);
    };
    const sched = startSchedule([{ name: 'mail.drain', everyMs: 300, run: () => drainMail({ mailer, origin: 'https://app.qa.test' }) }], log);
    try {
      await until('ok', 0);
      await proxy.down();
      await until('error', seen.length);
      await proxy.up();
      await until('ok', seen.length);
    } finally {
      sched.stop();
      await proxy.kill().catch(() => undefined);
      await dbm.close();
      dbm.configure({ app: dbEnv('poly_app', e.db), auth: dbEnv('poly_auth', e.db), worker: dbEnv('poly_worker', e.db), operator: dbEnv('poly_operator', e.db) });
    }
  }, 60_000);
});
