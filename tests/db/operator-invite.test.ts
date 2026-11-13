// POLY-142 gate 2 (ruling @ process/cairn/reviews/POLY-142/ruling.md, C1-C10 and the R4 helpers). Real Postgres as poly_worker through the
// real runUserInvite (in-process) and through `sh bin/polycarpic cli user invite` (child process). Sign-ups go through the real
// BetterAuth handler. One clone is used in order (empty -> C3 -> C4 -> C1 -> C2 -> C5 -> C7/C8/C10), then a second empty clone for C1b.
// Assumed surface, all from ruling R4/R5: apps/worker/src/cli/user-invite.ts exports runUserInvite({ email, bootstrap },
// { stdout, stderr, origin }) -> 0|1|2, where stdout/stderr are { write(s: string) }; @poly/tenancy exports newInvitationToken,
// invitationLink, validOperatorEmail. Titles end with [red if: <mutation>].
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnv } from './helpers/api';
import { definerGaps, loadAllow } from './helpers/definers';
import { BASE, PW, boot, post, teardown, type Env } from './helpers/auth';
import { newToken, seedInvitation, tokenHash } from './helpers/invitation';
import { ROOT, must, psqlSession } from './helpers/pg';
import { hashInvitationToken, invitationLink, newInvitationToken, validOperatorEmail } from '../../packages/tenancy/src/index.ts';

let e: Env;
let auth: any;
let mod: any = null;
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BIN = join(ROOT, 'bin', 'polycarpic');

// ---- ledger for C7: everything any run printed or sent, collected for the whole file
const ledger = { out: [] as string[], noise: '', queries: [] as string[], tokens: [] as string[] };
const realErr = process.stderr.write.bind(process.stderr);
const realOut = process.stdout.write.bind(process.stdout);
let restoreQuery: () => void = () => {};
beforeAll(async () => {
  process.stderr.write = ((c: any, ...r: any[]) => { ledger.noise += String(c); return (realErr as any)(c, ...r); }) as any;
  process.stdout.write = ((c: any, ...r: any[]) => { ledger.noise += String(c); return (realOut as any)(c, ...r); }) as any;
  const pg: any = createRequire(join(ROOT, 'packages/db/package.json'))('pg');
  const orig = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: unknown, ...a: any[]) {
    const q = a[0];
    ledger.queries.push(typeof q === 'string' ? q : JSON.stringify([q?.text, q?.values]));
    if (a[1] && typeof a[0] === 'string') ledger.queries.push(JSON.stringify(a[1]));
    return orig.apply(this, a);
  };
  restoreQuery = () => { pg.Client.prototype.query = orig; };
  e = await boot();
  auth = await e.mk();
});
afterAll(async () => {
  process.stderr.write = realErr as any;
  process.stdout.write = realOut as any;
  restoreQuery();
  await teardown(e);
});

type Run = { code: number; out: string; err: string };
async function invite(email: string, bootstrap: boolean, origin = BASE): Promise<Run> {
  mod ??= await import(join(ROOT, 'apps/worker/src/cli/user-invite.ts'));
  let out = '';
  let err = '';
  const code = await mod.runUserInvite({ email, bootstrap }, { stdout: { write: (s: string) => ((out += s), true) }, stderr: { write: (s: string) => ((err += s), true) }, origin });
  ledger.out.push(out);
  return { code, out, err };
}
const tokenOf = (out: string): string => {
  const t = new URL(out.trim()).searchParams.get('invitation')!;
  ledger.tokens.push(t);
  return t;
};
const hex = (t: string) => tokenHash(t).toString('hex');
const row = (t: string) => must(`SELECT id, issued_via, (entity_id IS NULL)::text, (inviter_user_id IS NULL)::text, role, email, (claimed_at IS NOT NULL)::text, (revoked_at IS NOT NULL)::text FROM public.invitation WHERE token_hash = decode('${hex(t)}', 'hex')`, e.db).rows[0]!;
const counts = () => [e.count('SELECT 1 FROM public.invitation'), e.count('SELECT 1 FROM public.audit_event')];
const liveBootstrap = () => e.count(`SELECT 1 FROM public.invitation WHERE issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NULL`);
const users = (email: string) => e.count(`SELECT 1 FROM public."user" WHERE email = '${email}'`);
const signUp = (email: string, invitationToken: string, a = auth) =>
  e.handle(post('/sign-up/email', { email, password: PW, name: 'Invited', invitationToken }, '', { 'x-forwarded-for': '203.0.113.9' }), a);

// ---------------------------------------------------------------- R4: tenancy helpers
describe('R4 tenancy helpers', () => {
  it('newInvitationToken is 32 random bytes, canonical base64url, hashed through hashInvitationToken (independent oracle: node:crypto)  [red if: export missing, token not 43 canonical chars, or hash differs]', () => {
    const a = newInvitationToken();
    const b = newInvitationToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.token, 'base64url').toString('base64url')).toBe(a.token);
    expect(a.token).not.toBe(b.token);
    expect(Buffer.compare(a.hash, tokenHash(a.token))).toBe(0);
    expect(Buffer.compare(hashInvitationToken(a.token), a.hash)).toBe(0);
  });
  it('invitationLink is <origin>/sign-up?invitation=<token>  [red if: another path or parameter name]', () => {
    const t = newToken();
    expect(invitationLink('https://app.qa.test', t)).toBe(`https://app.qa.test/sign-up?invitation=${t}`);
  });
  it('validOperatorEmail refuses the O10 table and accepts a plain address  [red if: any bad address passes]', () => {
    for (const bad of BAD_ADDRESSES) expect(validOperatorEmail(bad), JSON.stringify(bad)).toBe(false);
    expect(validOperatorEmail('Ok.Person+tag@Example.com')).toBe(true);
    expect(validOperatorEmail('a'.repeat(250) + '@b.c')).toBe(true); // 254 exactly
  });
});
const BAD_ADDRESSES = ['a'.repeat(251) + '@b.c', 'a\rb@c.d', 'a\nb@c.d', 'a\0b@c.d', 'a b@c.d', 'a\x7fb@c.d', 'nodomain', 'a@@b.c', 'a@b@c.d', '@b.c', 'a@', ''];

// ---------------------------------------------------------------- C3 (first: the instance is empty)
describe('C3: the plain invite on an empty instance', () => {
  it('precondition: no user, invitation or audit row  [red if: a migration seeds one]', () => {
    expect(e.count('SELECT 1 FROM public."user"')).toBe(0);
    expect(counts()).toEqual([0, 0]);
  });
  it('exits 2, prints nothing on stdout and writes nothing, the audit included  [red if: it exits 0/1, issues a row, or audits a refusal]', async () => {
    const r = await invite(`plain-${stamp()}@qa.test`, false);
    expect(r.code, r.err).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toMatch(/use --bootstrap/);
    expect(counts()).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------- C4
describe('C4: re-issue and concurrency on an empty instance', () => {
  it('a second --bootstrap revokes the first: revoked_at set, one invitation.revoked audit row names it, its link is 403, exactly one live  [red if: the first stays live, no audit row, or the old link still signs up]', async () => {
    const a = `boot-a-${stamp()}@qa.test`;
    const r1 = await invite(a, true);
    expect(r1.code, r1.err).toBe(0);
    const t1 = tokenOf(r1.out);
    const r2 = await invite(`boot-b-${stamp()}@qa.test`, true);
    expect(r2.code, r2.err).toBe(0);
    const t2 = tokenOf(r2.out);
    const [id1, , , , , , , revoked1] = row(t1);
    expect(revoked1).toBe('true');
    expect(row(t2)[7]).toBe('false');
    expect(e.count(`SELECT 1 FROM public.audit_event WHERE kind = 'invitation.revoked' AND payload::text LIKE '%${id1}%'`)).toBe(1);
    expect(e.count(`SELECT 1 FROM public.audit_event WHERE kind = 'invitation.revoked'`)).toBe(1);
    expect(liveBootstrap()).toBe(1);
    expect((await signUp(a, t1)).status).toBe(403);
    expect(users(a)).toBe(0);
  });
  it('two concurrent --bootstrap runs both exit 0 and exactly one live bootstrap row remains (both 0 proves the advisory lock; without it the unique index fails one with 23505)  [red if: no lock, or the revoke is not in the same transaction]', async () => {
    const rs = await Promise.all([invite(`race-a-${stamp()}@qa.test`, true), invite(`race-b-${stamp()}@qa.test`, true)]);
    expect(rs.map((r) => r.code), rs.map((r) => r.err).join('|')).toEqual([0, 0]);
    rs.forEach((r) => tokenOf(r.out));
    expect(liveBootstrap()).toBe(1);
  });
});

// ---------------------------------------------------------------- C1
describe('C1: the first user', () => {
  it('--bootstrap exits 0; its link signs up through /sign-up/email; the user has their own Person only  [red if: the first user cannot be made, or gets more than a Person]', async () => {
    const email = `first-${stamp()}@qa.test`;
    const r = await invite(email, true);
    expect(r.code, r.err).toBe(0);
    const t = tokenOf(r.out);
    const s = await signUp(email, t);
    expect(s.status, await s.clone().text()).toBe(200);
    expect(users(email)).toBe(1);
    const uid = must(`SELECT id FROM public."user" WHERE email = '${email}'`, e.db).rows[0]![0];
    expect(e.count(`SELECT 1 FROM public.membership WHERE user_id = '${uid}'`)).toBe(1);
    expect(e.count(`SELECT 1 FROM public.entity`)).toBe(1);
    expect(e.count(`SELECT 1 FROM public.entity WHERE self_user_id = '${uid}'`)).toBe(1);
  });
  it('with a user present, --bootstrap exits 2 and the invitation and audit_event counts are unchanged  [red if: bootstrap works twice, or the refusal leaves a revoke/audit behind]', async () => {
    const before = counts();
    const r = await invite(`again-${stamp()}@qa.test`, true);
    expect(r.code, r.err).toBe(2);
    expect(r.out).toBe('');
    expect(r.err).toMatch(/already has a user/);
    expect(counts()).toEqual(before);
  });
});

// ---------------------------------------------------------------- C2, C6, C8
describe('C2 + C6 + C8: the plain invite on a non-empty instance', () => {
  it('writes one operator row (no entity, no inviter, viewer, email lower-cased) and one audit row with the exact payload keys; its link signs up with only a Person  [red if: wrong issued_via/role/entity, audit actor or kind wrong, extra payload keys, or the invitee sees more than their Person]', async () => {
    const email = `Op.Mixed-${stamp()}@QA.test`;
    const before = counts();
    const r = await invite(email, false);
    expect(r.code, r.err).toBe(0);
    const t = tokenOf(r.out);
    const [id, via, noEntity, noInviter, role, stored] = row(t);
    expect([via, noEntity, noInviter, role, stored]).toEqual(['operator', 'true', 'true', 'viewer', email.toLowerCase()]);
    expect(counts()).toEqual([before[0]! + 1, before[1]! + 1]);
    const a = must(`SELECT kind, (entity_id IS NULL)::text, actor, (actor_user_id IS NULL)::text, (subject_user_id IS NULL)::text,
        (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(payload) k), payload->>'invitation_id', payload->>'issued_via'
        FROM public.audit_event WHERE kind = 'invitation.issued' AND payload->>'invitation_id' = '${id}'`, e.db).rows;
    expect(a).toEqual([['invitation.issued', 'true', 'operator:cli', 'true', 'true', 'invitation_id,issued_via', id, 'operator']]);
    const s = await signUp(email.toLowerCase(), t);
    expect(s.status, await s.clone().text()).toBe(200);
    const uid = must(`SELECT id FROM public."user" WHERE email = '${email.toLowerCase()}'`, e.db).rows[0]![0];
    expect(e.count(`SELECT 1 FROM public.membership WHERE user_id = '${uid}'`)).toBe(1);
    expect(e.count(`SELECT 1 FROM public.entity e JOIN public.membership m ON m.entity_id = e.id WHERE m.user_id = '${uid}' AND e.self_user_id = '${uid}'`)).toBe(1);
  });
  it('stdout is one line <origin>/sign-up?invitation=<43 chars>\\n and the hash of that token is the row\'s token_hash  [red if: extra stdout, another origin, a non-canonical token, or a different hash stored]', async () => {
    const r = await invite(`link-${stamp()}@qa.test`, false, 'https://origin.qa.test');
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^https:\/\/origin\.qa\.test\/sign-up\?invitation=[A-Za-z0-9_-]{43}\n$/);
    const t = tokenOf(r.out);
    expect(must(`SELECT encode(token_hash, 'hex') FROM public.invitation WHERE id = '${row(t)[0]}'`, e.db).rows[0]![0]).toBe(hex(t));
    expect(Buffer.compare(hashInvitationToken(t), tokenHash(t))).toBe(0);
  });
  it('expires_at - created_at is exactly 7 days, for both kinds  [red if: another interval, or the expiry is not set in the issuing transaction]', async () => {
    const op = await invite(`exp-${stamp()}@qa.test`, false);
    expect(op.code, op.err).toBe(0);
    expect(must(`SELECT (expires_at - created_at = interval '7 days')::text FROM public.invitation WHERE id = '${row(tokenOf(op.out))[0]}'`, e.db).rows[0]![0]).toBe('true');
    // the bootstrap kind is checked on the rows C4 made (their live/revoked state does not matter for the interval)
    expect(must(`SELECT count(*) FILTER (WHERE expires_at - created_at = interval '7 days'), count(*) FROM public.invitation WHERE issued_via = 'bootstrap'`, e.db).rows[0]!.every((x, _i, a) => x === a[0])).toBe(true);
    expect(e.count(`SELECT 1 FROM public.invitation WHERE issued_via = 'bootstrap'`)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- C5
describe('C5: the bootstrap rule (claim_invitations / accept_invitations)', () => {
  it('a live bootstrap invitation planted next to an existing user is refused on all three USER_INSERTING routes and leaves no user  [red if: claim or accept lacks the bootstrap predicate]', async () => {
    const email = `planted-${stamp()}@qa.test`;
    const t = newToken();
    must(`INSERT INTO public.invitation (email, role, token_hash, expires_at, issued_via) VALUES ('${email}', 'viewer', decode('${hex(t)}', 'hex'), now() + interval '1 day', 'bootstrap')`, e.db);
    expect((await signUp(email, t)).status).toBe(403);
    expect(users(email)).toBe(0);
    e.mails.length = 0;
    await e.handle(post('/sign-in/magic-link', { email, callbackURL: '/' }), auth);
    const m = e.mails.find((x) => x.email === email);
    if (m) await e.handle(new Request(`${BASE}/api/auth/magic-link/verify?token=${m.token}&callbackURL=/`, { headers: { origin: BASE } }), auth);
    expect(users(email), 'magic-link/verify').toBe(0);
    await e.oauth(email, auth, true);
    expect(users(email), 'callback/google').toBe(0);
    expect(e.count(`SELECT 1 FROM public.invitation WHERE token_hash = decode('${hex(t)}', 'hex') AND claimed_at IS NULL AND revoked_at IS NULL`)).toBe(1);
    // the same email now also holds a live operator row: a token-less verified sign-up claims the operator row only
    const op = await invite(email, false);
    expect(op.code, op.err).toBe(0);
    const opTok = tokenOf(op.out);
    await e.oauth(email, auth, true);
    expect(users(email)).toBe(1);
    expect(row(opTok)[6], 'operator row claimed').toBe('true');
    expect(e.count(`SELECT 1 FROM public.invitation WHERE token_hash = decode('${hex(t)}', 'hex') AND claimed_at IS NULL`), 'bootstrap row untouched').toBe(1);
  });
});

// ---------------------------------------------------------------- C9 (child processes, concurrent)
type Child = { code: number | null; out: string; err: string };
function cli(args: string[], env: Record<string, string>): Promise<Child> {
  return new Promise((res) => {
    const c = spawn('sh', [BIN, 'cli', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    const k = setTimeout(() => c.kill('SIGKILL'), 60_000);
    c.on('close', (code) => { clearTimeout(k); res({ code, out, err }); });
  });
}
const childEnv = (extra: Record<string, string | undefined> = {}) => {
  const env: Record<string, string | undefined> = { PATH: process.env.PATH, ...dbEnv('poly_operator', e.db), APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173', ...extra };
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>;
};
const counter = () => new Promise<{ port: number; n: () => number; close: () => void }>((r) => {
  let n = 0;
  const s = net.createServer((c) => { n++; c.on('error', () => {}); c.destroy(); }).listen(0, '127.0.0.1', () => r({ port: (s.address() as net.AddressInfo).port, n: () => n, close: () => s.close() }));
});

describe('POLY-146 AC5: the operator has its own pool (ruling R1)', () => {
  const opm = () => import(join(ROOT, 'packages/db/src/operator.ts')) as Promise<any>;
  const cfg = (operator: Record<string, string> | undefined) => e.dbm.configure({ app: dbEnv('poly_app', e.db), worker: dbEnv('poly_worker', e.db), operator });
  const restore = () => cfg(dbEnv('poly_operator', e.db));
  it('withOperatorTx runs as poly_operator, not the worker role  [red if: it still borrows the worker pool]', async () => {
    const m = await opm();
    restore();
    const who = await m.withOperatorTx(async (tx: any) => (await tx.execute(e.dbm.sql`SELECT current_user AS u`)).rows[0].u);
    expect(who).toBe('poly_operator');
  });
  it('an operator env whose DATABASE_USER is poly_worker throws OperatorPoolRefused and opens no connection  [red if: the pool is built from whatever user it is given]', async () => {
    const c = await counter();
    try {
      const m = await opm();
      expect(typeof m.OperatorPoolRefused, 'OperatorPoolRefused is exported on @poly/db/operator').toBe('function');
      await e.dbm.close(); // pools are built once; the refusal is at build time
      cfg({ ...dbEnv('poly_worker', e.db), DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(c.port) });
      await expect(m.withOperatorTx(async () => 1)).rejects.toBeInstanceOf(m.OperatorPoolRefused);
      expect(c.n(), 'no connection attempted').toBe(0);
    } finally { c.close(); await e.dbm.close(); restore(); }
  });
  it('the same refusal when the user comes from process.env alone (no operator config)  [red if: the process.env path skips the user check]', async () => {
    const c = await counter();
    const saved = { ...process.env };
    try {
      const m = await opm();
      await e.dbm.close();
      cfg(undefined);
      Object.assign(process.env, dbEnv('poly_worker', e.db), { DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(c.port) });
      await expect(m.withOperatorTx(async () => 1)).rejects.toBeInstanceOf(m.OperatorPoolRefused);
      expect(c.n()).toBe(0);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      c.close();
      await e.dbm.close();
      restore();
    }
  });
  it('a child `bin/polycarpic cli` run with DATABASE_USER=poly_worker exits 1 with config.refused naming DATABASE_USER and never connects  [red if: the CLI accepts the worker role]', async () => {
    const c = await counter();
    try {
      const r = await cli(['user', 'invite', `wk-${stamp()}@qa.test`], childEnv({ ...dbEnv('poly_worker', e.db), DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(c.port) }));
      expect(r.code, r.err).toBe(1);
      expect(r.err).toMatch(/config\.refused/);
      expect(r.err).toMatch(/DATABASE_USER/);
      expect(r.out).toBe('');
      expect(c.n()).toBe(0);
    } finally { c.close(); }
  });
  it('a child run with AUTH_SECRET_FILE set is refused (the operator never holds the auth secret)  [red if: the operator registry row allows it]', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'poly146-')), 'auth_secret');
    writeFileSync(f, 'x-auth-secret-0123456789abcdef0123456789abcdef\n');
    const r = await cli(['user', 'invite', `as-${stamp()}@qa.test`], childEnv({ AUTH_SECRET_FILE: f }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/AUTH_SECRET_FILE/);
  });
});

describe('C6 + C9: through the image dispatcher (sh bin/polycarpic cli user invite ...)', () => {
  it('a successful plain invite exits 0 with one stdout line whose origin is PUBLIC_ORIGIN even with BETTER_AUTH_URL and ORIGIN set to others  [red if: no `cli` entry, extra stdout, or the origin comes from anywhere but PUBLIC_ORIGIN]', async () => {
    const email = `child-${stamp()}@qa.test`;
    const r = await cli(['user', 'invite', email], childEnv({ BETTER_AUTH_URL: 'https://evil.qa.test', ORIGIN: 'https://evil2.qa.test' }));
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/^http:\/\/localhost:5173\/sign-up\?invitation=[A-Za-z0-9_-]{43}\n$/);
    const t = tokenOf(r.out);
    expect(row(t)[5]).toBe(email);
    ledger.out.push(r.out);
    ledger.noise += r.err;
  });
  it('--bootstrap before or after the email is accepted (the instance is non-empty, so both exit 2, never 1)  [red if: the grammar takes the flag in one position only]', async () => {
    const em = `flagpos-${stamp()}@qa.test`;
    const rs = await Promise.all([cli(['user', 'invite', '--bootstrap', em], childEnv()), cli(['user', 'invite', em, '--bootstrap'], childEnv())]);
    expect(rs.map((r) => r.code), rs.map((r) => r.err).join('|')).toEqual([2, 2]);
  });
  it('bad argv exits 1 with nothing on stdout and no connection: no email, two emails, an unknown flag, and a bad address  [red if: usage errors exit 0/2, print on stdout, or connect]', async () => {
    const c = await counter();
    try {
      const env = childEnv({ DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(c.port) });
      const rs = await Promise.all([
        cli(['user', 'invite'], env),
        cli(['user', 'invite', 'a@b.c', 'd@e.f'], env),
        cli(['user', 'invite', 'a@b.c', '--nope'], env),
        cli(['user', 'invite', 'no-at-sign'], env),
      ]);
      rs.forEach((r, i) => { expect(r.code, `case ${i}: ${r.err}`).toBe(1); expect(r.out, `case ${i}`).toBe(''); });
      expect(c.n()).toBe(0);
    } finally { c.close(); }
  });
  it('a bad worker configuration exits 1 with a config.refused line on stderr and never connects (DATABASE_HOST unset; PUBLIC_ORIGIN invalid)  [red if: the configuration is not validated before a pool exists]', async () => {
    const c = await counter();
    try {
      const unset = await cli(['user', 'invite', `cfg-${stamp()}@qa.test`], childEnv({ DATABASE_HOST: undefined }));
      expect(unset.code).toBe(1);
      expect(unset.err).toMatch(/config\.refused/);
      expect(unset.out).toBe('');
      const bad = await cli(['user', 'invite', `cfg-${stamp()}@qa.test`], childEnv({ DATABASE_HOST: '127.0.0.1', DATABASE_PORT: String(c.port), PUBLIC_ORIGIN: 'ftp://nope' }));
      expect(bad.code).toBe(1);
      expect(bad.err).toMatch(/config\.refused/);
      expect(c.n()).toBe(0);
    } finally { c.close(); }
  });
});

// ---------------------------------------------------------------- C10
// Advisory locks are per database, so a try-lock on this clone's key is a probe that cannot see (or disturb) a parallel file's
// database. It never reads pg_locks, which is cluster-wide (tests/ci/db-harness C5).
const keyHeld = (): boolean =>
  must(`BEGIN; SELECT pg_try_advisory_xact_lock(hashtextextended('app.issue_operator_invitation', 0)); COMMIT;`, e.db).rows[0]![0] === 'f';

describe('C10: the lock bound', () => {
  it('while another session holds the advisory key, --bootstrap exits 1 within 3 s and writes nothing  [red if: no lock_timeout (it would wait forever), or it exits 2/0]', async () => {
    const holder = psqlSession(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('app.issue_operator_invitation', 0)); SELECT pg_sleep(8);`, e.db);
    try {
      for (let i = 0; i < 50 && !keyHeld(); i++) await new Promise((r) => setTimeout(r, 100));
      expect(keyHeld(), 'the holder has the key').toBe(true);
      const before = counts();
      const t0 = Date.now();
      const r = await invite(`locked-${stamp()}@qa.test`, true);
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(r.code, r.err).toBe(1);
      expect(r.out).toBe('');
      expect(r.err).not.toMatch(/select|app\.issue_operator_invitation/i); // no SQL text
      expect(counts()).toEqual(before);
    } finally {
      holder.kill();
      // docker exec may outlive the client: wait until the key is free again so later tests do not hit the 2 s bound
      for (let i = 0; i < 150 && keyHeld(); i++) await new Promise((r) => setTimeout(r, 100));
    }
  }, 30_000);
});

// ---------------------------------------------------------------- C7 (after the forced failure)
describe('C7: the token goes nowhere else', () => {
  it('a failure at COMMIT prints no link and exits 1  [red if: the link is written before COMMIT returned]', async () => {
    must(`CREATE FUNCTION public.qa_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa forced commit failure'; END $$;
          CREATE CONSTRAINT TRIGGER qa_fail_commit AFTER INSERT ON public.invitation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.qa_fail_commit();`, e.db);
    try {
      const before = counts();
      const r = await invite(`fail-${stamp()}@qa.test`, false);
      expect(r.code, r.err).toBe(1);
      expect(r.out).toBe('');
      expect(r.err).not.toMatch(/invitation=/);
      expect(counts()).toEqual(before);
    } finally {
      must(`DROP TRIGGER qa_fail_commit ON public.invitation; DROP FUNCTION public.qa_fail_commit()`, e.db);
    }
  });
  it('across every run in this file, no token or link appears in stderr, logger output, any invitation/audit_event column, or any query text or parameter  [red if: the token or link is logged, stored, or sent to the database]', () => {
    expect(ledger.tokens.length).toBeGreaterThanOrEqual(6);
    const dump = must(`SELECT coalesce(string_agg(row_to_json(i)::text, ' '), '') FROM public.invitation i`, e.db).rows[0]![0]! + must(`SELECT coalesce(string_agg(row_to_json(a)::text, ' '), '') FROM public.audit_event a`, e.db).rows[0]![0]!;
    const queries = ledger.queries.join('\n');
    expect(queries.length, 'the query spy saw traffic').toBeGreaterThan(0);
    for (const t of ledger.tokens) {
      expect(ledger.noise, 'stderr/stdout noise').not.toContain(t);
      expect(dump, 'table rows').not.toContain(t);
      expect(queries, 'query text/params').not.toContain(t);
    }
    expect(queries).not.toMatch(/sign-up\?invitation=/);
    expect(queries, 'positive control: the spy sees the issuing call').toContain('issue_operator_invitation');
  });
});

// ---------------------------------------------------------------- definer allowlist (C12's definers.json half)
describe('C12 (catalog half in TS): definers.json', () => {
  it('lists app.issue_operator_invitation with owner poly_govern, EXECUTE [poly_operator]; the C-15 comparison finds no gap  [red if: absent, another owner or grantee]', () => {
    const d = loadAllow().filter((x) => x.function.startsWith('app.issue_operator_invitation('));
    expect(d).toHaveLength(1);
    expect(d[0]!.owner).toBe('poly_govern');
    expect(d[0]!.execute).toEqual(['poly_operator']);
    expect(definerGaps(e.db)).toEqual([]);
  });
});

// ---------------------------------------------------------------- C1b: second, empty clone
describe('C1b: a bootstrap invitation is claimed by a verified, token-less Google callback', () => {
  it('on a second empty clone: --bootstrap exits 0, then a verified token-less callback creates the first user and claims it  [red if: a bootstrap row cannot be claimed token-less on an empty instance]', async () => {
    await e.dbm.close();
    await e.dba.close(); // not teardown(): the shared sql worker must stay up
    mod = null;
    e = await boot();
    auth = await e.mk();
    expect(e.count('SELECT 1 FROM public."user"')).toBe(0);
    const email = `first-g-${stamp()}@qa.test`;
    const r = await invite(email, true);
    expect(r.code, r.err).toBe(0);
    const t = tokenOf(r.out);
    await e.oauth(email, auth, true);
    expect(users(email)).toBe(1);
    expect(row(t)[6]).toBe('true');
    // and an unverified callback for another invited address claims nothing
    const other = `first-u-${stamp()}@qa.test`;
    expect((await invite(other, false)).code).toBe(0); // plain invite: the instance now has a user
    await e.oauth(other, auth, false);
    expect(users(other)).toBe(0);
  });
});
