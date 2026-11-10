// POLY-85 R3/R1/R8: `check-config` on every entrypoint, the refusal-at-start log line, and the structural moves.
// Entrypoints (reconcile here only): apps/migrate/src/cli.ts (existing), apps/web/src/main.ts, apps/worker/src/main.ts.
// Output contract: `check-config: <message>` per fault on stderr (the POLY-83 shape), exit 0 / 1, no network.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANARIES, assertNoCanary } from '../log/canary.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = { migrate: 'apps/migrate/src/cli.ts', web: 'apps/web/src/main.ts', worker: 'apps/worker/src/main.ts' } as const;
type Svc = keyof typeof ENTRY;
const DBUSER: Record<Svc, string> = { web: 'poly_app', worker: 'poly_worker', migrate: 'poly_migrator' };

const dir = mkdtempSync(join(tmpdir(), 'poly85-cc-'));
let n = 0;
const file = (c: string) => { const p = join(dir, `f${n++}`); writeFileSync(p, c); return p; };
const good = (svc: Svc, over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  APP_ENV: 'development', TLS_MODE: 'private-ca', PUBLIC_ORIGIN: 'http://localhost:5173',
  DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '1', DATABASE_NAME: 'none', DATABASE_USER: DBUSER[svc], DATABASE_SSLMODE: 'disable',
  DATABASE_PASSWORD_FILE: file('pw\n'), ...(svc === 'migrate' ? {} : { AUTH_SECRET_FILE: file('auth\n') }), ...over,
});
const run = (svc: Svc, args: string[], env: Record<string, string | undefined>) => {
  const base: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: process.env.HOME };
  const p = spawnSync('node', ['--experimental-strip-types', join(ROOT, ENTRY[svc]), ...args], { encoding: 'utf8', timeout: 30_000, cwd: ROOT, env: { ...base, ...env } as NodeJS.ProcessEnv });
  return { code: p.status ?? 127, err: p.stderr ?? '', out: p.stdout ?? '', text: (p.stderr ?? '') + (p.stdout ?? '') };
};
const SVCS: Svc[] = ['migrate', 'web', 'worker'];

describe('check-config on every entrypoint (R3: the migrate container cannot see web\'s files, so each checks its own mounts)', () => {
  for (const svc of SVCS) {
    it(`${svc}: exit 0 and silent on a good config; connects nowhere (port 1 is closed)`, () => {
      const r = run(svc, ['check-config'], good(svc));
      expect(r.text).not.toMatch(/Cannot find module|ERR_MODULE_NOT_FOUND|Unknown file extension/);
      expect(r.code, r.text).toBe(0);
    });
    it(`${svc}: exit 1 on a missing DATABASE_PASSWORD_FILE, one \`check-config:\` line naming the variable and the path`, () => {
      const p = join(dir, 'absent');
      const r = run(svc, ['check-config'], good(svc, { DATABASE_PASSWORD_FILE: p }));
      expect(r.code, r.text).toBe(1);
      expect(r.err).toContain(`check-config: DATABASE_PASSWORD_FILE does not exist: ${p}`);
    });
    it(`${svc}: an empty file is named exactly (POLY-83 text, byte-identical)`, () => {
      const p = file('');
      expect(run(svc, ['check-config'], good(svc, { DATABASE_PASSWORD_FILE: p })).err).toContain(`check-config: DATABASE_PASSWORD_FILE is empty: ${p}`);
    });
    it(`${svc}: an unset variable reads \`X is not set\``, () => {
      expect(run(svc, ['check-config'], good(svc, { DATABASE_PASSWORD_FILE: undefined })).err).toContain('check-config: DATABASE_PASSWORD_FILE is not set');
    });
    it(`${svc}: a multi-line line-secret reads \`must hold one line: <path>\``, () => {
      const p = file('a\nb\n');
      expect(run(svc, ['check-config'], good(svc, { DATABASE_PASSWORD_FILE: p })).err).toContain(`check-config: DATABASE_PASSWORD_FILE must hold one line: ${p}`);
    });
    it(`${svc}: surrounding whitespace reads \`has surrounding whitespace: <path>\``, () => {
      const p = file(' pw\n');
      expect(run(svc, ['check-config'], good(svc, { DATABASE_PASSWORD_FILE: p })).err).toContain(`check-config: DATABASE_PASSWORD_FILE has surrounding whitespace: ${p}`);
    });
    it(`${svc}: an unreadable path (a directory) reads \`cannot be read: <path>\``, () => {
      const p = join(dir, 'adir'); mkdirSync(p, { recursive: true });
      expect(run(svc, ['check-config'], good(svc, { DATABASE_PASSWORD_FILE: p })).err).toContain(`check-config: DATABASE_PASSWORD_FILE cannot be read: ${p}`);
    });
    it(`${svc}: every fault on its own line (TLS_MODE, PLAID_ENV, APP_ENV together) and the exit is 1`, () => {
      const r = run(svc, ['check-config'], good(svc, { TLS_MODE: undefined, APP_ENV: 'staging', PLAID_ENV: 'production', PUBLIC_ORIGIN: 'https://app.example.com' }));
      expect(r.code).toBe(1);
      const lines = r.err.split('\n').filter((l) => l.startsWith('check-config:'));
      for (const v of ['TLS_MODE', 'PLAID_ENV']) expect(lines.filter((l) => l.includes(v)), v).toHaveLength(1);
    });
    it(`${svc}: the secret file's content and a refused variable's value never reach stdout or stderr`, () => {
      const r = run(svc, ['check-config'], good(svc, { DATABASE_PASSWORD_FILE: file(CANARIES.secretFile + '\nline2\n'), AUTH_SECRET_FILE: file(CANARIES.secretFile + '\nline2\n'), DATABASE_PASSWORD: CANARIES.token, DATABASE_URL: CANARIES.url, CANARY_TOKEN: CANARIES.bearer, APP_ENV: 'production' }));
      expect(r.code).toBe(1);
      assertNoCanary(r.text, `${svc} check-config`);
    });
    it(`${svc}: check-config also covers the non-DB inputs (TLS_MODE missing refuses, naming it)`, () => {
      const r = run(svc, ['check-config'], good(svc, { TLS_MODE: undefined }));
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/check-config: .*TLS_MODE/);
    });
  }
  it('web and worker also refuse a secret file their service must not see (keyring in web)', () => {
    const r = run('web', ['check-config'], good('web', { CREDENTIAL_KEYRING_FILE: file('k\n') }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('CREDENTIAL_KEYRING_FILE');
  });
  it('web and worker require AUTH_SECRET_FILE; migrate does not', () => {
    expect(run('web', ['check-config'], good('web', { AUTH_SECRET_FILE: undefined })).err).toContain('AUTH_SECRET_FILE');
    expect(run('worker', ['check-config'], good('worker', { AUTH_SECRET_FILE: undefined })).err).toContain('AUTH_SECRET_FILE');
    expect(run('migrate', ['check-config'], good('migrate')).code).toBe(0);
  });
});

describe('start refuses before any pool exists (R3 Startup)', () => {
  for (const svc of ['web', 'worker'] as const) {
    it(`${svc}: a bad config exits 1 with one config.refused JSON line per problem (var, fault; never the path), connecting nowhere`, () => {
      const p = join(dir, `missing-${svc}`);
      const r = run(svc, [], good(svc, { AUTH_SECRET_FILE: p, TLS_MODE: undefined }));
      expect(r.code, r.text).toBe(1);
      const lines = r.text.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
      const refused = lines.filter((l) => l.event === 'config.refused');
      expect(refused.map((l) => l.var).sort()).toEqual(['AUTH_SECRET_FILE', 'TLS_MODE']);
      for (const l of refused) {
        expect(l.service).toBe(svc);
        expect(typeof l.fault).toBe('string');
        expect(l.level).toMatch(/error|fatal/);
      }
      expect(r.text).not.toContain(p);
      expect(r.text).not.toMatch(/ECONNREFUSED|connect/i);
    });
  }
});

describe('structure (R1, R7)', () => {
  const layers = () => JSON.parse(readFileSync(join(ROOT, 'layers.json'), 'utf8')).packages;
  it('layers.json: config is L0, allow [], and exports exactly the ./log subpath', () => {
    const c = layers().config;
    expect(c.layer).toBe(0);
    expect(c.allow).toEqual([]);
    expect(c.subpaths).toEqual(['./log']);
  });
  it('packages/config exports "." and "./log"', () => {
    const e = JSON.parse(readFileSync(join(ROOT, 'packages/config/package.json'), 'utf8')).exports;
    expect(Object.keys(e).sort()).toEqual(['.', './log']);
  });
  it('secrets stays allow [] and reads no environment variable or file (R1)', () => {
    expect(layers().secrets.allow).toEqual([]);
    const walk = (d: string): string[] => existsSync(d) ? (spawnSync('find', [d, '-name', '*.ts', '!', '-name', '*.test.ts'], { encoding: 'utf8' }).stdout ?? '').split('\n').filter(Boolean) : [];
    for (const f of walk(join(ROOT, 'packages/secrets/src'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/process\.env|node:fs|readFile/);
  });
  it('migrate-config.ts is gone from packages/db and @poly/db/migrate no longer exports checkConfig (one validator)', () => {
    expect(existsSync(join(ROOT, 'packages/db/src/migrate-config.ts'))).toBe(false);
    expect(readFileSync(join(ROOT, 'packages/db/src/migrate.ts'), 'utf8')).not.toMatch(/checkConfig|migrate-config/);
  });
  it('apps/migrate calls @poly/config\'s checkConfig, not its own', () => {
    expect(readFileSync(join(ROOT, 'apps/migrate/src/cli.ts'), 'utf8')).toMatch(/from '@poly\/config'/);
  });
  it('the schemaStatus export exists on @poly/db/startup and assertSchemaNotBehind is built on it (R7)', () => {
    const s = readFileSync(join(ROOT, 'packages/db/src/startup.ts'), 'utf8');
    expect(s).toMatch(/export (async )?function schemaStatus/);
    expect(s.match(/schemaStatus\(/g)!.length).toBeGreaterThanOrEqual(2); // the definition and a call from the guard
  });
  it('the committed log schema exists beside the package', () => expect(existsSync(join(ROOT, 'packages/config/log.schema.json'))).toBe(true));
});
