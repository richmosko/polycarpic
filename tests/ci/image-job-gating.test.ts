// POLY-95 verdict C2: on a node-only PR the image job adds nothing beyond its own steps, so the Node and pnpm setup that only
// the infra container tests need is gated on the `image` key like the steps it serves.
import { describe, expect, it } from 'vitest';
import { steps, wf } from './helpers.ts';

describe('ci.yml image job: setup steps follow the image key', () => {
  it('Node, pnpm and install steps run only when image == true', () => {
    const job = wf('ci.yml').jobs.image!;
    const setup = steps(job).filter((s) => /Set up Node|Install pnpm|pnpm store|Install \(lockfile/.test(s.name ?? ''));
    expect(setup.length).toBeGreaterThanOrEqual(5);
    for (const s of setup) expect(s.if, s.name).toMatch(/needs\.changes\.outputs\.image == 'true'/); // red: runs on node-only PRs
  });
});
