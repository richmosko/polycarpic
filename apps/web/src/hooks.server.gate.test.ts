// POLY-89 build review N5 (seceng): the sign-in gate's 303 to /settings/second-step must carry the refreshed session cookie, so a gated
// user's session is extended like any other. Titles end with [red if: <mutation>].
import { describe, expect, it, vi } from 'vitest';

const REFRESHED = 'poly_session_token=refreshed.abc; Path=/; HttpOnly; Secure; SameSite=Lax';
let required = true;
vi.mock('@poly/auth', () => ({
  handleAuthRequest: async () => new Response(null),
  matchAuthPath: () => null,
  loadSession: async () => ({
    userId: 'u', sessionId: 's', shell: { name: 'Gated' }, setCookie: [REFRESHED], secondStepRequired: required,
  }),
}));
vi.mock('./lib/server/auth.ts', () => ({ startAuth: () => {} }));

const { handle } = await import('./hooks.server.ts');

async function request(path: string): Promise<Response> {
  const url = new URL(`https://app.qa.test${path}`);
  const event = { url, request: new Request(url), locals: {}, cookies: { get: () => undefined } };
  const resolve = async () => new Response('page');
  return (handle as (a: unknown) => Promise<Response>)({ event, resolve });
}

describe('the sign-in gate (R5)', () => {
  it('a gated user\'s 303 to /settings/second-step still carries the refreshed session cookie [red if: the redirect is returned before loaded.setCookie is appended (N5)]', async () => {
    required = true;
    const res = await request('/dashboard');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/settings/second-step');
    expect(res.headers.getSetCookie()).toEqual([REFRESHED]);
  });
  it('an ungated page still carries it, and the placeholder itself is not redirected [red if: the fix breaks the pass-through]', async () => {
    required = true;
    const placeholder = await request('/settings/second-step');
    expect(placeholder.status).toBe(200);
    expect(placeholder.headers.getSetCookie()).toEqual([REFRESHED]);
    required = false;
    const dash = await request('/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.headers.getSetCookie()).toEqual([REFRESHED]);
  });
});
