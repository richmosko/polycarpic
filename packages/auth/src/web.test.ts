// POLY-153 R7.3 / R9: web asks nobody who is signed in. `@poly/auth/web` no longer exports the interim session call
// (loadSession, loadSessionFromService, completeSession, setAuthInternalOrigin); what stays takes the handle and runs in withSession.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mod = async (): Promise<Record<string, unknown>> => (await import('./web.ts')) as Record<string, unknown>;
const src = () => readFileSync(new URL('./web.ts', import.meta.url), 'utf8');

describe('the interim session call is gone', () => {
  for (const name of ['loadSession', 'loadSessionFromService', 'completeSession', 'setAuthInternalOrigin']) {
    it(`${name} is not exported [red if: web can still ask the service who the cookie belongs to]`, async () => { expect((await mod())[name]).toBeUndefined(); });
  }
  it('web.ts names no /session URL, no AUTH_INTERNAL, no withTenant and no sessionUserId [red if: any old path remains]', () => {
    for (const re of [/AUTH_INTERNAL/, /\/session['"`]/, /\bwithTenant\b/, /\bsessionUserId\b/, /\bloadSession\b/]) expect(src()).not.toMatch(re);
  });
  it('listMySessions, revokeMySession and myLandingEntity remain and take the handle [red if: they still take an Identity with a user id]', async () => {
    const m = await mod();
    for (const n of ['listMySessions', 'revokeMySession', 'myLandingEntity']) expect(typeof m[n], n).toBe('function');
    expect(src()).toMatch(/withSession/);
  });
});
