// POLY-137 R8 row "/API/AUTH/...": the sign-in service's public listener tests the raw pathname, so a case variant of the tree is 404 and
// never reaches handleAuthRequest. Pure. Titles end [red if: <mutation>].
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ handle: vi.fn(async () => new Response('auth', { status: 200 })) }));
vi.mock('@poly/auth', () => ({ handleAuthRequest: h.handle }));
import { handlePublic } from './public.ts';

describe('handlePublic on the raw pathname', () => {
  for (const p of ['/API/AUTH/get-session', '/Api/Auth/list-sessions', '/api/AUTH/sign-in/email', '/API/auth']) {
    it(`${p} answers 404 and BetterAuth is never called  [red if: the prefix test lower-cases or decodes first]`, async () => {
      h.handle.mockClear();
      const res = await handlePublic(new Request(`https://app.qa.test${p}`), {} as never);
      expect(res.status).toBe(404);
      expect(h.handle).not.toHaveBeenCalled();
    });
  }
  it('/api/auth/ok reaches the handler, so the 404s above are not a dead listener  [red if: the listener refuses everything]', async () => {
    h.handle.mockClear();
    expect((await handlePublic(new Request('https://app.qa.test/api/auth/ok'), {} as never)).status).toBe(200);
    expect(h.handle).toHaveBeenCalledTimes(1);
  });
});
