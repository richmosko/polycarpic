// POLY-96 stage 3 -- .github/workflows/release.yml and infra/ci/release-lookup.sh (ruling §5): criterion 3.
// release-lookup.sh contract: `release-lookup.sh <40-hex commit>`; env STUB_* drive PATH stubs of gh/git/docker
// (the stubs live in a temp dir put first on PATH). Success: exit 0 and the LAST stdout line is `digest: sha256:<64 hex>`.
// Any failed check (no build run for the commit, label != commit, attestation verify fails): non-zero, and NO `digest:` line.
// Stub contract used here: `gh run list ...` prints the run id (empty = none); `gh run download ... -D <dir>` writes <dir>/digest.txt
// with the digest; `gh attestation verify ...` exits $STUB_ATTEST_RC; `docker ...inspect...` prints the revision label ($STUB_LABEL),
// as the bare value when called with --format and as {"Config":{"Labels":{"org.opencontainers.image.revision":...}}} otherwise.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ci, needsOf, ROOT, steps, wf, wfText } from './helpers.ts';

const w = wf('release.yml');
const text = wfText('release.yml');
const COMMIT = 'd'.repeat(40);
const DIGEST = 'sha256:' + 'e'.repeat(64);

describe('release.yml structure', () => {
  it('.github/workflows/release.yml exists', () => { expect(text).not.toBe(''); });
  it('triggers: push of v1.* tags and a dispatch with a `commit` input; top-level permissions {}', () => {
    expect(Object.keys(w.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect((w.on.push as { tags: string[] }).tags).toEqual(['v1.*']);
    expect((w.on.workflow_dispatch as { inputs: Record<string, unknown> }).inputs.commit).toBeDefined();
    expect(w.permissions).toEqual({});
  });
  it('jobs verify and publish; publish needs verify and is unreachable on dispatch (dry-run only)  [red if: if: dropped]', () => {
    expect(Object.keys(w.jobs).sort()).toEqual(['publish', 'verify']);
    expect(needsOf(w.jobs.publish!)).toEqual(['verify']);
    expect(w.jobs.publish!.if).toMatch(/github\.event_name == 'push'/);
  });
  it('verify: read-only scopes, no id-token; publish: contents: write only', () => {
    expect(w.jobs.verify!.permissions).toEqual({ contents: 'read', packages: 'read', attestations: 'read', actions: 'read' });
    expect(w.jobs.publish!.permissions).toEqual({ contents: 'write' });
  });
  it('never rebuilds: no docker build, buildx, push, pnpm install, packages: write, id-token  [red if: any appears]', () => {
    expect(text).not.toBe('');
    expect(text).not.toMatch(/docker (build|push)|buildx|build-push-action|pnpm install|packages:\s*write|id-token/);
  });
  it('verify uses release-lookup.sh; the attestation check carries source-ref, signer-workflow, deny-self-hosted (S96-15)', () => {
    const body = steps(w.jobs.verify!).map((s) => s.run ?? '').join('\n');
    expect(body).toMatch(/infra\/ci\/release-lookup\.sh/);
    const sh = (spawnSync('cat', [ci('release-lookup.sh')], { encoding: 'utf8' }).stdout) + text;
    expect(sh).toMatch(/--source-ref refs\/heads\/main/);
    expect(sh).toMatch(/--deny-self-hosted-runners/);
    expect(sh).toMatch(/--signer-workflow richmosko\/polycarpic\/\.github\/workflows\/build\.yml/);
    expect(sh).toMatch(/git verify-tag/);
  });
  it('commit input and tag reach the shell through env, not interpolation (S96-7)', () => {
    expect(Object.keys(w.jobs).length).toBeGreaterThan(0);
    for (const j of Object.values(w.jobs)) for (const s of steps(j)) expect(s.run ?? '').not.toMatch(/\$\{\{\s*(github\.(event|ref_name|head_ref)|inputs\.)/);
  });
  it('publish refuses an existing Release and writes the one-line body', () => {
    const body = steps(w.jobs.publish!).map((s) => s.run ?? '').join('\n');
    expect(body).toMatch(/gh release (view|create)/);
    expect(body).toMatch(/digest: sha256:|digest: \$/);
  });
});

function lookup(o: { run?: string | null; label?: string; attestRc?: number }) {
  if (!existsSync(ci('release-lookup.sh'))) throw new Error('infra/ci/release-lookup.sh does not exist');
  const d = mkdtempSync(join(tmpdir(), 'rl-'));
  const bin = join(d, 'bin'); mkdirSync(bin);
  const stub = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  stub('gh', `
case "$*" in
  *"run list"*) printf '%s' "$STUB_RUN" ;;
  *"run download"*) dir=.; while [ $# -gt 0 ]; do case "$1" in -D|--dir) dir="$2";; esac; shift; done; mkdir -p "$dir"; printf '%s\\n' "$STUB_DIGEST" > "$dir/digest.txt" ;;
  *"attestation verify"*) exit "\${STUB_ATTEST_RC:-0}" ;;
  *) : ;;
esac`);
  stub('docker', `case "$*" in *--format*) printf '%s' "$STUB_LABEL" ;; *) printf '{"Config":{"Labels":{"org.opencontainers.image.revision":"%s"}}}' "$STUB_LABEL" ;; esac`);
  const r = spawnSync('bash', [ci('release-lookup.sh'), COMMIT], {
    cwd: ROOT, encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`, HOME: d, TMPDIR: d, RUNNER_TEMP: d,
      STUB_RUN: o.run === undefined ? '999' : (o.run ?? ''), STUB_DIGEST: DIGEST, STUB_LABEL: o.label ?? COMMIT, STUB_ATTEST_RC: String(o.attestRc ?? 0),
      GITHUB_REPOSITORY: 'richmosko/polycarpic', GH_TOKEN: 'x',
    },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

describe('release-lookup.sh (stubbed gh/docker)', () => {
  it('happy path: last stdout line is `digest: sha256:...` for the digest the build run recorded', () => {
    const r = lookup({});
    expect(r.code, r.err).toBe(0);
    expect(r.out.trim().split('\n').at(-1)).toBe(`digest: ${DIGEST}`);
  });
  it('no build run for the commit -> non-zero, no digest line  [red if: falls back to building/looking up a tag]', () => {
    const r = lookup({ run: '' });
    expect(r.code).not.toBe(0);
    expect(r.out).not.toMatch(/digest:/);
  });
  it('image label differs from the commit -> non-zero  [red if: label check removed]', () => {
    const r = lookup({ label: 'f'.repeat(40) });
    expect(r.code).not.toBe(0);
    expect(r.out).not.toMatch(/digest:/);
  });
  it('attestation verification fails -> non-zero  [red if: verify result ignored]', () => {
    const r = lookup({ attestRc: 1 });
    expect(r.code).not.toBe(0);
    expect(r.out).not.toMatch(/digest:/);
  });
  it('a malformed commit argument is refused', () => {
    expect(existsSync(ci('release-lookup.sh'))).toBe(true);
    const r = spawnSync('bash', [ci('release-lookup.sh'), 'main; rm -rf /'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
  });
});
