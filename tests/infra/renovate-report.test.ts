// POLY-138 D1(b): the decision of the weekly Renovate check, infra/renovate/check-report.sh <report.json> (devops).
// Behavioural: the real script on fixture reports. Exit 1 = an update is due, 0 = none, 2 = a broken or incomplete lookup
// (fails closed). Every fixture derives from a REAL Renovate file report (fixtures/renovate-report-due.json), so each case
// is "the real report plus ONE change". Each test names the mutation that turns it red. Needs bash and jq (both on the runner).
//
// Seceng build review (build-review.md @ 0c687af7): finding 1, a report whose lookups failed (problems / warnings) must exit 2;
// finding 2, a report missing an expected pin must exit 2: postgres and age in infra/postgres/Dockerfile, the caddy builder and
// runtime FROM lines and the xcaddy literal in infra/caddy/Dockerfile.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const SCRIPT = join(ROOT, 'infra', 'renovate', 'check-report.sh');
const REAL = join(ROOT, 'tests', 'infra', 'fixtures', 'renovate-report-due.json');
const dir = mkdtempSync(join(tmpdir(), 'poly138-report-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const runFile = (f: string) => { const r = spawnSync('bash', [SCRIPT, f], { encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const run = (body: string | null) => {
  const f = join(dir, `r${n++}.json`);
  if (body !== null) writeFileSync(f, body);
  return runFile(f);
};

type Dep = { depName: string; currentValue?: string; depType?: string | null; updates?: any[]; warnings?: unknown[] | null; skipReason?: string; datasource?: string };
type PF = { packageFile: string; deps: Dep[] };
type Report = { problems?: unknown[]; repositories: Record<string, { problems?: unknown[]; packageFiles?: Record<string, PF[]> }> };
const real = (): Report => JSON.parse(readFileSync(REAL, 'utf8'));
const allDeps = (r: Report): Dep[] => Object.values(r.repositories).flatMap((x) => Object.values(x.packageFiles ?? {}).flatMap((pfs) => pfs.flatMap((pf) => pf.deps)));
/** the real report with every update emptied: all five pins present, nothing due */
const clean = (): Report => { const r = real(); for (const d of allDeps(r)) d.updates = []; return r; };
const files = (r: Report) => r.repositories.local!.packageFiles!;
const find = (r: Report, manager: string, file: string, pred: (d: Dep) => boolean) => files(r)[manager]!.find((pf) => pf.packageFile === file)!.deps.find(pred)!;
const drop = (r: Report, manager: string, file: string, pred: (d: Dep) => boolean) => {
  const pf = files(r)[manager]!.find((p) => p.packageFile === file)!;
  const before = pf.deps.length;
  pf.deps = pf.deps.filter((d) => !pred(d));
  if (pf.deps.length === before) throw new Error('fixture mutation removed nothing (a typo in the test, not a red)');
};
const J = (r: Report) => JSON.stringify(r);

const PG = 'infra/postgres/Dockerfile', CD = 'infra/caddy/Dockerfile';
const PINS: [string, string, string, (d: Dep) => boolean, RegExp][] = [
  ['the postgres FROM line', 'dockerfile', PG, (d) => d.depName === 'postgres', /postgres/],
  ['the age pin (the regex manager)', 'regex', PG, (d) => d.depName === 'age', /age/],
  ['the caddy builder FROM line', 'dockerfile', CD, (d) => d.depName === 'caddy' && /builder/.test(d.currentValue ?? ''), /caddy/],
  ['the caddy runtime FROM line', 'dockerfile', CD, (d) => d.depName === 'caddy' && !/builder/.test(d.currentValue ?? ''), /caddy/],
  ['the xcaddy build literal (the regex manager)', 'regex', CD, (d) => d.depName === 'caddy', /xcaddy|caddy/],
];

describe('infra/renovate/check-report.sh', () => {
  it('exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });

  describe('the decision: due / none due', () => {
    it('the real report, as captured (two Caddy digest updates): exit 1, naming the two Caddy dependencies and neither postgres nor age', () => {
      const r = runFile(REAL);
      expect(r.code).toBe(1); // red: a real report with updates reads as clean
      expect(r.out.match(/infra\/caddy\/Dockerfile: caddy /g)).toHaveLength(2);
      expect(r.out).not.toMatch(/: (postgres|age) /);
    });
    it('the real report with every updates list emptied: exit 0, "No update is due."', () => {
      const r = run(J(clean()));
      expect(r.code).toBe(0); // red: a clean lookup fails the weekly run (noise), or a pin check refuses the real report
      expect(r.out).toMatch(/No update is due\./);
    });
    it('every updates key removed: exit 0', () => {
      const r = clean();
      for (const d of allDeps(r)) delete d.updates;
      expect(run(J(r)).code).toBe(0);
    });
    it('an update on the postgres FROM line: exit 1, one line naming file, dependency, current and new value', () => {
      const r = clean();
      find(r, 'dockerfile', PG, (d) => d.depName === 'postgres').updates = [{ newValue: '17.13', newDigest: 'sha256:abc' }];
      const o = run(J(r));
      expect(o.code).toBe(1); // red: an update does not fail the run
      expect(o.out).toMatch(/infra\/postgres\/Dockerfile: postgres 17\.12 -> 17\.13@sha256:abc/);
    });
    it('a digest-only update (new value equals the current one, the Caddy case): exit 1', () => {
      const r = clean();
      const d = find(r, 'dockerfile', CD, (x) => x.depName === 'caddy' && !/builder/.test(x.currentValue ?? ''));
      d.updates = [{ newValue: d.currentValue, newDigest: 'sha256:def' }];
      const o = run(J(r));
      expect(o.code).toBe(1); // red: only a changed version is counted
      expect(o.out).toMatch(/caddy 2\.11\.9 -> 2\.11\.9@sha256:def/);
    });
    it('an update in the regex manager (age) is found, and only that dependency is named', () => {
      const r = clean();
      find(r, 'regex', PG, (d) => d.depName === 'age').updates = [{ newValue: '1.2.2' }];
      const o = run(J(r));
      expect(o.code).toBe(1); // red: only the first manager is read
      expect(o.out).toMatch(/: age 1\.2\.1-1\+b5 -> 1\.2\.2/);
      expect(o.out).not.toMatch(/: (postgres|caddy) /);
    });
  });

  describe('a report that is malformed or looked at nothing: exit 2, stderr, never "No update is due"', () => {
    it.each([
      ['a missing file', null],
      ['an empty file', ''],
      ['text that is not JSON', 'Renovate crashed'],
      ['JSON with no repositories key', '{}'],
      ['an empty repositories object', '{"repositories":{}}'],
      ['repositories as a list', '{"repositories":[]}'],
      ['a repository with no packageFiles', '{"repositories":{"r":{}}}'],
    ])('%s', (_n, body) => {
      const r = run(body);
      expect(r.code).toBe(2); // red: exit 0 or 1 (a failed lookup reads as clean, or as an update)
      expect(r.err.length).toBeGreaterThan(0);
      expect(r.out).not.toMatch(/No update is due/);
    });
    it('package files that hold no dependencies', () => {
      const r = clean();
      for (const pfs of Object.values(files(r))) for (const pf of pfs) pf.deps = [];
      expect(run(J(r)).code).toBe(2);
    });
  });

  describe('finding 1: a lookup that failed reads as broken, not as clean (seceng build review)', () => {
    const FAILED = [{ topic: 'postgres', message: 'Failed to look up docker package postgres', level: 'WARN' }];
    const cases: [string, (r: Report) => void][] = [
      ['a top-level problems entry', (r) => { r.problems = [{ level: 50, msg: 'rate limit exceeded' }]; }],
      ['a repository problems entry', (r) => { r.repositories.local!.problems = [{ level: 40, msg: 'registry unreachable' }]; }],
      ['a dependency warning (an object, as Renovate writes it)', (r) => { find(r, 'dockerfile', PG, (d) => d.depName === 'postgres').warnings = FAILED; }],
      ['a dependency warning (a string)', (r) => { find(r, 'regex', PG, (d) => d.depName === 'age').warnings = ['Debian mirror unreachable']; }],
      ['a warning on the last dependency of the last file', (r) => { find(r, 'regex', CD, (d) => d.depName === 'caddy').warnings = FAILED; }],
    ];
    it.each(cases)('%s, with every updates list empty: exit 2 and a message saying why', (_n, mut) => {
      const r = clean();
      mut(r);
      const o = run(J(r));
      expect(o.code).toBe(2); // red: exit 0, "No update is due." (the scheduled run is green and looked at nothing)
      expect(o.err).toMatch(/problem|warning/i);
      expect(o.out).not.toMatch(/No update is due/);
    });
    it('a lookup that failed for one dependency while another has an update: not exit 0', () => {
      const r = clean();
      find(r, 'dockerfile', CD, (d) => d.depName === 'caddy' && /builder/.test(d.currentValue ?? '')).updates = [{ newValue: '2.11.10' }];
      find(r, 'dockerfile', PG, (d) => d.depName === 'postgres').warnings = FAILED;
      expect(run(J(r)).code).not.toBe(0);
    });
    it('the benign cases stay clean: empty problems and warnings, null warnings, and skipReason: unknown-registry on the dockerfile age entry', () => {
      const r = clean();
      expect(r.problems).toEqual([]); // the real report carries empty lists, as seceng described
      find(r, 'dockerfile', PG, (d) => d.depName === 'age').skipReason = 'unknown-registry';
      const o = run(J(r));
      expect(o.code).toBe(0); // red: a check that fails on any skipReason (seceng: do not)
      expect(o.out).toMatch(/No update is due\./);
    });
  });

  describe('finding 2: a pin that was not extracted is a broken lookup (seceng build review)', () => {
    it.each(PINS)('without %s: exit 2, naming it', (_n, manager, file, pred, name) => {
      const r = clean();
      drop(r, manager, file, pred);
      const o = run(J(r));
      expect(o.code).toBe(2); // red: the run stays green and that pin is never checked again
      expect(o.err).toMatch(name);
      expect(o.out).not.toMatch(/No update is due/);
    });
    it('without the whole regex manager (both regex pins): exit 2', () => {
      const r = clean();
      delete files(r).regex;
      expect(run(J(r)).code).toBe(2);
    });
    it('without a whole Dockerfile (infra/postgres/Dockerfile moved out of includePaths): exit 2', () => {
      const r = clean();
      for (const m of Object.keys(files(r))) files(r)[m] = files(r)[m]!.filter((pf) => pf.packageFile !== PG);
      expect(run(J(r)).code).toBe(2);
    });
    it('a missing pin does not hide an update on another one: not exit 0', () => {
      const r = clean();
      drop(r, 'regex', PG, (d) => d.depName === 'age');
      find(r, 'dockerfile', PG, (d) => d.depName === 'postgres').updates = [{ newValue: '17.13' }];
      expect(run(J(r)).code).not.toBe(0);
    });
    it('the dockerfile manager\'s own age entry is not a pin: removing it leaves the report clean (exit 0)', () => {
      const r = clean();
      drop(r, 'dockerfile', PG, (d) => d.depName === 'age');
      expect(run(J(r)).code).toBe(0); // red: the check demands entries the ruled config does not need
    });
  });

  describe('finding 2, the expected list against the two Dockerfiles (a pin added without listing it fails here)', () => {
    const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
    const FROMS = (rel: string) => src(rel).split('\n').filter((l) => /^FROM /.test(l));
    it('the Dockerfiles hold exactly the five pins the check expects: 1 postgres FROM, 2 caddy FROMs, one `age=`, one xcaddy literal', () => {
      expect(FROMS(PG)).toHaveLength(1); // red: a new stage or base image is a pin nobody lists
      expect(FROMS(CD)).toHaveLength(2);
      expect(src(PG).match(/\bage=\S+/g)).toHaveLength(1);
      expect(src(CD).match(/xcaddy build v\d+\.\d+\.\d+/g)).toHaveLength(1);
      expect(FROMS(PG)[0]).toMatch(/^FROM postgres:\d+\.\d+@sha256:/);
      expect(FROMS(CD)[0]).toMatch(/^FROM caddy:\S+-builder@sha256:/);
      expect(FROMS(CD)[1]).toMatch(/^FROM caddy:\d\S*@sha256:/);
    });
    it('a report built from the live Dockerfiles\' pins (their current values, no updates) is clean; without any one of them it exits 2', () => {
      const pg = /^FROM postgres:(\S+?)@/.exec(FROMS(PG)[0]!)![1]!;
      const age = /\bage=(\S+)/.exec(src(PG))![1]!;
      const [bld, rtm] = FROMS(CD).map((l) => /^FROM caddy:(\S+?)@/.exec(l)![1]!);
      const lit = /xcaddy build v(\d+\.\d+\.\d+)/.exec(src(CD))![1]!;
      const build = (skip: number): Report => ({
        problems: [],
        repositories: { local: { problems: [], packageFiles: {
          dockerfile: [
            { packageFile: CD, deps: ([{ depName: 'caddy', currentValue: bld, depType: 'stage', updates: [], warnings: [] }, { depName: 'caddy', currentValue: rtm, depType: 'final', updates: [], warnings: [] }] as Dep[]).filter((_d, i) => skip !== 2 + i) },
            { packageFile: PG, deps: skip === 0 ? [] : [{ depName: 'postgres', currentValue: pg, depType: 'final', updates: [], warnings: [] }] },
          ],
          regex: [
            { packageFile: PG, deps: skip === 1 ? [] : [{ depName: 'age', currentValue: age, updates: [], warnings: [] }] },
            { packageFile: CD, deps: skip === 4 ? [] : [{ depName: 'caddy', currentValue: lit, updates: [], warnings: [] }] },
          ],
        } } },
      });
      expect(run(J(build(-1))).code, 'every live pin present').toBe(0); // red: the expected list asks for a pin the Dockerfiles no longer hold, or reads the live values wrong
      for (const skip of [0, 1, 2, 3, 4]) expect(run(J(build(skip))).code, `pin ${skip} missing`).toBe(2);
    });
  });

  describe('finding 2, PINS inside the script against the two Dockerfiles', () => {
    const PGF = 'infra/postgres/Dockerfile', CDF = 'infra/caddy/Dockerfile';
    /** the pins Renovate extracts from the two Dockerfiles, as [manager, file, depName, role] */
    const derive = (pg: string, cd: string): string[][] => {
      const froms = (t: string) => t.split('\n').filter((l) => /^FROM /.test(l));
      const role = (l: string, any: boolean) => (any ? 'any' : /^FROM caddy:\S*-builder@/.test(l) ? 'builder' : 'runtime');
      return [
        ...froms(pg).map((l) => ['dockerfile', PGF, /^FROM (\w+):/.exec(l)![1]!, 'any']),
        ...(pg.match(/\bage=\S+/g) ?? []).map(() => ['regex', PGF, 'age', 'any']),
        ...froms(cd).map((l) => ['dockerfile', CDF, /^FROM (\w+):/.exec(l)![1]!, role(l, false)]),
        ...(cd.match(/xcaddy build v\d+\.\d+\.\d+/g) ?? []).map(() => ['regex', CDF, 'caddy', 'any']),
      ];
    };
    const listed = (): string[][] => JSON.parse(/^PINS='(\[[\s\S]*?\n\])'/m.exec(readFileSync(SCRIPT, 'utf8'))![1]!);
    const key = (rows: string[][]) => rows.map((r) => r.join('|')).sort();
    it('PINS equals the pins the two Dockerfiles hold now (no pin unlisted, none listed that is gone)', () => {
      const live = derive(readFileSync(join(ROOT, PGF), 'utf8'), readFileSync(join(ROOT, CDF), 'utf8'));
      expect(key(listed())).toEqual(key(live)); // red: a FROM, age= or xcaddy literal added or removed without editing PINS
    });
    it('the comparison can fail: one more FROM in a Dockerfile makes the derived list differ from PINS', () => {
      const pg = readFileSync(join(ROOT, PGF), 'utf8'), cd = readFileSync(join(ROOT, CDF), 'utf8');
      expect(key(derive(pg + '\nFROM debian:13@sha256:' + '0'.repeat(64) + '\n', cd))).not.toEqual(key(listed()));
      expect(key(derive(pg, cd.replace(/xcaddy build v\S+/, 'xcaddy build'))).length).toBe(key(listed()).length - 1);
    });
  });

  it('the weekly workflow runs this script, not an inline check', () => {
    const f = join(ROOT, '.github', 'workflows', 'renovate-check.yml');
    expect(existsSync(f)).toBe(true);
    expect(readFileSync(f, 'utf8')).toContain('infra/renovate/check-report.sh'); // red: the decision is made elsewhere and this test proves nothing about it
  });
});
