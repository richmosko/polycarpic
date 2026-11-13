// POLY-87 C6: "/" sends a signed-in user to /dashboard?entity=<landing entity> (ruling R3 step 6). Titles end with [red if: ...].
// ASSUMED: load({ locals: { identity: { userId, sessionId } } }) runs landingEntity(tx) from @poly/tenancy inside withTenant
// from @poly/db and throws SvelteKit's redirect; both packages are replaced here, the redirect is the real one.
import { describe, expect, it, vi } from 'vitest';

const ENTITY = '00000000-0000-4000-8000-0000000000e1';
const seen: { userId?: string; sessionId?: string } = {};
vi.mock('@poly/db', async (orig) => ({
  ...((await orig()) as object),
  withTenant: async (userId: string, sessionId: string, fn: (tx: unknown) => unknown) => { seen.userId = userId; seen.sessionId = sessionId; return fn({}); },
}));
vi.mock('@poly/tenancy', async (orig) => ({ ...((await orig()) as object), landingEntity: async () => ENTITY }));

describe('root +page.server load', () => {
  it('redirects a signed-in user to /dashboard?entity=<landing entity>  [red if: the redirect drops the entity, or ignores locals.identity]', async () => {
    const { load } = await import('./+page.server.ts');
    const identity = { userId: '00000000-0000-4000-8000-0000000000a1', sessionId: '00000000-0000-4000-8000-0000000000b1' };
    let thrown: any;
    try { await (load as (e: unknown) => unknown)({ locals: { identity } }); } catch (x) { thrown = x; }
    expect(thrown?.status, 'a SvelteKit redirect was thrown').toBeGreaterThanOrEqual(300);
    expect(thrown?.location).toBe(`/dashboard?entity=${ENTITY}`);
    expect(seen).toEqual(identity);
  });
});
