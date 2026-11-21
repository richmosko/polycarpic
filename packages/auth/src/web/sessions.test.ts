// POLY-137 R8 row "Sessions revoke, non-uuid id": revokeSession throws HttpError(404, 'not_found') before any SQL. Pure: a fake Tx.
// Titles end [red if: <mutation>].
import { describe, expect, it, vi } from 'vitest';
import { HttpError, revokeSession } from './sessions.ts';

const tx = () => { const execute = vi.fn(async (..._a: unknown[]) => ({ rows: [] })); return { tx: { execute } as never, execute }; };
const OK = '00000000-0000-4000-8000-000000000000';

describe('a revoke id that is not a uuid is a 404, not a 500', () => {
  for (const id of ['x', '', '1; DROP', 'not-a-uuid-at-all', '00000000-0000-0000-0000-00000000000', '00000000-0000-0000-0000-0000000000000', '00000000-0000-0000-0000-00000000000g', ` ${OK}`]) {
    it(`revokeSession(${JSON.stringify(id)}) throws HttpError 404 not_found and execute is never called  [red if: the id reaches ::uuid in SQL]`, async () => {
      const t = tx();
      const x: any = await revokeSession(t.tx, id).catch((e: unknown) => e);
      expect(x).toBeInstanceOf(HttpError);
      expect([x.status, x.code]).toEqual([404, 'not_found']);
      expect(t.execute).not.toHaveBeenCalled();
    });
  }
  it('a well-formed uuid, either case, reaches the definer exactly once  [red if: the check refuses a valid id]', async () => {
    for (const id of [OK, 'ABCDEF00-0000-4000-8000-00000000ABCD']) {
      const t = tx();
      await revokeSession(t.tx, id);
      expect(t.execute).toHaveBeenCalledTimes(1);
    }
  });
  it('the existing P0002 and step_up_required mappings still hold  [red if: the new check swallows them]', async () => {
    const p0002 = { execute: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'P0002' }); }) } as never;
    expect(await revokeSession(p0002, OK).catch((e: any) => [e.status, e.code])).toEqual([404, 'not_found']);
    const su = { execute: vi.fn(async () => { throw Object.assign(new Error('step_up_required'), { code: '42501' }); }) } as never;
    expect(await revokeSession(su, OK).catch((e: any) => [e.status, e.code])).toEqual([403, 'step_up_required']);
  });
});
