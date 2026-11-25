// POLY-161c, verdict B27 (R1, S9, seceng P3): the Dockerfile's web stage, read as instructions and never as text. `violations(df)` returns every rule the file
// breaks; the real file returns none and each mutant (one edit to a copy) returns something, so a comment, the wrong stage or a dropped flag cannot pass.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const real = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');

interface Stage { name: string | null; lines: string[]; index: number }
/** Instructions only: comments gone, continuations joined. */
function stages(df: string): Stage[] {
  const out: Stage[] = [];
  const joined = df.replace(/\\\n/g, ' ').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  for (const l of joined) {
    const m = /^FROM\s+\S+(?:\s+AS\s+(\S+))?$/i.exec(l);
    if (m) out.push({ name: m[1] ?? null, lines: [], index: out.length });
    else out.at(-1)?.lines.push(l);
  }
  return out;
}

export function violations(df: string): string[] {
  const v: string[] = [];
  const all = stages(df);
  const web = all.find((s) => s.name === 'web');
  const last = all.at(-1);
  if (!web) return ['no stage named web'];
  if (!last || last.name !== null) v.push('the last stage is not the unnamed runtime stage');
  if (web === last) v.push('the web stage is the runtime stage');
  // vite build: exactly once, in web, on a RUN with --network=none; never in another stage, and never only in a comment (comments are gone already)
  const vite = all.flatMap((s) => s.lines.filter((l) => /^RUN\b/.test(l) && /\bvite\s+build\b/.test(l)).map((l) => ({ s, l })));
  if (vite.length !== 1) v.push(`vite build is run ${vite.length} times, not once`);
  for (const { s, l } of vite) {
    if (s !== web) v.push(`vite build runs in stage ${s.name ?? 'runtime'}, not web`);
    if (!/^RUN\s+(--\S+\s+)*--network=none\b/.test(l)) v.push('the vite build RUN has no --network=none');
    if (!/\brm -f build\/index\.js build\/server\/adapter-index\.js\b/.test(l)) v.push('the web RUN does not remove index.js and adapter-index.js');
    if (!/\bfind build -name '\*\.map' -delete\b/.test(l)) v.push('the web RUN does not delete the source maps');
    if (!/\bchmod -R a-w build\b/.test(l)) v.push('the web RUN does not make build read-only');
    if (!/bundle-packages\.mjs/.test(l)) v.push('the web RUN does not take the bundle package list');
  }
  // the web stage: a frozen install, no build arg, no env, no secret, no commit
  for (const l of web.lines) {
    if (/^(ARG|ENV)\b/.test(l)) v.push(`the web stage has ${l.split(/\s/)[0]}: ${l.slice(0, 40)}`);
    if (/--mount=type=(secret|ssh)/.test(l)) v.push('the web stage mounts a secret');
    if (/GIT_COMMIT|POLY_IMAGE_REVISION/.test(l)) v.push('the web stage names the commit');
    if (/\bpnpm install\b/.test(l) && !/--frozen-lockfile/.test(l)) v.push('the web stage installs without --frozen-lockfile');
    if (/^COPY\s+--from=/.test(l)) v.push('the web stage copies from another stage');
  }
  if (!web.lines.some((l) => /\bpnpm install\b/.test(l))) v.push('the web stage installs nothing');
  // out of web: one COPY, to the runtime stage, the build directory only, owned by root
  const outs = all.flatMap((s) => s.lines.filter((l) => /^COPY\b/.test(l) && /--from=web\b/.test(l)).map((l) => ({ s, l })));
  if (outs.length !== 1) v.push(`${outs.length} COPY --from=web instructions, not exactly one`);
  for (const { s, l } of outs) {
    if (s !== last) v.push('COPY --from=web is not in the runtime stage');
    if (!/--chown=root:root\b/.test(l)) v.push('COPY --from=web is not owned by root');
    if (!/\s\/app\/apps\/web\/build\s+\/app\/apps\/web\/build$/.test(l)) v.push(`COPY --from=web copies something other than apps/web/build: ${l}`);
  }
  // the runtime stage builds and installs nothing, and is read-only for the build it copies
  for (const l of last?.lines ?? []) {
    if (/\b(vite|pnpm install|npm i)\b/.test(l) && !/npm i -g/.test(l)) v.push(`the runtime stage builds or installs: ${l.slice(0, 50)}`);
    if (/\.svelte-kit/.test(l)) v.push('the runtime stage names .svelte-kit');
  }
  return v;
}

const edit = (from: RegExp | string, to: string) => real.replace(from, to);

describe('the Dockerfile\'s web stage (B27)', () => {
  it('the real file breaks no rule  [red if: the stage is mis-built]', () => {
    expect(violations(real)).toEqual([]);
  });

  const mutants: Array<[string, string, RegExp]> = [
    ['--network=none dropped', edit('RUN --network=none set -eu;', 'RUN set -eu;'), /no --network=none/],
    ['vite build only in a comment', edit(/node_modules\/\.bin\/vite build;/, 'true;'), /vite build is run 0 times/],
    ['vite build moved into the build stage', edit('RUN pnpm install --frozen-lockfile --prod', 'RUN pnpm install --frozen-lockfile --prod\nRUN vite build'), /vite build is run 2 times|not web/],
    ['a build arg in the web stage', edit('FROM node:26.12.0-slim@sha256:e556a144463cc8dc53afe8de6d2fa0db5c132fd39ffa232c17641bd40df2bf11 AS web\nWORKDIR /app', 'FROM node:26.12.0-slim@sha256:e556a144463cc8dc53afe8de6d2fa0db5c132fd39ffa232c17641bd40df2bf11 AS web\nARG GIT_COMMIT\nWORKDIR /app'), /web stage has ARG/],
    ['an env in the web stage', edit('AS web\nWORKDIR /app', 'AS web\nENV X=1\nWORKDIR /app'), /web stage has ENV/],
    ['the install without --frozen-lockfile', edit('RUN pnpm install --frozen-lockfile --filter', 'RUN pnpm install --filter'), /without --frozen-lockfile/],
    ['a second COPY --from=web', real.replace('RUN chmod -R a-w /release', 'COPY --from=web /app /app2\nRUN chmod -R a-w /release'), /2 COPY --from=web/],
    ['COPY --from=web of the whole app', edit('--from=web /app/apps/web/build /app/apps/web/build', '--from=web /app /app'), /something other than apps\/web\/build/],
    ['COPY --from=web not owned by root', edit('COPY --chown=root:root --from=web', 'COPY --chown=node:node --from=web'), /not owned by root/],
    ['index.js not removed', edit('rm -f build/index.js build/server/adapter-index.js;', 'true;'), /index\.js and adapter-index/],
    ['source maps kept', edit("find build -name '*.map' -delete;", 'true;'), /source maps/],
    ['build left writable', edit('chmod -R a-w build', 'true'), /read-only/],
    ['the bundle package list dropped', edit(/node \/app\/infra\/ci\/bundle-packages\.mjs [^;]*;/, 'true;'), /bundle package list/],
    ['the web stage made the last stage', real.replace(/\n# --- runtime[\s\S]*$/, '\n'), /last stage is not the unnamed runtime/],
    ['a secret mount in the web stage', edit('RUN --network=none set -eu;', 'RUN --network=none --mount=type=secret,id=x set -eu;'), /mounts a secret/],
    ['the runtime stage builds', edit('USER node', 'RUN vite build\nUSER node'), /vite build is run 2 times|runtime stage builds/],
  ];
  it.each(mutants)('%s  [red if: the pin lets it through]', (_n, df, re) => {
    expect(df, 'the mutation changed the file').not.toBe(real);
    const v = violations(df);
    expect(v.length).toBeGreaterThan(0);
    expect(v.join('\n')).toMatch(re);
  });
});

// build-review F2: Vite reads an `.env` at build and public-prefixed values go into served code. A bare `.env*` pattern matches only the context's root,
// so an apps/web/.env would reach the web stage. The pins read the file as patterns, never as text.
const dockerignore = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
export function ignoreViolations(text: string): string[] {
  const p = dockerignore(text);
  const v: string[] = [];
  for (const need of ['**/.env*', '**/.svelte-kit', 'apps/web/build', 'apps/web/tests']) if (!p.includes(need)) v.push(`.dockerignore lacks ${need}`);
  if (p.includes('.env*')) v.push('.dockerignore has the root-only `.env*`');
  if (p.some((l) => l.startsWith('!') && /\.env/.test(l))) v.push('.dockerignore re-includes an .env file');
  return v;
}
describe('the build context excludes .env files at any depth (F2)', () => {
  const realIgnore = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
  it('the real .dockerignore breaks no rule  [red if: .env* stays root-only]', () => {
    expect(ignoreViolations(realIgnore)).toEqual([]);
  });
  it.each([
    ['the root-only pattern', realIgnore.replace('**/.env*', '.env*'), /root-only|lacks \*\*\/\.env/],
    ['no .env pattern', realIgnore.replace('**/.env*\n', ''), /lacks \*\*\/\.env\*/],
    ['an .env file re-included', `${realIgnore}\n!apps/web/.env.public\n`, /re-includes/],
    ['.svelte-kit dropped', realIgnore.replace('**/.svelte-kit\n', ''), /lacks \*\*\/\.svelte-kit/],
    ['a comment standing in for the pattern', realIgnore.replace('**/.env*', '# **/.env*'), /lacks \*\*\/\.env\*/],
  ])('%s  [red if: the pin lets it through]', (_n, text, re) => {
    expect(text).not.toBe(realIgnore);
    expect(ignoreViolations(text).join('\n')).toMatch(re);
  });
});
