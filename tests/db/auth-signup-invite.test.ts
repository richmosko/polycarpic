// POLY-87 gate 2 (ruling @ process/cairn/reviews/POLY-87/ruling.md, addendum 1). Real Postgres, as poly_app, the real tenancy
// code (no claimInvitation mock). Invitations come from helpers/invitation.ts (R7). Built up in the ruling's step order;
// each describe names its condition numbers. Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
