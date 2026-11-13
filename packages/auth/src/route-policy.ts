// The allowlist over /api/auth/* (ARCH §3.1c, SECURITY A-34, A-38; POLY-86 ruling R3). Every HTTP route better-auth 1.7.18 and
// @better-auth/passkey 1.7.18 expose with core, twoFactor, magicLink and passkey is in exactly one class. A path not in the map
// answers 404, the same answer a blocked path gives. The hook is built from the map; the SvelteKit handle uses the same matcher.
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { currentClient, currentTx } from '@poly/db/auth';
import { claimInvitation, decodeInvitationToken, InvitationRequired } from '@poly/tenancy';
import { requireRecentAuth } from './recent-auth.ts';
import { invitationRequired } from './user-hooks.ts';

export type RouteClass = 'open' | 'enrolment' | 'step-up' | 'blocked';
export type Rule = { class: RouteClass; insertsUser?: true; realDomainOnly?: true; whenSession?: RouteClass | 'refused' };
export type TlsMode = 'real-domain' | 'private-ca';

const open = (extra: Omit<Rule, 'class'> = {}): Rule => ({ class: 'open', ...extra });
const enrolment: Rule = { class: 'enrolment' };
const stepUp = (extra: Omit<Rule, 'class'> = {}): Rule => ({ class: 'step-up', ...extra });
const blocked: Rule = { class: 'blocked' };

export const AUTH_ROUTES: Readonly<Record<string, Rule>> = {
  '/ok': open(),
  '/error': open(),
  '/sign-in/email': open(),
  '/sign-in/social': open({ realDomainOnly: true }),
  '/callback/:id': open({ insertsUser: true, realDomainOnly: true }),
  '/sign-in/magic-link': open(),
  '/magic-link/verify': open({ insertsUser: true }),
  '/sign-up/email': open({ insertsUser: true }),
  '/sign-out': open(),
  '/two-factor/verify-totp': open({ whenSession: 'enrolment' }),
  '/two-factor/verify-backup-code': open({ whenSession: 'refused' }),
  '/passkey/generate-authenticate-options': open(),
  '/passkey/verify-authentication': open(),
  '/verify-email': open(),
  '/send-verification-email': open(),
  '/request-password-reset': open(),
  '/reset-password/:token': open(),
  '/reset-password': open(),
  '/change-password': open(),
  '/update-user': open(),
  '/revoke-sessions': open(),
  '/list-accounts': open(),
  '/passkey/list-user-passkeys': open(),
  '/passkey/update-passkey': open(),
  '/two-factor/enable': enrolment,
  '/passkey/generate-register-options': enrolment,
  '/passkey/verify-registration': enrolment,
  '/passkey/delete-passkey': stepUp(),
  '/two-factor/disable': stepUp(),
  '/two-factor/generate-backup-codes': stepUp(),
  '/unlink-account': stepUp(),
  '/link-social': stepUp({ realDomainOnly: true }),
  '/change-email': stepUp(),
  '/revoke-other-sessions': stepUp(),
  '/list-sessions': blocked,
  '/revoke-session': blocked,
  '/get-session': blocked,
  '/two-factor/get-totp-uri': blocked,
  '/two-factor/send-otp': blocked,
  '/two-factor/verify-otp': blocked,
  '/delete-user': blocked,
  '/delete-user/callback': blocked,
  '/update-session': blocked,
  '/get-access-token': blocked,
  '/refresh-token': blocked,
  '/account-info': blocked,
  '/verify-password': blocked,
};

/** Every path that can insert a `user` row; the handler wraps these in withContextFreeTx (criterion 11). */
export const USER_INSERTING: ReadonlySet<string> = new Set(
  Object.entries(AUTH_ROUTES).filter(([, r]) => r.insertsUser).map(([p]) => p),
);

/** The credential paths that create a session on a single factor; the second-step hold covers exactly these (M1). */
export const SIGN_IN_PATHS: ReadonlySet<string> = new Set(['/sign-in/email', '/magic-link/verify', '/callback/:id']);

const TEMPLATES = Object.keys(AUTH_ROUTES).map((t) => ({ t, re: new RegExp('^' + t.replace(/:[A-Za-z]+/g, '[^/]+') + '$') }));

/** The listed template a request path (relative to /api/auth, as the router sees it) matches, or null. */
export function templateOf(path: string): string | null {
  return TEMPLATES.find(({ re }) => re.test(path))?.t ?? null;
}

/**
 * The template the router would dispatch a pathname to: percent-decoded, repeated '/' collapsed, trailing '/' dropped,
 * lower-cased (S7). Used by the SvelteKit handle to answer 404 before BetterAuth is reached. A path that decodes to
 * something with '..' or an encoded slash is refused outright.
 */
export function matchAuthPath(pathname: string): { template: string; rule: Rule } | null {
  if (pathname !== '/api/auth' && !pathname.startsWith('/api/auth/')) return null;
  let rest = pathname.slice('/api/auth'.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  rest = rest.replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
  if (rest === '' || rest.split('/').includes('..')) return null;
  const hit = templateOf(rest);
  return hit ? { template: hit, rule: AUTH_ROUTES[hit]! } : null;
}

/** Blocked and unlisted paths are 404 from the handle (HTTP only); private-CA mode also 404s the OAuth routes. */
export function refusedByHandle(pathname: string, tlsMode: TlsMode): boolean {
  const hit = matchAuthPath(pathname);
  if (!hit) return true;
  if (hit.rule.class === 'blocked') return true;
  return hit.rule.realDomainOnly === true && tlsMode === 'private-ca';
}

const notFound = () => new APIError('NOT_FOUND', { message: 'Not found' });
const forbidden = (code: string) => new APIError('FORBIDDEN', { code, message: code });

const REDIRECT_KEYS = ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL', 'redirectTo'] as const;

/** A redirect target is a path on our origin ('/x', never '//x' or '/\\x') or a URL whose origin is ours (S12). */
function ourOrigin(value: unknown, origin: string): boolean {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/')) return value[1] !== '/' && value[1] !== '\\';
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

interface Ctx {
  path: string;
  query?: Record<string, unknown>;
  context?: unknown;
  request?: Request;
  body?: Record<string, unknown>;
  [k: string]: unknown;
}

/** The one global hooks.before, built from AUTH_ROUTES. */
export function routePolicyHook(tlsMode: TlsMode) {
  return createAuthMiddleware(async (raw) => {
    const ctx = raw as unknown as Ctx;
    const rule = AUTH_ROUTES[ctx.path];
    if (!rule) throw notFound();
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    if (ctx.path === '/sign-in/social' && body.idToken !== undefined) throw new APIError('BAD_REQUEST', { message: 'idToken sign-in is not available' });
    if (rule.realDomainOnly && tlsMode === 'private-ca') throw notFound();
    if (rule.class === 'blocked') {
      if (ctx.request) throw notFound();
      return;
    }

    const origin = new URL((ctx.context as { options: { baseURL: string } }).options.baseURL).origin;
    // BetterAuth's own origin check only runs when cookies are present; a cross-origin state-changing request never passes (S12)
    const sent = ctx.request?.headers.get('origin');
    if (ctx.request && sent && !['GET', 'HEAD', 'OPTIONS'].includes(ctx.request.method) && sent !== origin) throw forbidden('invalid_origin');
    for (const src of [body, (ctx.query ?? {}) as Record<string, unknown>])
      for (const key of REDIRECT_KEYS) if (src[key] !== undefined && !ourOrigin(src[key], origin)) throw forbidden('invalid_redirect');
    if (ctx.path === '/sign-up/email') {
      // The same refusal for every cause (S8): a token that is not canonical, no transaction, no live row for token + email.
      const token = body.invitationToken;
      if (typeof token !== 'string' || decodeInvitationToken(token) === null) throw invitationRequired();
      const tx = currentClient()?.kind === 'withContextFreeTx' ? currentTx() : null;
      if (!tx) throw invitationRequired();
      try {
        await claimInvitation(tx, { email: String(body.email ?? ''), token });
      } catch (e) {
        if (e instanceof InvitationRequired) throw invitationRequired();
        throw e;
      }
    }
    if (ctx.path === '/update-user') {
      const extra = Object.keys(body).filter((k) => k !== 'name' && k !== 'image');
      if (extra.length > 0 || (body.image !== undefined && body.image !== null)) throw new APIError('BAD_REQUEST', { message: 'update-user accepts a name and a null image only' });
    }

    let cls: RouteClass | 'refused' = rule.class;
    if (rule.whenSession) {
      const s = await getSessionFromCtx(raw as never, { disableRefresh: true });
      if (s) cls = rule.whenSession;
    }
    if (cls === 'refused') throw forbidden('session_present');
    if (cls !== 'enrolment' && cls !== 'step-up') return;

    const session = await getSessionFromCtx(raw as never, { disableRefresh: true });
    if (!session) return; // BetterAuth's own session middleware answers 401
    const secondStepAt = (session.user as { secondStepAt?: Date | null }).secondStepAt;
    // Enrolment with no second step needs POLY-89's grant, which does not exist yet: nobody enrols (fails closed).
    if (cls === 'enrolment' && !secondStepAt) throw forbidden('second_step_required');
    await requireRecentAuth(session.session.id);
  });
}
