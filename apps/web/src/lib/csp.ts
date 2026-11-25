// SECURITY C-07's directives, once (POLY-161 R15). vite.config.ts hands them to Kit, which adds its nonces and hashes;
// server.ts sets the same policy as the default header, so an answer Kit does not build (its static 500 page) still carries it.
export const CSP_DIRECTIVES = {
  'default-src': ['self'],
  'script-src': ['self'],
  'style-src': ['self', 'unsafe-inline'],
  'img-src': ['self', 'data:'],
  'font-src': ['self'],
  'connect-src': ['self'],
  'object-src': ['none'],
  'base-uri': ['self'],
  'form-action': ['self'],
  'frame-ancestors': ['none'],
} as const;

const KEYWORDS = new Set(['self', 'none', 'unsafe-inline', 'unsafe-eval']);
const quote = (v: string): string => (KEYWORDS.has(v) ? `'${v}'` : v);

export const CSP_HEADER: string = Object.entries(CSP_DIRECTIVES)
  .map(([name, values]) => `${name} ${values.map(quote).join(' ')}`)
  .join('; ');
