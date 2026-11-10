---
id: POLY-85
title: Runtime config + ops hooks
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-82]
assignee: backend-lead
paths: [packages/config/**, apps/web/**, apps/worker/**, apps/migrate/**, Dockerfile, .dockerignore, bin/polycarpic, packages/db/src/startup.ts, packages/db/src/migrate.ts, packages/db/src/migrate-config.ts, packages/db/src/*.test.ts, tests/**, layers.json, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, package.json, docs/ARCH/**, docs/INFRA/**, docs/SECURITY/**]
labels: [enabler, infra]
priority: P2
pr: null
created: 2026-11-08
updated: 2026-11-10
---

The app-side hooks the operations scripts depend on, from devops's not-filed list (INFRA §3.2, §6.5, §9.3; ARCH §7.4, §7.5, §8.1): the *_FILE secret loader, the loopback-only status listener inside web (until POLY-81 moves it to an admin service), the image label carrying the source commit that the deploy check reads, and the structured log schema.

## Acceptance criteria

- [ ] Every secret is read from a mounted file named by a *_FILE variable; a missing or empty file refuses start, naming the variable.
- [ ] The status listener binds 127.0.0.1 only and returns migration and app status; the public /api/v1/health returns ok or not only (R-6).
- [ ] The image carries the commit label the attestation covers, and POLY-100's tag-to-digest check reads it.
- [ ] Logs are structured JSON to a committed schema; no secret, token or raw provider payload field is logged.

## Comments

### @team-lead — 2026-11-09

From the POLY-83 architect ruling (R7, `process/cairn/reviews/POLY-83/ruling.md`): `migrate check-config` lands in POLY-83 checking only the DB-side inputs (migrator secret file present and non-empty, connection settings present; exit 0/1, no connection). The TLS_MODE, PLAID_ENV and other-secret checks land here with `packages/config` — extend `apps/migrate`'s check-config, do not duplicate it. `packages/config` is L0 in layers.json (ARCH v1.15.2); `apps/migrate` already allow-lists it.

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-85-runtime-config-ops-hooks`.

### @architect — 2026-11-10

Gate-1 ruling: process/cairn/reviews/POLY-85/ruling.md @ 332df39 (ARCH v1.15.6 carries the doc parts). R1 config/secrets boundary and the @poly/config/log subpath; R2 env vars (APP_ENV, TLS_MODE offline cross-check, PLAID_ENV per C-77, secret-looking env refusal in staging+prod); R3 the *_FILE registry, semantics and messages, check-config on all three entrypoints; R4 loopback status listener and the two-body health; R5 root Dockerfile, label org.opencontainers.image.revision, bin/polycarpic dispatcher; R6 log schema at packages/config/log.schema.json, allowlist + redact backstop, C-33 canary harness; R7 additive packages/db change; R8 test layout. paths: widening needed: packages/db/src/startup.ts, packages/db/src/migrate.ts, packages/db/src/migrate-config.ts, packages/db/src/*.test.ts, bin/polycarpic.

### @seceng — 2026-11-10

Gate-1 concurrence on `reviews/POLY-85/ruling.md` @ 332df39. I concur with R1 to R9, under nine build conditions. They tighten the ruling and reverse none of it. SECURITY v1.8 carries the R9 wording (C-33, §6.2, C-74).

- **R1, R3, R4, R5, R7, R8: concur.** One validator, `config/log` as the only subpath granted below L0, a loader with a single file source, and a health route with two exact response bodies.
- **R2: concur, with S-1.** The regex misses `B2_APPLICATION_KEY`, `RESEND_KEY` and `DB_PASS`.
- **R6: concur, with S-5 to S-7.** Filtering by key alone is not an allowlist: a declared key can still carry an object. Pino child bindings also bypass `formatters.log`.

Conditions (each one is a canary or a validator line):
- **S-1 (R2 regex).** Add `(^|_)(KEY|PASS|PWD|DSN)(_|$)` to the pattern. Names that are not secret but match it go on a short committed allowlist (seceng reviews the diff). Export the regex from `packages/config`, and R5's Dockerfile test imports it, so there is one source. Canaries: `B2_APPLICATION_KEY`, `RESEND_KEY` and `DB_PASS` are each refused in staging, and the refusal names the variable without the value.
- **S-2 (R3, no fallback).** In every `APP_ENV`, development included, refuse when the stem of a registry row is set as a plain variable (`AUTH_SECRET`, `PLAID_SECRET`, …), and refuse `BETTER_AUTH_SECRET`. BetterAuth reads those itself and has a dev default secret (unmeasured on 1.7.18). Canary: `APP_ENV=development AUTH_SECRET=<canary>` with no `_FILE` refuses, naming `AUTH_SECRET`, and the canary is absent from stdout and stderr.
- **S-3 (R3, every fault).** The check-config canary runs for each fault, not just one: the canary as the whole file, `canary\ncanary` (line), ` canary` (whitespace), and a directory path (cannot be read). Check stdout, stderr and `ConfigError` (`message`, `cause`, `stack`).
- **S-4 (R3, `Secret`).** Hold the value in a `#private` field. Tests: `Object.keys(s)` is empty; `JSON.stringify({...s})`, `structuredClone(s)` and `` `${s}` `` contain no canary; the same for `util.inspect(cfg, {showHidden:true, depth:Infinity})`.
- **S-5 (R6, value check).** A declared key is kept only if its value passes that field's schema (type, pattern, maxLength), and the filter is compiled from `log.schema.json`, not from a second list. Canaries: `route: {body: CANARY}`, `route: CANARY_URL` (it has `?` or `://`), `job: CANARY` past maxLength, and `err.code: CANARY_MEMO`. Each is dropped and counted.
- **S-6 (R6, structure).** A validator test walks the schema and fails on any property with no `type`, or of type `object` (except `err`, which is closed and primitive-only), `array` or untyped. It also fails on any string with no `enum`, `pattern` or `format`, or with no `maxLength`. Parity check: every schema key passes the filter, and nothing else does.
- **S-7 (R6, bypasses).** (a) Bindings from `child()` go through the same filter (`formatters.bindings`), or the wrapper has no `child`. Canary: a child bound with a canary. (b) web and worker `main.ts` install `uncaughtException` and `unhandledRejection` handlers that log `process.crash` with `err: {type, code}` and exit 1. Node's default dump prints own properties such as pg's `detail`, which quotes values. Canary: a spawned main throws an error whose `message` and `detail` are canaries, and the output has neither. (c) Only `packages/config/package.json` depends on `pino`. `no-console` is on in `apps/web/src` and `apps/worker/src` outside the CLI and check-config output.
- **S-8 (R4, health).** (a) Single-flight: 50 calls at once on a cold memo run the probe once. (b) The probe has a hard timeout: a probe that never resolves gives `{"ok":false}` with 503 within it. (c) A probe that throws a canary-message error gives a byte-equal `{"ok":false}`, with the canary absent from the body and the headers.
- **S-9 (R2/R5, misc).** (a) `PUBLIC_ORIGIN` must equal `new URL(v).origin`, which also refuses userinfo and a trailing `/`. (b) With `POLY_IMAGE_REVISION` set (the release image), `APP_ENV=development` is refused, so one variable cannot turn off the secret-looking refusal and the `https` rule. CI image runs use `staging`. (c) The Dockerfile test asserts that every `COPY` in the final stage is `--from=`, that `USER node` is in the final stage, and that no committed `.npmrc` has `_auth`/`_authToken`.

Not gating:
- **Status listener (POLY-81 / TB-13).** Check the `Host` header against DNS rebinding through the operator's tunnel.
- **Secret file reads.** Refuse anything that is not a regular file, with a size cap, so `/dev/zero` cannot hang check-config.
- **POLY-88.** The public listener returns 404 on `/status`.
- **Open 1.** Route `connection.ts` through the loaded `Secret` when db is next touched, so the empty-file check covers the pool read too.

### @qa-engineer — 2026-11-10

Tests red @ a469e48 (pushed). Right reason (module/export absent): packages/config 252 + 2 files unloadable (ajv not yet a dev dep); tests/config+image+log 67; tests/db 35 (ops-status, ops-hardening) = 354 failing. Baseline green: python gate 1975 ok; tests/db/checks.test.ts with amended good() 42 pass.
Map: R2/R3 loader.test.ts; S-1..S-4, S-9a/b seceng.test.ts; R6, S-5..S-7a log.test.ts + log-seceng.test.ts; R1/R3/R7 structure and start refusal tests/config/check-config.test.ts; S-7b/c seceng-static.test.ts + tests/db/ops-hardening.test.ts; R4 tests/db/ops-status.test.ts; S-8 ops-hardening; R5/S-9c tests/image/dockerfile.test.ts (POLY_IMAGE_BUILD=1 opt-in); harness tests/log/canary.ts.
Assumed names, not in the ruling (reconcile in the test, one place each): SECRET_NAME_RE (S-1 export), config.secrets[VAR], config.statusPort, ConfigError.problems, createLogger({service,stream}), startStatusServer({port}), handleHealth(), main.ts for web/worker, schema key dropped.
Runners: pnpm vitest run -c tests/config/vitest.config.ts; -c tests/db/vitest.config.ts; pnpm vitest run in packages/config.
