// POLY-153 R9: the internal listener is removed, so its bind is too. bind.ts keeps only the public port; internalBind and the
// AUTH_INTERNAL_* variables are gone (POLY-152 R6.2's wildcard and socket tests go with them).
import { describe, expect, it } from 'vitest';

const load = async (): Promise<Record<string, unknown>> => (await import('./bind.ts')) as Record<string, unknown>;

describe('the bind after R9', () => {
  it('internalBind is no longer exported [red if: the internal listener\'s bind survives]', async () => {
    expect((await load()).internalBind).toBeUndefined();
  });
  it('publicPort still reads AUTH_PUBLIC_PORT, defaults to 3000 and refuses a bad value [red if: the public bind regressed in the removal]', async () => {
    const m = (await load()) as { publicPort: (e: Record<string, string | undefined>) => number };
    expect(m.publicPort({})).toBe(3000);
    expect(m.publicPort({ AUTH_PUBLIC_PORT: '3100' })).toBe(3100);
    expect(() => m.publicPort({ AUTH_PUBLIC_PORT: '70000' })).toThrow();
  });
  it('bind.ts mentions no AUTH_INTERNAL variable [red if: any internal bind variable is still read]', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(new URL('./bind.ts', import.meta.url), 'utf8')).not.toMatch(/AUTH_INTERNAL/);
  });
});
