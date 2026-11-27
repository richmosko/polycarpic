// POLY-167 R4b: every image build.yml builds and scans is also built and scanned on the pull request (ci.yml `image` job),
// so a scan that would fail on main fails before the merge. The image list is the one shipped-apt.test.ts reads.
// Reads files only.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify } from '../../infra/ci/changes.mjs';
import { shippedImages, type Image } from '../infra/shipped-images.ts';
import { ROOT, steps, wf, type Step, type Workflow } from './helpers.ts';

const GATE = "needs.changes.outputs.image == 'true'";
const ifOf = (s: Step) => (s.if === undefined ? undefined : String(s.if).trim());
const lines = (s: Step) => (s.run ?? '').split('\n').map((l) => l.trim());

/** The tag a run line builds `image` as, or undefined. The root app is built by image.sh, as build.yml's context and file. */
function builtTag(line: string, image: Image): string | undefined {
  if (line === 'bash infra/ci/image.sh build') return image.context === '.' && image.file === 'Dockerfile' ? 'polycarpic:ci' : undefined;
  const words = line.split(/\s+/);
  if (words[0] !== 'docker' || words[1] !== 'build') return undefined;
  let tag: string | undefined, file: string | undefined, context: string | undefined;
  for (let i = 2; i < words.length; i++) {
    const w = words[i]!;
    if (w === '-t') tag = words[++i];
    else if (w === '-f') file = words[++i];
    else if (w === '--no-cache' || w === '--pull') continue;
    else if (w.startsWith('-') || context !== undefined) return undefined; // an unknown flag (--target, --platform ...) is not the same build
    else context = w;
  }
  if (context !== image.context) return undefined;
  return posix.normalize(file ?? posix.join(context, 'Dockerfile')) === image.file ? tag : undefined;
}

export function parityViolations(build: Workflow, pr: Workflow, filter: (paths: string[]) => { image?: boolean }): string[] {
  const { images, problems } = shippedImages(build);
  const v = [...problems];
  const job = pr.jobs.image;
  if (!job) return [...v, 'ci.yml has no image job'];
  if (!String(job.if ?? '').split('||').map((s) => s.trim()).includes(GATE)) v.push('the image job does not run on the image change key');
  const all = steps(job);
  // a step counts only if a change that sets the image key runs it and its failure fails the job
  const live = (s: Step) => (ifOf(s) === undefined || ifOf(s) === GATE) && !('continue-on-error' in s) && !('shell' in s);
  for (const s of all) for (const l of lines(s)) if (/(^|[\s;&|(/])trivy\s+(image|fs|rootfs|config|repo)\b/.test(l)) v.push(`a trivy call outside infra/ci/image.sh: ${l}`);
  for (const image of images) {
    let at = -1, tag: string | undefined;
    all.forEach((s, i) => { if (at < 0 && live(s)) for (const l of lines(s)) { const t = builtTag(l, image); if (t) { at = i; tag = t; } } });
    if (!tag) { v.push(`${image.file} (context ${image.context}): the image job does not build it`); continue; }
    const scan = `bash infra/ci/image.sh scan ${tag}`;
    const scanned = all.some((s, i) => i >= at && live(s) && lines(s).includes(scan) && !/\|\||set \+e/.test(s.run ?? '') && (i > at || lines(s).indexOf(scan) > lines(s).findIndex((l) => builtTag(l, image) === tag)));
    if (!scanned) v.push(`${image.file}: no \`${scan}\` after its build`);
    // the root context is the whole tree, so its Dockerfile stands for it
    const probes = image.context === '.' ? [image.file] : [image.file, `${image.context}/a-new-file`];
    for (const p of probes) if (filter([p]).image !== true) v.push(`${image.file}: a change to ${p} does not set the image change key`);
  }
  return v;
}

const filter = (paths: string[]) => classify(paths) as { image?: boolean };
const real = () => ({ build: wf('build.yml'), pr: wf('ci.yml') });

describe('R4b: ci.yml builds and scans every image build.yml does', () => {
  it('the committed workflows agree', () => {
    const { build, pr } = real();
    expect(parityViolations(build, pr, filter)).toEqual([]);
  });
  it('build.yml scans one digest for each image it builds (the premise of the comparison)', () => {
    const scans = Object.entries(wf('build.yml').jobs).filter(([id]) => id !== 'release-scan').flatMap(([, j]) => steps(j)).filter((s) => /image\.sh scan /.test(s.run ?? ''));
    expect(scans).toHaveLength(shippedImages(wf('build.yml')).images.length);
    expect(readFileSync(join(ROOT, 'infra', 'ci', 'image.sh'), 'utf8')).toMatch(/trivy image --scanners vuln,secret --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1/);
  });
  it('red: a build.yml with one more image than ci.yml knows', () => {
    const { build, pr } = real();
    build.jobs.siblings!.steps!.push({ name: 'Build and push extra', uses: 'docker/build-push-action@0000000000000000000000000000000000000000', with: { context: 'infra/extra', file: 'infra/extra/Dockerfile' } });
    expect(parityViolations(build, pr, filter)).toEqual(['infra/extra/Dockerfile (context infra/extra): the image job does not build it']);
  });

  const toolsStep = (pr: Workflow, re: RegExp) => steps(pr.jobs.image!).find((s) => re.test(s.run ?? ''))!;
  const BUILD = /docker build[^\n]*polycarpic-tools:ci/, SCAN = /image\.sh scan polycarpic-tools:ci/;
  it.each<[string, (pr: Workflow) => void]>([
    ['no tools build', (pr) => { const s = toolsStep(pr, BUILD); s.run = 'true'; }],
    ['no tools scan', (pr) => { const s = toolsStep(pr, SCAN); s.run = 'true'; }],
    ['a direct trivy call in place of image.sh', (pr) => { const s = toolsStep(pr, SCAN); s.run = 'trivy image polycarpic-tools:ci'; }],
    ['a swallowed scan failure', (pr) => { const s = toolsStep(pr, SCAN); s.run = `${s.run!.trim()} || true`; }],
    ['continue-on-error on the scan', (pr) => { (toolsStep(pr, SCAN) as Record<string, unknown>)['continue-on-error'] = true; }],
    ['a narrower step condition', (pr) => { toolsStep(pr, SCAN).if = `${GATE} && false`; }],
    ['another context', (pr) => { const s = toolsStep(pr, BUILD); s.run = s.run!.replace(/infra\/backup$/m, 'infra'); }],
    ['one stage only', (pr) => { const s = toolsStep(pr, BUILD); s.run = s.run!.replace('docker build', 'docker build --target fetch'); }],
    ['the scan before the build', (pr) => { const a = steps(pr.jobs.image!); const s = toolsStep(pr, SCAN); a.splice(a.indexOf(s), 1); a.unshift(s); }],
  ])('red: ci.yml with %s', (_name, edit) => {
    const { build, pr } = real();
    edit(pr);
    expect(parityViolations(build, pr, filter)).not.toEqual([]);
  });
  it('red: a change filter that does not cover a context', () => {
    const { build, pr } = real();
    const blind = (paths: string[]) => ({ image: !paths[0]!.startsWith('infra/backup/') });
    expect(parityViolations(build, pr, blind).join('\n')).toMatch(/infra\/backup\/a-new-file does not set the image change key/);
  });
});
