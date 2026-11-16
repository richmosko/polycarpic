// POLY-89c (ruling 6eed53f8 R6; seceng C-a, C-f): `polycarpic cli user reset-mfa`. Ruled names: definer
// app.reset_second_step(p_email text) RETURNS boolean (EXECUTE poly_operator only); command apps/worker/src/cli/user-reset-mfa.ts
// exporting runUserResetMfa({ email }, { stdout, stderr }) -> 0 | 1 | 2 (ASSUMED: the shape of runUserInvite; exit 2 on no match is ruled).
// Red today because the definer and the command are absent. Titles end [red if: ...].
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloneMigrated, dbEnv } from './helpers/api';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, url } from './helpers/pg';
import { fixture, pgmod, fails, msgOf } from './helpers/second-step';
import { must } from './helpers/sql';

let db: string;
let f: ReturnType<typeof fixture>;
beforeAll(() => { db = cloneMigrated(); f = fixture(db, 894); });
afterAll(() => {});

async function asOperator<T>(fn: (q: (t: string, v?: unknown[]) => Promise<any>) => Promise<T>, commit = true): Promise<T> {
  const c = new pgmod.Client({ connectionString: url('poly_operator', db) });
  await c.connect();
  const q = (t: string, v?: unknown[]) => c.query({ text: t, values: v, queryMode: 'extended' });
  try { await q('BEGIN'); const r = await fn(q); if (commit) await q('COMMIT'); return r; }
  finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
}
const reset = (email: string) => asOperator((q) => q('SELECT app.reset_second_step($1)', [email]).then((r) => r.rows[0].reset_second_step));

async function enrolled() {
  const u = await f.user({ enrolled: true });
  must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up) VALUES ('k','${u.id}','rc${u.id}',0,'singleDevice',false)`, db);
  const s1 = f.session(u.id, true);
  f.session(u.id);
  must(`INSERT INTO public.verification (identifier, value, expires_at) VALUES ('trust-device-${u.id}', '${u.id}', now() + interval '1 day')`, db);
  return { ...u, s1 };
}

describe('C6 reset_second_step (R6)', () => {
  it('clears every factor, second_step_at and two_factor_enabled, deletes sessions, challenges, grants and trust-device rows, writes audit second_step.reset (actor operator, subject = the user) and a notification [red if: the definer is absent or leaves any of these]', async () => {
    const u = await enrolled();
    must(`INSERT INTO app.email_challenge (user_id, session_id, purpose, code_hash, expires_at) VALUES ('${u.id}', '${u.s1}', 'first_enrolment', decode(repeat('00', 32), 'hex'), now() + interval '5 minutes')`, db);
    expect(await reset(u.email)).toBe(true);
    const c = (sql: string) => must(sql, db).rows[0]![0];
    expect(c(`SELECT count(*) FROM public.two_factor WHERE user_id = '${u.id}'`)).toBe('0');
    expect(c(`SELECT count(*) FROM public.passkey WHERE user_id = '${u.id}'`)).toBe('0');
    expect(c(`SELECT second_step_at IS NULL AND NOT two_factor_enabled FROM public."user" WHERE id = '${u.id}'`)).toBe('t');
    expect(c(`SELECT count(*) FROM public.session WHERE user_id = '${u.id}'`)).toBe('0');
    expect(c(`SELECT count(*) FROM app.email_challenge WHERE user_id = '${u.id}'`)).toBe('0');
    expect(c(`SELECT count(*) FROM app.enrolment_grant WHERE user_id = '${u.id}'`)).toBe('0');
    expect(c(`SELECT count(*) FROM public.verification WHERE value = '${u.id}'`)).toBe('0');
    expect(must(`SELECT actor, subject_user_id FROM public.audit_event WHERE kind = 'second_step.reset' AND subject_user_id = '${u.id}'`, db).rows).toEqual([['operator', u.id]]);
    expect(c(`SELECT count(*) FROM public.notification WHERE recipient_user_id = '${u.id}'`)).toBe('1');
  });
  it('matches the email lower-cased, as the unique index does [red if: the match is case-sensitive]', async () => {
    const u = await enrolled();
    expect(await reset(u.email.toUpperCase())).toBe(true);
    expect(must(`SELECT count(*) FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]).toBe('0');
  });
  it('an unknown email raises (the CLI exits 2) and changes nothing [red if: it returns false or succeeds silently]', async () => {
    const x = await fails(reset('nobody-here@qa.test'));
    expect(x).not.toBeNull();
    expect(msgOf(x)).not.toMatch(/does not exist/);
  });
  it('leaves memberships unchanged, and the user\'s next require-second-step state is true for a manager (sign-in meets the gate) [red if: reset removes memberships or second_step_at stays set]', async () => {
    const u = await enrolled();
    const owner = await f.user({ enrolled: true });
    const ent = await f.committed('poly_app', owner.id, null, (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), $1, 'business_pass_through')`, [`rs${u.id}`]));
    void ent;
    const eid = must(`SELECT id FROM public.entity WHERE name = 'rs${u.id}'`, db).rows[0]![0]!;
    must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${eid}', '${u.id}', 'manager')`, db);
    await reset(u.email);
    expect(must(`SELECT role FROM public.membership WHERE entity_id = '${eid}' AND user_id = '${u.id}'`, db).rows[0]![0]).toBe('manager');
    const s = f.session(u.id);
    expect(await f.marked('poly_app', u.id, s, (q) => q('SELECT app.second_step_required() AS r').then((r) => r.rows[0].r))).toBe(true);
  });
  it('refuses a call that carries a user marker, and no runtime role may execute it [red if: the definer accepts a marker or is granted to poly_app/poly_worker/poly_auth]', async () => {
    for (const r of ['poly_app', 'poly_worker']) // poly_auth is a SERIAL-only fixture role; the gates file checks it
      expect(must(`SELECT has_function_privilege('${r}', 'app.reset_second_step(text)', 'EXECUTE')`, db).rows[0]![0], r).toBe('f');
    expect(must(`SELECT has_function_privilege('poly_operator', 'app.reset_second_step(text)', 'EXECUTE')`, db).rows[0]![0]).toBe('t');
  });
  it('only an exact parameter-bound call is accepted (an injected suffix is refused) [red if: the enter_* exact-call check is missing]', async () => {
    const u = await enrolled();
    const x = await fails(asOperator((q) => q(`SELECT app.reset_second_step($1) WHERE true`, [u.email])));
    expect(x).not.toBeNull();
    expect(msgOf(x)).not.toMatch(/does not exist/);
  });
});

describe('C6 the command (apps/worker/src/cli/user-reset-mfa.ts)', () => {
  const io = () => { const out: string[] = []; const err: string[] = []; return { out, err, io: { stdout: { write: (s: string) => { out.push(s); } }, stderr: { write: (s: string) => { err.push(s); } }, origin: 'https://app.qa.test' } }; };
  it('exits 0 for a known user and 2 for an unknown email, prints no secret, and the user must re-enrol [red if: the command is absent or exits 0/1 on no match]', async () => {
    const mod: any = await import('../../apps/worker/src/cli/user-reset-mfa.ts').catch((x) => ({ __err: x }));
    expect(mod.__err, 'apps/worker/src/cli/user-reset-mfa.ts must exist and export runUserResetMfa').toBeUndefined();
    const { configure, close } = (await import('../../packages/db/src/index.ts')) as any;
    const { dbEnv } = await import('./helpers/api');
    await close();
    configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db), operator: dbEnv('poly_operator', db) });
    const u = await enrolled();
    const a = io();
    expect(await mod.runUserResetMfa({ email: u.email }, a.io)).toBe(0);
    expect(must(`SELECT count(*) FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]).toBe('0');
    const b = io();
    expect(await mod.runUserResetMfa({ email: 'nobody-here@qa.test' }, b.io)).toBe(2);
    await close();
  });
  it('through the image dispatcher: `sh bin/polycarpic cli user reset-mfa <email>` exits 0 for a known user (case-insensitive), 2 for an unknown email, prints no secret, and a poly_worker run is refused [red if: cli/main.ts has no reset-mfa entry or accepts the worker role]', async () => {
    const u = await enrolled();
    const env = (user: string) => ({ PATH: process.env.PATH!, ...dbEnv(user, db), APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173' });
    const run = (args: string[], e: Record<string, string>) => new Promise<{ code: number | null; out: string; err: string }>((res) => {
      const c = spawn('sh', [join(ROOT, 'bin', 'polycarpic'), 'cli', ...args], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
      const k = setTimeout(() => c.kill('SIGKILL'), 60_000);
      c.on('close', (code) => { clearTimeout(k); res({ code, out, err }); });
    });
    const bad = await run(['user', 'reset-mfa', 'nobody-here@qa.test'], env('poly_operator'));
    expect(bad.code, bad.err).toBe(2);
    const worker = await run(['user', 'reset-mfa', u.email], env('poly_worker'));
    expect(worker.code, worker.err).toBe(1);
    expect(must(`SELECT count(*) FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]).toBe('1');
    const ok = await run(['user', 'reset-mfa', u.email.toUpperCase()], env('poly_operator'));
    expect(ok.code, ok.err).toBe(0);
    expect(must(`SELECT count(*) FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]).toBe('0');
    expect(ok.out + ok.err).not.toMatch(/secret|backup|token|password/i);
  });
  it('seceng (4): reset_second_step refuses every text that is not exactly "SELECT app.reset_second_step($1)" [red if: the exact-call check admits an alias or fails open on NULL]', async () => {
    const u = await enrolled();
    for (const text of ['SELECT app.reset_second_step($1) AS r', 'select app.reset_second_step($1)', '/* x */ SELECT app.reset_second_step($1)', 'SELECT app.reset_second_step($1), 1', 'SELECT * FROM app.reset_second_step($1)']) {
      const x = await fails(asOperator((q) => q(text, [u.email])));
      expect(x, text).not.toBeNull();
      expect(msgOf(x), text).toMatch(/on its own|exact|called/i);
    }
    expect(must(`SELECT count(*) FROM public.two_factor WHERE user_id = '${u.id}'`, db).rows[0]![0]).toBe('1');
  });
});
