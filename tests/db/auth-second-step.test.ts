// POLY-86 criterion 6 (ruling M1; seceng S9, S10, S17): the second-step hold on the three credential paths, measured against the
// pinned versions. An enrolled TOTP user and an enrolled passkey-only user must leave /sign-in/email, /magic-link/verify and
// /callback/:id with no session row and no session cookie; an unenrolled user must still get a session on all three.
// Titles end with [red if: <mutation>].
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { get, post, PW, boot, jar, teardown, type Env } from './helpers/auth';
import { must } from './helpers/sql';
import { SIGN_IN_PATHS } from '../../packages/auth/src/route-policy.ts';

vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o as any));

let e: Env;
let auth: any;
beforeAll(async () => { e = await boot(); auth = await e.mk(); });
afterAll(() => teardown(e));

const sessions = (uid: string) => e.count(`SELECT 1 FROM public.session WHERE user_id = '${uid}'`);
const hasSessionCookie = (r: Response) => r.headers.getSetCookie().some((c) => /session_token=[^;]/.test(c) && !/max-age=0/i.test(c));

const paths: Record<string, (email: string) => Promise<Response>> = {
  '/sign-in/email': (email) => e.handle(post('/sign-in/email', { email, password: PW }), auth),
  '/magic-link/verify': async (email) => {
    e.mails.length = 0;
    await e.handle(post('/sign-in/magic-link', { email, callbackURL: '/' }), auth);
    const m = e.mails.find((x) => x.email === email)!;
    return e.handle(get(`/magic-link/verify?token=${m.token}&callbackURL=/`), auth);
  },
  '/callback/:id': (email) => e.oauth(email, auth),
};

describe('the hold (M1)', () => {
  for (const [label, opts] of [['an enrolled TOTP user', { twoFactor: true }], ['an enrolled passkey-only user', { secondStepAt: true }]] as const)
    for (const p of Object.keys(paths))
      it(`${label} leaves ${p} with no session row and no session cookie  [red if: the hold covers /sign-in/email only (twoFactor's own matcher), or the passkey-only after-hook is missing]`, async () => {
        const u = e.seedUser(opts);
        const res = await paths[p](u.email);
        expect(sessions(u.id), `${p} left a session row`).toBe(0);
        expect(hasSessionCookie(res), `${p} set a session cookie`).toBe(false);
        if (opts.twoFactor && p !== '/callback/:id') expect(res.headers.getSetCookie().some((c) => /two_factor/.test(c)), 'two_factor cookie').toBe(true);
        if (!opts.twoFactor) {
          // passkey-only: JSON answers {secondStepRequired:'passkey'}; the GET paths redirect to /sign-in/second-step
          const txt = await res.clone().text();
          expect(txt + (res.headers.get('location') ?? '')).toMatch(/secondStepRequired|second-step/);
        }
      });

  for (const p of Object.keys(paths))
    it(`control: a user with no second step gets a session on ${p}  [red if: the hold is applied to every user]`, async () => {
      const u = e.seedUser();
      const res = await paths[p](u.email);
      expect(res.status).toBeLessThan(400);
      expect(sessions(u.id)).toBe(1);
      expect(hasSessionCookie(res)).toBe(true);
    });

  it('a TOTP user finishes at the no-session /two-factor/verify-totp, which creates the session  [red if: the widened hold deletes the session but sets no two_factor cookie, stranding the user]', async () => {
    const { symmetricEncrypt } = await import('better-auth/crypto');
    const { createOTP } = await import('@better-auth/utils/otp');
    const u = e.seedUser({ twoFactor: true });
    const secret = 'JBSWY3DPEHPK3PXP';
    const enc = await symmetricEncrypt({ key: (await import('./helpers/auth')).SECRET, data: secret });
    must(`INSERT INTO public.two_factor (user_id, secret, backup_codes, verified) VALUES ('${u.id}', '${enc}', '${enc}', true)`, e.db);
    const first = await paths['/magic-link/verify'](u.email);
    const cookie = jar('', first);
    expect(sessions(u.id)).toBe(0);
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const done = await e.handle(post('/two-factor/verify-totp', { code }, cookie), auth);
    expect(done.status).toBe(200);
    expect(sessions(u.id)).toBe(1);
    expect(hasSessionCookie(done)).toBe(true);
  });
});

describe('S10: the matcher patch finds its hook by behaviour', () => {
  it('createAuth throws at start when no after-hook matches /sign-in/email (twoFactor absent)  [red if: it patches hooks.after[0] by index and runs unheld]', async () => {
    await expect(e.mk('real-domain', (o) => ({ ...o, plugins: (o.plugins ?? []).filter((p: any) => p.id !== 'two-factor') }))).rejects.toThrow();
  });

  it('a reordered plugin array still starts and still holds  [red if: the patch depends on position]', async () => {
    const reordered = await e.mk('real-domain', (o) => ({ ...o, plugins: [...(o.plugins ?? [])].reverse() }));
    const u = e.seedUser({ twoFactor: true });
    e.mails.length = 0;
    await e.handle(post('/sign-in/magic-link', { email: u.email, callbackURL: '/' }), reordered);
    const res = await e.handle(get(`/magic-link/verify?token=${e.mails.at(-1)!.token}&callbackURL=/`), reordered);
    expect(sessions(u.id)).toBe(0);
    expect(hasSessionCookie(res)).toBe(false);
  });

  it('the plugin\'s matcher is a function that answers true for each of SIGN_IN_PATHS and false for a sentinel  [red if: the plugin\'s internal shape changed and the patch silently stopped matching]', async () => {
    // BetterAuth keeps options.hooks.after as one function (ours); the plugins' after-hooks are the array under each plugin.
    const hooks = (auth.options.plugins ?? []).flatMap((p: any) => p.hooks?.after ?? []) as { matcher: (c: any) => boolean }[];
    const hits = hooks.filter((h) => typeof h.matcher === 'function' && h.matcher({ path: '/sign-in/email' }) && !h.matcher({ path: '/__sentinel__' }));
    expect(hits).toHaveLength(1);
    for (const p of SIGN_IN_PATHS) expect(hits[0].matcher({ path: p }), p).toBe(true);
    expect([...SIGN_IN_PATHS].sort()).toEqual(['/callback/:id', '/magic-link/verify', '/sign-in/email']);
  });
});

describe('S17: the two_factor cookie attributes', () => {
  it('__Host- prefix, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain  [red if: any attribute differs; the builder reports if 1.7.18 cannot, seceng rules]', async () => {
    const u = e.seedUser({ twoFactor: true });
    const res = await paths['/sign-in/email'](u.email);
    const sc = res.headers.getSetCookie().find((c) => /two_factor/.test(c));
    expect(sc, 'no two_factor cookie').toBeDefined();
    expect(sc!).toMatch(/^__Host-/);
    for (const re of [/;\s*HttpOnly/i, /;\s*Secure/i, /;\s*SameSite=Lax/i, /;\s*Path=\//i]) expect(sc!).toMatch(re);
    expect(sc!).not.toMatch(/;\s*Domain=/i);
  });
});
