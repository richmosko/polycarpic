// POLY-138 R7 (ruling d5ead294): the property behind the xcaddy rebuild, not the mechanism, so these survive its removal.
//  - the built Caddy's EFFECTIVE golang.org/x/net (the `=>` replacement when there is one) is >= 0.62.0;
//  - the pinned builder verifies Go module checksums (sum.golang.org, nothing private, insecure or excluded).
// The parsers are pure and have their own red/green cases, so each assertion is shown able to fail without a rebuild.
// Runs in the `image` job (needs a Docker daemon; the builder image is the one the Caddy Dockerfile already pulls).
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sh } from './stack.ts';

/** `go version -m` output -> the effective x/net version (a `=>` replacement wins), or null. */
const effectiveXNet = (out: string): string | null => {
  const ls = out.split('\n');
  const i = ls.findIndex((l) => /^\s*dep\s+golang\.org\/x\/net\s/.test(l));
  if (i < 0) return null;
  const rep = /^\s*=>\s+golang\.org\/x\/net\s+(v\S+)/.exec(ls[i + 1] ?? '');
  return rep ? rep[1]! : (/golang\.org\/x\/net\s+(v\S+)/.exec(ls[i]!)?.[1] ?? null);
};
const atLeast = (v: string, min: string) => {
  const a = v.replace(/^v/, '').split('.').map(Number), b = min.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};
/** `go env -json` output -> the checksum-weakening settings found. */
const weakChecksums = (env: Record<string, string>): string[] => {
  const bad: string[] = [];
  if (env.GOSUMDB !== 'sum.golang.org') bad.push(`GOSUMDB=${env.GOSUMDB}`);
  for (const k of ['GONOSUMDB', 'GOPRIVATE', 'GOINSECURE']) if (env[k]) bad.push(`${k}=${env[k]}`);
  return bad;
};

describe('the parsers (pure): each assertion can be red', () => {
  const dep = '\tdep\tgolang.org/x/net\tv0.60.0\th1:abc';
  it('a replacement line wins over the dep line', () => expect(effectiveXNet(`${dep}\n\t=>\tgolang.org/x/net\tv0.62.0\th1:def`)).toBe('v0.62.0'));
  it('no replacement: the dep line is the version', () => expect(effectiveXNet(dep)).toBe('v0.60.0'));
  it('no x/net at all is null (the test then fails, it does not pass)', () => expect(effectiveXNet('\tdep\tgolang.org/x/text\tv0.1.0')).toBeNull());
  it('0.60.0 is below the fix; 0.62.0 and 0.63.1 are not', () => {
    expect(atLeast('v0.60.0', 'v0.62.0')).toBe(false);
    expect(atLeast('v0.62.0', 'v0.62.0')).toBe(true);
    expect(atLeast('v0.63.1', 'v0.62.0')).toBe(true);
  });
  it('a weakened environment is reported, a clean one is not', () => {
    expect(weakChecksums({ GOSUMDB: 'off', GONOSUMDB: '', GOPRIVATE: '', GOINSECURE: '' })).toEqual(['GOSUMDB=off']);
    expect(weakChecksums({ GOSUMDB: 'sum.golang.org', GONOSUMDB: '', GOPRIVATE: 'example.com', GOINSECURE: '' })).toEqual(['GOPRIVATE=example.com']);
    expect(weakChecksums({ GOSUMDB: 'sum.golang.org', GONOSUMDB: '', GOPRIVATE: '', GOINSECURE: '' })).toEqual([]);
  });
});

describe('the built Caddy and its builder', () => {
  const df = readFileSync(join(ROOT, 'infra', 'caddy', 'Dockerfile'), 'utf8');
  const BUILDER = (/^FROM (caddy:\S+-builder@sha256:[0-9a-f]{64}) AS build/m.exec(df) ?? [])[1] ?? '';
  const IMG = 'poly138-caddy-build:test';
  it('the effective golang.org/x/net in /usr/bin/caddy is >= 0.62.0', { timeout: 300_000 }, () => {
    expect(BUILDER, 'the pinned builder FROM line').not.toBe('');
    const b = sh('docker', ['build', '-t', IMG, join(ROOT, 'infra', 'caddy')]);
    expect(b.code, b.err.slice(-400)).toBe(0);
    const name = `poly138bin${process.pid}`;
    const dir = mkdtempSync(join(tmpdir(), 'poly138-bin-'));
    try {
      expect(sh('docker', ['create', '--name', name, IMG]).code).toBe(0);
      const cp = sh('docker', ['cp', `${name}:/usr/bin/caddy`, join(dir, 'caddy')]);
      expect(cp.code, cp.err).toBe(0);
      const v = sh('docker', ['run', '--rm', '-v', `${dir}:/b:ro`, '--entrypoint', 'go', BUILDER, 'version', '-m', '/b/caddy']);
      expect(v.code, v.err).toBe(0);
      const eff = effectiveXNet(v.out);
      expect(eff, 'the binary lists golang.org/x/net').not.toBeNull();
      expect(atLeast(eff!, 'v0.62.0'), `effective x/net ${eff}`).toBe(true); // red: no replacement (the stock binary bundles 0.60.0)
    } finally { sh('docker', ['rm', '-f', name]); rmSync(dir, { recursive: true, force: true }); }
  });
  it('the pinned builder verifies checksums: GOSUMDB=sum.golang.org, GONOSUMDB/GOPRIVATE/GOINSECURE empty', () => {
    expect(BUILDER).not.toBe('');
    const r = sh('docker', ['run', '--rm', '--entrypoint', 'go', BUILDER, 'env', '-json', 'GOSUMDB', 'GONOSUMDB', 'GOPRIVATE', 'GOINSECURE']);
    expect(r.code, r.err).toBe(0);
    expect(weakChecksums(JSON.parse(r.out))).toEqual([]); // red: a builder (or image ENV) that sets any of them
  });
});
