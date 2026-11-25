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

// POLY-161 R13 (addendum 1; seceng B1): control code points, a fixed-origin resolve and a resolved `//` path. Each rule has a row only it can
// refuse, so a rule dropped in turn is red (verdict B33). Red today: the module passes a control followed by `/evil.example`, and `/x/..//evil.example`.
const ctl = (n: number) => String.fromCharCode(n);
const CONTROLS = [...Array.from({ length: 32 }, (_, i) => i), 0x7f];
describe('safeNext (R13)', () => {
  it.each([
    ['tab then /evil.example', `/${ctl(9)}/evil.example`],
    ['LF then /evil.example', `/${ctl(10)}/evil.example`],
    ['CR then /evil.example', `/${ctl(13)}/evil.example`],
    ['tab then \\evil.example', `/${ctl(9)}\\evil.example`],
    ['LF then \\evil.example', `/${ctl(10)}\\evil.example`],
    ['CR then \\evil.example', `/${ctl(13)}\\evil.example`],
    ['NUL then /evil.example', `/${ctl(0)}/evil.example`],
    ['dot-dot to a // path', '/x/..//evil.example'],
    ['dot then backslash', '/./\\evil.example'],
    ['//x', '//x'],
    ['/\\x', '/\\x'],
  ])('%s gives / [red if: the value resolves off our origin or to a // path in a browser]', async (_n, v) => {
    expect((await load()).safeNext(v)).toBe('/');
  });

  it.each(CONTROLS)('control code point %i in second, later and last positions gives / [red if: the control rule is dropped or position-limited]', async (c) => {
    const { safeNext } = await load();
    for (const v of [`/${ctl(c)}a`, `/a${ctl(c)}b`, `/a/b${ctl(c)}`, `/a?q=1${ctl(c)}`, `/a#f${ctl(c)}`]) expect(safeNext(v), JSON.stringify(v)).toBe('/');
  });

  // Rows only one rule can refuse: dropping that rule alone turns exactly its row green.
  it('control rule alone: a control inside a plain path, which the origin and // rules both pass [red if: control rule dropped]', async () => {
    expect((await load()).safeNext(`/a${ctl(9)}b`)).toBe('/');
  });
  it('origin rule alone: `/\\evil.example` has no control and no // path in the input [red if: fixed-origin resolve dropped]', async () => {
    expect((await load()).safeNext('/\\evil.example')).toBe('/');
  });
  it('// path rule alone: `/x/..//evil.example` stays on our origin and has no control [red if: resolved-pathname rule dropped]', async () => {
    expect((await load()).safeNext('/x/..//evil.example')).toBe('/');
  });

  it.each(['/dashboard', '/a?b=c', '/a#d', '/a?n=//evil.example', '/%09/evil.example', '/%2f/evil.example', '/@x', '/%', '/'])('%s passes unchanged [red if: a plain path is rewritten or over-refused]', async (v) => {
    expect((await load()).safeNext(v)).toBe(v);
  });
  it.each([null, undefined, 5, {}, ['/a'], '', 'x', 'https://x'])('%j gives / [red if: the type or the leading slash is not checked]', async (v) => {
    expect((await load()).safeNext(v)).toBe('/');
  });
});
