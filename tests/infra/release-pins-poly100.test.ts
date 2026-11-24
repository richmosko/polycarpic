// POLY-100 T-relyml (R9, S2's mirror): static pins on .github/workflows/release.yml, with mutants. `violations(wf)` lists every pin the workflow breaks.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const real: any = parse(readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8'));
const clone = () => structuredClone(real);

const V1 = String.raw`^v1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`;
const EDGE = String.raw`^edge-(0|[1-9][0-9]*)$`;

export function violations(wf: any): string[] {
  const v: string[] = [];
  const tags = [].concat(wf.on?.push?.tags ?? []).sort();
  if (JSON.stringify(tags) !== JSON.stringify(['edge-*', 'v1.*'])) v.push(`triggers are ${tags.join(',')}, not exactly v1.* and edge-*`);
  const verify = wf.jobs?.verify?.steps ?? [];
  const checkout = verify.findIndex((s: any) => String(s.uses ?? '').startsWith('actions/checkout'));
  const first = verify.find((s: any, i: number) => i > checkout && s.run); // the first step that runs anything
  const run = String(first?.run ?? '');
  if (!run.includes(V1)) v.push('the first step does not hold the full v1 regex');
  if (!run.includes(EDGE)) v.push('the first step does not hold the full edge regex');
  if (!/exit 1/.test(run) || !/\[\[ .*=~|grep -E|grep -Eq/.test(run)) v.push('the first step does not refuse a tag matching neither regex');
  const all = JSON.stringify(verify);
  if (!/cat-file tag/.test(all) || !/sed -n 's\/\^tag \/\/p'/.test(String(verify.map((s: any) => s.run ?? '').join('\n')))) v.push("the tag object's own name is not read");
  if (!/= "\$TAG"/.test(verify.map((s: any) => s.run ?? '').join('\n'))) v.push("the tag object's name is not compared with the ref, for both kinds");
  const pub = wf.jobs?.publish;
  if (JSON.stringify(pub?.permissions) !== '{"contents":"write"}') v.push('publish does not hold contents: write alone');
  const pubRun = String((pub?.steps ?? []).map((s: any) => s.run ?? '').join('\n'));
  const flags = pubRun.match(/--latest=false/g) ?? [];
  if (flags.length !== 1) v.push('--latest=false must appear exactly once');
  if (!/case "\$TAG" in edge-\*\) LATEST="--latest=false"/.test(pubRun)) v.push('--latest=false is not set for edge tags only');
  if (/v1\.\*\) LATEST/.test(pubRun)) v.push('a v1 Release is made not-latest');
  if (!/\$LATEST/.test(pubRun)) v.push('the switch is never passed to gh release create');
  for (const [id, job] of Object.entries<any>(wf.jobs ?? {})) if (id !== 'publish' && Object.values(job.permissions ?? {}).some((x) => x === 'write')) v.push(`${id} holds a write scope`);
  return v;
}

describe('release.yml pins (POLY-100 T-relyml)', () => {
  it('the real workflow breaks none', () => expect(violations(real)).toEqual([]));

  const firstRun = (w: any) => w.jobs.verify.steps.find((s: any, i: number) => i > 0 && s.run);
  const mutants: [string, (w: any) => void][] = [
    ['a third trigger pattern', (w) => { w.on.push.tags.push('hotfix-*'); }],
    ['only v1.* triggers', (w) => { w.on.push.tags = ['v1.*']; }],
    ['the regex step dropped', (w) => { const f = firstRun(w); f.run = String(f.run).split(V1).join('x').split(EDGE).join('y'); }],
    ['the edge regex dropped', (w) => { const f = firstRun(w); f.run = String(f.run).split(EDGE).join('y'); }],
    ['the v1 regex dropped', (w) => { const f = firstRun(w); f.run = String(f.run).split(V1).join('x'); }],
    ['the name compare dropped', (w) => { for (const s of w.jobs.verify.steps) if (s.run) s.run = String(s.run).replace(/\[ "\$\(git cat-file tag[^\n]*\n/, ''); }],
    ['the switch-over dropped (edge Releases become latest)', (w) => { for (const s of w.jobs.publish.steps) if (s.run) s.run = String(s.run).replace('LATEST="--latest=false"', 'LATEST=""'); }],
    ['--latest=false for every tag', (w) => { for (const s of w.jobs.publish.steps) if (s.run) s.run = String(s.run).replace('case "$TAG" in edge-*) LATEST="--latest=false" ;; esac', 'LATEST="--latest=false"'); }],
    ['publish gains a second write scope', (w) => { w.jobs.publish.permissions = { contents: 'write', packages: 'write' }; }],
    ['verify gains a write scope', (w) => { w.jobs.verify.permissions.contents = 'write'; }],
  ];
  for (const [name, edit] of mutants) {
    it(`red on: ${name}`, () => {
      const w = clone();
      edit(w);
      expect(violations(w)).not.toEqual([]);
    });
  }
});
