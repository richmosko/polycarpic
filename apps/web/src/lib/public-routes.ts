// The signed-out routes (POLY-161 R6): an exact set, never a prefix. A route that is not listed meets the sign-in guard.
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  '/api/v1/health',
  '/sign-in',
  '/sign-in/cancel-method',
  '/sign-in/forgot',
  '/sign-in/reset',
  '/sign-in/second-step',
  '/sign-up',
]);
