// POLY-147 seceng N1: a definer result that is not a string (a renamed column, a driver change) fails the request and rolls back;
// it must never skip S6's pre-COMMIT check. A stubbed client: no database needed. Written by qa-147.
// Red-if: markedOf() is removed, or returns the value unchecked (the callback then runs and COMMIT is sent).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: string[] = [];
let enterRow: Record<string, unknown> | undefined;

vi.mock('./pool.ts', () => {
  const client = {
    query: vi.fn(async (text: string) => {
      sent.push(String(text));
      if (/enter_session|enter_job/.test(String(text))) return { rows: enterRow ? [enterRow] : [], command: 'SELECT' };
      if (/pg_current_xact_id_if_assigned/.test(String(text))) return { rows: [{ x: '12345' }], command: 'SELECT' };
      if (/^COMMIT/.test(String(text))) return { rows: [], command: 'COMMIT' };
      return { rows: [], command: 'OK' };
    }),
    release: vi.fn(),
  };
  const pool = { connect: async () => client };
  return { appPool: () => pool, workerPool: () => pool, operatorPool: () => pool, configure: () => {}, close: async () => {} };
});

import { withSession, withSystem } from './context.ts';

const HANDLE = 'A'.repeat(43);
const SHELL = { user_id: '00000000-0000-4000-8000-000000000001', session_id: '00000000-0000-4000-8000-000000000002', name: null, image: null, expires_at: new Date() };
const E = '00000000-0000-4000-8000-000000000003';

beforeEach(() => { sent.length = 0; enterRow = undefined; });

describe('N1: the definer result must be a string', () => {
  it('control: a string result runs the callback and commits  [red if: the stub or wrapper changed shape]', async () => {
    enterRow = { xid: '12345', ...SHELL };
    let ran = false;
    await withSession(HANDLE, async () => { ran = true; }).catch(() => {});
    expect(ran).toBe(true);
  });
  for (const [name, xid] of [['a number', 12345], ['null', null], ['a renamed column', undefined]] as const) {
    it(`withSession: ${name} fails with IdentityMarkerLost, the callback never runs, the transaction rolls back and never commits  [red if: markedOf is removed or unchecked]`, async () => {
      enterRow = xid === undefined ? { renamed: '12345', ...SHELL } : { xid, ...SHELL };
      let ran = false;
      const x = await withSession(HANDLE, async () => { ran = true; }).then(() => null, (e: unknown) => e as Error);
      expect(x?.name).toBe('IdentityMarkerLost');
      expect(ran).toBe(false);
      expect(sent.some((t) => /^ROLLBACK/.test(t))).toBe(true);
      expect(sent.some((t) => /^COMMIT/.test(t))).toBe(false);
    });
  }
  it('withSession: no row fails with IdentityMarkerLost  [red if: markedOf is removed or unchecked]', async () => {
    enterRow = undefined;
    let ran = false;
    const x = await withSession(HANDLE, async () => { ran = true; }).then(() => null, (e: unknown) => e as Error);
    expect(x).toBeInstanceOf(Error);
    expect(ran).toBe(false);
    expect(sent.some((t) => /^COMMIT/.test(t))).toBe(false);
  });
  for (const [name, row] of [['a number', { enter_job: 12345 }], ['null', { enter_job: null }], ['a renamed column', { renamed: '12345' }], ['no row', undefined]] as const) {
    it(`withSystem: ${name} fails the same way  [red if: markedOf is removed or unchecked]`, async () => {
      enterRow = row as Record<string, unknown> | undefined;
      let ran = false;
      const x = await withSystem('qa_job', { entityId: E, connectionId: null }, async () => { ran = true; }).then(() => null, (e: unknown) => e as Error);
      expect(x?.name).toBe('IdentityMarkerLost');
      expect(ran).toBe(false);
      expect(sent.some((t) => /^COMMIT/.test(t))).toBe(false);
    });
  }
});
