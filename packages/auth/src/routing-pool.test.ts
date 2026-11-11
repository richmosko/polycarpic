// POLY-86 ruling addendum 1: BetterAuth never runs as a job principal (P4). withSystem needs a seeded job target, so this is
// pure: db/auth's currentClient is mocked to report a withSystem transaction. Titles end with [red if: <mutation>].
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ current: vi.fn(), plain: vi.fn() }));
vi.mock('@poly/db/auth', () => ({ currentClient: m.current, authPool: () => ({ connect: m.plain, query: m.plain }) }));
import { AuthUnderSystemJob, createRoutingPool } from './routing-pool.ts';

beforeEach(() => {
  m.current.mockReset();
  m.plain.mockReset();
});

describe('AuthUnderSystemJob', () => {
  it('connect() and query() throw under withSystem and never touch a pool  [red if: the kind check is missing and the worker client is leased to BetterAuth]', async () => {
    m.current.mockReturnValue({ kind: 'withSystem', client: { query: vi.fn() } });
    const pool = createRoutingPool();
    await expect(pool.connect()).rejects.toBeInstanceOf(AuthUnderSystemJob);
    await expect(pool.query('select 1')).rejects.toBeInstanceOf(AuthUnderSystemJob);
    expect(m.plain).not.toHaveBeenCalled();
  });

  it('outside any transaction it goes to the plain pool  [red if: the null case throws or is routed to a request client]', async () => {
    m.current.mockReturnValue(null);
    m.plain.mockResolvedValue({ rows: [] });
    await createRoutingPool().query('select 1');
    expect(m.plain).toHaveBeenCalledTimes(1);
  });
});
