// POLY-86 criterion 3, 10 (ARCH §3.1c table; ruling R3). Pure shape of AUTH_ROUTES; the live-instance coverage and the per-class
// behaviour run in tests/db/auth-route-policy.test.ts (needs Postgres). Titles end with [red if: <mutation>].
import { describe, expect, it } from 'vitest';
import { AUTH_ROUTES, SIGN_IN_PATHS, USER_INSERTING } from './route-policy.ts';

const R = AUTH_ROUTES as Record<string, { class: string; insertsUser?: true; realDomainOnly?: true; whenSession?: string }>;
const of = (c: string) => Object.entries(R).filter(([, r]) => r.class === c).map(([p]) => p).sort();

describe('AUTH_ROUTES', () => {
  it('holds the 47 paths of ARCH §3.1c, each with one of the four classes  [red if: a path is dropped or given a fifth class]', () => {
    expect(Object.keys(R)).toHaveLength(47);
    for (const [p, r] of Object.entries(R)) {
      expect(['open', 'enrolment', 'step-up', 'blocked'], p).toContain(r.class);
      expect(p.startsWith('/'), p).toBe(true);
    }
  });

  it('blocked is exactly the 13 token- and secret-bearing routes  [red if: /get-session, /list-sessions, an IdP-token route or deleteUser is not blocked]', () => {
    expect(of('blocked')).toEqual([
      '/account-info', '/delete-user', '/delete-user/callback', '/get-access-token', '/get-session', '/list-sessions', '/refresh-token',
      '/revoke-session', '/two-factor/get-totp-uri', '/two-factor/send-otp', '/two-factor/verify-otp', '/update-session', '/verify-password',
    ].sort());
  });

  it('step-up is exactly the 7 routes of the table, /revoke-other-sessions included (A-38)  [red if: /revoke-other-sessions is open]', () => {
    expect(of('step-up')).toEqual(['/change-email', '/link-social', '/passkey/delete-passkey', '/revoke-other-sessions', '/two-factor/disable', '/two-factor/generate-backup-codes', '/unlink-account'].sort());
  });

  it('enrolment holds passkey registration and /two-factor/enable; verify-totp is open without a session and enrolment with one; verify-backup-code is open without a session and carries a whenSession rule  [red if: the split paths lose whenSession]', () => {
    expect(of('enrolment')).toEqual(expect.arrayContaining(['/passkey/generate-register-options', '/passkey/verify-registration', '/two-factor/enable']));
    expect(R['/two-factor/verify-totp']).toMatchObject({ class: 'open', whenSession: 'enrolment' });
    expect(R['/two-factor/verify-backup-code']).toMatchObject({ class: 'open' });
    expect(R['/two-factor/verify-backup-code'].whenSession).toBeDefined();
  });

  it('USER_INSERTING is derived from insertsUser: sign-up/email, callback/:id, magic-link/verify; /sign-in/social carries no flag  [red if: a user-inserting route is unflagged (the handler would not wrap it), or /sign-in/social is flagged]', () => {
    expect(Object.entries(R).filter(([, r]) => r.insertsUser).map(([p]) => p).sort()).toEqual(['/callback/:id', '/magic-link/verify', '/sign-up/email']);
    expect([...USER_INSERTING].sort()).toEqual(['/callback/:id', '/magic-link/verify', '/sign-up/email']);
    expect(R['/sign-in/social'].insertsUser).toBeUndefined();
  });

  it('realDomainOnly marks /sign-in/social, /callback/:id and /link-social, and nothing else  [red if: OAuth stays reachable in private-CA mode (C-76)]', () => {
    expect(Object.entries(R).filter(([, r]) => r.realDomainOnly).map(([p]) => p).sort()).toEqual(['/callback/:id', '/link-social', '/sign-in/social']);
  });

  it('SIGN_IN_PATHS is the three credential paths  [red if: the hold set drifts from the sign-in set]', () => {
    expect([...SIGN_IN_PATHS].sort()).toEqual(['/callback/:id', '/magic-link/verify', '/sign-in/email']);
  });
});
