import { HttpError, loadSession, setAuthInternalOrigin } from '@poly/auth/web';
import { loadConfig } from '@poly/config';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';

export const init: ServerInit = () => {
  // The sign-in service's internal listener (POLY-152 R6.2). Web holds no BetterAuth instance and no secret.
  setAuthInternalOrigin(loadConfig('web').authInternalOrigin);
};

const notFound = () => new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
const isAuthTree = (p: string) => p === '/api/auth' || p.startsWith('/api/auth/');
const isPublic = (p: string) => p === '/sign-in' || p.startsWith('/sign-in/') || p === '/sign-up' || p === '/healthz';

/** next is honoured only as a path on this origin: '/x', never '//x' or '/\x' (S12). */
const safeNext = (path: string) => (path.startsWith('/') && path[1] !== '/' && path[1] !== '\\' ? path : '/');

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;

  // The look follows the poly-theme cookie; only dark or auto ever reach the page.
  const stored = event.cookies.get('poly-theme');
  const look = stored === 'dark' ? 'dark' : stored === 'auto' ? 'auto' : '';
  // shadcn's `sidebar:state` cookie holds the open state: exactly "false" means collapsed.
  const sidebar = event.cookies.get('sidebar:state') === 'false' ? 'collapsed' : 'expanded';
  const page = () =>
    resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%poly.theme%', look).replace('%poly.sidebar%', sidebar),
    });

  // The /api/auth tree belongs to the sign-in service; Caddy routes it there and web refuses it, listed or not (POLY-152 R1.6).
  if (isAuthTree(pathname)) return notFound();
  if (isPublic(pathname)) return page();

  let loaded;
  try {
    loaded = await loadSession(event.request);
  } catch (e) {
    // The service is unreachable or answered oddly: never a redirect to /sign-in, which would read as signed out (R6.2).
    if (e instanceof HttpError && e.status === 503) return new Response('Sign-in service unavailable', { status: 503, headers: { 'retry-after': '5' } });
    throw e;
  }
  if (!loaded) {
    const to = new URLSearchParams({ next: safeNext(pathname + search) });
    return new Response(null, { status: 303, headers: { location: `/sign-in?${to}` } });
  }
  // The sign-in gate (POLY-89 R5): while the database says a second step is required, every page but the placeholder redirects to it.
  if (loaded.secondStepRequired && pathname !== '/settings/second-step') {
    return new Response(null, { status: 303, headers: { location: '/settings/second-step' } });
  }
  event.locals.session = loaded.shell;
  event.locals.identity = { userId: loaded.userId, sessionId: loaded.sessionId };
  return page();
};
