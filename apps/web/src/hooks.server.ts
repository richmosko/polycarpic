import type { Handle } from '@sveltejs/kit/hooks';

export const handle: Handle = ({ event, resolve }) => {
  const stored = event.cookies.get('poly-theme');
  const theme = stored === 'dark' ? 'dark' : stored === 'auto' ? 'auto' : '';
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%poly.theme%', theme),
  });
};
