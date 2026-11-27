// POLY-167 R3/R4b: the images build.yml ships, derived from the workflow itself. shipped-apt.test.ts (apt rules) and
// tests/ci/image-scan-parity.test.ts (PR scan parity) both read this list, so the two cannot drift.
import { posix } from 'node:path';

export type Image = { context: string; file: string };
/** `problems` is every way build.yml could build an image that this list would not hold: each is a failure, never skipped. */
export function shippedImages(workflow: any): { images: Image[]; problems: string[] } {
  const images: Image[] = [];
  const problems: string[] = [];
  for (const [job, j] of Object.entries<any>(workflow?.jobs ?? {})) {
    for (const s of j.steps ?? []) {
      const where = `${job} / ${s.name ?? s.uses ?? 'step'}`;
      const uses = String(s.uses ?? '');
      if (/\bdocker\/bake-action@/.test(uses)) problems.push(`${where}: bake builds are not derived`);
      if (/\bdocker\s+(?:(?:buildx|compose|image)\s+)?(?:build|bake)\b|image\.sh\s+build\b/.test(String(s.run ?? ''))) {
        problems.push(`${where}: an image built by a run step is not derived`);
      }
      if (!/\bdocker\/build-push-action@/.test(uses)) continue;
      const context = String(s.with?.context ?? '');
      const file = String(s.with?.file ?? posix.join(context, 'Dockerfile'));
      if (!context || `${context}${file}`.includes('${{')) { problems.push(`${where}: context and file must be literal`); continue; }
      images.push({ context, file: posix.normalize(file) });
    }
  }
  if (images.length === 0) problems.push('no image build was found');
  return { images, problems };
}
