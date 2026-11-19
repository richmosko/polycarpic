// POLY-89 build review N5 (seceng), retargeted by POLY-152 R7 and POLY-153 R7.2 (the gate runs in the handle's session transaction): the sign-in gate's 303 to /settings/second-step. Web relays no cookie any
// more (the service re-sets nothing on a page load; the row is the idle bound), so neither the redirect nor the page carries a Set-Cookie.
// Titles end with [red if: <mutation>].
import { describe, expect, it, vi } from 'vitest';

let required = true;
const HANDLE = 'g'.repeat(43);
vi.mock('@poly/db', async (orig) => ({
  ...((await orig()) as object),
  withSession: async (_h: string, fn: (tx: unknown, shell: unknown) => unknown) =>
    fn({ execute: async () => ({ rows: [{ r: required }] }) }, { userId: 'u', sessionId: 's', name: 'Gated', image: null, expiresAt: '2030-01-01T00:00:00Z' }),
  NoLiveSession: class extends Error {},
}));
vi.mock('@poly/tenancy', async (orig) => ({ ...((await orig()) as object), provisionPerson: async () => undefined }));

const { handle } = await import('./hooks.server.ts');

async function request(path: string): Promise<Response> {
  const url = new URL(`https://app.qa.test${path}`);
  const event = { url, request: new Request(url), locals: {}, cookies: { get: (n: string) => (n === '__Host-poly_handle' ? HANDLE : undefined), set: () => {}, delete: () => {} } };
  const resolve = async () => new Response('page');
  return (handle as (a: unknown) => Promise<Response>)({ event, resolve });
}

describe('the sign-in gate (R5)', () => {
  it('a gated user is redirected 303 to /settings/second-step, and the redirect sets no cookie [red if: the gate is gone, or web relays a cookie]', async () => {
    required = true;
    const res = await request('/dashboard');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/settings/second-step');
    expect(res.headers.getSetCookie()).toEqual([]);
  });
  it('the placeholder itself is not redirected while gated, an ungated user reaches any page, and neither answer sets a cookie [red if: the gate loops or relays a cookie]', async () => {
    required = true;
    const placeholder = await request('/settings/second-step');
    expect(placeholder.status).toBe(200);
    expect(placeholder.headers.getSetCookie()).toEqual([]);
    required = false;
    const dash = await request('/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.headers.getSetCookie()).toEqual([]);
  });
});
