// POLY-86 harness (ruling @ 82a7d49). ONE place holds every assumption about packages/auth's surface, so the builder
// reconciles names here and not in eight test files. Assumed surface (ruling R1, R2, R4, R5; anything not in the ruling is
// marked ASSUMED):
//   @poly/auth     : authOptions(input) -> BetterAuthOptions; createAuth(options) -> BetterAuth instance (awaited, so sync or async);
//                    handleAuthRequest(request, auth?) -> Response   (ASSUMED 2nd arg: the instance; default = the app's own);
//                    loadSession(request, auth?) -> null | { userId, sessionId, shell, setCookie };
//                    listSessions(tx), revokeSession(tx, id); AUTH_ROUTES. input = { secret, baseURL, tlsMode, google?, github?, sendMagicLink }
//                    with tlsMode 'real-domain' | 'private-ca' (ASSUMED value for the first).
//   @poly/db/auth  : currentClient() -> { kind, client } | null (R2), withContextFreeTx, authPool
//   @poly/auth routing-pool.ts : createRoutingPool()
//   @poly/tenancy  : claimInvitation(tx, { email, token }) stub that throws InvitationRequired (R3). Tests mock that one export.
// The migration chain is the real one (0004_auth_second_step adds two_factor, passkey, user.second_step_at/two_factor_enabled,
// session.recent_auth_at). Users are seeded as superuser; sessions come from a real sign-in so no cookie name is guessed.
import { createHmac } from 'node:crypto';
import { vi } from 'vitest';
import { cloneMigrated, dbEnv } from './api';
import { closeSql, must } from './sql.ts';

export const BASE = 'https://app.qa.test';
export const SECRET = 'qa-auth-secret-0123456789abcdef0123456789abcdef';
export const PW = 'correct horse battery staple 1';

export type Mode = 'real-domain' | 'private-ca';
export type Env = Awaited<ReturnType<typeof boot>>;

/** Switch for the one mocked export: claimInvitation. `impl` null = the ruling's real stub (throws InvitationRequired).
 *  A test file declares: vi.mock('../../packages/tenancy/src/index.ts', async (o) => (await import('./helpers/auth')).claimFactory(o)) */
// One object on globalThis: boot() calls vi.resetModules(), which would otherwise give the mock factory a second copy of this module.
type Claim = { impl: null | ((tx: unknown, a: { email: string; token: string | null }, real: (tx: unknown, a: { email: string; token: string | null }) => Promise<unknown>) => Promise<unknown>) };
export const claim: Claim = ((globalThis as { __polyClaim?: Claim }).__polyClaim ??= { impl: null });
export async function claimFactory(orig: () => Promise<unknown>) {
  const real = (await orig()) as Record<string, any>;
  return { ...real, claimInvitation: (tx: unknown, a: any) => (claim.impl ? claim.impl(tx, a, real.claimInvitation) : real.claimInvitation(tx, a)) };
}

export const hdr = { origin: BASE, 'content-type': 'application/json' };
export const url = (p: string) => `${BASE}/api/auth${p}`;
export const post = (p: string, body: unknown, cookie = '', extra: Record<string, string> = {}) =>
  new Request(url(p), { method: 'POST', headers: { ...hdr, ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body) });
export const get = (p: string, cookie = '', method = 'GET') => new Request(url(p), { method, headers: { ...(cookie ? { cookie } : {}), origin: BASE } });

/** Merge Set-Cookie headers into a Cookie header value (a cookie set to empty / Max-Age=0 is dropped). */
export function jar(prev: string, res: Response): string {
  const m = new Map(prev.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c] as const));
  for (const sc of res.headers.getSetCookie()) {
    const kv = sc.split(';')[0];
    const [k, v] = [kv.split('=')[0], kv.slice(kv.indexOf('=') + 1)];
    if (v === '' || /max-age=0/i.test(sc)) m.delete(k);
    else m.set(k, kv);
  }
  return [...m.values()].join('; ');
}

export async function boot() {
  const db = cloneMigrated();
  vi.resetModules();
  const dbm: any = await import('../../../packages/db/src/index.ts');
  await dbm.close();
  dbm.configure({ app: dbEnv('poly_app', db), worker: dbEnv('poly_worker', db) });
  const dba: any = await import('../../../packages/db/src/auth.ts');
  const dbs: any = await import('../../../packages/db/src/session.ts');
  const A: any = await import('../../../packages/auth/src/index.ts');
  const mails: { email: string; token: string; url: string }[] = [];
  const input = (tlsMode: Mode = 'real-domain', extra: Record<string, unknown> = {}) => ({
    secret: SECRET, baseURL: BASE, tlsMode, requireClientIp: false,
    google: { clientId: 'qa-google', clientSecret: 'qa-google-secret' },
    sendMagicLink: async (m: { email: string; token: string; url: string }) => { mails.push(m); },
    ...extra,
  });
  const optionsOf = (tlsMode: Mode = 'real-domain', extra: Record<string, unknown> = {}) => A.authOptions(input(tlsMode, extra));
  // S6: tests that need the limiter off do it here, in their own options, never in authOptions' defaults.
  const mk = async (tlsMode: Mode = 'real-domain', patch: (o: any) => any = (o) => o) =>
    A.createAuth(patch({ ...optionsOf(tlsMode), rateLimit: { enabled: false } }));
  const auth = await mk();
  const hash: string = await (await auth.$context).password.hash(PW);
  const handle = (req: Request, a: any = auth) => A.handleAuthRequest(req, a);

  let n = 0;
  function seedUser(o: { email?: string; name?: string; secondStepAt?: boolean; twoFactor?: boolean; password?: boolean } = {}) {
    const email = o.email ?? `u${++n}-${Math.random().toString(36).slice(2, 7)}@qa.test`;
    const id = must(`INSERT INTO public."user" (name, email, email_verified) VALUES ('${o.name ?? 'QA User'}', '${email}', true) RETURNING id`, db).rows[0][0];
    if (o.password !== false) must(`INSERT INTO public.account (account_id, provider_id, user_id, password, updated_at) VALUES ('${id}', 'credential', '${id}', '${hash}', now())`, db);
    if (o.twoFactor) must(`UPDATE public."user" SET two_factor_enabled = true, second_step_at = now() WHERE id = '${id}'`, db);
    else if (o.secondStepAt) must(`UPDATE public."user" SET second_step_at = now() WHERE id = '${id}'`, db);
    return { id, email };
  }
  /** A real email+password sign-in; returns the Cookie header for later requests. */
  async function signIn(email: string, a: any = auth): Promise<{ cookie: string; res: Response }> {
    const res = await handle(post('/sign-in/email', { email, password: PW }), a);
    return { cookie: jar('', res), res };
  }
  /** A Cookie header for a session row inserted directly (an enrolled user cannot finish /sign-in/email: it is held). Name and
   *  prefix are read from a real sign-in; the value is better-call's signed form: encodeURIComponent(token.base64(hmac-sha256)). */
  async function cookieForToken(token: string, a: any = auth): Promise<string> {
    const probe = seedUser();
    const { res } = await signIn(probe.email, a);
    const name = res.headers.getSetCookie().map((c) => c.split('=')[0]).find((n) => /session_token/.test(n))!;
    return `${name}=${encodeURIComponent(`${token}.${createHmac('sha256', SECRET).update(token).digest('base64')}`)}`;
  }
  /** Google, stubbed at the network edge only: the token endpoint answers with an unsigned id_token for `email`. */
  async function oauth(email: string, a: any, verified = true) {
    const real = globalThis.fetch;
    const idt = ['{"alg":"none"}', JSON.stringify({ sub: `sub-${email}`, email, email_verified: verified, name: 'Oauth Person', iss: 'https://accounts.google.com', aud: 'qa-google' })]
      .map((x) => Buffer.from(x).toString('base64url')).join('.') + '.';
    vi.stubGlobal('fetch', async (i: any, init?: any) => {
      const u = String(i?.url ?? i);
      if (/oauth2\.googleapis\.com\/token/.test(u)) return new Response(JSON.stringify({ access_token: 'at', id_token: idt, token_type: 'Bearer', expires_in: 3600 }), { headers: { 'content-type': 'application/json' } });
      if (/googleapis\.com/.test(u)) return new Response(JSON.stringify({ sub: `sub-${email}`, email, email_verified: verified, name: 'Oauth Person' }), { headers: { 'content-type': 'application/json' } });
      return real(i, init);
    });
    try {
      const start = await handle(post('/sign-in/social', { provider: 'google', callbackURL: '/' }), a);
      const cookie = jar('', start);
      const loc = (await start.clone().json().catch(() => ({})) as any).url ?? start.headers.get('location');
      const state = new URL(loc).searchParams.get('state')!;
      return await handle(get(`/callback/google?code=qa-code&state=${state}`, cookie), a);
    } finally { vi.stubGlobal('fetch', real); }
  }
  const sessionRow = (cookieEmail: string) =>
    must(`SELECT s.id, s.token FROM public.session s JOIN public."user" u ON u.id = s.user_id WHERE u.email = '${cookieEmail}' ORDER BY s.created_at DESC LIMIT 1`, db).rows[0];
  const count = (sql: string) => Number(must(`SELECT count(*) FROM (${sql}) q`, db).rows[0][0]);
  return { db, dbm, dba, dbs, A, auth, mk, input, optionsOf, mails, handle, seedUser, signIn, cookieForToken, oauth, sessionRow, count, hash };
}

export async function teardown(e?: Env) {
  await e?.dbm?.close?.();
  await e?.dba?.close?.();
  await closeSql();
}
