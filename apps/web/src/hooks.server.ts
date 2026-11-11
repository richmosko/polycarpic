import type { Handle } from '@sveltejs/kit/hooks';

export const handle: Handle = ({ event, resolve }) => {
  const theme = event.cookies.get('poly-theme') === 'dark' ? 'dark' : 'light';
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%poly.theme%', theme),
  });
};
