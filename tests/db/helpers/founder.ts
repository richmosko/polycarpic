// POLY-90 test seam (ruling §S): shared by founder.test.ts and owner-transition.test.ts. Raw pg connections, so a test can tell
// a refusal at the STATEMENT from one at COMMIT. Every write that a rule is meant to reach goes through the real login role.
import { expect } from 'vitest';
import { enterAs, pgmod, type Q } from './second-step';
import { server, url } from './pg';
import { must } from './sql';
import { seedInvitation, seedOwnerEntity, tokenHash, type Role } from './invitation';
import { withHandle } from './handle';

export const FOUNDER_MSG = 'the founding owner must hold owner';
export const OWN_PERSON_MSG = 'a user keeps owner on their own Person';
export const KEEP_MSG = 'an entity keeps at least one owner';
export const SET_ONCE_MSG = "an invitation's issued_via never changes";

export type Refusal = { code: string; message: string; constraint: string | undefined };
export const refusalOf = (x: any): Refusal => ({ code: x?.code, message: String(x?.message), constraint: x?.constraint });
/** The promise's refusal, or null when it succeeded. */
export const caught = async (p: Promise<unknown>): Promise<Refusal | null> => p.then(() => null, refusalOf);

// `super` with a `user` writes that user's identity marker: app.keep_an_owner counts through app.owner_count, which is null with no
// member in context, so a superuser with no marker cannot touch any owner row, and the rule under test is never reached.
export type As = { role: 'poly_app'; user: string } | { role: 'poly_auth'; user: string; session: string } | { role: 'super'; user?: string };
export type Conn = { q: Q; commit: () => Promise<Refusal | null>; end: () => Promise<void> };

/** An open transaction, entered as `as`. `end()` rolls back whatever was not committed. */
export async function open(db: string, as: As): Promise<Conn> {
  const connectionString = as.role === 'super' ? server().superUrl.replace(/\/[^/]*$/, `/${db}`) : url(as.role, db);
  const c = new pgmod.Client({ connectionString });
  await c.connect();
  const q: Q = (text, values) => c.query({ text, values, queryMode: 'extended' });
  await q('BEGIN');
  if (as.role !== 'super') await enterAs(q, db, as.role, as.user, as.role === 'poly_auth' ? as.session : null);
  else if (as.user) await q(`INSERT INTO app.tx_identity (xid, user_id, session_id, kind) VALUES (pg_current_xact_id(), $1, NULL, 'session')`, [as.user]);
  return {
    q,
    commit: () => caught(q('COMMIT')),
    end: async () => { await c.query('ROLLBACK').catch(() => {}); await c.end(); },
  };
}

/** Run `fn` in one transaction and commit; any refusal, at a statement or at COMMIT, throws. */
export async function committed<T>(db: string, as: As, fn: (q: Q) => Promise<T>): Promise<T> {
  const c = await open(db, as);
  try {
    const r = await fn(c.q);
    const x = await c.commit();
    if (x) throw new Error(`commit refused: ${x.code} ${x.message}`);
    return r;
  } finally { await c.end(); }
}

/** Where a transaction was refused: at a statement of `fn`, at COMMIT, or nowhere. A refused statement never reaches COMMIT. */
export async function stage(db: string, as: As, fn: (q: Q) => Promise<unknown>): Promise<{ at: 'statement' | 'commit' | 'none'; refusal: Refusal | null }> {
  const c = await open(db, as);
  try {
    const s = await caught(Promise.resolve(fn(c.q)));
    if (s) return { at: 'statement', refusal: s };
    const x = await c.commit();
    return x ? { at: 'commit', refusal: x } : { at: 'none', refusal: null };
  } finally { await c.end(); }
}

export const expectAt = (got: { at: string; refusal: Refusal | null }, at: 'statement' | 'commit', code: string, message: string) => {
  expect({ at: got.at, code: got.refusal?.code, message: got.refusal?.message }).toEqual({ at, code, message });
};

// ---------------------------------------------------------------------------- fixtures
let n = 0;
const tag = () => `${process.pid}-${++n}-${Math.random().toString(36).slice(2, 7)}`;

/** A user with no Person, enrolled in a second step (superuser fixture; with no marker, nothing is seated by it). */
export function newUser(db: string, o: { enrolled?: boolean } = {}): { id: string; email: string } {
  const email = `u-${tag()}@qa.test`;
  const id = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('U', '${email}', true) RETURNING id`, db).rows[0]![0]!;
  if (o.enrolled !== false) enrolAsSuper(db, id);
  return { id, email };
}
export const enrolAsSuper = (db: string, id: string): void => {
  must(`BEGIN; INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('s', 'b', '${id}', true); UPDATE public."user" SET two_factor_enabled = true WHERE id = '${id}'; COMMIT;`, db);
};

/** A Business created through poly_app by a fresh enrolled owner: the sole owner, and the founder. */
export function business(db: string): { owner: string; entity: string } {
  const r = seedOwnerEntity(db, tag());
  return { owner: r.ownerId, entity: r.entityId };
}
/** A Business created through poly_app by an existing enrolled user. */
export async function businessOf(db: string, user: string): Promise<string> {
  const name = `qa-b-${tag()}`;
  return committed(db, { role: 'poly_app', user }, async (q) => {
    await q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'business'), $1, 'business_c_corp')`, [name]);
    return (await q('SELECT id FROM public.entity WHERE name = $1', [name])).rows[0].id as string;
  });
}
/** The user's own Person, created through poly_app (the user must be enrolled to share it later). */
export async function personOf(db: string, user: string): Promise<string> {
  return committed(db, { role: 'poly_app', user }, async (q) => {
    await q(`INSERT INTO public.entity (type_id, name, tax_classification, self_user_id) VALUES ((SELECT id FROM public.entity_type WHERE system_key = 'person'), $1, 'individual', $2)`, [`P-${tag()}`, user]);
    return (await q('SELECT id FROM public.entity WHERE self_user_id = $1', [user])).rows[0].id as string;
  });
}
/** A non-owner seat as superuser (poly_app has no membership INSERT). Never an owner: owners arrive by raise() or enrolment. */
export const seat = (db: string, entity: string, user: string, role: 'viewer' | 'manager'): void => {
  must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${entity}', '${user}', '${role}')`, db);
};
export const RAISE = `UPDATE public.membership SET role = $3 WHERE entity_id = $1 AND user_id = $2`;
/** The sole owner's direct raise, through poly_app: the 1 -> 2 write of ruling R6. */
export const raise = (db: string, by: string, entity: string, user: string, role: Role = 'owner') =>
  committed(db, { role: 'poly_app', user: by }, async (q) => {
    const r = await q(RAISE, [entity, user, role]);
    expect(r.rowCount, 'the raise changed one row').toBe(1);
    return (await q('SELECT now()::text AS t')).rows[0].t as string;
  });
/** A Business of `founder` with a second owner `co`, made by the real raise. */
export async function twoOwners(db: string): Promise<{ founder: string; co: string; entity: string }> {
  const b = business(db);
  const co = newUser(db).id;
  seat(db, b.entity, co, 'viewer');
  await raise(db, b.owner, b.entity, co);
  return { founder: b.owner, co, entity: b.entity };
}

export const roleOf = (db: string, entity: string, user: string): string => must(`SELECT role FROM public.membership WHERE entity_id = '${entity}' AND user_id = '${user}'`, db).rows[0]?.[0] ?? '';
export const founderOf = (db: string, entity: string): string => must(`SELECT coalesce(founding_owner_user_id::text, '') FROM public.entity WHERE id = '${entity}'`, db).rows[0]![0]!;
export const owners = (db: string, entity: string): number => Number(must(`SELECT count(*) FROM public.membership WHERE entity_id = '${entity}' AND role = 'owner'`, db).rows[0]![0]);

// ---------------------------------------------------------------------------- invitations
export type Inv = { id: string; token: string; email: string };
/** A direct (issued_via = 'owner') invitation, inserted through poly_app by `by` (the sole owner), then shaped as superuser. */
export function invite(db: string, entity: string, by: string, o: { role?: Role; email?: string; expired?: boolean; claimedBy?: string } = {}): Inv {
  const email = o.email ?? `inv-${tag()}@qa.test`;
  const token = seedInvitation({ db, email, role: o.role ?? 'viewer', entityId: entity, as: by });
  const id = must(`SELECT id FROM public.invitation WHERE token_hash = decode('${tokenHash(token).toString('hex')}', 'hex')`, db).rows[0]![0]!;
  if (o.claimedBy) claimAsSuper(db, id, o.claimedBy);
  if (o.expired) must(`UPDATE public.invitation SET expires_at = now() - interval '1 minute' WHERE id = '${id}'`, db);
  return { id, token, email };
}
export const claimAsSuper = (db: string, invitation: string, user: string): void => {
  must(`UPDATE public.invitation SET claimed_user_id = '${user}', claimed_at = now() WHERE id = '${invitation}'`, db);
};
export type InvState = { revoked: string; accepted: string };
export const invState = (db: string, id: string): InvState => {
  const [revoked, accepted] = must(`SELECT coalesce(revoked_at::text, ''), coalesce(accepted_at::text, '') FROM public.invitation WHERE id = '${id}'`, db).rows[0]!;
  return { revoked: revoked!, accepted: accepted! };
};

// ---------------------------------------------------------------------------- enrolment, the real path
export type Enrolment = Conn & {
  /** The statement that fires two_factor_80_sync, and so app.seat_claimed_invitations(). */
  finish: () => Promise<unknown>;
  /** The backend pid, for pg_stat_activity. */
  pid: number;
};
/** A poly_auth transaction brought to the last statement of a first TOTP enrolment. Nothing is seated until finish(). */
export async function enrolment(db: string, user: string): Promise<Enrolment> {
  const session = must(withHandle(`INSERT INTO public.session (user_id, token, expires_at) VALUES ('${user}', 'tk-${tag()}', now() + interval '1 day') RETURNING id`), db).rows[0]![0]!;
  const c = await open(db, { role: 'poly_auth', user, session });
  try {
    // the second-step definers accept only their exact call text: no alias, nothing else in the statement
    const code = (await c.q('SELECT app.issue_email_challenge($1)', ['first_enrolment'])).rows[0].issue_email_challenge;
    expect((await c.q('SELECT app.confirm_email_challenge($1)', [code])).rows[0].confirm_email_challenge).toBe(true);
    await c.q(`INSERT INTO public.two_factor (secret, backup_codes, user_id, verified) VALUES ('sec', 'bk', $1, false)`, [user]);
    await c.q('SELECT app.set_two_factor_enabled($1)', [true]);
    const pid = (await c.q('SELECT pg_backend_pid() AS p')).rows[0].p as number;
    return { ...c, pid, finish: () => c.q('UPDATE public.two_factor SET verified = true WHERE user_id = $1', [user]) };
  } catch (e) { await c.end(); throw e; }
}
/** Enrol and commit: every claimed manager and owner invitation of the user is seated or skipped in this transaction. */
export async function enrol(db: string, user: string): Promise<void> {
  const e = await enrolment(db, user);
  try {
    await e.finish();
    const x = await e.commit();
    if (x) throw new Error(`enrolment commit refused: ${x.code} ${x.message}`);
  } finally { await e.end(); }
}
export const enrolled = (db: string, user: string): boolean => must(`SELECT (second_step_at IS NOT NULL AND two_factor_enabled)::text FROM public."user" WHERE id = '${user}'`, db).rows[0]![0] === 'true';

/** Resolves once every pid is waiting on a lock (so a race is really a race); throws after `ms`. */
export async function waitingOnLock(db: string, pids: number[], ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    const k = Number(must(`SELECT count(*) FROM pg_stat_activity WHERE pid IN (${pids.join(',')}) AND wait_event_type = 'Lock'`, db).rows[0]![0]);
    if (k === pids.length) return;
    if (Date.now() > deadline) throw new Error(`only ${k} of ${pids.length} backends are waiting on a lock`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
