# POLY-146 — security review (seceng-146)

Diff reviewed: `fb3933cb..b5a37021` on `feature/poly-146-identity-hardening`, against the ruling (`ruling.md`, with
addenda 1 and 2). Method: reading the diff, the installed better-auth 1.7.18 and @better-auth/passkey 1.7.18 `dist`,
and the tests that cover each item. **I ran no test.** The green results are the builders' (backend 5c7de096 full db,
infra 163 passed, tests 26c8a928) and are not re-measured here.

## Result

Pass. No must is open. The open points are recorded under Residuals and Follow-ups.

## What I checked

| Item | How | Result |
|---|---|---|
| Every writer to `verification` is hashed | Read the source: every create, find, consume and delete goes through `internalAdapter`'s `processIdentifier`. Writers in our plugin set: reset, magic link, OAuth state, the two-factor pending, attempts and trust-device ids, the passkey challenge. `2fa-otp` is unreachable (no `sendOTP`), and so is `delete-account` (`deleteUser` is off). | Pass. `storeIdentifier: 'hashed'` is set as the plain string with no `overrides` (options.ts; the unit test asserts it). |
| Magic link | `storeToken: 'hashed'` as well, so the stored identifier is H(`magic-link:` + H(token)) | Pass |
| A value read from the table is refused | On a miss, the plain-identifier fallback looks up `<prefix>:<presented>`, and a stored hash carries no prefix. The unprefixed ids come only from cookies signed with the auth secret (passkey index.mjs:263/369/418/539; two-factor verify-two-factor.mjs). The test presents the stored value, whole and with its prefix stripped, at POST and GET `/reset-password` and at GET `/magic-link/verify`. | Pass (code-read plus the test as written) |
| Token entropy against an unkeyed SHA-256 | reset `generateId(24)`, magic link `generateRandomString(32, a-zA-Z)` | About 140 and 180 bits, so no offline guessing |
| The auth secret leaves `worker` | registry `AUTH_SECRET_FILE` is `['web']`; prod and staging `worker` mount no `auth_secret`; the policy matrix drops it from the worker; check-config tests | Pass |
| poly_operator attributes and grants | roles.sql (LOGIN, the five NOs, CONNECT); 0010 (REVOKE from poly_worker, GRANT to poly_operator, run as poly_govern; USAGE on `app` as poly_owner); definers.json; pgTAP C12, plus C13 named-ACL and A1.2 effective-privilege rows | Pass. PUBLIC defaults are already stripped (roles.sql:53, 59, 64; 0001:12). |
| The worker cannot issue | poly_worker gives a 42501 for plain and bootstrap and leaves no row (pgTAP). `operatorPool()` checks `DATABASE_USER` on every call, before any connection (5c7de096), and refuses in a worker process. The worker never holds the password. | Pass |
| The operator password reaches no long-running container | Only `operator` mounts `db_password_operator__operator`. The secret matrix refuses it elsewhere. `secret-path` refuses a renamed target (the file must sit under `<prefix><service>/`). `operator-one-shot` requires the name, `restart: "no"`, `profiles: [operator]` and `logging.driver: none`. Host directories are 0750 per gid (INFRA §7.5). | Pass |
| T-99: the link in a container log | `logging: {driver: "none"}` on `operator`, prod and staging; lint fail row; `logging-measure.md` | Pass, with the caveat below |
| pg_hba | poly_operator from the app subnet with scram, before the final reject, prod and staging | Pass |
| The CLI drops the schema-behind check | poly_operator cannot read `drizzle`. A stale schema fails on the missing function (42883) and exits 1. | Accepted: fails closed |

## The measurement caveat (A1.1)

The stand-in proved the property that matters, on the real rendered service definition: with driver `none`, an
attached `run` passes stdout and stderr to the terminal, and `docker logs` holds nothing. That is a Docker property,
not one of the program. What it did not prove is that the real `user invite` prints its link before exit under a TTY.
`tests/db/operator-invite.test.ts` covers that with a child process on a pipe. I accept it for this gate. The first
real invite on staging (POLY-97) is the end-to-end check.

## Residuals (each is stated in SECURITY)

- **Hashing protects against a read, not a write.** `poly_app` holds INSERT on `verification` (0001:27). SQL as
  `poly_app` can plant a magic-link row for any address, since it can compute the hash itself, and redeem it for a real
  session cookie. That session outlives the injection until it is revoked. The plain-identifier fallback makes this
  easier still, but it adds no reach: `poly_app` SQL already acts as any user (R-2). What hashing closes is the
  read-only path: a SELECT-only injection, a leaked dump, or `poly_backup`.
- **Session tokens are still stored in the clear** (R-12; BetterAuth has no option).
- **Password reset is not enabled** (`sendResetPassword` is unset). The hash covers it once POLY-137 wires it, with
  `resetPasswordTokenExpiresIn: 900`, as noted on POLY-137.

## Follow-ups (for the lead)

- INFRA §7.5 routes every `polycarpic-ops cli …` command, including `reset-mfa`, `remove-owner`, `set-founder` and
  `secrets rotate`, through the `operator` service. Today only `user invite` exists. Each later command needs grants
  that poly_operator does not hold, and `secrets rotate` needs the keyring. Each must come with its own grant review,
  never a widening of poly_operator by default. The keyring must not be mounted into `operator` without one.

## Not checked

- I did not run the suites, the pgTAP files or the compose lint.
- The real invite link's path through a live `docker compose run` (see the caveat).
- `provision.sh` setting poly_operator's password (POLY-97; the script is not in the tree). Until then the role has
  no password and cannot log in.
