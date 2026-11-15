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
      if (/enter_asserted_user|enter_job/.test(String(text))) return { rows: enterRow ? [enterRow] : [], command: 'SELECT' };
      if (/pg_current_xact_id_if_assigned/.test(String(text))) return { rows: [{ x: '12345' }], command: 'SELECT' };
      if (/^COMMIT/.test(String(text))) return { rows: [], command: 'COMMIT' };
      return { rows: [], command: 'OK' };
    }),
    release: vi.fn(),
  };
  const pool = { connect: async () => client };
  return { appPool: () => pool, workerPool: () => pool, operatorPool: () => pool, configure: () => {}, close: async () => {} };
});

import { withSystem, withTenant } from './context.ts';
import { sessionUserId } from './session.ts';

const ASSERTED = ['enter', 'asserted', 'user'].join('_');
const JOB = ['enter', 'job'].join('_');
const U = '00000000-0000-4000-8000-000000000001';
const S = '00000000-0000-4000-8000-000000000002';
const E = '00000000-0000-4000-8000-000000000003';

beforeEach(() => { sent.length = 0; enterRow = undefined; });

describe('N1: the definer result must be a string', () => {
  it('control: a string result runs the callback and commits  [red if: the stub or wrapper changed shape]', async () => {
    enterRow = { enter_asserted_user: '12345' };
    let ran = false;
    await withTenant(sessionUserId(U), S, async () => { ran = true; }).catch(() => {});
    expect(ran).toBe(true);
  });
  for (const [name, row] of [['a number', { enter_asserted_user: 12345 }], ['null', { enter_asserted_user: null }], ['a renamed column', { renamed: '12345' }], ['no row', undefined]] as const) {
    it(`withTenant: ${name} fails with IdentityMarkerLost, the callback never runs, the transaction rolls back and never commits  [red if: markedOf is removed or unchecked]`, async () => {
      enterRow = row as Record<string, unknown> | undefined;
      let ran = false;
      const x = await withTenant(sessionUserId(U), S, async () => { ran = true; }).then(() => null, (e: unknown) => e as Error);
      expect(x?.name).toBe('IdentityMarkerLost');
      expect(ran).toBe(false);
      expect(sent.some((t) => /^ROLLBACK/.test(t))).toBe(true);
      expect(sent.some((t) => /^COMMIT/.test(t))).toBe(false);
    });
    it(`withSystem: ${name} fails the same way  [red if: markedOf is removed or unchecked]`, async () => {
      enterRow = row === undefined ? undefined : Object.fromEntries(Object.entries(row).map(([k, v]) => [k === ASSERTED ? JOB : k, v]));
      let ran = false;
      const x = await withSystem('qa_job', { entityId: E, connectionId: null }, async () => { ran = true; }).then(() => null, (e: unknown) => e as Error);
      expect(x?.name).toBe('IdentityMarkerLost');
      expect(ran).toBe(false);
      expect(sent.some((t) => /^COMMIT/.test(t))).toBe(false);
    });
  }
});
