// POLY-160c contract pin (ruling R5, S): the seam the pool tests and the three mains share. Red until pool.ts lands R5.
// The behaviour cases (per pool, canaries, the 10 s bound) join this file in the pool slice.
import { describe, expect, it } from 'vitest';
import * as pool from './pool.ts';
import * as startup from './startup.ts';
import * as index from './index.ts';

describe('connection-lost seam', () => {
  it('pool.ts exports onConnectionLost, startup re-exports it, the db index does not', () => {
    expect(typeof pool.onConnectionLost).toBe('function');
    expect(startup.onConnectionLost).toBe(pool.onConnectionLost);
    expect('onConnectionLost' in index).toBe(false);
  });
});
