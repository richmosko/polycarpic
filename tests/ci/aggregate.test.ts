// POLY-96 criterion 1 -- the `app` aggregate, infra/ci/aggregate.mjs (ruling §1).
// Contract: env NEEDS = toJSON(needs) = {<job>: {result, outputs}}; exit 0 = green, non-zero = red.
// Output -> keyed job: node->unit, layers->lint, ci->lint, image->image, db->db.
import { describe, expect, it } from 'vitest';
import { node } from './helpers.ts';

type Needs = Record<string, { result: string; outputs: Record<string, string> }>;
const OUT = ['node', 'layers', 'db', 'image', 'ci'];
const base = (on: string[] = []): Needs => ({
  changes: { result: 'success', outputs: Object.fromEntries(OUT.map((k) => [k, String(on.includes(k))])) },
  guard: { result: 'success', outputs: {} },
  lint: { result: 'skipped', outputs: {} }, unit: { result: 'skipped', outputs: {} },
  db: { result: 'skipped', outputs: {} }, image: { result: 'skipped', outputs: {} },
});
const set = (n: Needs, job: string, result: string): Needs => ({ ...n, [job]: { ...n[job]!, result } });
const agg = (needs: unknown, raw?: string) => node('aggregate.mjs', { env: { NEEDS: raw ?? JSON.stringify(needs) } }).code;

describe('aggregate.mjs', () => {
  it('docs-only: changes+guard succeed, all else skipped -> green  [red if: skipped treated as failure]', () => {
    expect(agg(base())).toBe(0);
  });
  it('all jobs succeeded with every output true -> green', () => {
    let n = base(OUT);
    for (const j of ['lint', 'unit', 'db', 'image']) n = set(n, j, 'success');
    expect(agg(n)).toBe(0);
  });
  it('changes failed (filter error) -> red  [red if: changes result ignored; criterion 1 fail-closed]', () => {
    expect(agg(set(base(), 'changes', 'failure'))).not.toBe(0);
  });
  it('changes skipped -> red', () => { expect(agg(set(base(), 'changes', 'skipped'))).not.toBe(0); });
  it('guard failed -> red  [red if: guard not required]', () => { expect(agg(set(base(), 'guard', 'failure'))).not.toBe(0); });
  it('guard skipped -> red  [red if: guard may be skipped]', () => { expect(agg(set(base(), 'guard', 'skipped'))).not.toBe(0); });
  for (const j of ['lint', 'unit', 'db', 'image']) {
    it(`${j} failure -> red`, () => { expect(agg(set(base(), j, 'failure'))).not.toBe(0); });
    it(`${j} cancelled -> red  [red if: only 'failure' is rejected]`, () => { expect(agg(set(base(), j, 'cancelled'))).not.toBe(0); });
  }
  const keyed: [string, string][] = [['node', 'unit'], ['layers', 'lint'], ['ci', 'lint'], ['image', 'image'], ['db', 'db']];
  for (const [out, job] of keyed) {
    it(`output ${out}=true but ${job} skipped -> red (mis-wired if:)  [red if: output->job check removed or mapped wrong]`, () => {
      expect(agg(base([out]))).not.toBe(0);
    });
    it(`output ${out}=true and ${job} success -> green`, () => {
      expect(agg(set(base([out]), job, 'success'))).toBe(0);
    });
  }
  it('unknown result string -> red', () => { expect(agg(set(base(), 'lint', 'weird'))).not.toBe(0); });
  it('a needed job missing from NEEDS -> red', () => {
    const n = base();
    delete n.unit;
    expect(agg(n)).not.toBe(0);
  });
  it('NEEDS unset, empty or not JSON -> red', () => {
    expect(node('aggregate.mjs', { env: {} }).code).not.toBe(0);
    expect(agg(null, '')).not.toBe(0);
    expect(agg(null, '{not json')).not.toBe(0);
  });
});
