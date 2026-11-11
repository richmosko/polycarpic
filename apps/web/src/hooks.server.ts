import { handleAuthRequest, loadSession, matchAuthPath } from '@poly/auth';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { startAuth } from './lib/server/auth.ts';

export const init: ServerInit = () => {
  startAuth();
};

const notFound = () => new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
const isAuthTree = (p: string) => p === '/api/auth' || p.startsWith('/api/auth/');
const isPublic = (p: string) => p === '/sign-in' || p.startsWith('/sign-in/') || p === '/healthz';

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

  if (isAuthTree(pathname)) {
    // Unlisted and blocked paths are 404 here, before BetterAuth is reached (SECURITY A-34, A-38).
    const hit = matchAuthPath(pathname);
    if (!hit || hit.rule.class === 'blocked') return notFound();
    return handleAuthRequest(event.request);
  }
  if (isPublic(pathname)) return page();

  const loaded = await loadSession(event.request);
  if (!loaded) {
    const to = new URLSearchParams({ next: safeNext(pathname + search) });
    return new Response(null, { status: 303, headers: { location: `/sign-in?${to}` } });
  }
  event.locals.session = loaded.shell;
  event.locals.identity = { userId: loaded.userId, sessionId: loaded.sessionId };
  const res = await page();
  for (const c of loaded.setCookie) res.headers.append('set-cookie', c);
  return res;
};
