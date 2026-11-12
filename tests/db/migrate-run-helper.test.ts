// POLY-136 ruling addendum 2, seceng C6: the in-process helper captures only console and process.stderr.write, and puts
// both back in a `finally`, so a throwing run cannot leave the next test with a patched stream.
import { describe, expect, it, vi } from 'vitest';
import * as api from './helpers/api';

vi.mock('../../apps/migrate/src/run.ts', () => ({
  run: async (_argv: string[], _env: NodeJS.ProcessEnv) => {
    console.log('captured line');
    process.stderr.write('captured err\n');
    throw new Error('run blew up');
  },
}));

describe('migrateRun restores what it patched (C6)', () => {
  it('a throwing run leaves console.* and process.stderr.write as they were  [red if: the restore is not in a finally]', async () => {
    const helper = (api as Record<string, unknown>).migrateRun as ((db: string, dir: string, args?: string[], env?: Record<string, string>) => Promise<unknown>) | undefined;
    expect(helper, 'tests/db/helpers/api.ts must export migrateRun').toBeTypeOf('function');
    const before = { write: process.stderr.write, log: console.log, error: console.error, warn: console.warn };
    await expect(helper!('none', '/nonexistent', [])).rejects.toThrow('run blew up');
    expect(process.stderr.write).toBe(before.write);
    expect(console.log).toBe(before.log);
    expect(console.error).toBe(before.error);
    expect(console.warn).toBe(before.warn);
  });
});
