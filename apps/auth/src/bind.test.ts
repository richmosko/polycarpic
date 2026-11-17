// POLY-152 R6.2 (seceng §5.1, E2): the internal listener binds only to the service's address on the web–auth network, or to a Unix
// socket on a volume that only web and auth mount; never 0.0.0.0 or ::. internalBind(env) returns { host } or { path }.
import { describe, expect, it } from 'vitest';

// The module is loaded OUTSIDE the refusal catch, so a missing file is a red test, never a vacuous "refused".
const load = async (): Promise<(env: Record<string, string>) => { host?: string; socket?: string; port?: number }> => ((await import('./bind.ts')) as any).internalBind;
const bind = async (env: Record<string, string>) => (await load())(env);
const refuses = async (env: Record<string, string>) => { const f = await load(); try { f(env); return null; } catch (e) { return e as Error; } };

describe('the internal bind', () => {
  it('a concrete network address is accepted and returned as given [red if: bind.ts is absent]', async () => {
    const b = await bind({ AUTH_INTERNAL_HOST: '10.201.2.5', AUTH_INTERNAL_PORT: '3001' });
    expect(b.host).toBe('10.201.2.5');
  });
  it('a Unix socket path is accepted, returned as { path } [red if: sockets are not supported]', async () => {
    expect((await bind({ AUTH_INTERNAL_SOCKET: '/run/auth/internal.sock' })).path).toBe('/run/auth/internal.sock');
  });
  for (const h of ['0.0.0.0', '::', '::0', '', '[::]', '0000:0000:0000:0000:0000:0000:0000:0000']) {
    it(`host ${JSON.stringify(h)} is refused at startup [red if: a wildcard or unresolved name can be bound]`, async () => {
      expect(await refuses({ AUTH_INTERNAL_HOST: h, AUTH_INTERNAL_PORT: '3001' })).not.toBeNull();
    });
  }
  it('no host and no socket is refused: there is no default bind [red if: it defaults to all interfaces]', async () => {
    expect(await refuses({ AUTH_INTERNAL_PORT: '3001' })).not.toBeNull();
  });
  it('the internal port may not equal the public port [red if: the two listeners can collide]', async () => {
    expect(await refuses({ AUTH_INTERNAL_HOST: '10.201.2.5', AUTH_INTERNAL_PORT: '3000', AUTH_PUBLIC_PORT: '3000' })).not.toBeNull();
  });
});
