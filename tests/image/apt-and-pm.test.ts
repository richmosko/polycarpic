// POLY-96 ruling Addendum 1: A1 (apt trust) and A4 (the runtime image carries no package manager).
// Static checks always run; the built-image checks are opt-in: POLY_IMAGE_BUILD=1 (needs docker).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dockerfiles = () => readdirSync(ROOT).filter((f) => /^Dockerfile/.test(f));
const joined = (f: string) => readFileSync(join(ROOT, f), 'utf8').replace(/\\\n/g, ' ').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
/** Check one RUN-ish line against the A1 rules. Returns the violations. */
export function aptViolations(line: string): string[] {
  const v: string[] = [];
  if (/--allow-unauthenticated|--allow-insecure-repositories|--allow-downgrades|--allow-remove-essential|--allow-change-held-packages/.test(line)) v.push('allow-* flag');
  if (/\[[^\]]*trusted\s*=\s*yes[^\]]*\]/i.test(line)) v.push('trusted=yes');
  if (/Acquire::|APT::Get::/i.test(line)) v.push('Acquire::/APT::Get:: option');
  if (/apt-key|add-apt-repository|signed-by|sources\.list|\/etc\/apt\/(sources|trusted|keyrings)/.test(line)) v.push('added source or key');
  for (const m of line.matchAll(/\bapt(?:-get)?\b((?:\s+-\S+)*)\s+([a-z-]+)/g)) {
    if (!['update', 'upgrade'].includes(m[2]!)) v.push(`apt ${m[2]} (only update and upgrade are ruled)`);
  }
  return v;
}

describe('A1: apt uses the base image\'s own signed sources, upgrade only', () => {
  it('the Dockerfile exists and calls apt-get upgrade (the ruled in-place upgrade)', () => {
    expect(existsSync(join(ROOT, 'Dockerfile'))).toBe(true);
    expect(joined('Dockerfile').join('\n')).toMatch(/apt-get[^\n]* upgrade/);
  });
  it('no Dockerfile* breaks the A1 rules  [red if: --allow-unauthenticated, [trusted=yes], Acquire::, dist-upgrade, apt install, an added source/key]', () => {
    for (const f of dockerfiles()) for (const l of joined(f)) expect(aptViolations(l), `${f}: ${l}`).toEqual([]);
  });
  it('the matcher catches each forbidden form (mutation check on the test itself)', () => {
    for (const bad of [
      'RUN apt-get -y --allow-unauthenticated upgrade', 'RUN apt-get --allow-insecure-repositories update', 'RUN apt-get --allow-downgrades upgrade',
      'RUN echo "deb [trusted=yes] http://x/ stable main" > /etc/apt/sources.list.d/x.list', 'RUN apt-get -o Acquire::AllowInsecureRepositories=true update',
      'RUN apt-get -o APT::Get::AllowUnauthenticated=true upgrade', 'RUN apt-get dist-upgrade -y', 'RUN apt-get full-upgrade', 'RUN apt-get install -y curl',
      'RUN apt-get update && apt-get -y install git', 'RUN apt-key add x.gpg',
    ]) expect(aptViolations(bad), bad).not.toEqual([]);
    expect(aptViolations('RUN apt-get update && apt-get -y --no-install-recommends upgrade && rm -rf /var/lib/apt/lists/*')).toEqual([]);
  });
});

describe('A4: no package manager in the runtime image (static)', () => {
  it('the Dockerfile removes /usr/local/lib/node_modules in the runtime stage and runs as node', () => {
    const lines = joined('Dockerfile');
    const lastFrom = lines.map((l, i) => (/^FROM\s/i.test(l) ? i : -1)).filter((i) => i >= 0).at(-1)!;
    const runtime = lines.slice(lastFrom).join('\n');
    expect(runtime).toMatch(/rm -rf[^\n]*\/usr\/local\/lib\/node_modules/);
    expect(runtime).toMatch(/^USER node$/m);
  });
  it('nothing in bin/ or apps/*/src invokes npm, npx, pnpm, yarn or corepack at runtime  [red if: a script shells out to a package manager]', () => {
    const files: string[] = [];
    const walk = (p: string) => { if (!existsSync(p)) return; if (statSync(p).isFile()) { files.push(p); return; } for (const e of readdirSync(p)) if (e !== 'node_modules') walk(join(p, e)); };
    walk(join(ROOT, 'bin'));
    for (const a of readdirSync(join(ROOT, 'apps'))) walk(join(ROOT, 'apps', a, 'src'));
    const PM = /(^|[;&|(`]\s*|\$\(\s*)(npm|npx|pnpm|yarn|corepack)\s+\S|(spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*['"`](npm|npx|pnpm|yarn|corepack)\b/m;
    for (const f of files.filter((x) => !/\.test\.[jt]s$/.test(x))) expect(readFileSync(f, 'utf8'), f).not.toMatch(PM);
  });
});

describe.skipIf(process.env.POLY_IMAGE_BUILD !== '1')('A4 on the built image (POLY_IMAGE_BUILD=1)', () => {
  const tag = `polycarpic-qa-pm:${process.pid}`;
  const SHA = 'c0ffee0123456789abcdef0123456789abcdef01';
  const docker = (args: string[]) => spawnSync('docker', args, { encoding: 'utf8', timeout: 900_000, cwd: ROOT });
  it('build', () => { const b = docker(['build', '--build-arg', `GIT_COMMIT=${SHA}`, '-t', tag, '.']); expect(b.status, b.stderr.slice(-500)).toBe(0); }, 900_000);
  for (const pm of ['npm', 'npx', 'corepack', 'pnpm', 'yarn']) {
    it(`${pm} does not resolve on PATH  [red if: the node_modules tree or its shims return]`, () => {
      const r = docker(['run', '--rm', '--entrypoint', 'sh', tag, '-c', `command -v ${pm}`]);
      expect(r.status).not.toBe(0);
      expect(r.stdout.trim()).toBe('');
    });
  }
  it('/usr/local/lib/node_modules is absent and the User is node', () => {
    expect(docker(['run', '--rm', '--entrypoint', 'sh', tag, '-c', 'test ! -e /usr/local/lib/node_modules']).status).toBe(0);
    expect(docker(['image', 'inspect', '--format', '{{ .Config.User }}', tag]).stdout.trim()).toBe('node');
  });
  it('apt is present only because the process is not root: apt-get update as node fails', () => {
    expect(docker(['run', '--rm', '--entrypoint', 'sh', tag, '-c', 'apt-get update']).status).not.toBe(0);
  });
});
