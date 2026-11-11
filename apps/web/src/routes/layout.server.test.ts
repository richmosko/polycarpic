// POLY-128 R4: the root layout's session projection carries no token (ARCH §3.1c).
import { describe, expect, it } from 'vitest';
import { load } from './+layout.server.ts';

const run = (locals: unknown) => (load as (e: unknown) => unknown)({ locals });

describe('root +layout.server load', () => {
  it('returns exactly { session: null } with no session  [red if: extra keys or undefined]', () => {
    expect(run({})).toEqual({ session: null });
    expect(Object.keys(run({}) as object)).toEqual(['session']);
  });
  it('projects only user{id,name,image} and expiresAt  [red if: a token, cookie, email or other field leaks]', () => {
    const session = {
      user: { id: 'u1', name: 'Ada', image: null, email: 'a@b.c' },
      expiresAt: '2030-01-01T00:00:00Z',
      token: 'secret',
      id: 'sess',
    };
    const out = run({ session }) as { session: Record<string, unknown> };
    expect(Object.keys(out)).toEqual(['session']);
    expect(Object.keys(out.session).sort()).toEqual(['expiresAt', 'user']);
    expect(Object.keys(out.session.user as object).sort()).toEqual(['id', 'image', 'name']);
    expect(JSON.stringify(out)).not.toMatch(/secret|a@b\.c|sess"/);
  });
});
