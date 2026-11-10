// Teeth for the harness itself: a canary that cannot fail is not a canary.
import { describe, expect, it } from 'vitest';
import { CANARIES, assertNoCanary } from './canary.ts';

describe('assertNoCanary', () => {
  it('passes clean text', () => expect(() => assertNoCanary('{"event":"a.b"}')).not.toThrow());
  for (const [k, v] of Object.entries(CANARIES)) {
    it(`catches ${k}, whole`, () => expect(() => assertNoCanary(`x ${v} y`)).toThrow(/canary leaked/));
  }
  it('catches a fragment (a URL cut at the password)', () => expect(() => assertNoCanary('…QACANARYpw@…')).toThrow(/canary leaked/));
  it('does not echo the surrounding text', () => {
    try {
      assertNoCanary(`SECRETCONTEXT ${CANARIES.token}`);
    } catch (e) {
      expect(String(e)).not.toMatch(/SECRETCONTEXT/);
    }
  });
});
