// POLY-85 R5 / criterion 3: the image carries the commit label POLY-100's tag-to-digest check reads.
// Static checks always run. The real build is opt-in: POLY_IMAGE_BUILD=1 (needs docker; qa runs it at build-green).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECRET_NAME_RE } from '../../packages/config/src/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LABEL = 'org.opencontainers.image.revision';
const SHA = 'c0ffee0123456789abcdef0123456789abcdef01';
const src = () => readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
/** Dockerfile lines with continuations joined and comments dropped. */
const lines = () => src().replace(/\\\n/g, ' ').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const stages = () => {
  const out: { name: string; body: string[] }[] = [];
  for (const l of lines()) {
    const m = /^FROM\s+\S+(?:\s+AS\s+(\S+))?/i.exec(l);
    if (m) out.push({ name: m[1] ?? `stage${out.length}`, body: [l] });
    else out.at(-1)?.body.push(l);
  }
  return out;
};
const last = () => stages().at(-1)!;

describe('Dockerfile (static)', () => {
  it('exists at the repo root, with a .dockerignore beside it', () => {
    expect(existsSync(join(ROOT, 'Dockerfile'))).toBe(true);
    expect(existsSync(join(ROOT, '.dockerignore'))).toBe(true);
  });
  it('is multi-stage: a build stage and a final runtime stage', () => expect(stages().length).toBeGreaterThanOrEqual(2));
  it('the base is node:26.12.0-slim pinned by digest, in every stage', () => {
    for (const l of lines().filter((x) => /^FROM\s/i.test(x))) expect(l, l).toMatch(/node:26\.12\.0-slim@sha256:[0-9a-f]{64}/);
  });
  it('the final stage runs as USER node', () => expect(last().body.filter((l) => /^USER\s/i.test(l)).at(-1)).toMatch(/^USER\s+node\b/i));
  it('ARG GIT_COMMIT is declared in the final stage with no default', () => {
    const arg = last().body.find((l) => /^ARG\s+GIT_COMMIT\b/i.test(l));
    expect(arg, 'ARG GIT_COMMIT in the final stage').toBeDefined();
    expect(arg).not.toContain('=');
  });
  it('GIT_COMMIT is the only build arg anywhere', () => {
    const args = lines().filter((l) => /^ARG\s/i.test(l)).map((l) => l.split(/\s+/)[1]!.split('=')[0]);
    expect(args.length).toBeGreaterThan(0);
    for (const a of args) expect(a).toBe('GIT_COMMIT');
  });
  it('a RUN fails the build unless GIT_COMMIT is a full 40-hex sha, before the LABEL', () => {
    const body = last().body;
    const guard = body.findIndex((l) => /^RUN\s/i.test(l) && l.includes('GIT_COMMIT') && l.includes('[0-9a-f]{40}'));
    const label = body.findIndex((l) => /^LABEL\s/i.test(l) && l.includes(LABEL));
    expect(guard, 'sha guard RUN').toBeGreaterThanOrEqual(0);
    expect(label, 'LABEL in the final stage').toBeGreaterThan(guard);
  });
  it(`the final stage LABELs ${LABEL}=$GIT_COMMIT and the source URL`, () => {
    const l = last().body.filter((x) => /^LABEL\s/i.test(x)).join(' ');
    expect(l).toMatch(new RegExp(`${LABEL.replace(/\./g, '\\.')}="?\\$\\{?GIT_COMMIT\\}?"?`));
    expect(l).toContain('org.opencontainers.image.source=https://github.com/richmosko/polycarpic');
  });
  it('the LABEL is not in an earlier stage only (labels do not cross stages)', () => {
    expect(last().body.some((l) => /^LABEL\s/i.test(l) && l.includes(LABEL))).toBe(true);
  });
  it('ENV POLY_IMAGE_REVISION=$GIT_COMMIT in the final stage', () => {
    expect(last().body.some((l) => /^ENV\s/i.test(l) && /POLY_IMAGE_REVISION=("?)\$\{?GIT_COMMIT\}?\1/.test(l))).toBe(true);
  });
  it('no ARG or ENV (any stage) has a secret-looking name (the one exported pattern, S-1)', () => {
    for (const l of lines().filter((x) => /^(ARG|ENV)\s/i.test(x))) {
      const names = l.replace(/^(ARG|ENV)\s+/i, '').split(/\s+/).map((t) => t.split('=')[0]!);
      for (const nm of names) expect(SECRET_NAME_RE.test(nm), `${l}`).toBe(false);
    }
  });
  it('S-9(c): every COPY in the final stage is --from= (nothing comes from the build context directly)', () => {
    const copies = last().body.filter((l) => /^COPY\s/i.test(l));
    expect(copies.length).toBeGreaterThan(0);
    for (const c of copies) expect(c, c).toMatch(/^COPY\s+(--chown=\S+\s+)?--from=\S+/i);
  });
  it('S-9(c): no committed .npmrc carries _auth or _authToken', () => {
    const files = spawnSync('git', ['ls-files', '*.npmrc', '.npmrc'], { encoding: 'utf8', cwd: ROOT }).stdout.split('\n').filter(Boolean);
    for (const f of files) expect(readFileSync(join(ROOT, f), 'utf8'), f).not.toMatch(/_auth/i);
  });
  it('no COPY of an env file, key, or a secrets directory', () => {
    for (const l of lines().filter((x) => /^(COPY|ADD)\s/i.test(x))) expect(l, l).not.toMatch(/\.env|\.pem|\.key|secrets?\b/i);
  });
  it('ships the migrations including meta/_journal.json (POLY-100 reads the journal)', () => {
    expect(src()).toMatch(/migrations/);
  });
  it('ENTRYPOINT is the polycarpic dispatcher in exec form', () => expect(lines().filter((l) => /^ENTRYPOINT\s/i.test(l)).at(-1)).toBe('ENTRYPOINT ["/app/bin/polycarpic"]'));
  it('pnpm is installed with --allow-scripts=pnpm at 12.18.0, never via corepack or npx', () => {
    expect(src()).toMatch(/npm i(nstall)? -g --allow-scripts=pnpm pnpm@12\.18\.0/);
    expect(src()).not.toMatch(/corepack|npx /);
  });
  it('installs from the frozen lockfile', () => expect(src()).toMatch(/pnpm install --frozen-lockfile/));
});

describe('.dockerignore', () => {
  const ign = () => readFileSync(join(ROOT, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const want of ['.git', '**/node_modules', 'temp', 'docs', 'process', 'prototype', 'tests', '.claude', '**/*.test.ts', '.env*', '**/secrets']) {
    it(`excludes ${want}`, () => expect(ign()).toContain(want));
  }
});

describe('bin/polycarpic dispatcher', () => {
  const p = join(ROOT, 'bin', 'polycarpic');
  it('exists, is executable, and is POSIX sh', () => {
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).mode & 0o111).not.toBe(0);
    expect(readFileSync(p, 'utf8').split('\n')[0]).toMatch(/^#!\/bin\/sh\b/);
  });
  it('dispatches web, worker, migrate, status and cli, with exec  [POLY-142 C9, red if: no `cli` entry running apps/worker/src/cli/main.ts]', () => {
    const s = readFileSync(p, 'utf8');
    for (const c of ['web', 'worker', 'migrate', 'status', 'cli']) expect(s, c).toMatch(new RegExp(`\\b${c}\\b`));
    expect(s).toMatch(/\bexec\s+node\b/);
    expect(s).toMatch(/^\s*cli\)\s+exec node "\$here\/apps\/worker\/src\/cli\/main\.ts" "\$@"/m);
  });
  it('an unknown command exits non-zero without running node', () => {
    const r = spawnSync('sh', [p, 'bogus-command'], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBeNull();
  });
});

describe.skipIf(process.env.POLY_IMAGE_BUILD !== '1')('real build (POLY_IMAGE_BUILD=1)', () => {
  const tag = `polycarpic-qa-image:${process.pid}`;
  const sh = (args: string[], env: Record<string, string> = {}) => spawnSync('docker', args, { encoding: 'utf8', timeout: 900_000, cwd: ROOT, env: { ...process.env, ...env } });
  it('building without GIT_COMMIT fails', () => {
    const r = sh(['build', '-t', `${tag}-nosha`, '.']);
    expect(r.status).not.toBe(0);
  }, 900_000);
  it('building with a non-sha GIT_COMMIT fails', () => {
    for (const bad of ['main', 'abc123', 'C0FFEE0123456789ABCDEF0123456789ABCDEF01', SHA.slice(0, 39)]) {
      expect(sh(['build', '--build-arg', `GIT_COMMIT=${bad}`, '-t', `${tag}-bad`, '.']).status, bad).not.toBe(0);
    }
  }, 900_000);
  it('building with the sha: the label equals it, read the way POLY-100 reads it', () => {
    const b = sh(['build', '--build-arg', `GIT_COMMIT=${SHA}`, '-t', tag, '.']);
    expect(b.status, b.stderr.slice(-800)).toBe(0);
    const i = sh(['image', 'inspect', '--format', `{{ index .Config.Labels "${LABEL}" }}`, tag]);
    expect(i.stdout.trim()).toBe(SHA);
    const e = sh(['image', 'inspect', '--format', '{{ range .Config.Env }}{{ println . }}{{ end }}', tag]);
    expect(e.stdout).toContain(`POLY_IMAGE_REVISION=${SHA}`);
  }, 900_000);
  it('the image runs as a non-root user and holds no secret-named env', () => {
    const u = sh(['image', 'inspect', '--format', '{{ .Config.User }}', tag]);
    expect(u.stdout.trim()).toBe('node');
  });
  it('`docker run <img> migrate check-config` with an empty env exits 1', () => {
    const r = sh(['run', '--rm', tag, 'migrate', 'check-config']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/check-config:/);
  }, 120_000);
  it('web check-config and worker check-config likewise exit 1 on an empty env', () => {
    for (const c of ['web', 'worker']) expect(sh(['run', '--rm', tag, c, 'check-config']).status, c).toBe(1);
  }, 120_000);
  it('the image contains no test files, docs, tracker or .git', () => {
    const r = sh(['run', '--rm', '--entrypoint', 'sh', tag, '-c', 'find /app \\( -name "*.test.ts" -o -name .git -o -name docs -o -name process -o -name temp \\) -not -path "*/node_modules/*" | head -5']);
    expect(r.stdout.trim()).toBe('');
  }, 120_000);
});
