// POLY-137 R8 row "routing pool, query-config object" (ruling @ a5e9ce4f). A transaction-control statement passed as a query-config
// object ({text}) is refused before any statement is sent, as the string form already is. Pure: db/auth's currentClient is mocked.
// Titles end [red if: <mutation>].
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ current: vi.fn(), plain: vi.fn() }));
vi.mock('@poly/db/auth', () => ({ currentClient: m.current, authPool: () => ({ connect: m.plain, query: m.plain }) }));
import { UnsupportedTransactionControl, createRoutingPool } from './routing-pool.ts';

const sent = vi.fn(async (..._a: unknown[]) => ({ rows: [] }));
beforeEach(() => { m.current.mockReset(); m.plain.mockReset(); sent.mockClear(); m.current.mockReturnValue({ kind: 'request', client: { query: sent } }); });

describe('query-config objects are held to the same grammar as strings', () => {
  const refused: [string, unknown][] = [
    ['{text: COMMIT}', { text: 'COMMIT' }],
    ['{text: " begin "} (case and padding)', { text: ' begin ' }],
    ['{text: ROLLBACK TO SAVEPOINT x}', { text: 'ROLLBACK TO SAVEPOINT x' }],
    ['{text: SAVEPOINT x}', { text: 'SAVEPOINT x' }],
    ['{text: RELEASE SAVEPOINT x}', { text: 'RELEASE SAVEPOINT x' }],
    ['{text: START TRANSACTION}', { text: 'START TRANSACTION' }],
    ['{text: SET TRANSACTION ...}', { text: 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE' }],
    ['{name: "x"} (no text: a prepared statement by name)', { name: 'x' }],
    ['{text: 1} (text is not a string)', { text: 1 }],
    ['{text: ["SELECT 1"]} (an array that stringifies to a plain statement)', { text: ['SELECT 1'] }],
    ['{text: {toString}} (an object that stringifies to COMMIT)', { text: { toString: () => 'COMMIT' } }],
  ];
  for (const [label, q] of refused) {
    it(`pool.query(${label}) inside an open savepoint throws UnsupportedTransactionControl and the client receives nothing more  [red if: the object form bypasses the CONTROL/PASS check]`, async () => {
      const pool = createRoutingPool();
      await pool.query('BEGIN'); // depth 1: today a string COMMIT is rewritten to a RELEASE, and an object COMMIT would reach the server as itself
      sent.mockClear();
      const x = await pool.query(q).catch((e: unknown) => e);
      expect(x, 'must be refused').toBeInstanceOf(UnsupportedTransactionControl);
      expect(sent).not.toHaveBeenCalled();
    });
    it(`lease.query(${label}) is refused the same way, and a refusal does not wedge the one-lease queue  [red if: only pool.query is checked]`, async () => {
      const pool = createRoutingPool();
      const lease: any = await pool.connect();
      await lease.query('BEGIN');
      sent.mockClear();
      const x = await lease.query(q).catch((e: unknown) => e);
      expect(x).toBeInstanceOf(UnsupportedTransactionControl);
      expect(sent).not.toHaveBeenCalled();
      lease.release();
      await expect(pool.query('select 1')).resolves.toBeDefined();
    });
  }
  it('{text: "SELECT $1::int", values: [1]} passes through untouched, one statement  [red if: the guard refuses ordinary config objects]', async () => {
    const q = { text: 'SELECT $1::int', values: [1] };
    await createRoutingPool().query(q);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]![0]).toBe(q);
  });
  it("strings keep today's rewrite: BEGIN becomes a savepoint  [red if: the fix breaks the string path]", async () => {
    const lease: any = await createRoutingPool().connect();
    await lease.query('BEGIN');
    expect(sent.mock.calls.map((c) => c[0])).toEqual(['SAVEPOINT ba_1']);
    lease.release();
  });
});
