// POLY-87 C6: "/" sends a signed-in user to /dashboard?entity=<landing entity> (ruling R3 step 6). Titles end with [red if: ...].
// POLY-153 R7.2: load({ locals: { handle } }) runs landingEntity(tx) from @poly/tenancy inside withSession(handle) from @poly/db and
// throws SvelteKit's redirect; both packages are replaced here, the redirect is the real one. locals.identity and withTenant are gone.
import { describe, expect, it, vi } from 'vitest';

const ENTITY = '00000000-0000-4000-8000-0000000000e1';
const seen: { handle?: string } = {};
vi.mock('@poly/db', async (orig) => ({
  ...((await orig()) as object),
  withSession: async (handle: string, fn: (tx: unknown, row: unknown) => unknown) => { seen.handle = handle; return fn({}, {}); },
}));
vi.mock('@poly/tenancy', async (orig) => ({ ...((await orig()) as object), landingEntity: async () => ENTITY }));

describe('root +page.server load', () => {
  it('redirects a signed-in user to /dashboard?entity=<landing entity> by the handle  [red if: the redirect drops the entity, or ignores locals.handle]', async () => {
    const { load } = await import('./+page.server.ts');
    const handle = 'p'.repeat(43);
    let thrown: any;
    try { await (load as (e: unknown) => unknown)({ locals: { handle } }); } catch (x) { thrown = x; }
    expect(thrown?.status, 'a SvelteKit redirect was thrown').toBeGreaterThanOrEqual(300);
    expect(thrown?.location).toBe(`/dashboard?entity=${ENTITY}`);
    expect(seen.handle).toBe(handle);
  });
  it('with no handle on locals it does not enter and falls through to /dashboard without an entity  [red if: it calls withSession with undefined]', async () => {
    seen.handle = undefined;
    const { load } = await import('./+page.server.ts');
    let thrown: any;
    try { await (load as (e: unknown) => unknown)({ locals: {} }); } catch (x) { thrown = x; }
    expect(seen.handle).toBeUndefined();
    expect(thrown?.location ?? '').toMatch(/^\/dashboard/);
    expect(thrown?.location ?? '').not.toContain('entity=');
  });
});
