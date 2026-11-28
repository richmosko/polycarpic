// POLY-90 (ruling R1, R2, R4, R5, R8; addenda 1-2): the founder column and its commit-time invariant, the self-Person owner row,
// issued_via set once and the tombstone shape. Every refusal asserts SQLSTATE and message at the stage that raises it, and every
// guard has a positive case. Titles carry the seam id and end [red if: <mutation>].
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { REAL_MIGRATIONS, dbEnv, freshDb, migrateCli } from './helpers/api';
import {
  FOUNDER_MSG, OWN_PERSON_MSG, RAISE, SET_ONCE_MSG, business, businessOf, committed, expectAt, founderOf, invite, invState,
  newUser, owners, personOf, raise, roleOf, seat, stage, twoOwners,
} from './helpers/founder';
import { must } from './helpers/sql';

let db: string;
beforeAll(async () => {
  db = freshDb();
  const r = migrateCli(db, REAL_MIGRATIONS);
  expect(r.code, r.err + r.out).toBe(0);
});

const app = (user: string) => ({ role: 'poly_app', user }) as const;
const SUPER = { role: 'super' } as const;
/** A superuser session carrying `user`'s marker, so app.keep_an_owner can count (helpers/founder.ts). */
const superAs = (user: string) => ({ role: 'super', user }) as const;
const LOWER = `UPDATE public.membership SET role = 'viewer' WHERE entity_id = $1 AND user_id = $2`;
const REMOVE = `DELETE FROM public.membership WHERE entity_id = $1 AND user_id = $2`;
const TYPE = (k: string) => `(SELECT id FROM public.entity_type WHERE system_key = '${k}')`;

describe('R1 the founder column', () => {
  it('T-R1: the creator of an entity, a Business and a Person alike, is its founder  [red if: the column has no default of app.current_user_id()]', async () => {
    const b = business(db);
    expect(founderOf(db, b.entity)).toBe(b.owner);
    const u = newUser(db).id;
    const p = await personOf(db, u);
    expect(founderOf(db, p)).toBe(u);
  });

  it('T-R1a: poly_app may not name the founder on INSERT, its own id included (42501)  [red if: INSERT on the column is granted]', async () => {
    const u = newUser(db).id;
    for (const founder of [u, newUser(db).id]) {
      const got = await stage(db, app(u), (q) => q(`INSERT INTO public.entity (type_id, name, tax_classification, founding_owner_user_id) VALUES (${TYPE('business')}, 'r1a', 'business_c_corp', $1)`, [founder]));
      expectAt(got, 'statement', '42501', 'permission denied for table entity');
    }
    const e = await businessOf(db, u); // positive: the same insert without the column
    expect(founderOf(db, e)).toBe(u);
  });

  it('T-R1b: poly_app may not rewrite the founder, even as the owner (42501); the owner may still rename  [red if: UPDATE on the column is granted]', async () => {
    const t = await twoOwners(db);
    const got = await stage(db, app(t.founder), (q) => q('UPDATE public.entity SET founding_owner_user_id = $2 WHERE id = $1', [t.entity, t.co]));
    expectAt(got, 'statement', '42501', 'permission denied for table entity');
    await committed(db, app(t.founder), async (q) => expect((await q(`UPDATE public.entity SET name = 'renamed' WHERE id = $1`, [t.entity])).rowCount).toBe(1));
    expect(founderOf(db, t.entity)).toBe(t.founder);
  });

  it('no login role holds INSERT or UPDATE on the founder column  [red if: a grant and a trigger overwrite stand in for the missing grant]', () => {
    const held = must(`SELECT rolname || ':' || p FROM pg_roles CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE']) p
      WHERE rolcanlogin AND NOT rolsuper AND rolname LIKE 'poly\\_%' AND has_column_privilege(oid, 'public.entity', 'founding_owner_user_id', p)`, db).rows;
    expect(held).toEqual([]);
    expect(Number(must(`SELECT count(*) FROM pg_roles WHERE rolcanlogin AND rolname LIKE 'poly\\_%'`, db).rows[0]![0]), 'the query has login roles to look at').toBeGreaterThanOrEqual(5);
  });

  it('T-R1c: a Person\'s founder is its user: a superuser naming the Person\'s other owner is refused at the statement; a Business\'s founder may move to its other owner  [red if: entity_person_founder_check is missing]', async () => {
    const u = newUser(db).id;
    const p = await personOf(db, u);
    const co = newUser(db).id;
    seat(db, p, co, 'viewer');
    await raise(db, u, p, co);
    const got = await stage(db, SUPER, (q) => q('UPDATE public.entity SET founding_owner_user_id = $2 WHERE id = $1', [p, co]));
    expect(got.at).toBe('statement');
    expect([got.refusal!.code, got.refusal!.constraint]).toEqual(['23514', 'entity_person_founder_check']);
    const t = await twoOwners(db);
    const moved = await stage(db, SUPER, (q) => q('UPDATE public.entity SET founding_owner_user_id = $2 WHERE id = $1', [t.entity, t.co]));
    expect(moved.refusal).toBeNull();
    expect(founderOf(db, t.entity)).toBe(t.co);
  });

  it('a live entity has a founder and a purged one has none (entity_founder_tombstone_check, both directions)  [red if: the check is missing or one-sided]', async () => {
    const b = business(db);
    const live = await stage(db, SUPER, (q) => q('UPDATE public.entity SET founding_owner_user_id = NULL WHERE id = $1', [b.entity]));
    expect([live.at, live.refusal?.code, live.refusal?.constraint]).toEqual(['statement', '23514', 'entity_founder_tombstone_check']);
    const PURGE = 'UPDATE public.entity SET name = NULL, type_id = NULL, tax_classification = NULL, self_user_id = NULL, purged_at = now()';
    const kept = await stage(db, SUPER, (q) => q(`${PURGE} WHERE id = $1`, [b.entity]));
    expect([kept.at, kept.refusal?.code, kept.refusal?.constraint]).toEqual(['statement', '23514', 'entity_founder_tombstone_check']);
    const ok = await stage(db, SUPER, (q) => q(`${PURGE}, founding_owner_user_id = NULL WHERE id = $1`, [b.entity]));
    expect(ok.refusal).toBeNull();
  });
});

describe('R2 the founder holds owner at every commit', () => {
  it('T-R2a: the founder lowering themselves on a two-owner entity: the statement succeeds, the COMMIT fails  [red if: membership_91_founder_holds_owner is dropped, or it is not deferred]', async () => {
    const t = await twoOwners(db);
    const got = await stage(db, app(t.founder), async (q) => expect((await q(LOWER, [t.entity, t.founder])).rowCount).toBe(1));
    expectAt(got, 'commit', '23514', FOUNDER_MSG);
    expect(roleOf(db, t.entity, t.founder)).toBe('owner');
    // positive: the co-owner gives up owner and commits
    await committed(db, app(t.co), async (q) => expect((await q(LOWER, [t.entity, t.co])).rowCount).toBe(1));
    expect(owners(db, t.entity)).toBe(1);
  });

  for (const role of ['poly_app', 'poly_auth', 'none'] as const) {
    it(`T-R2a: the same refusal when the transaction commits ${role === 'none' ? 'as the superuser' : `with the role switched to ${role}`}  [red if: the check runs as invoker, reads through app.owner_count, or exempts the committing role]`, async () => {
      const t = await twoOwners(db);
      const got = await stage(db, superAs(t.founder), async (q) => {
        expect((await q(LOWER, [t.entity, t.founder])).rowCount).toBe(1);
        if (role !== 'none') await q(`SET LOCAL ROLE ${role}`);
      });
      expectAt(got, 'commit', '23514', FOUNDER_MSG);
      expect(roleOf(db, t.entity, t.founder)).toBe('owner');
    });
  }

  it('T-R2b: lowering and restoring the founder in one transaction commits: the check reads state at commit, not the changed row  [red if: an immediate trigger tests NEW.role]', async () => {
    const t = await twoOwners(db);
    const got = await stage(db, superAs(t.co), async (q) => {
      await q(LOWER, [t.entity, t.founder]);
      await q(RAISE, [t.entity, t.founder, 'owner']);
    });
    expect(got.refusal).toBeNull();
    expect(roleOf(db, t.entity, t.founder)).toBe('owner');
  });

  it('T-R2c: with SET CONSTRAINTS ALL IMMEDIATE a user still creates an entity  [red if: the entity trigger fires before entity_seat_creator seats the owner]', async () => {
    const u = newUser(db).id;
    const got = await stage(db, app(u), async (q) => {
      await q('SET CONSTRAINTS ALL IMMEDIATE');
      await q(`INSERT INTO public.entity (type_id, name, tax_classification) VALUES (${TYPE('business')}, $1, 'business_c_corp')`, [`r2c-${u}`]);
    });
    expect(got.refusal).toBeNull();
    expect(must(`SELECT count(*) FROM public.entity WHERE name = 'r2c-${u}' AND founding_owner_user_id = '${u}'`, db).rows[0]![0]).toBe('1');
  });

  it('T-R2d: a superuser deleting the founder\'s owner row on a two-owner entity is refused at COMMIT  [red if: R2 exempts a superuser, or the trigger skips DELETE]', async () => {
    const t = await twoOwners(db);
    const got = await stage(db, superAs(t.co), async (q) => expect((await q(REMOVE, [t.entity, t.founder])).rowCount).toBe(1));
    expectAt(got, 'commit', '23514', FOUNDER_MSG);
    expect(roleOf(db, t.entity, t.founder)).toBe('owner');
  });

  it('moving the founder to a user who is not an owner is refused at COMMIT; to an owner it commits  [red if: entity_z91_founder_holds_owner is dropped, or skips UPDATE]', async () => {
    const t = await twoOwners(db);
    const viewer = newUser(db).id;
    seat(db, t.entity, viewer, 'viewer');
    const got = await stage(db, SUPER, async (q) => expect((await q('UPDATE public.entity SET founding_owner_user_id = $2 WHERE id = $1', [t.entity, viewer])).rowCount).toBe(1));
    expectAt(got, 'commit', '23514', FOUNDER_MSG);
    expect(founderOf(db, t.entity)).toBe(t.founder);
  });

  it('a purged entity is skipped: its former founder\'s owner row may go  [red if: R2 does not return early on purged_at]', async () => {
    const t = await twoOwners(db);
    must(`UPDATE public.entity SET name = NULL, type_id = NULL, tax_classification = NULL, self_user_id = NULL, founding_owner_user_id = NULL, purged_at = now() WHERE id = '${t.entity}'`, db);
    const got = await stage(db, superAs(t.co), async (q) => expect((await q(REMOVE, [t.entity, t.founder])).rowCount).toBe(1));
    expect(got.refusal).toBeNull();
    expect(owners(db, t.entity)).toBe(1);
  });

  it('no role may delete an entity row (R2 relies on it)  [red if: DELETE on entity is granted to any poly role]', () => {
    const held = must(`SELECT rolname FROM pg_roles WHERE NOT rolsuper AND rolname LIKE 'poly\\_%' AND rolname <> 'poly_owner' AND has_table_privilege(oid, 'public.entity', 'DELETE')`, db).rows;
    expect(held).toEqual([]);
  });
});

describe('R8 the tombstone shape', () => {
  it('T-R8: a founder removing every own membership in one transaction is refused at COMMIT while another owner remains; the co-owner does the same and commits  [red if: the founder triggers are dropped]', async () => {
    const t = await twoOwners(db);
    const second = await businessOf(db, t.founder);
    seat(db, second, t.co, 'viewer');
    await raise(db, t.founder, second, t.co);
    const ALL_MINE = 'DELETE FROM public.membership WHERE user_id = $1';
    const got = await stage(db, app(t.founder), async (q) => expect((await q(ALL_MINE, [t.founder])).rowCount).toBe(2));
    expectAt(got, 'commit', '23514', FOUNDER_MSG);
    expect([owners(db, t.entity), owners(db, second)]).toEqual([2, 2]);
    await committed(db, app(t.co), async (q) => expect((await q(ALL_MINE, [t.co])).rowCount).toBe(2));
    expect([owners(db, t.entity), owners(db, second)]).toEqual([1, 1]);
  });
});

describe('R4 a user keeps owner on their own Person', () => {
  /** A's own Person with a second owner B (two owners, so keep_an_owner cannot be what refuses). */
  async function sharedPerson() {
    const a = newUser(db).id;
    const b = newUser(db).id;
    const p = await personOf(db, a);
    seat(db, p, b, 'viewer');
    await raise(db, a, p, b);
    expect(owners(db, p)).toBe(2);
    return { a, b, p };
  }

  for (const [who, superuser] of [['A', false], ['a superuser', true]] as const) {
    for (const [verb, sql] of [['demotes', LOWER], ['deletes', REMOVE]] as const) {
      it(`T-R4: ${who} ${verb} A's owner row on A's own two-owner Person: refused at the statement  [red if: membership_15_own_person_owner is dropped, skips ${verb === 'deletes' ? 'DELETE' : 'UPDATE'}${superuser ? ', or exempts a superuser' : ''}]`, async () => {
        const s = await sharedPerson();
        const got = await stage(db, superuser ? superAs(s.b) : app(s.a), (q) => q(sql, [s.p, s.a]));
        expectAt(got, 'statement', '23514', OWN_PERSON_MSG);
        expect(roleOf(db, s.p, s.a)).toBe('owner');
      });
    }
  }

  it('T-R4 positive: B lowers their own role on A\'s Person, and A removes a viewer from it  [red if: R4 refuses every change on a Person]', async () => {
    const s = await sharedPerson();
    const v = newUser(db).id;
    seat(db, s.p, v, 'viewer');
    await committed(db, app(s.a), async (q) => expect((await q(REMOVE, [s.p, v])).rowCount).toBe(1));
    await committed(db, app(s.b), async (q) => expect((await q(LOWER, [s.p, s.b])).rowCount).toBe(1));
    expect(roleOf(db, s.p, s.b)).toBe('viewer');
  });

  it('T-R4 positive: A lowers their own role on a Business A does not found, A having a Person  [red if: R4 matches on the user and not on the entity\'s self_user_id]', async () => {
    const t = await twoOwners(db);
    await personOf(db, t.co);
    await committed(db, app(t.co), async (q) => expect((await q(LOWER, [t.entity, t.co])).rowCount).toBe(1));
    expect(roleOf(db, t.entity, t.co)).toBe('viewer');
  });
});

describe('R5 issued_via is set once', () => {
  it('T-R5a: a superuser changing issued_via is refused by the trigger; the owner revokes the same row  [red if: the check is missing from invitation_set_once, or exempts a superuser]', async () => {
    const b = business(db);
    const i = invite(db, b.entity, b.owner);
    const got = await stage(db, SUPER, (q) => q(`UPDATE public.invitation SET issued_via = 'operator', entity_id = NULL, inviter_user_id = NULL WHERE id = $1`, [i.id]));
    expectAt(got, 'statement', '42501', SET_ONCE_MSG);
    const same = await stage(db, SUPER, (q) => q(`UPDATE public.invitation SET issued_via = 'owner' WHERE id = $1`, [i.id]));
    expect(same.refusal, 'writing the same value is not a change').toBeNull();
    await committed(db, app(b.owner), async (q) => expect((await q('UPDATE public.invitation SET revoked_at = now() WHERE id = $1', [i.id])).rowCount).toBe(1));
    expect(invState(db, i.id).revoked).not.toBe('');
  });

  it('T-R5a: poly_app can neither update nor supply issued_via (42501, by privilege)  [red if: a grant names the column]', async () => {
    const b = business(db);
    const i = invite(db, b.entity, b.owner);
    expectAt(await stage(db, app(b.owner), (q) => q(`UPDATE public.invitation SET issued_via = 'bootstrap' WHERE id = $1`, [i.id])), 'statement', '42501', 'permission denied for table invitation');
    expectAt(await stage(db, app(b.owner), (q) => q(`INSERT INTO public.invitation (entity_id, email, role, inviter_user_id, token_hash, expires_at, issued_via)
      VALUES ($1, 'r5a@qa.test', 'viewer', $2, sha256('r5a'::bytea), now() + interval '1 day', 'owner')`, [b.entity, b.owner])), 'statement', '42501', 'permission denied for table invitation');
  });
});
