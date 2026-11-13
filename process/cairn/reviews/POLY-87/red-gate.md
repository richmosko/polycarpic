# POLY-87 gate 2 — existing tests changed (qa-87)
- tests/db/pgtap/04_tenancy.sql #19: trigger list gains invitation.invitation_20_set_once:before (R2 invitation_set_once). #27: membership poly_govern INSERT policies 1 -> 2 (R2/C15 viewer accept).
- tests/db/helpers/tenancy.ts: token_hash decode('aa11'/'bb22') -> 32 bytes (R1 octet_length = 32).
- tests/db/auth-fields.test.ts: signUpEmail now uses a real no-entity invitation (seedInvitation); claimInvitation mock removed.
- tests/db/auth-signup-wrap.test.ts: the mock now records and then runs the REAL claim (helpers/auth.ts claimFactory passes `real` as 3rd arg); each sign-up seeds a real invitation; /sign-up/email claims twice (route hook + user hook), the other routes once.
- tests/db/auth-signup-invite.test.ts cond 2: every request sends one valid X-Forwarded-For (requireClientIp variants).
- tests/ci/db-areas.test.ts + infra/ci/changes.mjs: two new files in area auth.
- helpers/auth.ts oauth(email, a, verified = true).
Red by design until the build: wrap (3 sign-up tests), auth-fields core-calls, pgtap 04 (#19, #27), pgtap 05, new files.
- Later fixes: pgtap 05 (constraint regex, quoting, pg_% roles); Explode trigger name; tenancy.test.ts 32-byte hashes; packages/tenancy/permission-matrix.json (sha256 hash, set-once-safe revoke); auth-signup-wrap + auth-signup-invite pin that only the sign-up run labels a commit-time 42501.
- Local at d48a73b: db battery 414/414 (50 s wall; auth-signup-invite 17.9 s, auth-new-user-step 3.0 s), tests/ci 528, tests/layers 502, tests/infra 142.
