import type { Handle } from '@sveltejs/kit/hooks';

export const handle: Handle = ({ event, resolve }) => {
  const stored = event.cookies.get('poly-theme');
  const theme = stored === 'dark' ? 'dark' : stored === 'auto' ? 'auto' : '';
  // shadcn's `sidebar:state` cookie holds the open state: exactly "false" means collapsed.
  const sidebar = event.cookies.get('sidebar:state') === 'false' ? 'collapsed' : 'expanded';
  return resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace('%poly.theme%', theme).replace('%poly.sidebar%', sidebar),
  });
};
