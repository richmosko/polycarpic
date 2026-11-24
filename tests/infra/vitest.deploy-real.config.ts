// POLY-100 T-real (ruling.md 3765f358): the one real first-deploy of the image job's last step. Files run one after the other, in name order: 1 (first deploy, second poll),
// 2 (the rollback case: separable, the lead may drop it), 3 (S38's sweep of the kept log). Not part of tests/infra/vitest.config.ts: it needs Linux, root and Docker, and changes the runner.
import { defineConfig } from 'vitest/config';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';

/** Name order, always: the default sequencer puts the files that failed last time first, which would run part 2 on a box part 1 never made. */
class ByName extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  test: {
    include: ['tests/infra/deploy-real/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false, shuffle: false, sequencer: ByName },
    testTimeout: 15 * 60_000,
    hookTimeout: 15 * 60_000,
    bail: 1, // the first failure stops the run: a setup fault is one red with its own message, not fourteen product failures
    retry: 0, // a product assertion is never retried (ruling, Flakes)
    reporters: ['default'],
  },
});
