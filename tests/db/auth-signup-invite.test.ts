// POLY-87 gate 2 (ruling @ process/cairn/reviews/POLY-87/ruling.md, addendum 1). Real Postgres, as poly_app, the real tenancy
// code (no claimInvitation mock). Invitations come from helpers/invitation.ts (R7). Built up in the ruling's step order;
// each describe names its condition numbers. Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnv } from './helpers/api';
import { PW, boot, post, teardown, type Env } from './helpers/auth';
import { claimedBy, inviteRow, newToken, seedInvitation, seedOwnerEntity } from './helpers/invitation';
import { must } from './helpers/sql';

let e: Env;
let auth: any;
beforeAll(async () => {
  e = await boot();
  auth = await e.mk();
});
afterAll(() => teardown(e));

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const users = (email: string) => e.count(`SELECT 1 FROM public."user" WHERE email = '${email}'`);
const signUp = (email: string, invitationToken?: string, a = auth) =>
  e.handle(post('/sign-up/email', { email, password: PW, name: 'Invited', ...(invitationToken === undefined ? {} : { invitationToken }) }), a);
const body = async (r: Response) => ({ status: r.status, text: await r.clone().text() });

describe('condition 1 + 28: every refusal on /sign-up/email is the same 403 invitation_required', () => {
  it('no token, a malformed token, an unknown token, an expired, a revoked, a claimed token and another email: 403, identical bodies, no user row  [red if: any case answers 500, a different body, or creates a user]', async () => {
    const o = seedOwnerEntity(e.db);
    const email = `inv-${stamp()}@qa.test`;
    const cases: Record<string, string | undefined> = {
      none: undefined,
      malformed: 'not-a-token!',
      short: newToken().slice(0, 40),
      unknown: newToken(),
      expired: seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId, state: 'expired' }),
      revoked: seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId, state: 'revoked' }),
      claimed: seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId, state: 'claimed' }),
      otherEmail: seedInvitation({ db: e.db, email: `someone-else-${stamp()}@qa.test`, role: 'viewer', entityId: o.entityId, as: o.ownerId }),
    };
    const got: Record<string, { status: number; text: string }> = {};
    for (const [k, t] of Object.entries(cases)) got[k] = await body(await signUp(email, t));
    for (const [k, g] of Object.entries(got)) {
      expect(g.status, k).toBe(403);
      expect(JSON.parse(g.text).code, k).toBe('invitation_required');
    }
    expect(new Set(Object.values(got).map((g) => g.text)).size, JSON.stringify(got)).toBe(1);
    expect(users(email)).toBe(0);
  });

  it('a valid token for the right email signs up (positive control: the refusals above are about the invitation, not about the route)  [red if: sign-up with a live invitation is refused]', async () => {
    const o = seedOwnerEntity(e.db);
    const email = `ok-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const r = await signUp(email, t);
    expect(r.status, await r.clone().text()).toBe(200);
    expect(users(email)).toBe(1);
  });
});

describe('condition 2: no configuration input reopens sign-up', () => {
  it('every AuthInput variant and NODE_ENV value still refuses the condition-1 cases, and authOptions carries no key that disables databaseHooks (S11)  [red if: an input or env flag short-circuits the claim]', async () => {
    const email = `cfg-${stamp()}@qa.test`;
    const saved = process.env.NODE_ENV;
    try {
      for (const env of ['production', 'development', 'test', undefined]) {
        if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
        for (const [mode, extra] of [
          ['real-domain', {}],
          ['private-ca', {}],
          ['real-domain', { requireClientIp: true }],
          ['real-domain', { disableSignUp: false, emailAndPassword: { enabled: true, disableSignUp: false } }],
        ] as const) {
          const a = await e.mk(mode, (o: any) => ({ ...o, ...extra }));
          for (const t of [undefined, 'x', newToken()]) {
            const r = await signUp(email, t, a);
            expect(r.status, `${env}/${mode}/${JSON.stringify(extra)}/${t}`).toBe(403);
            expect(JSON.parse(await r.text()).code).toBe('invitation_required');
          }
        }
      }
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved;
    }
    expect(users(email)).toBe(0);
    const o: any = e.optionsOf('real-domain');
    expect(JSON.stringify(Object.keys(o))).not.toMatch(/disable.?hooks|skip.?hooks|bypass/i);
    expect(typeof o.databaseHooks?.user?.create?.before).toBe('function');
  });
});

describe('condition 3: a claimed link cannot be replayed', () => {
  it('a second sign-up on the same token is refused 403 and claimed_user_id is unchanged  [red if: claim does not bind the invitation to its user, or a replay overwrites the binding]', async () => {
    const o = seedOwnerEntity(e.db);
    const email = `replay-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const first = await signUp(email, t);
    expect(first.status, await first.clone().text()).toBe(200);
    const owner = claimedBy(e.db, t);
    expect(owner).toMatch(/^[0-9a-f-]{36}$/);
    const second = await signUp(email, t);
    expect(second.status).toBe(403);
    expect(JSON.parse(await second.text()).code).toBe('invitation_required');
    expect(claimedBy(e.db, t)).toBe(owner);
    expect(inviteRow(e.db, t)[2], 'viewer invitation is accepted once').not.toBe('');
  });
});

describe('condition 4: two concurrent sign-ups on one token', () => {
  it('end with exactly one user, Person and membership; the loser leaves no row and gets 403  [red if: the claim does not lock the row, so both commit or the loser 500s]', async () => {
    const o = seedOwnerEntity(e.db);
    const email = `race-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const rs = await Promise.all([signUp(email, t), signUp(email, t)]);
    const statuses = rs.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(await Promise.all(rs.map(body)))).toEqual([200, 403]);
    expect(users(email)).toBe(1);
    const uid = must(`SELECT id FROM public."user" WHERE email = '${email}'`, e.db).rows[0]![0];
    expect(e.count(`SELECT 1 FROM public.entity WHERE self_user_id = '${uid}'`)).toBe(1);
    expect(e.count(`SELECT 1 FROM public.membership WHERE user_id = '${uid}' AND entity_id = '${o.entityId}'`)).toBe(1);
    const loser = rs.find((r) => r.status === 403)!;
    expect(JSON.parse(await loser.text()).code).toBe('invitation_required');
  });
});

// ---------------------------------------------------------------- step 2: hooks and transaction (conditions 6-11)
// ASSUMED surface (the ruling names it in R3 step 6, not its return type): @poly/tenancy exports
// landingEntity(tx) -> Promise<string> (the entity id). Everything else is the ruling's.
const SID = '00000000-0000-4000-8000-0000000000e1';
const landing = async (userId: string): Promise<string> => {
  const T: any = await import('../../packages/tenancy/src/index.ts');
  return e.dbm.withTenant(e.dbs.sessionUserId(userId), SID, (tx: any) => T.landingEntity(tx));
};
const visibleCount = (userId: string): Promise<number> =>
  e.dbm.withTenant(e.dbs.sessionUserId(userId), SID, async (tx: any) =>
    Number((await tx.execute(e.dbm.sql`SELECT cardinality(app.visible_entities()) AS n`)).rows[0].n));
const uidOf = (email: string) => must(`SELECT id FROM public."user" WHERE email = '${email}'`, e.db).rows[0]![0]!;
const personOf = (uid: string) => must(`SELECT id FROM public.entity WHERE self_user_id = '${uid}'`, e.db).rows[0]![0]!;
const memberships = (uid: string) => must(`SELECT entity_id, role FROM public.membership WHERE user_id = '${uid}' ORDER BY role`, e.db).rows;

/** The three USER_INSERTING routes. The token is carried by /sign-up/email only; the others match by verified email (R3). */
const routes: Record<string, (email: string, token: string) => Promise<Response>> = {
  '/sign-up/email': (email, token) => signUp(email, token),
  '/magic-link/verify': async (email) => {
    e.mails.length = 0;
    await e.handle(post('/sign-in/magic-link', { email, callbackURL: '/' }), auth);
    const m = e.mails.find((x) => x.email === email)!;
    return e.handle(new Request(`https://app.qa.test/api/auth/magic-link/verify?token=${m.token}&callbackURL=/`, { headers: { origin: 'https://app.qa.test' } }), auth);
  },
  '/callback/:id': (email) => e.oauth(email, auth),
};

describe('condition 6: a viewer entity invitation seats a viewer on that entity, through each route', () => {
  for (const [path, drive] of Object.entries(routes))
    it(`${path}: a viewer membership on the invited entity, accepted_at set, landingEntity is that entity  [red if: the accept step is missing or seats on the wrong entity]`, async () => {
      const o = seedOwnerEntity(e.db);
      const email = `v6-${stamp()}@qa.test`;
      const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
      const r = await drive(email, t);
      expect(r.status, await r.clone().text()).toBeLessThan(400);
      expect(users(email), `${path} created the user`).toBe(1);
      const uid = uidOf(email);
      expect(memberships(uid)).toEqual(expect.arrayContaining([[o.entityId, 'viewer']]));
      const [claimed, , accepted] = inviteRow(e.db, t);
      expect(claimed).toBe(uid);
      expect(accepted).not.toBe('');
      expect(await landing(uid)).toBe(o.entityId);
      expect(must(`SELECT signup_txid IS NULL FROM public."user" WHERE id = '${uid}'`, e.db).rows[0]![0], 'C32: no committed row keeps its stamp').toBe('t');
    });
});

describe('condition 7: a no-entity invitation gives the invitee only their own Person', () => {
  it('visible_entities() has one element and landingEntity is the Person  [red if: a no-entity row seats a membership or the accept step ignores it]', async () => {
    const email = `n7-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer' });
    const r = await signUp(email, t);
    expect(r.status, await r.clone().text()).toBeLessThan(400);
    const uid = uidOf(email);
    expect(await visibleCount(uid)).toBe(1);
    expect(await landing(uid)).toBe(personOf(uid));
    expect(memberships(uid)).toEqual([[personOf(uid), 'owner']]);
    expect(inviteRow(e.db, t)[0]).toBe(uid);
  });
});

describe('condition 8: a manager or owner invitation is claimed, not seated', () => {
  for (const role of ['manager', 'owner'] as const)
    it(`${role}: claimed_user_id set, accepted_at null, no membership on the entity, the user lands on their Person  [red if: the role is seated before the second step is enrolled]`, async () => {
      const o = seedOwnerEntity(e.db);
      const email = `r8-${role}-${stamp()}@qa.test`;
      const t = seedInvitation({ db: e.db, email, role, entityId: o.entityId, as: o.ownerId });
      const r = await signUp(email, t);
      expect(r.status, await r.clone().text()).toBeLessThan(400);
      const uid = uidOf(email);
      expect(inviteRow(e.db, t)).toEqual([uid, expect.any(String), '']);
      expect(inviteRow(e.db, t)[1]).not.toBe('');
      expect(memberships(uid).map((m) => m[0])).not.toContain(o.entityId);
      expect(await landing(uid)).toBe(personOf(uid));
    });
});

describe('conditions 9, 10: any failure leaves no user, entity, membership or account, and the invitation unclaimed', () => {
  const rows = (email: string) => ({
    user: users(email),
    account: e.count(`SELECT 1 FROM public.account a JOIN public."user" u ON u.id = a.user_id WHERE u.email = '${email}'`),
    entity: e.count(`SELECT 1 FROM public.entity en JOIN public."user" u ON u.id = en.self_user_id WHERE u.email = '${email}'`),
    membership: e.count(`SELECT 1 FROM public.membership m JOIN public."user" u ON u.id = m.user_id WHERE u.email = '${email}'`),
  });
  const none = { user: 0, account: 0, entity: 0, membership: 0 };
  beforeAll(() => {
    must(`CREATE FUNCTION public.qa_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa: forced failure'; END $$;
      CREATE FUNCTION public.qa_refuse_session87() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF EXISTS (SELECT 1 FROM public."user" WHERE id = NEW.user_id AND email LIKE 'rb-session-%') THEN RAISE EXCEPTION 'qa: session refused'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_rb_session BEFORE INSERT ON public.session FOR EACH ROW EXECUTE FUNCTION public.qa_refuse_session87();
      CREATE TRIGGER qa_rb_entity BEFORE INSERT ON public.entity FOR EACH ROW WHEN (NEW.name = 'Explode Person') EXECUTE FUNCTION public.qa_refuse();
      CREATE FUNCTION public.qa_refuse_accept() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.email LIKE 'rb-accept-%' AND to_jsonb(NEW)->>'claimed_at' IS NOT NULL THEN RAISE EXCEPTION 'qa: accept refused'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_rb_accept BEFORE UPDATE ON public.invitation FOR EACH ROW EXECUTE FUNCTION public.qa_refuse_accept();`, e.db);
  });
  const attempt = async (email: string, name: string) => {
    const o = seedOwnerEntity(e.db);
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const r = await e.handle(post('/sign-up/email', { email, password: PW, name, invitationToken: t }), auth);
    return { r, t, o };
  };
  it('a refused session insert (after the whole sign-up ran) rolls everything back, including the claim  [red if: the sign-up commits in pieces or the claim survives]', async () => {
    const email = `rb-session-${stamp()}@qa.test`;
    const { r, t } = await attempt(email, 'Rolled Back');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(rows(email)).toEqual(none);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
    expect(r.headers.getSetCookie()).toEqual([]);
  });
  it('a throw from provisionPerson (trigger on entity) rolls everything back  [red if: the user commits before provisionPerson runs]', async () => {
    const email = `rb-prov-${stamp()}@qa.test`;
    const { r, t } = await attempt(email, 'Explode');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(rows(email)).toEqual(none);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
  });
  it('a throw after the step, from acceptInvitations, rolls everything back  [red if: provisionPerson commits before the accept]', async () => {
    const email = `rb-accept-${stamp()}@qa.test`;
    const { r, t } = await attempt(email, 'After Step');
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(rows(email)).toEqual(none);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
  });
});

describe('condition 11: the pooled backend carries no identity after a sign-up', () => {
  it('after a commit, and after a rollback, the next checkout of the same backend (max: 1) reads app.user_id empty and sees zero tenant rows  [red if: the setting is session-level, so it rides the backend into the pool]', async () => {
    await e.dbm.close();
    e.dbm.configure({ app: dbEnv('poly_app', e.db), worker: dbEnv('poly_worker', e.db), max: 1 });
    const a = await e.mk();
    const probe = async () => e.dba.withContextFreeTx(async (tx: any) => {
      const s = (await tx.execute(e.dbm.sql`SELECT coalesce(current_setting('app.user_id', true), '') AS v, pg_backend_pid() AS pid, (SELECT count(*) FROM public.entity) AS n`)).rows[0];
      return { v: s.v as string, pid: s.pid as number, n: Number(s.n) };
    });
    const before = await probe();
    const o = seedOwnerEntity(e.db);
    const okEmail = `pool-ok-${stamp()}@qa.test`;
    const ok = await signUp(okEmail, seedInvitation({ db: e.db, email: okEmail, role: 'viewer', entityId: o.entityId, as: o.ownerId }), a);
    expect(ok.status, await ok.clone().text()).toBe(200);
    const afterCommit = await probe();
    const badEmail = `rb-session-pool-${stamp()}@qa.test`;
    const bad = await signUp(badEmail, seedInvitation({ db: e.db, email: badEmail, role: 'viewer', entityId: o.entityId, as: o.ownerId }), a);
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const afterRollback = await probe();
    for (const p of [afterCommit, afterRollback]) {
      expect(p.v).toBe('');
      expect(p.n).toBe(0);
      expect(p.pid).toBe(before.pid);
    }
  });
});

// ---------------------------------------------------------------- step 3: the step's refusals (conditions 12, 32)
// ASSUMED (R3 step 4): the after-hook runs enterNewUser(created.id), provisionPerson(tx), acceptInvitations(tx, { token }) in
// that order, with acceptInvitations exported by @poly/tenancy. A variant swaps databaseHooks.user.create.after for one that
// leaves a step out; the real before-hook (claim) stays.
describe('conditions 12, 32: a sign-up missing a step is refused and leaves no user row', () => {
  const variant = (steps: { enter: boolean; provision: boolean; accept: boolean }) => async () => {
    const T: any = await import('../../packages/tenancy/src/index.ts');
    return e.mk('real-domain', (o: any) => ({
      ...o,
      databaseHooks: {
        ...o.databaseHooks,
        user: {
          ...o.databaseHooks.user,
          create: {
            ...o.databaseHooks.user.create,
            after: async (user: { id: string }, ctx: { body?: { invitationToken?: string } } | null) => {
              const tx: any = e.dba.currentTx();
              if (steps.enter) await tx.enterNewUser(user.id);
              if (steps.provision) await T.provisionPerson(tx);
              if (steps.accept) await T.acceptInvitations(tx, { token: ctx?.body?.invitationToken ?? null });
            },
          },
        },
      },
    }));
  };
  const run = async (a: any) => {
    const o = seedOwnerEntity(e.db);
    const email = `var-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    return { email, t, r: await signUp(email, t, a) };
  };
  it('control: all three steps, in order, sign up  [red if: the variant mechanism itself is broken]', async () => {
    const { email, r } = await run(await variant({ enter: true, provision: true, accept: true })());
    expect(r.status, await r.clone().text()).toBe(200);
    expect(users(email)).toBe(1);
  });
  it('C12: with enterNewUser removed the same sign-up fails from RLS (42501) and leaves no user row  [red if: provisionPerson runs without the step, or the failure commits]', async () => {
    const { email, t, r } = await run(await variant({ enter: false, provision: true, accept: true })());
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(users(email)).toBe(0);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
  });
  it('C32: with acceptInvitations skipped the sign-up fails at commit (deferred stamp check) and leaves no user row  [red if: a stamped row can commit]', async () => {
    const { email, t, r } = await run(await variant({ enter: true, provision: true, accept: false })());
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(users(email)).toBe(0);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
  });
});
