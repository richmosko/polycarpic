# POLY-162: security build review (seceng-162, POLY-162d)

## Verdict @ `a1d5da3f`: **PASS WITH FIXES. 0 BLOCKS, 5 FIX HERE, 5 FOLLOW-UP**

**Conditions on the pass:** a full `ci.yml` run green at the final tip, T-real included, with its time recorded. Run 45500690283 is at `aac58b1d`, its `lint` job failed and `image` was still running when I read it; it is not evidence for the tip. The only T-real pass read is local (`treal-local-run4.txt`, 16/16, 299 s); that run did not go through CI's `sudo … | tee`.

**Read:** `git diff main...a1d5da3f`, product, workflow and tests; the T-real harness and the undo script whole, though unchanged. **Ran, no containers:** the listener and its flush mutant on real sockets (Node on macOS); the installed guard's `_service` on the committed renders of every service of the three files. **Not run:** any suite, mutant or container. "Red on" below is the builders' record unless it says I ran it.
S41 and S42 have no section in `ruling-review.md`; their only record is `ruling.md` G13 and G15, which is what I judged against.

## S38, S41, S42 as built

| Clause | Result | Evidence |
|---|---|---|
| S38 a trigger, import walk | Met by test | `deploy-key.test.ts` ROWS and "the suite does not import what the key cannot see"; the undo script is now a row |
| S38 b undo | Met for order and condition by test (`always() && deploy`, after the step, nothing pulls later). **What it removes is by reading only**, and it misses one network (F3) | `deploy-key.test.ts`; `deploy-real-undo.sh` |
| S38 c kept log | Path by test, content by T-real part 3; the CI form breaks the file (F1) | `3-sweep.test.ts`, `ci.yml` |
| S38 d sweep | Met on a green run by test. **Not met on a red run**: `bail: 1` skips part 3, the upload is `always()` (F1) | `vitest.deploy-real.config.ts` |
| S38 e no token | Met by two tests (the workflow's text; the process itself) | `deploy-key.test.ts`, `3-sweep.test.ts` (e) |
| S41 template0 | Met by test on real Postgres: a table planted in template1 is absent, with a control; red with no `TEMPLATE`, an unasked create, and roles.sql on `postgres` | `provision-db-create.test.ts`; `provision.sh` stage_database |
| S42 match, headers, 404, no echo, limits, no-bytes close | Met by test; red on `startsWith`, `maxConnections` 128, `headersTimeout` 0. I ran: pipelined second GET dropped, upgrade and Expect answered once | `public-health.test.ts` |
| S42 flush, then destroy | Met by reading, to the kernel only; ruled below | `public-health.ts:36` |
| S42 by reading only | `connect`/`clientError` `destroy` is tested; "started **once**" is not (the test accepts two calls); "no handler argument" is not (the signature is `{port}`); "nothing in the environment moves the bind" is a source match | `public-health.test.ts` "source and agreement" |

`handleHealth` is bounded (probe 4 s, single flight, 5 s memo), so a hung database does not pin the 64 connections.
A request with no `Host` gets Node's own 400, not the fixed 404: no body, nothing echoed, Caddy always sends `Host`. Accepted, no change.

## Ruling: the flush clause needs no test

**The code read is enough.** I ran 200 POSTs with 2 MB of unread body against each form. The built code delivered the whole 404 to 13 clients, the mutant (`res.end(body); req.socket.destroy()`) to 16: they do not differ. Node hands a 100-byte answer to the kernel inside `end()`, so the mutant is equivalent at this layer and no honest test can be red on it.
The same numbers show the clause is **weaker than its words**: with much unread body the kernel resets the connection and the client can lose the answer. It fails in the safe direction: the loser is a client uploading to a path that does not exist, and it exposes, retries or leaves nothing running. (Part of the loss may be my client dropping data on its write error; unmeasured.) `GET` health carries no body, so the health readers are unaffected. A bounded drain would add input handling to a file POLY-161 deletes. Not worth it.

## Condition (1), G14: **closed**

The worker runs `["worker"]` in both files, and the guard and the lint compare `command` and `entrypoint` for every service. I ran the guard: the unmodified service passes, and each of other, extended, empty and missing `command` and `entrypoint` is refused `guard-pinned`, for all 14 services of prod and staging and for caddy (3 or 4 variants per key, the pinned one left out). `docker compose run` one-offs keep the pinned entrypoint. Committed guard cases cover staging's services only; prod's `backup` and `uploader`, and caddy, rest on the one loop and my run (F4).
**What G14 does not reach (U1).** Its reason, "a compose file cannot choose what a container holding a given secret runs", is wider than its two keys. I ran it: `NODE_OPTIONS=--import=data:…` in `environment` passes `_service` for every app service, worker included, and so does any `healthcheck.test` but web's. This is on `main` already and is not a bypass of a rule the guard has: the compose file comes from the same attested commit as the image, and the container's limits and mounts hold.

## T-real in CI and a fork's reach: **not widened**

- `pull_request`, never `pull_request_target`; job `contents: read`; `persist-credentials: false`; no secret in `ci.yml`; the repository default token is read (`gh api`, read today).
- The step runs PR code as root by `sudo`. Every GitHub-hosted step already has passwordless `sudo` and Docker, so a PR could already do this. The machine is discarded.
- `build.yml` and `release.yml` do not run it (pinned by test) and restore no cache (C-81), so a cache written by a PR job does not reach an attested image.
- New: a third-party image by mutable tag runs on the runner (F2).

## Ruling B9: the kept log (S38 c, d on a red run). Replaces F1's "Wanted"

**Nothing is published until a sweep that runs on failure has passed.** No upload at all would be safe too, but a red run is when the log is needed.

1. **Three inputs, one output.** The step's output goes by `tee` to its own file, never the file the harness appends to (measured: `tee` erases the harness's lines). The harness's log is a second file. Neither is the uploaded path. The sweep step reads those two and staging's `deploy.log` and, only when all three are clean, writes the one uploaded file. `deploy.log` absent is allowed (a run that failed before it); an input that exists and cannot be read is a failure.
2. **The step.** `infra/ci/deploy-real-sweep.*`, in the `deploy` trigger, `if: always()` with the job's gate, after the test and **before the undo** (which deletes the secret list). The undo stays `always()` and does not depend on it. The upload is `always() && steps.<sweep>.outcome == 'success'`, never `!= 'failure'`.
3. **Fail closed.** No or unparsable `/run/poly-deploy-real/secrets.json`, or a name of the harness's `SECRETS` or the token missing from it: exit 1, no output file, no upload. A run that died in setup keeps only the job's own log.
4. **What it looks for:** for every listed secret, any 16 consecutive characters of it, in the value as it is, percent-encoded, base64 and hex; `PRIVATE KEY-----`; `github_pat_` or `gh[a-z]_` followed by 20 token characters; and part 3 (c)'s three shapes (a render, an environment dump, env-file lines).
5. **It removes nothing.** No redaction: a hit is exit 1, the names only, never a value or the line, and no file published. The job is then red even if the test was green. Part 3 stays as it is.

**Tests** (qa; unit, no container; each red on its mutant): clean inputs publish; a planted whole secret, a 16-character piece and an encoded one, each in each of the three inputs; no list, a short list, an unreadable input; the output names the secret and never its value. In `deploy-key.test.ts`: the upload without the sweep's outcome, the sweep after the undo, the sweep without `always()`, `tee` on the harness's file or on the uploaded one.

**Limit, accepted:** the job's own console is public as it is printed; no sweep can hold that back. It holds fixture values only, random per run, on a discarded machine, and the sweep of the step's output makes such a leak a red job. S38 a to e apply unchanged in T-real's own job: `contents: read`, `persist-credentials: false`, no token, no pull after the test.

## FIX HERE

| # | Owner | Finding | Wanted |
|---|---|---|---|
| F1 | devops, qa | `tee` opens the same file the harness appends to, without `-a`. I ran the shape: the later `tee` write overwrites the harness's line. The kept log loses text, the sweep reads a file that then changes, and on a red run it never sweeps. No real secret is at stake (fixture values, random per run, a discarded machine; the step output is public already) | Ruling B9 above |
| F2 | qa | `harness.ts:164` starts `registry:2` by tag, as a root-daemon container | Pin by digest |
| F3 | devops | The undo removes `polycarpic-edge-staging` but not the project's own `polycarpic-staging_default`, which the harness header lists (by reading) | Remove it |
| F4 | qa | G14's tests: no guard case for `auth` missing, or for prod's `backup`/`uploader` and caddy with a `command` or `entrypoint` added; no lint row for `backup` and `uploader` (caddy's command has one in `lint-caddy.test.ts`) | Cases for them, red with the loop off |
| F5 | qa | G14 rules T-real asserts the worker's `RestartCount` is 0; nothing does. The worker's health check is `process.exit(0)`, so "(healthy)" does not show it runs the worker | Assert `RestartCount` 0 and the container's `Args` |

Cheap with F4, not required: the main.ts test counts exactly one call.

## FOLLOW-UP (POLY-160)

| # | Finding |
|---|---|
| U1 | Pin every service's `healthcheck`, and refuse environment keys outside a per-service list (`NODE_OPTIONS`, `LD_PRELOAD`, `PG*`, `RCLONE_*` class). Before the first prod deploy |
| U2 | The lint holds its own copy of the G14 and web-health values beside `compose-allow.json`; read them from the one file, as it does for env files |
| U3 | No test runs the undo and looks at what is left |
| U4 | `infra/ci/install-compose.sh` is not in the `deploy` trigger; `compose-version` is |
| U5 | T-real's fake `gh` attests: real attestation is first shown on staging (POLY-104, C-83's refusals) |

## Tags

**My condition stands, and it is not enough by itself.** No `v1.*` or `edge-*` tag before this issue is done stays a gate. Today the remote holds no tag (`git ls-remote --tags`). After it, still before any tag:
1. **POLY-160**: H1 (R-32), the Principal's gate; H3 and U1 before the first prod deploy, so before a `v1.*` tag; the Principal's two Compose and Docker-update items before real household data.
2. **POLY-161**: for a `v1.*` tag, the real web server. Until then 3000 answers health only. An `edge-*` tag deploys Caddy alone and does not need it.
3. **POLY-104**: staging takes no tag, so the first staging deploy comes before any `v1.*` tag and shows what T-real fakes.

## SECURITY

1.20.2: C-83 states the command, entrypoint and health-check pins, what T-real shows and fakes, and what the guard does not judge (U1). It holds once the CI condition above is met.

## Delta `a1d5da3f..78888010` (F1 to F5, B9): **confirmed, PASS; CI condition OPEN**

Product tip `a975ba56`; after it only gate records. **By reading**, nothing run by me. Nothing new blocks.
- **F1/B9 met:** the two logs are separate files, the sweep is `always()`, before the undo, and the upload is tied to its success; the list must hold every name the harness registers. `e14f1e67` drops the `touch`, so an absent log is refused in CI too.
- **F2, F3, F5 met.** **F4:** met in the lint for all services. In the guard the committed cases are staging's; prod's `backup` and `uploader` and caddy have none. Accepted to POLY-160 with U2: one loop with no project branch, and I ran it for prod and caddy at `a1d5da3f` (`compose_guard.py` is unchanged since). `gate.md` gives the reason as "the tool deploys staging only": it deploys prod and edge too, and the guard judges both. The gap is the tests', not the tool's reach.
- **U4** is done here (`install-compose.sh` is in the trigger).
- **gitleaks:** five fixture fingerprints reviewed (`bf79faf6`); clean over `origin/main..HEAD` on the lead's re-run.
- **CI, run 45507656076 at `a975ba56`:** when written, `deploy-real` is green (T-real, sweep, undo, upload; job 6 min 59 s of its 15) and so are `guard`, `lint`, `unit`, `db`, `provision`; `image` still runs and `app` has not started. The condition is met when the run concludes success, and is void if the product tip moves.
