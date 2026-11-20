// POLY-150 (seceng, review record 93c67eaa): the last-method guard on BOTH method tables, with the guard's OWN code and message. Since POLY-89 every passkey delete
// failed with 42703 and tests that only checked "it fails" passed it as the right failure. Each refusal here asserts SQLSTATE and message, reads the row back
// unchanged, and every refusal has a positive case beside it. Real Postgres; SQL as poly_auth under a session marker (the route-free floor).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, teardown, type Env } from './helpers/auth';
import { sessionWithHandle } from './helpers/handle';
import { codeOf, fails, fixture, msgOf } from './helpers/second-step';
import { must } from './helpers/sql';
import { softAuthenticator } from './helpers/webauthn';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let fx: ReturnType<typeof fixture>;
let seq = 0;
beforeAll(async () => { e = await boot(); fx = fixture(e.db, 153); });
afterAll(() => teardown(e));

const LAST = '42501|second_step_required';
const STALE = '42501|step_up_required';
const ONLY_OWN = '42501|a second step is removed by its own user';
const sig = (x: any) => `${codeOf(x)}|${msgOf(x)}`;
const count = (sql: string) => e.count(sql);

/** A user with the methods given, second_step_at set by the database's own sync triggers; `manager` seats them on a shared entity (so a method is needed). */
async function user(o: { totp?: boolean; passkeys?: number; manager?: boolean }) {
  const u = await fx.user({ enrolled: !!o.totp });
  const ids: string[] = [];
  for (let i = 0; i < (o.passkeys ?? 0); i++) {
    const k = softAuthenticator();
    ids.push(must(`INSERT INTO public.passkey (public_key, user_id, credential_id, counter, device_type, backed_up, transports) VALUES ('${k.publicKey}', '${u.id}', 'lm-${++seq}-${k.credentialId}', 0, 'singleDevice', false, 'internal') RETURNING id`, e.db).rows[0]![0]!);
  }
  if (o.manager) {
    const owner = await fx.user({ enrolled: true });
    await fx.committed('poly_app', owner.id, null, (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), $1, 'business_pass_through')`, [`LM-${++seq}-${owner.id}`]));
    const ent = must(`SELECT id FROM public.entity WHERE name = 'LM-${seq}-${owner.id}'`, e.db).rows[0]![0]!;
    must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${ent}', '${u.id}', 'manager')`, e.db);
  }
  return { ...u, passkeyIds: ids };
}
const session = (uid: string, fresh: boolean) => sessionWithHandle(e.db, uid, fresh ? { fresh: true } : {}).id;
const del = (uid: string, sid: string, sql: string, values: unknown[]) => fails(fx.committed('poly_auth', uid, sid, (q) => q(sql, values)));
const refused = async (uid: string, sid: string, sql: string, values: unknown[], snap: string) => {
  const before = count(snap);
  const x = await del(uid, sid, sql, values);
  expect(x, 'the statement must be refused').not.toBeNull();
  expect(count(snap), 'and change nothing').toBe(before);
  return sig(x);
};

describe('the last method is refused with the guard\'s own code, on each table', () => {
  it('a manager\'s only verified TOTP: 42501 second_step_required, with a fresh step-up [red if: the guard is absent, or fails for another reason]', async () => {
    const u = await user({ totp: true, manager: true });
    const s = session(u.id, true);
    expect(await refused(u.id, s, 'DELETE FROM public.two_factor WHERE user_id = $1', [u.id], `SELECT 1 FROM public.two_factor WHERE user_id = '${u.id}'`)).toBe(LAST);
  });
  it('a manager\'s only passkey (no TOTP): the same refusal on the passkey table [red if: the passkey table\'s delete guard is broken (42703) or absent]', async () => {
    const u = await user({ passkeys: 1, manager: true });
    const s = session(u.id, true);
    expect(await refused(u.id, s, 'DELETE FROM public.passkey WHERE id = $1', [u.passkeyIds[0]], `SELECT 1 FROM public.passkey WHERE user_id = '${u.id}'`)).toBe(LAST);
  });
  it('without a fresh step-up the refusal is step_up_required, on both tables [red if: a stale session can remove a method]', async () => {
    const u = await user({ totp: true, passkeys: 1, manager: true });
    const s = session(u.id, false);
    expect(await refused(u.id, s, 'DELETE FROM public.passkey WHERE id = $1', [u.passkeyIds[0]], `SELECT 1 FROM public.passkey WHERE user_id = '${u.id}'`)).toBe(STALE);
    expect(await refused(u.id, s, 'DELETE FROM public.two_factor WHERE user_id = $1', [u.id], `SELECT 1 FROM public.two_factor WHERE user_id = '${u.id}'`)).toBe(STALE);
  });
  it('another user\'s passkey cannot be deleted: 42501 "removed by its own user" [red if: the ownership floor is missing]', async () => {
    const victim = await user({ totp: true, passkeys: 1 });
    const attacker = await user({ totp: true });
    const s = session(attacker.id, true);
    expect(await refused(attacker.id, s, 'DELETE FROM public.passkey WHERE id = $1', [victim.passkeyIds[0]], `SELECT 1 FROM public.passkey WHERE user_id = '${victim.id}'`)).toBe(ONLY_OWN);
  });
});

describe('and the positive cases: a method that is not the last is removed after a fresh step-up', () => {
  it('a viewer deletes their own passkey (TOTP remains); the row is gone and the user is still enrolled [red if: every passkey delete fails, as it did from POLY-89]', async () => {
    const u = await user({ totp: true, passkeys: 1 });
    const s = session(u.id, true);
    expect(await del(u.id, s, 'DELETE FROM public.passkey WHERE id = $1', [u.passkeyIds[0]])).toBeNull();
    expect(count(`SELECT 1 FROM public.passkey WHERE user_id = '${u.id}'`)).toBe(0);
    expect(must(`SELECT second_step_at IS NOT NULL FROM public."user" WHERE id = '${u.id}'`, e.db).rows[0]![0]).toBe('t');
  });
  it('a manager deletes one of two methods (the passkey), then the TOTP that remains is the last and is refused (removing a TOTP with a passkey left is the /two-factor/disable route, covered in method-audit.test.ts) [red if: the last method can go, or the first removal fails]', async () => {
    const a = await user({ totp: true, passkeys: 1, manager: true });
    const sa = session(a.id, true);
    expect(await del(a.id, sa, 'DELETE FROM public.passkey WHERE id = $1', [a.passkeyIds[0]])).toBeNull();
    expect(await refused(a.id, sa, 'DELETE FROM public.two_factor WHERE user_id = $1', [a.id], `SELECT 1 FROM public.two_factor WHERE user_id = '${a.id}'`)).toBe(LAST);
  });
  it('an unverified two_factor row is not a method: it can be deleted with no step-up and nothing is refused [red if: an unverified row is guarded like a method]', async () => {
    const u = await fx.user({});
    must(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${u.id}', false)`, e.db);
    const s = session(u.id, false);
    const x = await del(u.id, s, 'DELETE FROM public.two_factor WHERE user_id = $1', [u.id]);
    expect(x === null ? 'deleted' : sig(x), 'an unverified row, deleted by its own user').toBe('deleted');
  });
});
