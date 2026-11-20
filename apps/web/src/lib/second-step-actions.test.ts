// POLY-150 Addendum 2.3: the one pure function that decides each Settings action's state, from my_second_step's row and recentAuthOk.
// Remove on the last method and Remove while paused get no browser test (the database refuses both anyway); this is their test.
// CONTRACT (the builder may rename in one place here): `lib/second-step-actions.ts` exports
//   actionStates(row: { passkeys: unknown[]; totp_added_at: string | null; needs_a_method: boolean; codes_paused: boolean }, recentAuthOk: boolean)
//   -> { removeApp, removePasskey, makeNewCodes, addPasskey } each 'shown' | 'disabled' | 'hidden'.
// Red today: the module does not exist.
import { describe, expect, it } from 'vitest';

type State = 'shown' | 'disabled' | 'hidden';
type Row = { passkeys: unknown[]; totp_added_at: string | null; needs_a_method: boolean; codes_paused: boolean };
type Out = { removeApp: State; removePasskey: State; makeNewCodes: State; addPasskey: State };
const load = async (): Promise<(r: Row, recentAuthOk: boolean) => Out> => ((await import('./second-step-actions.ts')) as { actionStates: (r: Row, a: boolean) => Out }).actionStates;
const APP = '2026-01-01T00:00:00Z';
const KEY = { id: 'k', name: 'laptop', created_at: APP };

describe('actionStates', () => {
  it('needs_a_method with one method: Remove of that method is hidden [red if: the last method can be removed from the screen]', async () => {
    const f = await load();
    expect(f({ passkeys: [], totp_added_at: APP, needs_a_method: true, codes_paused: false }, true).removeApp).toBe('hidden');
    expect(f({ passkeys: [KEY], totp_added_at: null, needs_a_method: true, codes_paused: false }, true).removePasskey).toBe('hidden');
  });
  it('needs_a_method with two methods: both Removes are shown [red if: the rule hides a method that is not the last]', async () => {
    const f = await load();
    const o = f({ passkeys: [KEY], totp_added_at: APP, needs_a_method: true, codes_paused: false }, true);
    expect(o.removeApp).toBe('shown');
    expect(o.removePasskey).toBe('shown');
  });
  it('one method and no method needed: Remove is shown [red if: the last-method rule applies to a user who needs none]', async () => {
    expect((await load())({ passkeys: [], totp_added_at: APP, needs_a_method: false, codes_paused: false }, true).removeApp).toBe('shown');
  });
  it('codes_paused: Remove is disabled, not hidden (DESIGN #second-step-paused) [red if: a paused Remove is clickable or vanishes]', async () => {
    const o = (await load())({ passkeys: [KEY], totp_added_at: APP, needs_a_method: false, codes_paused: true }, true);
    expect(o.removeApp).toBe('disabled');
    expect(o.removePasskey).toBe('disabled');
  });
  it('recentAuthOk false: no action is hidden or disabled by freshness; each stays shown and opens Confirm it\'s you [red if: staleness removes the action]', async () => {
    const o = (await load())({ passkeys: [KEY], totp_added_at: APP, needs_a_method: false, codes_paused: false }, false);
    for (const k of ['removeApp', 'removePasskey', 'makeNewCodes', 'addPasskey'] as const) expect(o[k], k).toBe('shown');
  });
  it('Make new codes needs the app: with a passkey only it is hidden [red if: codes are offered to a user with no authenticator app (D3)]', async () => {
    expect((await load())({ passkeys: [KEY], totp_added_at: null, needs_a_method: false, codes_paused: false }, true).makeNewCodes).toBe('hidden');
  });
});
