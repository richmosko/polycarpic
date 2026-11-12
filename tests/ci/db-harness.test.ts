// POLY-141 C1-C6 (ruling R1, R2): the db harness lock, the cluster-write fence around the parallel project, and the vitest
// config shape. No Docker, no database. Contract the builder implements (pinned here):
//   tests/db/helpers/bootstrap-lock.ts  export function withBootstrapLock<T>(fn: () => T): T   (synchronous)
//     - POLY_TEST_LOCK_DIR unset -> throws before fn runs; POLY_TEST_LOCK_TIMEOUT_MS (default 120000) elapsed -> throws
//       `bootstrap lock timeout`, fn never runs; acquire = mkdirSync(<dir>/bootstrap.lock), release = rmdirSync in finally.
//   tests/db/global-setup.ts            mkdtemp's a per-run directory and sets process.env.POLY_TEST_LOCK_DIR before returning
//   tests/db/vitest.config.ts           `export const SERIAL: string[]` (repo-relative paths) + projects db-parallel / db-serial
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers.ts';

const LOCK_MOD = join(ROOT, 'tests/db/helpers/bootstrap-lock.ts');
const API = join(ROOT, 'tests/db/helpers/api.ts');
const GLOBAL_SETUP = join(ROOT, 'tests/db/global-setup.ts');
const CONFIG = join(ROOT, 'tests/db/vitest.config.ts');
const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const lockMod = async (): Promise<{ withBootstrapLock: <T>(fn: () => T) => T }> => {
  if (!existsSync(LOCK_MOD)) throw new Error('tests/db/helpers/bootstrap-lock.ts does not exist');
  return import(pathToFileURL(LOCK_MOD).href);
};
const withEnv = <T>(env: Record<string, string | undefined>, fn: () => T): T => {
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try { return fn(); } finally { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v); }
};
const scratchDir = () => mkdtempSync(join(tmpdir(), 'poly141-lock-'));

describe('C1 the lock excludes: two processes contend, the second enters after the first leaves', () => {
  it('intervals of two concurrent holders never overlap  [red if: withBootstrapLock is a no-op]', async () => {
    const dir = scratchDir();
    const log = join(dir, 'log');
    const script = join(dir, 'holder.mts');
    writeFileSync(script, `
      import { appendFileSync } from 'node:fs';
      import { withBootstrapLock } from ${JSON.stringify(pathToFileURL(LOCK_MOD).href)};
      const [log, tag] = process.argv.slice(2);
      withBootstrapLock(() => {
        appendFileSync(log, tag + ' in ' + Date.now() + '\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
        appendFileSync(log, tag + ' out ' + Date.now() + '\\n');
      });
    `);
    const run = (tag: string) => new Promise<{ code: number | null; err: string }>((res) => {
      const c = spawn('node', [script, log, tag], { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', POLY_TEST_LOCK_DIR: dir }, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      c.stderr.on('data', (d) => (err += d));
      c.on('close', (code) => res({ code, err }));
    });
    const [a, b] = await Promise.all([run('a'), run('b')]);
    expect(a.err + b.err).toBe('');
    expect([a.code, b.code]).toEqual([0, 0]);
    const ev = readFileSync(log, 'utf8').trim().split('\n').map((l) => { const [tag, kind, t] = l.split(' '); return { tag, kind, t: Number(t) }; });
    expect(ev).toHaveLength(4);
    const [first, second] = [ev[0]!, ev[2]!];
    expect(ev[1]).toMatchObject({ tag: first.tag, kind: 'out' });   // the holder leaves before the next one enters
    expect(second).toMatchObject({ kind: 'in' });
    expect(second.tag).not.toBe(first.tag);
    expect(second.t).toBeGreaterThanOrEqual(ev[1]!.t);
  }, 30_000);
  it('the lock is released after fn returns and after fn throws (a second call succeeds)', async () => {
    const { withBootstrapLock } = await lockMod();
    const dir = scratchDir();
    withEnv({ POLY_TEST_LOCK_DIR: dir }, () => {
      expect(withBootstrapLock(() => 7)).toBe(7);
      expect(() => withBootstrapLock(() => { throw new Error('inner'); })).toThrow('inner');
      expect(withBootstrapLock(() => 8)).toBe(8);
      expect(existsSync(join(dir, 'bootstrap.lock'))).toBe(false);
    });
  });
});

describe('C2 the lock fails loudly and never runs fn unlocked', () => {
  it('POLY_TEST_LOCK_DIR unset -> throws and fn does not run', async () => {
    const { withBootstrapLock } = await lockMod();
    let ran = false;
    withEnv({ POLY_TEST_LOCK_DIR: undefined }, () => expect(() => withBootstrapLock(() => { ran = true; })).toThrow());
    expect(ran).toBe(false);
  });
  it('a lock held past POLY_TEST_LOCK_TIMEOUT_MS -> throws `bootstrap lock timeout`, fn does not run, the holder\'s lock is untouched', async () => {
    const { withBootstrapLock } = await lockMod();
    const dir = scratchDir();
    mkdirSync(join(dir, 'bootstrap.lock'));
    let ran = false;
    const t0 = Date.now();
    withEnv({ POLY_TEST_LOCK_DIR: dir, POLY_TEST_LOCK_TIMEOUT_MS: '300' }, () => expect(() => withBootstrapLock(() => { ran = true; })).toThrow(/bootstrap lock timeout/));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(ran).toBe(false);
    expect(existsSync(join(dir, 'bootstrap.lock'))).toBe(true);
  });
  it('acquires with mkdirSync and waits with Atomics.wait; the default timeout is 120000 ms  [source pins]', () => {
    const src = read(LOCK_MOD);
    expect(src).toContain('mkdirSync');
    expect(src).toContain('rmdirSync');
    expect(src).toContain('Atomics.wait');
    expect(src).toContain('bootstrap.lock');
    expect(src).toMatch(/120[_]?000/);
    expect(src).not.toMatch(/pg_advisory/);
  });
});

// Return the text of `function <name>(...) { ... }` up to the closing brace at column 0.
const fnBody = (src: string, name: string): string => new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\n\\}`).exec(src)?.[0] ?? '';
// Text inside the parentheses of the first `withBootstrapLock(` call in `s`, or ''.
function lockedSpan(s: string): string {
  const i = s.indexOf('withBootstrapLock(');
  if (i < 0) return '';
  let depth = 0;
  for (let k = i + 'withBootstrapLock'.length; k < s.length; k++) {
    if (s[k] === '(') depth++;
    else if (s[k] === ')' && --depth === 0) return s.slice(i, k + 1);
  }
  return '';
}

describe('C3 every psql call that sends the bootstrap text is inside the lock, except setRolePasswords', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|mjs)$/.test(e.name) ? [join(d, e.name)] : []));
  const code = (s: string) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  for (const fn of ['freshDb', 'cloneMigrated']) {
    it(`${fn}() reads BOOTSTRAP only inside withBootstrapLock(...)  [red if: the wrapper is removed]`, () => {
      const body = fnBody(read(API), fn);
      expect(body, `${fn} found in helpers/api.ts`).not.toBe('');
      const reads = [...body.matchAll(/readFileSync\(BOOTSTRAP/g)];
      expect(reads.length, 'a BOOTSTRAP read').toBeGreaterThan(0);
      const span = lockedSpan(body);
      expect(span, `${fn} calls withBootstrapLock`).not.toBe('');
      expect([...span.matchAll(/readFileSync\(BOOTSTRAP/g)].length).toBe(reads.length);
      expect(body).toMatch(/\bmust\(/);
      expect(span).toMatch(/\bmust\(/);                     // the psql call itself is inside, not just the file read
    });
  }
  it('setRolePasswords() is the one unwrapped reader (it runs once, in globalSetup, before any worker)', () => {
    const body = fnBody(read(API), 'setRolePasswords');
    expect(body).toMatch(/readFileSync\(BOOTSTRAP/);
    expect(body).not.toContain('withBootstrapLock');
  });
  it('api.ts imports withBootstrapLock from ./bootstrap-lock.ts', () => {
    expect(read(API)).toMatch(/import\s*\{[^}]*\bwithBootstrapLock\b[^}]*\}\s*from\s*['"]\.\/bootstrap-lock\.ts['"]/);
  });
  it('no other file under tests/db reads roles.sql or BOOTSTRAP', () => {
    const offenders = walk(join(ROOT, 'tests/db')).filter((f) => f !== API && !f.endsWith('bootstrap-lock.ts') && /\bBOOTSTRAP\b|['"`]roles\.sql['"`]/.test(code(read(f))));
    expect(offenders.map((f) => f.replace(ROOT + '/', ''))).toEqual([]);
  });
});

describe('C4 globalSetup creates the lock directory before any worker starts', () => {
  it('mkdtemp, then POLY_TEST_LOCK_DIR exported, in global-setup.ts  [red while absent]', () => {
    const src = read(GLOBAL_SETUP);
    expect(src).toMatch(/mkdtempSync\(/);
    expect(src).toMatch(/process\.env\.POLY_TEST_LOCK_DIR\s*=/);
    expect(src.indexOf('POLY_TEST_LOCK_DIR')).toBeLessThan(src.indexOf('return stop'));
  });
});

// --- C5 and C6 need SERIAL from the config --------------------------------------------------------------------------
type Cfg = { test?: Record<string, any> };
async function config(): Promise<{ SERIAL: string[]; cfg: Cfg }> {
  const m = (await import(pathToFileURL(CONFIG).href)) as { SERIAL?: string[]; default: Cfg };
  if (!Array.isArray(m.SERIAL)) throw new Error('tests/db/vitest.config.ts does not export SERIAL');
  return { SERIAL: m.SERIAL, cfg: m.default };
}
const FILES = readdirSync(join(ROOT, 'tests/db')).filter((f) => f.endsWith('.test.ts')).map((f) => `tests/db/${f}`).sort();

// A cluster-wide write or read: role DDL, role membership, ALTER SYSTEM, anything that looks across databases.
export function clusterWrites(text: string): string[] {
  const body = text.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const hits: string[] = [];
  for (const m of body.matchAll(/\bCREATE\s+ROLE\b|\bDROP\s+ROLE\b|\bALTER\s+SYSTEM\b|\bpg_locks\b|\bpg_stat_activity\b|\bpg_terminate_backend\b/gi)) hits.push(m[0]);
  for (const m of body.matchAll(/\bALTER\s+ROLE\b[^;`'"\n]*/gi)) if (!/\bIN\s+DATABASE\b/i.test(m[0])) hits.push(m[0]);
  for (const m of body.matchAll(/\b(?:GRANT|REVOKE)\s+(?![^;\n]*\bON\b)[a-z_]+(?:\s*,\s*[a-z_]+)*\s+(?:TO|FROM)\s/g)) hits.push(m[0]);
  return hits;
}

describe('C5 no test outside the serial project writes cluster-wide state', () => {
  it('the detector can fail: runner.test.ts trips it, and so do fixtures for each class', () => {
    expect(clusterWrites(read(join(ROOT, 'tests/db/runner.test.ts'))).length).toBeGreaterThan(0);
    for (const s of ['CREATE ROLE x', 'DROP ROLE x', 'ALTER ROLE x PASSWORD 1', 'ALTER SYSTEM SET a = 1', 'select * from pg_locks', 'pg_stat_activity', 'select pg_terminate_backend(1)', 'GRANT poly_owner TO poly_migrator;', 'REVOKE poly_owner FROM poly_migrator;']) {
      expect(clusterWrites(s), s).not.toEqual([]);
    }
    for (const s of ['ALTER ROLE poly_app IN DATABASE d SET a = 1', 'GRANT SELECT, INSERT ON public.t TO poly_app;', 'REVOKE EXECUTE ON FUNCTION f() FROM PUBLIC;']) expect(clusterWrites(s), s).toEqual([]);
  });
  it('every file outside SERIAL is clean  [red if: runner moves to the parallel project, or a parallel file gains a cluster write]', async () => {
    const { SERIAL } = await config();
    const parallel = FILES.filter((f) => !SERIAL.includes(f));
    expect(parallel.length).toBeGreaterThan(10);
    for (const f of parallel) expect(clusterWrites(read(join(ROOT, f))), f).toEqual([]);
  });
});

describe('C6 the vitest config shape', () => {
  const projectOf = (cfg: Cfg, name: string) => (cfg.test?.projects ?? []).find((p: any) => p?.test?.name === name);
  it('SERIAL is exactly runner, template-clone and ops-hardening, as repo-relative paths that exist', async () => {
    const { SERIAL } = await config();
    expect([...SERIAL].sort()).toEqual(['tests/db/ops-hardening.test.ts', 'tests/db/runner.test.ts', 'tests/db/template-clone.test.ts']);
    for (const f of SERIAL) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });
  it('projects db-parallel (groupOrder 0, fileParallelism true) and db-serial (groupOrder 1, fileParallelism false)', async () => {
    const { cfg, SERIAL } = await config();
    const par = projectOf(cfg, 'db-parallel');
    const ser = projectOf(cfg, 'db-serial');
    expect(par, 'project db-parallel').toBeDefined();
    expect(ser, 'project db-serial').toBeDefined();
    expect(par.test.sequence?.groupOrder).toBe(0);
    expect(par.test.fileParallelism).toBe(true);
    expect(ser.test.sequence?.groupOrder).toBe(1);
    expect(ser.test.fileParallelism).toBe(false);
    expect([...ser.test.include].sort()).toEqual([...SERIAL].sort());
    expect(par.test.include).toEqual(['tests/db/**/*.test.ts']);
    expect(par.test.exclude).toEqual(expect.arrayContaining(SERIAL));
  });
  it('globalSetup is at the root only (one container); maxWorkers is 3; hook and test timeouts are kept', async () => {
    const { cfg } = await config();
    expect(cfg.test?.globalSetup).toEqual(['tests/db/global-setup.ts']);
    for (const name of ['db-parallel', 'db-serial']) expect(projectOf(cfg, name)?.test?.globalSetup, name).toBeUndefined();
    expect(cfg.test?.maxWorkers).toBe(3);
    expect(cfg.test?.testTimeout).toBe(60_000);
    expect(cfg.test?.hookTimeout).toBe(300_000);
  });
  it('the two projects together select every tests/db/*.test.ts exactly once', async () => {
    const { SERIAL } = await config();
    const parallel = FILES.filter((f) => !SERIAL.includes(f));
    expect(new Set([...parallel, ...SERIAL]).size).toBe(FILES.length);
    expect(parallel.length + SERIAL.length).toBe(FILES.length);
  });
});

// POLY-141 T1/T4: one owner for the image tag and the build arguments.
describe('T1 pgtap-image.mjs owns PG_BASE, IMAGE and the build argv; pg.ts keeps no copy', () => {
  const HELPER = join(ROOT, 'tests/db/helpers/pgtap-image.mjs');
  const PG = join(ROOT, 'tests/db/helpers/pg.ts');
  it('pg.ts imports IMAGE, PG_BASE and buildArgv from ./pgtap-image.mjs  [red while pg.ts parses the FROM line itself]', () => {
    const src = read(PG);
    for (const name of ['IMAGE', 'PG_BASE', 'buildArgv']) {
      expect(src, name).toMatch(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]\\./pgtap-image\\.mjs['"]`));
    }
  });
  it('pg.ts has no FROM-line parsing, no Dockerfile read and no docker build argv of its own', () => {
    const src = read(PG).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(src).not.toMatch(/startsWith\(['"]FROM /);
    expect(src).not.toContain('infra/postgres/Dockerfile');
    expect(src).not.toMatch(/'infra',\s*'postgres'/);
    expect(src).not.toMatch(/\['build'/);
    expect(src).not.toContain('--build-arg');
    expect(src).not.toMatch(/polycarpic-pgtap:/);
  });
  it('the helper is plain JS on node built-ins only, has a --build mode, and exports IMAGE, PG_BASE and buildArgv', async () => {
    expect(existsSync(HELPER), 'tests/db/helpers/pgtap-image.mjs').toBe(true);
    const src = read(HELPER);
    for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) expect(m[1], m[1]).toMatch(/^node:/);
    expect(src).toContain('--build');
    const m: any = await import(pathToFileURL(HELPER).href);
    expect(m.PG_BASE).toMatch(/^postgres:\d+\.\d+@sha256:[0-9a-f]{64}$/);
    expect(m.IMAGE).toBe(`polycarpic-pgtap:${m.PG_BASE.split('@sha256:')[1].slice(0, 12)}`);
    const argv: string[] = m.buildArgv();
    expect(Array.isArray(argv)).toBe(true);
    expect(argv).toContain('build');
    expect(argv).toContain(`PG_BASE=${m.PG_BASE}`);
    expect(argv).toContain(m.IMAGE);
    expect(argv[argv.length - 1]).toBe(join(ROOT, 'tests', 'db', 'docker'));
  });
  it('the helper reads the FROM line of infra/postgres/Dockerfile and checks the pin', () => {
    const src = read(HELPER);
    expect(src).toContain('infra');
    expect(src).toMatch(/FROM /);
    expect(src).toMatch(/sha256/);
  });
});

// Callers of the bootstrap outside vitest's globalSetup (the Web e2e server) have no POLY_TEST_LOCK_DIR unless they set it.
describe('every harness caller outside tests/db/*.test.ts sets the lock dir through ensureBootstrapLockDir() first', () => {
  const tracked = () => spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).stdout.split('\0').filter(Boolean);
  const callers = () => tracked().filter((f) =>
    /\.(ts|mjs|js|svelte)$/.test(f)
    && !f.startsWith('tests/db/') && !f.startsWith('tests/ci/') && !f.startsWith('.claude/')
    && /\b(?:freshDb|cloneMigrated)\s*\(/.test(read(join(ROOT, f)).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')));

  it('the search finds the e2e server (not vacuous)', () => {
    expect(callers()).toContain('apps/web/tests/e2e/serve.ts');
  });
  it('each caller imports ensureBootstrapLockDir from tests/db/helpers/bootstrap-lock.ts and calls it before the first freshDb/cloneMigrated call  [red while serve.ts leaves the dir unset]', () => {
    for (const f of callers()) {
      const src = read(join(ROOT, f));
      expect(src, f).toMatch(/import\s*\{[^}]*\bensureBootstrapLockDir\b[^}]*\}\s*from\s*['"][./]*tests\/db\/helpers\/bootstrap-lock\.ts['"]/);
      const ensure = src.search(/\bensureBootstrapLockDir\s*\(/);
      const first = src.search(/\b(?:freshDb|cloneMigrated)\s*\(/);
      expect(ensure, `${f}: a call to ensureBootstrapLockDir()`).toBeGreaterThan(-1);
      expect(ensure, `${f}: before the first bootstrap call`).toBeLessThan(first);
    }
  });
  it('ensureBootstrapLockDir() creates and exports a directory when unset, and keeps an existing value', async () => {
    if (!existsSync(LOCK_MOD)) throw new Error('tests/db/helpers/bootstrap-lock.ts does not exist');
    const m: any = await import(pathToFileURL(LOCK_MOD).href);
    expect(typeof m.ensureBootstrapLockDir, 'ensureBootstrapLockDir exported').toBe('function');
    withEnv({ POLY_TEST_LOCK_DIR: undefined }, () => {
      const d = m.ensureBootstrapLockDir();
      expect(existsSync(d)).toBe(true);
      expect(process.env.POLY_TEST_LOCK_DIR).toBe(d);
      expect(m.ensureBootstrapLockDir()).toBe(d);
      expect(m.withBootstrapLock(() => 3)).toBe(3);
    });
    const keep = scratchDir();
    withEnv({ POLY_TEST_LOCK_DIR: keep }, () => expect(m.ensureBootstrapLockDir()).toBe(keep));
  });
});
