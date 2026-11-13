// POLY-87 gate 2 (ruling @ process/cairn/reviews/POLY-87/ruling.md, addendum 1). Real Postgres, as poly_app, the real tenancy
// code (no claimInvitation mock). Invitations come from helpers/invitation.ts (R7). Built up in the ruling's step order;
// each describe names its condition numbers. Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbEnv } from './helpers/api';
import { PW, boot, get, jar, post, teardown, type Env } from './helpers/auth';
import { claimedBy, inviteRow, newToken, seedInvitation, seedOwnerEntity, tokenHash } from './helpers/invitation';
import { psql, psqlSession } from './helpers/pg';
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

// ---------------------------------------------------------------- step 6: closure (condition 23)
// FIRST in the file on purpose: it needs a freshly migrated database with no user, and no later describe has seeded one yet.
// `routes` is defined further down; it is only read inside the test bodies.
describe('condition 23: on a fresh instance with no user, sign-up is closed', () => {
  it('precondition: the migrated database holds no user and no invitation  [red if: a migration seeds a user or an invitation]', () => {
    expect(e.count('SELECT 1 FROM public."user"')).toBe(0);
    expect(e.count('SELECT 1 FROM public.invitation')).toBe(0);
  });
  it('every USER_INSERTING route, and /sign-up/email with any token, is refused and leaves no user row  [red if: any route creates the first user, or a token-less path has a bootstrap exception]', async () => {
    for (const path of Object.keys(routes)) {
      const email = `closed-${stamp()}@qa.test`;
      const r = await routes[path]!(email, newToken());
      expect(e.count(`SELECT 1 FROM public."user" WHERE email = '${email}'`), `${path} (${r.status})`).toBe(0);
      expect(r.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c)), path).toBe(false);
    }
    for (const t of [undefined, '', 'x', newToken(), newToken()]) {
      const email = `closed-${stamp()}@qa.test`;
      const r = await signUp(email, t);
      expect(r.status, `token ${t}`).toBe(403);
      expect(users(email)).toBe(0);
    }
    expect(e.count('SELECT 1 FROM public."user"')).toBe(0);
  });
});

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

// ---------------------------------------------------------------- step 7: seceng conditions (addendum 1; conditions 24-29)
const bodyKeys = async (r: Response) => Object.keys(JSON.parse(await r.clone().text())).sort();
const noHooks = (patch: (o: any) => any = (o) => o) => e.mk('real-domain', (o: any) => patch({ ...o, hooks: {} })); // the route hook is gone: the request reaches databaseHooks

describe('condition 24 (S1): the user hook picks the claim mode from the route, never from the body', () => {
  it('two live invitations for one email: a sign-up with A\'s token claims A only, B stays live  [red if: the claim matches by email on the token route]', async () => {
    const o = seedOwnerEntity(e.db);
    const o2 = seedOwnerEntity(e.db);
    const email = `two-${stamp()}@qa.test`;
    const a = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const b = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o2.entityId, as: o2.ownerId });
    const r = await signUp(email, a);
    expect(r.status, await r.clone().text()).toBe(200);
    const uid = uidOf(email);
    expect(inviteRow(e.db, a)[0]).toBe(uid);
    expect(inviteRow(e.db, b)).toEqual(['', '', '']);
    expect(memberships(uid).map((m) => m[0])).toEqual(expect.arrayContaining([o.entityId]));
    expect(memberships(uid).map((m) => m[0])).not.toContain(o2.entityId);
  });
  it('a /sign-up/email that reaches the user hook with no token is refused and creates no user, even with a live invitation for that email  [red if: a missing body token falls through to the token-less (email) claim]', async () => {
    const o = seedOwnerEntity(e.db);
    const email = `notok-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const a = await noHooks();
    for (const body of [undefined, '', 'not-a-token']) {
      const r = await signUp(email, body, a);
      expect(r.status, `body token ${JSON.stringify(body)}`).toBeGreaterThanOrEqual(400);
    }
    expect(users(email)).toBe(0);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
  });
});

describe('condition 25 (S2): token-less sign-up needs a verified email', () => {
  it('a Google callback with email_verified=false for an invited address leaves no user and the invitation unclaimed  [red if: the token-less claim does not check email_verified]', async () => {
    const o = seedOwnerEntity(e.db);
    const email = `unver-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    await e.oauth(email, auth, false);
    expect(users(email)).toBe(0);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
  });

  // GitHub at the network edge only: token endpoint, /user (profile), /user/emails.
  const github = async (profileEmail: string | null, emails: { email: string; primary: boolean; verified: boolean }[], a: any) => {
    const real = globalThis.fetch;
    const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', async (i: any, init?: any) => {
      const u = String(i?.url ?? i);
      if (/github\.com\/login\/oauth\/access_token/.test(u)) return json({ access_token: 'gh-at', token_type: 'bearer', scope: 'read:user,user:email' });
      if (/api\.github\.com\/user\/emails/.test(u)) return json(emails);
      if (/api\.github\.com\/user/.test(u)) return json({ id: 4242, login: 'qa-gh', name: 'GH Person', email: profileEmail, avatar_url: 'https://example.invalid/a.png' });
      return real(i, init);
    });
    try {
      const start = await e.handle(post('/sign-in/social', { provider: 'github', callbackURL: '/' }), a);
      const cookie = jar('', start);
      const loc = ((await start.clone().json().catch(() => ({}))) as any).url ?? start.headers.get('location');
      const state = new URL(loc).searchParams.get('state')!;
      return await e.handle(get(`/callback/github?code=qa-code&state=${state}`, cookie), a);
    } finally { vi.stubGlobal('fetch', real); }
  };
  const ghAuth = async () => {
    try { return await e.mk('real-domain', () => e.A.authOptions(e.input('real-domain', { github: { clientId: 'qa-gh', clientSecret: 'qa-gh-secret' } }))); }
    catch (err) { return err as Error; }
  };

  it('options.ts overrides GitHub\'s getUserInfo (not mapProfileToUser), or authOptions refuses a github input (the fallback)  [red if: GitHub is on with the profile email as proof]', async () => {
    const got = await ghAuth();
    if (got instanceof Error) { expect(got.message).toMatch(/github/i); return; }
    const o: any = e.optionsOf('real-domain', { github: { clientId: 'qa-gh', clientSecret: 'qa-gh-secret' } });
    expect(typeof o.socialProviders?.github?.getUserInfo, 'github.getUserInfo').toBe('function');
  });
  it('the GitHub email is the /user/emails entry that is both primary and verified, never the profile email  [red if: the profile email is the proof]', async () => {
    const a = await ghAuth();
    if (a instanceof Error) return; // fallback chosen: github is refused outright (previous test)
    const o = seedOwnerEntity(e.db);
    const invited = `gh-invited-${stamp()}@qa.test`;
    const other = `gh-other-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email: invited, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    // profile email is the invited one, but it is not primary and verified: claims nothing
    await github(invited, [{ email: invited, primary: false, verified: true }, { email: other, primary: true, verified: false }], a);
    expect(users(invited) + users(other)).toBe(0);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
    // invited and primary but unverified
    await github(invited, [{ email: invited, primary: true, verified: false }], a);
    expect(users(invited)).toBe(0);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
    // the primary verified entry is the invited address while the profile shows another: claims it
    const r = await github(other, [{ email: other, primary: false, verified: true }, { email: invited, primary: true, verified: true }], a);
    expect(r.status, await r.clone().text()).toBeLessThan(400);
    expect(users(invited)).toBe(1);
    expect(inviteRow(e.db, t)[0]).toBe(uidOf(invited));
    expect(users(other)).toBe(0);
  });
});

describe('condition 26 (S3): a password sign-up does not verify the email', () => {
  it('email_verified is false after /sign-up/email, and a later Google callback for that address fails as not linked and adds no account row  [red if: the sign-up marks the email verified, so a provider links onto the account]', async () => {
    const o = seedOwnerEntity(e.db);
    const email = `s3-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const r = await signUp(email, t);
    expect(r.status, await r.clone().text()).toBe(200);
    const uid = uidOf(email);
    expect(must(`SELECT email_verified FROM public."user" WHERE id = '${uid}'`, e.db).rows[0]![0]).toBe('f');
    const before = e.count(`SELECT 1 FROM public.account WHERE user_id = '${uid}'`);
    const cb = await e.oauth(email, auth);
    const loc = cb.headers.get('location') ?? '';
    expect(/error=|account_not_linked/i.test(loc) || cb.status >= 400, `callback answered ${cb.status} ${loc}`).toBe(true);
    expect(e.count(`SELECT 1 FROM public.account WHERE user_id = '${uid}'`)).toBe(before);
    expect(e.count(`SELECT 1 FROM public.account WHERE user_id = '${uid}' AND provider_id = 'google'`)).toBe(0);
  });
});

describe('condition 27 (S5): a blocked claim answers 403, and token-less claims do not deadlock', () => {
  it('a claim blocked longer than lock_timeout answers 403 invitation_required, not 500, with the same body  [red if: the 55P03 surfaces as a 500]', async () => {
    const o = seedOwnerEntity(e.db);
    const email = `s5-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const hex = tokenHash(t).toString('hex');
    const holder = psqlSession(`BEGIN; SELECT 1 FROM public.invitation WHERE token_hash = decode('${hex}', 'hex') FOR UPDATE; SELECT pg_sleep(14);`, e.db);
    try {
      for (let i = 0; i < 60; i++) {
        if (psql(`SELECT 1 FROM public.invitation WHERE token_hash = decode('${hex}', 'hex') FOR UPDATE NOWAIT`, e.db).sqlstate === '55P03') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const r = await signUp(email, t);
      const text = await r.text();
      expect(r.status, text).toBe(403);
      expect(JSON.parse(text).code).toBe('invitation_required');
      expect(text).not.toMatch(/55P03|lock|timeout|42501|permission/i);
    } finally { holder.kill(); }
    expect(users(email)).toBe(0);
  });
  it('two token-less sign-ups for one address with two live invitations end without a deadlock (40P01) and with one user  [red if: claims lock rows in different orders]', async () => {
    const o = seedOwnerEntity(e.db);
    const o2 = seedOwnerEntity(e.db);
    const email = `dead-${stamp()}@qa.test`;
    seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    seedInvitation({ db: e.db, email, role: 'viewer', entityId: o2.entityId, as: o2.ownerId });
    const links: string[] = [];
    for (let i = 0; i < 2; i++) {
      e.mails.length = 0;
      await e.handle(post('/sign-in/magic-link', { email, callbackURL: '/' }), auth);
      links.push(e.mails.find((x) => x.email === email)!.token);
    }
    const errs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errs.push(a.map(String).join(' ')); });
    try {
      const rs = await Promise.all(links.map((tok) => e.handle(new Request(`https://app.qa.test/api/auth/magic-link/verify?token=${tok}&callbackURL=/`, { headers: { origin: 'https://app.qa.test' } }), auth)));
      for (const r of rs) expect(r.status, await r.clone().text()).toBeLessThan(500);
    } finally { spy.mockRestore(); }
    expect(errs.join('\n')).not.toMatch(/40P01|deadlock/i);
    expect(users(email)).toBe(1);
  });
});

describe('condition 28 (S8): every refusal looks the same', () => {
  it('/sign-up/email: the route hook, the second claim (route hook removed), 42501 and no token answer one 403 body with no SQLSTATE, message or hint  [red if: a refusal path leaks its cause]', async () => {
    const email = `s8-${stamp()}@qa.test`;
    const bare = await noHooks();
    const answers = [
      await signUp(email, undefined),
      await signUp(email, newToken()),
      await signUp(email, newToken(), bare),
      await signUp(email, 'bad', bare),
    ];
    const texts = await Promise.all(answers.map((r) => r.text()));
    for (const [i, r] of answers.entries()) expect(r.status, `${i}: ${texts[i]}`).toBe(403);
    expect(new Set(texts).size, texts.join(' | ')).toBe(1);
    expect(Object.keys(JSON.parse(texts[0]!)).sort()).toEqual(['code', 'message']);
    expect(texts[0]).not.toMatch(/4\d{4}|5\d{4}|sql|hint|detail|lock|permission|row-level/i);
  });
  it('/callback/:id and /magic-link/verify: no invitation, an unverified email and a revoked invitation redirect to one and the same error target  [red if: the redirect differs by cause]', async () => {
    const o = seedOwnerEntity(e.db);
    const magic = async (email: string) => {
      e.mails.length = 0;
      await e.handle(post('/sign-in/magic-link', { email, callbackURL: '/' }), auth);
      const m = e.mails.find((x) => x.email === email)!;
      return e.handle(new Request(`https://app.qa.test/api/auth/magic-link/verify?token=${m.token}&callbackURL=/`, { headers: { origin: 'https://app.qa.test' } }), auth);
    };
    const target = (r: Response) => r.headers.get('location') ?? `status ${r.status}`;
    const none = `s8a-${stamp()}@qa.test`;
    const revoked = `s8b-${stamp()}@qa.test`;
    seedInvitation({ db: e.db, email: revoked, role: 'viewer', entityId: o.entityId, as: o.ownerId, state: 'revoked' });
    const m = [await magic(none), await magic(revoked)].map(target);
    expect(m[0], m.join(' | ')).toMatch(/error/i);
    expect(new Set(m).size, m.join(' | ')).toBe(1);
    const unver = `s8c-${stamp()}@qa.test`;
    seedInvitation({ db: e.db, email: unver, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const c = [await e.oauth(`s8d-${stamp()}@qa.test`, auth), await e.oauth(unver, auth, false), await e.oauth(revoked, auth)].map(target);
    expect(c[0], c.join(' | ')).toMatch(/error/i);
    expect(new Set(c).size, c.join(' | ')).toBe(1);
    expect(users(none) + users(revoked) + users(unver)).toBe(0);
  });
});

describe('condition 29 (S9): token handling', () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const nonCanonical = (t: string) => {
    const i = alphabet.indexOf(t[42]!);
    const alt = alphabet[(i & ~3) | ((i + 1) & 3)]!; // same decoded bytes, different last character
    return t.slice(0, 42) + alt;
  };
  it('a non-canonical 43-character token that decodes to the same bytes is refused, the canonical one works  [red if: the hook hashes the decoded bytes without re-encoding]', async () => {
    const o = seedOwnerEntity(e.db);
    const email = `s9-${stamp()}@qa.test`;
    const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
    const alt = nonCanonical(t);
    expect(alt).not.toBe(t);
    expect(Buffer.from(alt, 'base64url').equals(Buffer.from(t, 'base64url'))).toBe(true);
    const bad = await signUp(email, alt);
    expect(bad.status).toBe(403);
    expect(users(email)).toBe(0);
    expect(inviteRow(e.db, t)).toEqual(['', '', '']);
    const ok = await signUp(email, t);
    expect(ok.status, await ok.clone().text()).toBe(200);
  });
  it('captured console and logger output holds no plaintext token across the refusals and one successful sign-up  [red if: a token is logged]', async () => {
    const out: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { out.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); }));
    const wOut = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { out.push(String(c)); return true; }) as any);
    const wErr = vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { out.push(String(c)); return true; }) as any);
    const tokens: string[] = [];
    try {
      const o = seedOwnerEntity(e.db);
      const email = `s9log-${stamp()}@qa.test`;
      const mine = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId });
      tokens.push(mine);
      for (const state of ['expired', 'revoked', 'claimed'] as const) {
        const t = seedInvitation({ db: e.db, email, role: 'viewer', entityId: o.entityId, as: o.ownerId, state });
        tokens.push(t);
        await signUp(email, t);
      }
      const unknown = newToken();
      tokens.push(unknown);
      await signUp(email, unknown);
      await signUp(email, nonCanonical(mine));
      await signUp(email, mine); // the one success
    } finally { for (const s of [...spies, wOut, wErr]) s.mockRestore(); }
    const all = out.join('\n');
    for (const t of tokens) expect(all, 'a plaintext token reached the log').not.toContain(t);
  });
});
