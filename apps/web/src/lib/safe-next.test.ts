// POLY-150 R1 (S22): `next` is honoured only as a path on this origin. One module, imported by hooks, the set-up page's load and both
// sign-in pages. Titles end [red if: ...]. Red today: the rule lives inside hooks.server.ts and the module does not exist.
import { describe, expect, it } from 'vitest';

const load = async (): Promise<{ safeNext: (v: unknown) => string }> => (await import('./safe-next.ts')) as never;

describe('safeNext (R1)', () => {
  it.each(['//x', '/\\x', 'https://x', 'http://evil.test/', 'javascript:x', '%2F%2Fx', '', undefined, null, 'x'])('%j gives / [red if: an off-origin or malformed value is honoured]', async (v) => {
    expect((await load()).safeNext(v)).toBe('/');
  });
  it.each(['/dashboard', '/settings/second-step', '/a?b=c', '/a#d'])('%s passes unchanged [red if: a plain path on this origin is rewritten]', async (v) => {
    expect((await load()).safeNext(v)).toBe(v);
  });
});
