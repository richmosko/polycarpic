// POLY-90 (ruling R5-R7 and addenda; seceng conditions I-3, V-1 to V-7): the revocation of direct invitations when an entity gets
// its second owner, the lock order of the seating path, and revoked invitations at every acceptance step. A second owner is made
// only by the real raise or the real enrolment, except in T-R6e, whose subject is the superuser write. Titles end [red if: <mutation>].
import { beforeAll, describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, freshDb, migrateCli } from './helpers/api';
import { signUpEntry, tx } from './helpers/auth-tx';
import {
  RAISE, business, businessOf, caught, committed, enrol, enrolled, enrolment, invState, invite, newUser, open, owners, raise,
  pidOf, roleOf, seat, waitingOnLock, type Conn, type Inv, type Refusal,
} from './helpers/founder';
import { tokenHash } from './helpers/invitation';
import { must } from './helpers/sql';
import { psql } from './helpers/pg';

let db: string;
beforeAll(async () => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, r.err + r.out).toBe(0);
});

const app = (user: string) => ({ role: 'poly_app', user }) as const;
const REVOKE = 'UPDATE public.invitation SET revoked_at = now() WHERE id = $1';
const revokedAt = (id: string, t: string) => must(`SELECT (revoked_at = '${t}'::timestamptz)::text FROM public.invitation WHERE id = '${id}'`, db).rows[0]![0];
const audits = (ids: string[]) => must(`SELECT payload->>'invitation_id', coalesce(entity_id::text, ''), actor, coalesce(actor_user_id::text, ''), payload::text
  FROM public.audit_event WHERE kind = 'invitation.revoked' AND payload->>'invitation_id' IN (${ids.map((i) => `'${i}'`).join(',')})`, db).rows;
const notices = (ids: string[]) => must(`SELECT payload->>'invitation_id', recipient_user_id, payload::text FROM public.notification
  WHERE kind = 'invitation.revoked' AND payload->>'invitation_id' IN (${ids.map((i) => `'${i}'`).join(',')})`, db).rows;
const untouched = (i: Inv) => expect(invState(db, i.id).revoked, i.email).toBe('');

/** Each revoked invitation has exactly one audit event and one notification to its inviter, with exactly the ruled payloads. */
function expectRecords(revoked: Inv[], entity: string, actor: { actor: string; user: string }, inviter: string) {
  const ids = revoked.map((i) => i.id);
  const a = audits(ids);
  expect(a.map((r) => r[0]).sort(), 'one audit event per revoked row').toEqual([...ids].sort());
  for (const [id, ent, kind, user, payload] of a) {
    expect([ent, kind, user]).toEqual([entity, actor.actor, actor.user]);
    expect(JSON.parse(payload!)).toEqual({ invitation_id: id, reason: 'owner_transition' });
  }
  const n = notices(ids);
  expect(n.map((r) => r[0]).sort(), 'one notification per revoked row').toEqual([...ids].sort());
  for (const [id, recipient, payload] of n) {
    expect(recipient).toBe(inviter);
    expect(JSON.parse(payload!), 'no role and no email in the payload').toEqual({ invitation_id: id, entity_id: entity, reason: 'owner_transition' });
  }
}

/** A sole-owner Business with an enrolled viewer who can be raised. */
function soleWithViewer() {
  const b = business(db);
  const v = newUser(db).id;
  seat(db, b.entity, v, 'viewer');
  return { ...b, viewer: v };
}

describe('R6 the 1 -> 2 revocation, the raise path', () => {
  it('T-R6a: the sole owner raising a member to owner revokes every outstanding direct invitation of that entity in the same transaction, and nothing else  [red if: the trigger is dropped, filters on claimed_at IS NULL or on expires_at, or the revocation runs later]', async () => {
    const b = soleWithViewer();
    const claimant = () => newUser(db, { enrolled: false });
    const [ci, cm, co, cx] = [claimant(), claimant(), claimant(), claimant()];
    const outstanding = [
      invite(db, b.entity, b.owner, { role: 'viewer' }),
      invite(db, b.entity, b.owner, { role: 'viewer', claimedBy: ci.id }),
      invite(db, b.entity, b.owner, { role: 'manager', claimedBy: cm.id }),
      invite(db, b.entity, b.owner, { role: 'owner' }),
      invite(db, b.entity, b.owner, { role: 'owner', claimedBy: co.id }),
      invite(db, b.entity, b.owner, { role: 'viewer', expired: true }),
      invite(db, b.entity, b.owner, { role: 'owner', expired: true, claimedBy: cx.id }),
    ];
    const other = await businessOf(db, b.owner);
    const elsewhere = invite(db, other, b.owner, { role: 'owner' });
    const accepted = invite(db, b.entity, b.owner, { claimedBy: claimant().id });
    must(`UPDATE public.invitation SET accepted_at = now() WHERE id = '${accepted.id}'`, db);
    const earlier = invite(db, b.entity, b.owner);
    must(`UPDATE public.invitation SET revoked_at = now() - interval '1 day' WHERE id = '${earlier.id}'`, db);
    const before = invState(db, earlier.id).revoked;
    const operator = must(`INSERT INTO public.invitation (email, role, token_hash, expires_at, issued_via)
      VALUES ('op-r6a@qa.test', 'viewer', sha256('op-r6a'::bytea), now() + interval '1 day', 'operator') RETURNING id`, db).rows[0]![0]!;
    for (const i of outstanding) untouched(i);

    const c = await open(db, app(b.owner));
    let t: string;
    try {
      expect((await c.q(RAISE, [b.entity, b.viewer, 'owner'])).rowCount).toBe(1);
      t = (await c.q('SELECT now()::text AS t')).rows[0].t;
      const inside = await c.q('SELECT count(*)::int AS n FROM public.invitation WHERE entity_id = $1 AND revoked_at = now()', [b.entity]);
      expect(inside.rows[0].n, 'revoked inside the raising transaction').toBe(outstanding.length);
      expect(await c.commit()).toBeNull();
    } finally { await c.end(); }

    for (const i of outstanding) expect(revokedAt(i.id, t!), i.email).toBe('true');
    expectRecords(outstanding, b.entity, { actor: 'user', user: b.owner }, b.owner);
    // seceng P2: the revocation's actor is computed as audit_membership computes it (0017's expression, not 0014's): the rows equal the
    // membership.role_changed row of the same transaction. [red if: a stale copy labels a session-marked request 'session']
    const role = must(`SELECT actor, actor_user_id::text FROM public.audit_event WHERE entity_id = '${b.entity}' AND kind = 'membership.role_changed' AND created_at = '${t!}'::timestamptz`, db).rows;
    expect(role, 'the raise wrote one role_changed row').toHaveLength(1);
    const revocations = must(`SELECT DISTINCT actor, actor_user_id::text FROM public.audit_event WHERE entity_id = '${b.entity}' AND kind = 'invitation.revoked' AND created_at = '${t!}'::timestamptz`, db).rows;
    expect(revocations).toEqual(role);
    untouched(elsewhere);
    expect(invState(db, accepted.id).revoked).toBe('');
    expect(invState(db, earlier.id).revoked).toBe(before);
    expect(invState(db, operator).revoked).toBe('');
    expect(audits([elsewhere.id, accepted.id, earlier.id, operator])).toEqual([]);

    // none of the revoked claims seats afterwards, the expired owner claim included (V-1, V-5)
    for (const who of [co, cm, cx]) {
      await enrol(db, who.id);
      expect([enrolled(db, who.id), roleOf(db, b.entity, who.id)]).toEqual([true, '']);
    }
    expect(owners(db, b.entity)).toBe(2);
  });

  it('T-R6a: a raising transaction that rolls back revokes nothing and records nothing  [red if: the revocation is not in the membership write\'s transaction]', async () => {
    const b = soleWithViewer();
    const i = invite(db, b.entity, b.owner, { role: 'owner' });
    const c = await open(db, app(b.owner));
    try { expect((await c.q(RAISE, [b.entity, b.viewer, 'owner'])).rowCount).toBe(1); } finally { await c.end(); }
    untouched(i);
    expect([audits([i.id]), notices([i.id])]).toEqual([[], []]);
  });

  it('T-R6a positive: a raise to manager, and a viewer seat, revoke nothing  [red if: the revocation fires on any membership write, with neither NEW.role nor the owner count tested]', async () => {
    const b = business(db);
    const i = invite(db, b.entity, b.owner, { role: 'owner' });
    const v = newUser(db).id;
    seat(db, b.entity, v, 'viewer');
    await raise(db, b.owner, b.entity, v, 'manager');
    untouched(i);
    expect(audits([i.id])).toEqual([]);
  });

  it('T-R6c: back to one owner and up again: a direct invitation issued in between is revoked at the next 1 -> 2  [red if: the revocation runs once per entity]', async () => {
    const b = soleWithViewer();
    await raise(db, b.owner, b.entity, b.viewer);
    await committed(db, app(b.viewer), async (q) => expect((await q('DELETE FROM public.membership WHERE entity_id = $1 AND user_id = $2', [b.entity, b.viewer])).rowCount).toBe(1));
    expect(owners(db, b.entity)).toBe(1);
    const i = invite(db, b.entity, b.owner, { role: 'viewer' }); // the gate is open again
    const w = newUser(db).id;
    seat(db, b.entity, w, 'viewer');
    untouched(i);
    const t = await raise(db, b.owner, b.entity, w);
    expect(revokedAt(i.id, t)).toBe('true');
    expectRecords([i], b.entity, { actor: 'user', user: b.owner }, b.owner);
  });

  it('T-R6e: a superuser with no user in context seating two owners in one INSERT revokes the direct invitation  [red if: R6 exempts a superuser, counts with app.owner_count (null skips), or tests n = 2]', async () => {
    const b = business(db);
    const i = invite(db, b.entity, b.owner, { role: 'owner' });
    const [x, y] = [newUser(db).id, newUser(db).id];
    must(`INSERT INTO public.membership (entity_id, user_id, role) VALUES ('${b.entity}', '${x}', 'owner'), ('${b.entity}', '${y}', 'owner')`, db);
    expect(owners(db, b.entity)).toBe(3);
    expect(invState(db, i.id).revoked).not.toBe('');
    expectRecords([i], b.entity, { actor: 'none', user: '' }, b.owner);
  });

  it('T-R6 lock: while one owner-making write is uncommitted, another on the same entity waits  [red if: owner_transition drops FOR UPDATE on the entity row]', async () => {
    const b = business(db); // no invitation outstanding: the entity row is the only thing the two writes share
    const [x, y] = [newUser(db).id, newUser(db).id];
    const one = await open(db, { role: 'super' });
    const two = await open(db, { role: 'super' });
    try {
      const pid = (await two.q('SELECT pg_backend_pid() AS p')).rows[0].p as number;
      const SEAT = `INSERT INTO public.membership (entity_id, user_id, role) VALUES ($1, $2, 'owner')`;
      await one.q(SEAT, [b.entity, x]);
      const second = caught(two.q(SEAT, [b.entity, y]));
      await waitingOnLock(db, [pid]);
      expect(await one.commit()).toBeNull();
      expect(await second).toBeNull();
      expect(await two.commit()).toBeNull();
    } finally { await one.end(); await two.end(); }
    expect(owners(db, b.entity)).toBe(3);
  });
});

describe('the last-owner guard\'s own lock (ruling §V8)', () => {
  // For poly_app the gate locks the entity first, so keep_an_owner's lock cannot be told from it. A superuser is exempt from the gate,
  // and removes owners here through keep_an_owner's lock alone (it carries a marker so the guard can count).
  it('while a gate-exempt owner removal is uncommitted, another on the same entity waits and is then refused by keep_an_owner  [red if: keep_an_owner drops FOR UPDATE on the entity row]', async () => {
    const b = soleWithViewer();
    await raise(db, b.owner, b.entity, b.viewer); // owners: the founder and one other
    const LOWER = `UPDATE public.membership SET role = 'viewer' WHERE entity_id = $1 AND user_id = $2`;
    const one = await open(db, { role: 'super', user: b.owner });
    const two = await open(db, { role: 'super', user: b.owner });
    try {
      expect((await one.q(LOWER, [b.entity, b.viewer])).rowCount).toBe(1);
      const pid = await pidOf(two);
      const second = caught(two.q(LOWER, [b.entity, b.owner]));
      await waitingOnLock(db, [pid]);
      expect(await one.commit()).toBeNull();
      const x = await second;
      expect([x?.code, x?.message]).toEqual(['23514', 'an entity keeps at least one owner']);
    } finally { await one.end(); await two.end(); }
    expect(owners(db, b.entity)).toBe(1);
  });
});

/** A sole-owner Business with two claimed direct owner invitations, X to I and Y to J, I and J not yet enrolled. */
function twoOwnerClaims() {
  const b = business(db);
  const i = newUser(db, { enrolled: false });
  const j = newUser(db, { enrolled: false });
  const x = invite(db, b.entity, b.owner, { role: 'owner', email: i.email, claimedBy: i.id });
  const y = invite(db, b.entity, b.owner, { role: 'owner', email: j.email, claimedBy: j.id });
  return { ...b, i: i.id, j: j.id, x, y };
}
/** Exactly two owners; the winner's row accepted and not revoked; the loser enrolled, unseated, its row revoked and not accepted. */
function expectOneSeat(s: ReturnType<typeof twoOwnerClaims>) {
  expect(owners(db, s.entity)).toBe(2);
  const iWon = roleOf(db, s.entity, s.i) === 'owner';
  const [won, lost] = iWon ? [{ u: s.i, inv: s.x }, { u: s.j, inv: s.y }] : [{ u: s.j, inv: s.y }, { u: s.i, inv: s.x }];
  expect(roleOf(db, s.entity, won.u)).toBe('owner');
  expect(roleOf(db, s.entity, lost.u)).toBe('');
  const [w, l] = [invState(db, won.inv.id), invState(db, lost.inv.id)];
  expect({ accepted: w.accepted !== '', revoked: w.revoked !== '' }, 'the seated row').toEqual({ accepted: true, revoked: false });
  expect({ accepted: l.accepted !== '', revoked: l.revoked !== '' }, 'the other row').toEqual({ accepted: false, revoked: true });
  expect([enrolled(db, s.i), enrolled(db, s.j)], 'both enrolments committed').toEqual([true, true]);
  expectRecords([lost.inv], s.entity, { actor: 'user', user: won.u }, s.owner);
}

describe('R6 and R7, the seating path', () => {
  it('T-R6b: an owner invitation seating at enrolment revokes the others, and its own row is accepted, not revoked  [red if: the trigger is dropped, or accepted_at is set after the membership INSERT (R7 step 3 swapped)]', async () => {
    const s = twoOwnerClaims();
    const unclaimed = invite(db, s.entity, s.owner, { role: 'viewer' });
    await enrol(db, s.i);
    expect(roleOf(db, s.entity, s.i)).toBe('owner');
    const own = invState(db, s.x.id);
    expect({ accepted: own.accepted !== '', revoked: own.revoked }).toEqual({ accepted: true, revoked: '' });
    expect(invState(db, s.y.id).revoked).not.toBe('');
    expect(invState(db, unclaimed.id).revoked).not.toBe('');
    expectRecords([s.y, unclaimed], s.entity, { actor: 'user', user: s.i }, s.owner);
    await enrol(db, s.j);
    expect([enrolled(db, s.j), roleOf(db, s.entity, s.j), invState(db, s.y.id).accepted]).toEqual([true, '', '']);
    expect(owners(db, s.entity)).toBe(2);
  });

  it('T-R7a: two invitees enrol on two connections, the second while the first holds its seat: both commit, two owners, the loser revoked  [red if: the revocation uses SKIP LOCKED, or the seat loop does not re-read after waiting]', async () => {
    const s = twoOwnerClaims();
    const a = await enrolment(db, s.i);
    const c = await enrolment(db, s.j);
    try {
      expect(await caught(a.finish())).toBeNull();
      const second = caught(c.finish());
      await waitingOnLock(db, [c.pid]);
      expect(await a.commit()).toBeNull();
      expect(await second, 'no 40P01 and no 40001 on the second enrolment').toBeNull();
      expect(await c.commit()).toBeNull();
    } finally { await a.end(); await c.end(); }
    expect(roleOf(db, s.entity, s.i)).toBe('owner');
    expectOneSeat(s);
  });

  for (let round = 1; round <= 3; round++) {
    it(`T-R7a: two enrolments released at the same moment, round ${round}: neither deadlocks, exactly two owners  [red if: seat_claimed_invitations does not lock its entities first (R7 step 1 dropped)]`, async () => {
      const s = twoOwnerClaims();
      const a = await enrolment(db, s.i);
      const c = await enrolment(db, s.j);
      const holder = await open(db, { role: 'super' });
      const run = async (e: typeof a): Promise<Refusal | null> => (await caught(e.finish())) ?? (await e.commit());
      try {
        await holder.q('SELECT 1 FROM public.entity WHERE id = $1 FOR UPDATE', [s.entity]);
        const both = [run(a), run(c)];
        await waitingOnLock(db, [a.pid, c.pid]);
        await holder.end();
        expect(await Promise.all(both), 'both transactions commit').toEqual([null, null]);
      } finally { await a.end(); await c.end(); await holder.end().catch(() => {}); }
      expectOneSeat(s);
    });
  }

  it('R7a step 3: a user holding two claimed owner invitations on one entity is seated by one; the other stays revoked and is never accepted  [red if: the accepted_at UPDATE drops revoked_at IS NULL (the loop already fetched the row its own seat revoked)]', async () => {
    const b = business(db);
    const u = newUser(db, { enrolled: false });
    const both = [1, 2].map(() => invite(db, b.entity, b.owner, { role: 'owner', email: u.email, claimedBy: u.id }));
    await enrol(db, u.id);
    expect([enrolled(db, u.id), roleOf(db, b.entity, u.id), owners(db, b.entity)]).toEqual([true, 'owner', 2]);
    const states = both.map((i) => { const s = invState(db, i.id); return `accepted=${s.accepted !== ''} revoked=${s.revoked !== ''}`; }).sort();
    expect(states).toEqual(['accepted=false revoked=true', 'accepted=true revoked=false']);
  });

  it('a manager invitation seating at enrolment on a sole-owner entity revokes nothing  [red if: the revocation fires on any membership write, with neither NEW.role nor the owner count tested]', async () => {
    const b = business(db);
    const u = newUser(db, { enrolled: false });
    invite(db, b.entity, b.owner, { role: 'manager', email: u.email, claimedBy: u.id });
    const other = invite(db, b.entity, b.owner, { role: 'owner' });
    await enrol(db, u.id);
    expect(roleOf(db, b.entity, u.id)).toBe('manager');
    untouched(other);
  });
});

// ---------------------------------------------------------------------------- R7b: sign-up takes the entity before the invitation
let signups = 0;
const newSignupId = () => `00000000-0000-4000-8000-${String(907_000 + ++signups).padStart(12, '0')}`;
const CLAIM = 'SELECT app.claim_invitations($1::bytea, $2)';
const ACCEPT = 'SELECT app.accept_invitations($1::bytea)';
/** No lock on this invitation row is held by anyone: a third session takes it without waiting. */
const invitationFree = (id: string) => {
  const r = psql(`BEGIN; SELECT 1 FROM public.invitation WHERE id = '${id}' FOR UPDATE NOWAIT; ROLLBACK;`, db);
  return r.ok ? 'free' : r.sqlstate;
};

describe('R7 one lock order: a definer waiting for the entity row holds no invitation row', () => {
  /** Another session holds the entity; `start` must block on it with the invitation row still free, then succeed once released. */
  async function probe(entity: string, invitation: string, waiter: number, start: () => Promise<unknown>): Promise<void> {
    const holder = await open(db, { role: 'super' });
    let running: Promise<Refusal | null>;
    try {
      await holder.q('SELECT 1 FROM public.entity WHERE id = $1 FOR UPDATE', [entity]);
      running = caught(start());
      await waitingOnLock(db, [waiter]);
      expect(invitationFree(invitation), 'the waiting definer has locked no invitation row').toBe('free');
    } finally { await holder.end(); }
    expect(await running!).toBeNull();
  }

  for (const fn of ['claim_invitations', 'accept_invitations'] as const) {
    it(`R7b: ${fn} locks the entity before the invitation  [red if: its first statement does not lock the named entities FOR KEY SHARE (R7b step 1 dropped)]`, async () => {
      const b = business(db);
      const i = invite(db, b.entity, b.owner);
      const s = await open(db, { role: 'signup' });
      try {
        const id = newSignupId();
        const hash = tokenHash(i.token);
        if (fn === 'accept_invitations') await signUpEntry(s.q, id, i.email);
        await probe(b.entity, i.id, await pidOf(s), () => (fn === 'claim_invitations' ? s.q(CLAIM, [hash, i.email]) : s.q(ACCEPT, [hash])));
        if (fn === 'claim_invitations') { await signUpEntry(s.q, id, i.email); await s.q(ACCEPT, [hash]); }
        expect(await s.commit()).toBeNull();
        expect(roleOf(db, b.entity, id)).toBe('viewer');
      } finally { await s.end(); }
    });
  }

  it('R7a: seat_claimed_invitations locks the entity before the invitation  [red if: R7a step 1 is dropped]', async () => {
    const b = business(db);
    const u = newUser(db, { enrolled: false });
    const i = invite(db, b.entity, b.owner, { role: 'owner', email: u.email, claimedBy: u.id });
    const e = await enrolment(db, u.id);
    try {
      await probe(b.entity, i.id, e.pid, () => e.finish());
      expect(await e.commit()).toBeNull();
    } finally { await e.end(); }
    expect(roleOf(db, b.entity, u.id)).toBe('owner');
  });

  it('T-R7b positive: two sign-ups on one entity do not queue on each other  [red if: R7b locks the entity FOR UPDATE]', async () => {
    const b = business(db);
    const [i, j] = [invite(db, b.entity, b.owner), invite(db, b.entity, b.owner)];
    const [a, c] = [await open(db, { role: 'signup' }), await open(db, { role: 'signup' })];
    try {
      await a.q(CLAIM, [tokenHash(i.token), i.email]);
      await c.q("SET LOCAL lock_timeout = '1s'");
      const second = await caught((async () => {
        await c.q(CLAIM, [tokenHash(j.token), j.email]);
        await signUpEntry(c.q, newSignupId(), j.email);
        await c.q(ACCEPT, [tokenHash(j.token)]);
      })());
      expect(second).toBeNull();
      expect(await c.commit()).toBeNull();
    } finally { await a.end(); await c.end(); }
  });
});

describe('T-R7b a viewer sign-up against the sole owner\'s raise on the same entity', () => {
  it('T-R7b (i): the sign-up holds after its claim, the raise waits: both commit, the viewer is seated, no 40P01  [red if: R7b step 1 is dropped (the raise and the sign-up deadlock)]', async () => {
    const b = soleWithViewer();
    const mine = invite(db, b.entity, b.owner);
    const open2 = invite(db, b.entity, b.owner, { role: 'owner' });
    const id = newSignupId();
    const signup = await open(db, { role: 'signup' });
    const raising = await open(db, app(b.owner));
    try {
      await signup.q(CLAIM, [tokenHash(mine.token), mine.email]);
      const pid = await pidOf(raising);
      const raised = (async () => (await caught(raising.q(RAISE, [b.entity, b.viewer, 'owner']))) ?? (await raising.commit()))();
      await waitingOnLock(db, [pid]);
      const signed = (await caught((async () => { await signUpEntry(signup.q, id, mine.email); await signup.q(ACCEPT, [tokenHash(mine.token)]); })())) ?? (await signup.commit());
      expect(signed, 'the sign-up: no 40P01, no refusal').toBeNull();
      expect(await raised, 'the raise: no 40P01, no refusal').toBeNull();
    } finally { await signup.end(); await raising.end(); }
    expect([roleOf(db, b.entity, id), roleOf(db, b.entity, b.viewer)]).toEqual(['viewer', 'owner']);
    const s = invState(db, mine.id);
    expect({ accepted: s.accepted !== '', revoked: s.revoked !== '' }).toEqual({ accepted: true, revoked: false });
    expect(invState(db, open2.id).revoked).not.toBe('');
  });

  it('T-R7b (ii): the raise holds, the sign-up waits at its claim and is refused invitation_required once the raise commits, no 40P01  [red if: the claim reads revoked_at before it waits]', async () => {
    const b = soleWithViewer();
    const mine = invite(db, b.entity, b.owner);
    const signup = await open(db, { role: 'signup' });
    const raising = await open(db, app(b.owner));
    try {
      expect((await raising.q(RAISE, [b.entity, b.viewer, 'owner'])).rowCount).toBe(1);
      const pid = await pidOf(signup);
      const claim = caught(signup.q(CLAIM, [tokenHash(mine.token), mine.email]));
      await waitingOnLock(db, [pid]);
      expect(await raising.commit()).toBeNull();
      const x = await claim;
      expect([x?.code, x?.message]).toEqual(['42501', 'invitation_required']);
    } finally { await signup.end(); await raising.end(); }
    expect(roleOf(db, b.entity, b.viewer)).toBe('owner');
    const s = invState(db, mine.id);
    expect({ accepted: s.accepted !== '', revoked: s.revoked !== '' }).toEqual({ accepted: false, revoked: true });
  });
});

describe('R5 a revoked invitation is refused at every acceptance step', () => {
  let n = 0;
  /** A new user's sign-up as poly_auth, committed; `claim: false` goes straight to accept_invitations. */
  const signUp = (email: string, token: string, claim = true) => {
    const id = `00000000-0000-4000-8000-${String(905_000 + ++n).padStart(12, '0')}`;
    return {
      id,
      done: caught(tx(db, 'poly_auth', async (q) => {
        if (claim) await q('SELECT app.claim_invitations($1::bytea, $2)', [tokenHash(token), email]);
        await signUpEntry(q, id, email);
        await q('SELECT app.accept_invitations($1::bytea)', [tokenHash(token)]);
      }, true)),
    };
  };
  const exists = (id: string) => must(`SELECT count(*) FROM public."user" WHERE id = '${id}'`, db).rows[0]![0];

  for (const claim of [true, false]) {
    it(`T-R5b: sign-up with a revoked invitation's token is refused by ${claim ? 'claim_invitations' : 'accept_invitations'}; the unrevoked twin seats  [red if: ${claim ? 'claim' : 'accept'}_invitations drops revoked_at IS NULL]`, async () => {
      const b = business(db);
      const dead = invite(db, b.entity, b.owner);
      await committed(db, app(b.owner), async (q) => expect((await q(REVOKE, [dead.id])).rowCount).toBe(1));
      if (claim) { // the claim alone refuses: in the full flow, accept_invitations' own refusal would hide a claim that took the row
        const at = await caught(tx(db, 'poly_auth', (q) => q('SELECT app.claim_invitations($1::bytea, $2)', [tokenHash(dead.token), dead.email])));
        expect([at?.code, at?.message]).toEqual(['42501', 'invitation_required']);
      }
      const refused = signUp(dead.email, dead.token, claim);
      const x = await refused.done;
      expect([x?.code, x?.message]).toEqual(['42501', 'invitation_required']);
      expect(exists(refused.id)).toBe('0');
      const live = invite(db, b.entity, b.owner);
      const ok = signUp(live.email, live.token, claim);
      expect(await ok.done).toBeNull();
      expect(roleOf(db, b.entity, ok.id)).toBe('viewer');
    });
  }

  it('T-R5c: an owner invitation revoked after it was claimed seats nothing at enrolment; the unrevoked twin seats  [red if: seat_claimed_invitations drops revoked_at IS NULL]', async () => {
    for (const revoke of [true, false]) {
      const b = business(db);
      const u = newUser(db, { enrolled: false });
      const i = invite(db, b.entity, b.owner, { role: 'owner', email: u.email, claimedBy: u.id });
      if (revoke) await committed(db, app(b.owner), async (q) => expect((await q(REVOKE, [i.id])).rowCount).toBe(1));
      await enrol(db, u.id);
      expect(enrolled(db, u.id)).toBe(true);
      expect([roleOf(db, b.entity, u.id), invState(db, i.id).accepted !== '']).toEqual(revoke ? ['', false] : ['owner', true]);
    }
  });

  it('T-R5d: an enrolment that waits on an uncommitted revocation commits with no seat  [red if: revocation is read before the locked query, not in it]', async () => {
    const b = business(db);
    const u = newUser(db, { enrolled: false });
    const i = invite(db, b.entity, b.owner, { role: 'owner', email: u.email, claimedBy: u.id });
    const e = await enrolment(db, u.id);
    let revoker: Conn | undefined;
    try {
      revoker = await open(db, app(b.owner));
      expect((await revoker.q(REVOKE, [i.id])).rowCount).toBe(1);
      const seating = caught(e.finish());
      await waitingOnLock(db, [e.pid]);
      expect(await revoker.commit()).toBeNull();
      expect(await seating).toBeNull();
      expect(await e.commit()).toBeNull();
    } finally { await revoker?.end(); await e.end(); }
    expect([enrolled(db, u.id), roleOf(db, b.entity, u.id), invState(db, i.id).accepted]).toEqual([true, '', '']);
  });
});
