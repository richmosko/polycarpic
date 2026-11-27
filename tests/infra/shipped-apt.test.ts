// POLY-167 R3: the apt rules (SECURITY C-80, A1) and the in-place upgrade, for every Dockerfile build.yml builds.
// A digest pin never moves by itself; the final stage's `apt-get upgrade` is how the weekly rebuild takes Debian fixes.
// Reads files only. It lives here, not in tests/image, because the `lint` job runs this suite when either a Dockerfile
// under infra/ or build.yml changes.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { aptViolations } from './apt-rules.ts';
import { shippedImages } from './shipped-images.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p: string): string | undefined => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : undefined);
const buildYml = () => parse(read('.github/workflows/build.yml')!);

/** Dockerfiles whose final stage need not run `apt-get upgrade`. A second entry is a ruling, and a visible edit here. */
const NO_APT_UPGRADE: Record<string, string> = {
  'infra/caddy/Dockerfile': 'Alpine, no apt; its digests are refreshed by the Renovate lookup',
};

/** The ruled installs (a new package needs its own ruling). `earlier` is for stages that do not ship. */
const RULED: Record<string, { final: RegExp[]; earlier: RegExp[] }> = {
  'infra/postgres/Dockerfile': { final: [/^age=\S+$/], earlier: [] },
  'infra/backup/tools.Dockerfile': { final: [/^ca-certificates$/, /^curl$/], earlier: [/^ca-certificates$/, /^curl$/, /^unzip$/] },
};

const stagesOf = (text: string): string[][] => {
  const out: string[][] = [];
  const lines = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n').replace(/\\\n/g, ' ').split('\n').map((l) => l.trim());
  for (const l of lines.filter(Boolean)) {
    if (/^FROM\s/i.test(l)) out.push([]);
    out.at(-1)?.push(l);
  }
  return out;
};

/** The line with each ruled install removed, so what is left must pass A1 as written (update and upgrade only). */
const dropRuled = (line: string, ruled: RegExp[]) =>
  line.replace(/\bapt-get((?:\s+-\S+)*)\s+install((?:\s+(?![&;|])\S+)+)/g, (whole, _flags: string, rest: string) => {
    const packages = rest.trim().split(/\s+/).filter((w) => !['-y', '--no-install-recommends'].includes(w));
    return packages.every((p) => ruled.some((r) => r.test(p))) ? 'true' : whole;
  });

/** True when a RUN refreshes the lists and then really upgrades: not simulated, and its failure not swallowed. */
const upgrades = (line: string) => {
  if (!/^RUN\s/i.test(line) || /\|\|/.test(line)) return false;
  const m = /\bapt-get(?:\s+-\S+)*\s+update\s+&&[^;|]*?\bapt-get((?:\s+-\S+)*)\s+upgrade\b((?:\s+-\S+)*)/.exec(line);
  return m !== null && !/(^|\s)(-s|-d|--simulate|--dry-run|--just-print|--no-act|--recon|--download-only)(\s|$)/.test(`${m[1]} ${m[2]}`);
};

export function shippedAptViolations(workflow: unknown, readFile: (p: string) => string | undefined): string[] {
  const { images, problems } = shippedImages(workflow);
  const v = [...problems];
  for (const { file } of images) {
    const text = readFile(file);
    if (text === undefined) { v.push(`${file}: build.yml builds it and it cannot be read`); continue; }
    const stages = stagesOf(text);
    if (stages.length === 0) { v.push(`${file}: no FROM`); continue; }
    stages.forEach((stage, i) => {
      const ruled = RULED[file]?.[i === stages.length - 1 ? 'final' : 'earlier'] ?? [];
      for (const line of stage) for (const why of aptViolations(dropRuled(line, ruled))) v.push(`${file}: ${why}`);
    });
    if (!(file in NO_APT_UPGRADE) && !stages.at(-1)!.some(upgrades)) v.push(`${file}: the final stage does not run apt-get update && apt-get upgrade`);
  }
  for (const f of Object.keys(NO_APT_UPGRADE)) if (!images.some((i) => i.file === f)) v.push(`${f}: excepted, but build.yml does not build it`);
  return v;
}

describe('R3: every Dockerfile build.yml builds follows the apt rules and upgrades in its final stage', () => {
  it('the committed tree is clean', () => {
    expect(shippedAptViolations(buildYml(), read)).toEqual([]);
  });
  it('reaches the four shipped Dockerfiles, and Caddy is the one exception', () => {
    expect(shippedImages(buildYml()).images.map((i) => i.file).sort()).toEqual(['Dockerfile', 'infra/backup/tools.Dockerfile', 'infra/caddy/Dockerfile', 'infra/postgres/Dockerfile']);
    expect(Object.keys(NO_APT_UPGRADE)).toEqual(['infra/caddy/Dockerfile']);
    expect(stagesOf(read('infra/caddy/Dockerfile')!).at(-1)!.join('\n')).not.toMatch(/\bapt(-get)?\s/);
  });

  const TOOLS = 'infra/backup/tools.Dockerfile';
  const withTools = (edit: (t: string) => string) => (p: string) => {
    const t = read(p);
    if (p !== TOOLS) return t;
    const out = edit(t!);
    expect(out, 'the mutation changed nothing').not.toEqual(t);
    return out;
  };
  const UPGRADE = ' && apt-get -y --no-install-recommends upgrade';
  it.each<[string, (t: string) => string]>([
    ['(a) the upgrade removed', (t) => t.replace(UPGRADE, '')],
    ['the upgrade only in the stage that does not ship', (t) => t.replace(UPGRADE, '').replace('RUN apt-get update', `RUN apt-get update${UPGRADE}`)],
    ['a simulated upgrade', (t) => t.replace(UPGRADE, ' && apt-get -s upgrade')],
    ['a swallowed failure', (t) => t.replace(' && rm -rf /var/lib/apt/lists/*', ' || true')],
    ['no update before the upgrade', (t) => t.replace(`RUN apt-get update${UPGRADE}`, 'RUN apt-get -y upgrade')],
    ['dist-upgrade', (t) => t.replace(UPGRADE, `${UPGRADE} && apt-get -y dist-upgrade`)],
    ['an unauthenticated upgrade', (t) => t.replace(UPGRADE, ' && apt-get -y --allow-unauthenticated upgrade')],
    ['an added package', (t) => t.replace('ca-certificates curl && rm', 'ca-certificates curl git && rm')],
  ])('red: tools.Dockerfile with %s', (_name, edit) => {
    expect(shippedAptViolations(buildYml(), withTools(edit))).not.toEqual([]);
  });

  const extra = (step: object) => {
    const w = buildYml();
    w.jobs.siblings.steps.push({ name: 'Build and push extra', ...step });
    return w;
  };
  const ACTION = 'docker/build-push-action@0000000000000000000000000000000000000000';
  const reads = (p: string) => (p === 'infra/extra/Dockerfile' ? 'FROM debian:bookworm-slim\nRUN true\n' : read(p));
  it.each<[string, object]>([
    ['(b) an extra image whose Dockerfile does not upgrade', { uses: ACTION, with: { context: 'infra/extra', file: 'infra/extra/Dockerfile' } }],
    ['an extra image with the default file name', { uses: ACTION, with: { context: 'infra/extra' } }],
    ['an extra image whose Dockerfile cannot be read', { uses: ACTION, with: { context: 'infra/nowhere' } }],
    ['a file name built from an expression', { uses: ACTION, with: { context: '.', file: '${{ env.FILE }}' } }],
    ['an image built by a run step', { run: 'docker buildx build --push infra/extra' }],
    ['a bake build', { uses: 'docker/bake-action@0000000000000000000000000000000000000000' }],
  ])('red: a build.yml with %s', (_name, step) => {
    expect(shippedAptViolations(extra(step), reads)).not.toEqual([]);
  });
});
