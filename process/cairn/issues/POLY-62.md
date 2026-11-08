---
id: POLY-62
title: Entity + membership schema (multi-entity, roles, tax classification)
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-11-08
---

PRD §4 Story 1 (foundational). Kickoff §2.4: entity owns books, users hold roles via membership(user, entity, role). Includes the tax-classification attribute (individual; trust grantor/non-grantor; business pass-through/C-corp) consumed by the tax-estimate issue. Source: docs/PRD/index.html

## Comments

### @seceng — 2026-11-08

BetterAuth measurement spike (2026-11-08). better-auth 1.7.18 + @better-auth/passkey 1.7.18 on scratch PostgreSQL 14. Throwaway code outside the repo. SECURITY v1.2.3 holds the record (§4.1 "BetterAuth, measured"; R-12; A-29 amended; A-31 to A-33).
1. Session token: stored in the clear in session.token, matching the cookie token. The cookie is HMAC-signed with the auth secret. R-12 is confirmed, with narrower impact; Principal to re-approve it.
2. encryptOAuthTokens: exists, default false. When on, access and refresh tokens are XChaCha20-Poly1305 ciphertext. The idToken stays plain, and a databaseHooks.account before-hook drops it.
3. Two-factor: /enable needs the password and writes twoFactor verified=false, with secret and backup codes encrypted. skipVerificationOnEnable defaults to false. method otp is refused when unconfigured. The first /verify-totp sets twoFactorEnabled, replaces the session, then sets verified. Backup codes are encrypted, not hashed. One redeems while TOTP is unverified, but nothing becomes enabled.
4. Passkey: there is no /passkey/add-passkey. Registration is generate-register-options + verify-registration. It needs a session younger than freshAge (24h default; SESSION_NOT_FRESH otherwise) and no password.
5. Connection: on its own pool, the trigger saw app.session_id = null, on a different backend and transaction. databaseHooks never fire for twoFactor or passkey. hooks.before sees the session id and refuses with nothing written, but runs outside the transaction. A routing pool (BetterAuth gets our withTenant client; BEGIN/COMMIT become savepoints) let the trigger see the GUC in our transaction, and rollback removed BetterAuth's row (A-31). The TOTP guard moves to the user twoFactorEnabled flip (A-32).
6. Email-anchored enrolment: no native step. emailOTP types are fixed, keyed on the email address, and need no session. The app's email_challenge + grant is the only path.
7. Other (code-read): deleteUser is off by default (404). bearer plugin token = session token; unsigned is accepted unless requireSignature. allowPasswordless is needed for OAuth-only TOTP. freshAge is session age, not re-auth, so recent_auth_at stays ours.
