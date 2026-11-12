// POLY-96 criterion 1 -- the `app` aggregate, infra/ci/aggregate.mjs (ruling §1).
// Contract: env NEEDS = toJSON(needs) = {<job>: {result, outputs}}; exit 0 = green, non-zero = red.
// Output -> keyed job: node->unit, layers->lint, ci->lint, image->image, db->db.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { node, ROOT, wf } from './helpers.ts';

// The jobs ci.yml gates on each filter output, read from the job-level `if:` (the contract REQUIRED must mirror).
const ifOf = (job: string) => `${wf('ci.yml').jobs[job]?.if ?? ''}`;
const wired = (out: string) => ['lint', 'unit', 'db', 'image'].filter((j) => new RegExp(`needs\\.changes\\.outputs\\.${out}\\b`).test(ifOf(j))).sort();

type Needs = Record<string, { result: string; outputs: Record<string, string> }>;
const OUT = ['node', 'layers', 'db', 'image', 'ci'];
// POLY-141 C20: the aggregate also reads the four area keys; `db` is their OR, so asking for `db` turns all four on.
const AREAS = ['db_auth', 'db_tenancy', 'db_migrate', 'db_ops'];
const outputsFor = (on: string[]): Record<string, string> => {
  const areaOn = (a: string) => on.includes(a) || on.includes('db');
  return Object.fromEntries([...OUT.filter((k) => k !== 'db').map((k) => [k, String(on.includes(k))]), ...AREAS.map((a) => [a, String(areaOn(a))]), ['db', String(AREAS.some(areaOn))]]);
};
const base = (on: string[] = []): Needs => ({
  changes: { result: 'success', outputs: outputsFor(on) },
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
    it(`output ${out}=true and ${job} success, the other jobs it gates also success -> green`, () => {
      let n = base([out]);
      for (const j of wired(out)) n = set(n, j, 'success');
      expect(agg(set(n, job, 'success'))).toBe(0);
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

// POLY-136 item 2 (ruling): one output can gate several jobs; the aggregate checks every one of them.
describe('aggregate.mjs: every job an output gates (POLY-136 item 2)', () => {
  const allOk = (on: string[]) => { let n = base(on); for (const j of ['lint', 'unit', 'db', 'image']) n = set(n, j, 'success'); return n; };
  for (const [out, job] of [['node', 'lint'], ['node', 'image'], ['image', 'lint'], ['image', 'unit']] as const) {
    it(`output ${out}=true but ${job} skipped (the other jobs ran) -> red  [red if: REQUIRED maps ${out} to fewer jobs than ci.yml wires]`, () => {
      expect(agg(set(allOk([out]), job, 'skipped'))).not.toBe(0);
    });
  }
  for (const out of OUT) {
    it(`${out}=true, each job ci.yml wires to it skipped in turn -> red; all success -> green  [red if: a job in the ci.yml if: is missing from REQUIRED]`, () => {
      const jobs = wired(out);
      expect(jobs.length).toBeGreaterThan(0);
      expect(agg(allOk([out]))).toBe(0);
      for (const j of jobs) expect(agg(set(allOk([out]), j, 'skipped')), `${out} -> ${j}`).not.toBe(0);
    });
  }
  it('REQUIRED equals, per output, the jobs whose if: in ci.yml names it  [red if: ci.yml or REQUIRED changes alone]', async () => {
    const { REQUIRED } = (await import('../../infra/ci/aggregate.mjs')) as { REQUIRED?: Record<string, string[]> };
    expect(REQUIRED, 'aggregate.mjs must export REQUIRED').toBeDefined();
    for (const out of OUT) expect([...(REQUIRED![out] ?? [])].sort(), out).toEqual(wired(out));
  });
});

// POLY-141 C20 (seceng S2): a changes job that emits a malformed or incomplete output set is red, never green.
describe('aggregate.mjs: the changes outputs are validated (POLY-141 C20)', () => {
  const KEYS = [...OUT, ...AREAS];
  const withOut = (outputs: Record<string, string>): Needs => ({ ...base(), changes: { result: 'success', outputs } });
  const allFalse = () => Object.fromEntries(KEYS.map((k) => [k, 'false']));
  it('every key present and false -> green (control)', () => { expect(agg(withOut(allFalse()))).toBe(0); });
  it('empty outputs -> red  [red if: missing keys read as false]', () => { expect(agg(withOut({}))).not.toBe(0); });
  for (const k of KEYS) {
    it(`${k} missing -> red`, () => { const o = allFalse(); delete o[k]; expect(agg(withOut(o))).not.toBe(0); });
    for (const bad of ['TRUE', 'yes', '', '1']) {
      it(`${k}='${bad}' -> red  [red if: only the exact string 'true' is read, anything else counts as false]`, () => { expect(agg(withOut({ ...allFalse(), [k]: bad }))).not.toBe(0); });
    }
  }
  it('db=true with every area false -> red even when the db job succeeded (db must be the OR of the areas)', () => { expect(agg(set(withOut({ ...allFalse(), db: 'true' }), 'db', 'success'))).not.toBe(0); });
  it('an area true with db=false -> red', () => { expect(agg(withOut({ ...allFalse(), db_ops: 'true' }))).not.toBe(0); });
  it('imports its key list from changes.mjs: TABLE keys and the four areas are all named there', () => {
    const src = readFileSync(join(ROOT, 'infra/ci/aggregate.mjs'), 'utf8');
    expect(src).toMatch(/from ['"]\.\/changes\.mjs['"]/);
  });
});
