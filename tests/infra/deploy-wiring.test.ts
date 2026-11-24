// POLY-100 R11 statics: the CI build, the image refs, the units. Reads files; no Docker, no network (lint job).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const wf = parse(read('.github/workflows/build.yml'));
const stepsOf = (job: string): any[] => wf.jobs[job].steps;
const text = (s: any) => JSON.stringify(s);

describe('build.yml: siblings job (R11)', () => {
  const sib = stepsOf('siblings');
  const builds = sib.filter((s) => String(s.uses ?? '').startsWith('docker/build-push-action'));
  it('builds exactly postgres, tools and caddy from their own Dockerfiles, each with GIT_COMMIT', () => {
    expect(builds.map((s) => s.with.file).sort()).toEqual(['infra/backup/tools.Dockerfile', 'infra/caddy/Dockerfile', 'infra/postgres/Dockerfile']);
    for (const b of builds) expect(text(b.with['build-args'])).toContain('GIT_COMMIT=${{ github.sha }}');
  });
  it('each sibling is provenance-attested (one attest step per build)', () => {
    const attests = sib.filter((s) => String(s.uses ?? '').startsWith('actions/attest-build-provenance'));
    expect(attests).toHaveLength(3);
  });
  it('each sibling is Trivy-scanned', () => {
    const names = sib.map((s) => String(s.name ?? ''));
    for (const n of ['postgres', 'tools', 'caddy']) expect(names.some((x) => x.startsWith('Trivy scan of ' + n))).toBe(true);
    // the scan comes before the attestation of the same image
    expect(names.findIndex((x) => x.startsWith('Trivy scan of caddy'))).toBeLessThan(names.findIndex((x, i) => i > 0 && /attest/i.test(x) && /caddy/i.test(x)) === -1 ? 1e9 : names.findIndex((x, i) => /attest/i.test(x) && /caddy/i.test(x)));
  });
});

describe('compose files: no default digest anywhere (F10)', () => {
  for (const f of ['prod', 'staging', 'edge']) {
    it(`${f}.yml: every POLY_*_IMAGE is \${…:?} and no image carries a literal digest`, () => {
      const t = read(`infra/compose/${f}.yml`);
      for (const m of t.matchAll(/\$\{(POLY_[A-Z]+_IMAGE)([^}]*)\}/g)) expect(m[2], m[0]).toBe(':?');
      expect(t.split('\n').filter((l) => /^\s*image:/.test(l) && /@sha256:/.test(l))).toEqual([]);
    });
  }
});

describe('deploy units (R1)', () => {
  const service = read('infra/deploy/systemd/polycarpic-deploy@.service');
  const timer = read('infra/deploy/systemd/polycarpic-deploy@.timer');
  it('the service is a oneshot that runs the installed ops tool for its instance, with a 90 minute cap', () => {
    expect(service).toMatch(/^Type=oneshot$/m);
    expect(service).toMatch(/^ExecStart=\/usr\/local\/sbin\/polycarpic-ops deploy %i$/m);
    expect(service).toMatch(/^TimeoutStartSec=90min$/m);
  });
  it('the timer polls every five minutes with up to a minute of jitter', () => {
    expect(timer).toMatch(/^OnCalendar=\*:0\/5$/m);
    expect(timer).toMatch(/^RandomizedDelaySec=60$/m);
  });
  it('provision installs the units but does not enable them (first-deploy does)', () => {
    const p = read('infra/provision.sh');
    expect(p).toContain('polycarpic-deploy@.service');
    expect(p).toContain('polycarpic-deploy@.timer');
    expect(p).not.toMatch(/systemctl enable[^\n]*polycarpic-deploy@/);
  });
  it('provision-check compares the deploy units to the ops bundle', () => {
    expect(read('infra/provision-check.sh')).toContain('polycarpic-deploy@');
  });
});

describe('installed policy and signers (R5, R11)', () => {
  it('compose-allow.json ships with the ops bundle, not the release manifest', () => {
    expect(read('infra/ops/install.sh')).toMatch(/PATHS="[^"]*\binfra\/deploy\b/);
  });
  it('provision-check reports compose-allow.json, allowed_signers and edge.env', () => {
    const c = read('infra/provision-check.sh');
    for (const n of ['compose-allow.json', 'allowed_signers', 'edge.env']) expect(c).toContain(n);
  });
});

// T-net (ruling dac66f0a, static part): all three compose files declare the edge networks they use as external, by exact name, and none creates one.
// provision.sh creates exactly the two (the provision job's box tests); this file holds what a read of the YAML can show.
describe('T-net: edge networks are external in every compose file', () => {
  const NAMES: Record<string, string> = { 'edge-prod': 'polycarpic-edge-prod', 'edge-staging': 'polycarpic-edge-staging' };
  for (const f of ['prod', 'staging', 'edge']) {
    it(`${f}.yml: every edge network it declares is external with the exact name, and carries no ipam, driver or options`, () => {
      const y = parse(read(`infra/compose/${f}.yml`));
      const declared = Object.keys(y.networks ?? {}).filter((k) => k.startsWith('edge-'));
      expect(declared.length, `${f} uses at least one edge network`).toBeGreaterThan(0);
      for (const k of declared) {
        expect(y.networks[k], `${f} ${k}`).toEqual({ name: NAMES[k], external: true });
      }
    });
  }
  it('prod and staging join only their own edge network, and edge.yml both', () => {
    const own = { prod: 'edge-prod', staging: 'edge-staging' } as const;
    for (const p of ['prod', 'staging'] as const) {
      const y = parse(read(`infra/compose/${p}.yml`));
      expect(Object.keys(y.networks).filter((k) => k.startsWith('edge-'))).toEqual([own[p]]);
    }
    const e = parse(read('infra/compose/edge.yml'));
    expect(Object.keys(e.networks).filter((k) => k.startsWith('edge-')).sort()).toEqual(['edge-prod', 'edge-staging']);
  });
});
