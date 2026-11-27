// POLY-90 (ruling R5-R7 and addenda; seceng conditions I-3, V-1 to V-7): the revocation of direct invitations when an entity gets
// its second owner, the lock order of the seating path, and revoked invitations at every acceptance step. A second owner is made
// only by the real raise or the real enrolment, except in T-R6e, whose subject is the superuser write. Titles end [red if: <mutation>].
import { beforeAll, describe, expect, it } from 'vitest';
import { REAL_MIGRATIONS, freshDb, migrateCli } from './helpers/api';
import { signUpEntry, tx } from './helpers/auth-tx';
import {
  RAISE, business, businessOf, caught, committed, enrol, enrolled, enrolment, invState, invite, newUser, open, owners, raise,
  roleOf, seat, waitingOnLock, type Conn, type Inv, type Refusal,
} from './helpers/founder';
import { tokenHash } from './helpers/invitation';
import { must } from './helpers/sql';

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

  it('T-R6a positive: a raise to manager, and a viewer seat, revoke nothing  [red if: the trigger does not test NEW.role = owner]', async () => {
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

  it('a manager invitation seating at enrolment on a sole-owner entity revokes nothing  [red if: the trigger fires on every seat]', async () => {
    const b = business(db);
    const u = newUser(db, { enrolled: false });
    invite(db, b.entity, b.owner, { role: 'manager', email: u.email, claimedBy: u.id });
    const other = invite(db, b.entity, b.owner, { role: 'owner' });
    await enrol(db, u.id);
    expect(roleOf(db, b.entity, u.id)).toBe('manager');
    untouched(other);
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
