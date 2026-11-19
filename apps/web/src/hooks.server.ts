import { createLogger } from '@poly/config/log';
import { NoLiveSession, sql, withSession } from '@poly/db';
import { provisionPerson } from '@poly/tenancy';
import type { Handle } from '@sveltejs/kit/hooks';
import { safeNext } from './lib/safe-next';

// POLY-153 R7.2: web enters a transaction only by the handle cookie. BetterAuth's cookies are scoped to /api/auth and never reach it.
const HANDLE_COOKIE = '__Host-poly_handle';
const log = createLogger({ service: 'web' });

const isSelfUniqueRace = (e: unknown): boolean => {
  for (let cur: unknown = e, n = 0; cur && typeof cur === 'object' && n < 5; cur = (cur as { cause?: unknown }).cause, n++) {
    const p = cur as { code?: unknown; constraint?: unknown };
    if (typeof p.code === 'string') return p.code === '23505' && p.constraint === 'entity_self_user_id_unique';
  }
  return false;
};

/**
 * One transaction under a `session` marker: the user's own Person on first load (named from the row enter_session returned, so web's
 * SQL names no BetterAuth table), then the sign-in gate. A NoLiveSession (a dead handle) is thrown as is.
 */
async function enter(handle: string) {
  const once = () =>
    withSession(handle, async (tx, row) => {
      const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name : 'Person';
      await provisionPerson(tx, name);
      const gate = await tx.execute<{ r: boolean }>(sql`SELECT app.second_step_required() AS r`);
      return {
        shell: { user: { id: row.userId, name, image: row.image ?? null }, expiresAt: new Date(row.expiresAt).toISOString() },
        secondStepRequired: gate.rows[0]?.r === true,
      };
    });
  try {
    return await once();
  } catch (e) {
    if (!isSelfUniqueRace(e)) throw e;
    try {
      return await once(); // the whole transaction again, fresh; it finds the winner's Person
    } catch (again) {
      log.error('session.provision_failed', { outcome: 'error', err: again });
      throw again;
    }
  }
}

const notFound = () => new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
const isAuthTree = (p: string) => p === '/api/auth' || p.startsWith('/api/auth/');
const isPublic = (p: string) => p === '/sign-in' || p.startsWith('/sign-in/') || p === '/sign-up' || p === '/healthz';

const SETUP_PATH = '/settings/second-step';
const SETUP_PATHS = new Set([SETUP_PATH, `${SETUP_PATH}/__data.json`]);

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;

  // The look follows the poly-theme cookie; only dark or auto ever reach the page.
  const stored = event.cookies.get('poly-theme');
  const look = stored === 'dark' ? 'dark' : stored === 'auto' ? 'auto' : '';
  // shadcn's `sidebar:state` cookie holds the open state: exactly "false" means collapsed.
  const sidebar = event.cookies.get('sidebar:state') === 'false' ? 'collapsed' : 'expanded';
  const render = () =>
    resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%poly.theme%', look).replace('%poly.sidebar%', sidebar),
    });
  const page = () => render();
  // R10: a signed-in page or its __data.json is never storable, so a page that mounts the set-up dialog cannot come back from a cache.
  const signedInPage = async () => {
    const res = await render();
    res.headers.set('cache-control', 'no-store');
    return res;
  };

  // The /api/auth tree belongs to the sign-in service; Caddy routes it there and web refuses it, listed or not (POLY-152 R1.6).
  if (isAuthTree(pathname)) return notFound();
  if (isPublic(pathname)) return page();

  const signIn = () => new Response(null, { status: 303, headers: { location: `/sign-in?${new URLSearchParams({ next: safeNext(pathname + search) })}` } });
  const handleValue = event.cookies.get(HANDLE_COOKIE);
  if (!handleValue) return signIn();
  let entered;
  try {
    entered = await enter(handleValue);
  } catch (e) {
    if (e instanceof NoLiveSession) {
      // A dead handle: clear the cookie so the browser does not look signed in, and go to sign-in.
      event.cookies.delete(HANDLE_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
      return signIn();
    }
    throw e;
  }
  // The sign-in gate (POLY-89 R5, POLY-150 R1.3): while the database says a second step is required, every page redirects to the Settings panel
  // (where the set-up dialog opens) except exactly two paths: that page and its __data.json. Never a prefix: the rest of /settings stays gated.
  if (entered.secondStepRequired && !SETUP_PATHS.has(pathname)) {
    return new Response(null, { status: 303, headers: { location: `${SETUP_PATH}?setup=1` } });
  }
  event.locals.session = entered.shell;
  event.locals.handle = handleValue;
  event.locals.secondStepRequired = entered.secondStepRequired;
  return signedInPage();
};
