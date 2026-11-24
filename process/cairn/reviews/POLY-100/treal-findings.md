# What T-real found on real Linux, Docker and Compose (qa-100, 2026-11-24)

Reproduced in a privileged Ubuntu container on the Mac (recipe: `treal-local-container.md`), on the branch tip of the day. Status is at a9d35481.

| # | Finding | Kind | Status at a9d35481 |
|---|---|---|---|
| 1 | Docker 29.1.3 says `error: no such object: <name>` (lowercase); the case-sensitive "gone" test made every first deploy `oneoff-stuck` | product | fixed (336f60bd, G4) |
| 2 | On a fresh Postgres `poly_migrator` does not exist: `migrate --plan` dies with 28P01, so a first deploy ended `plan-error`, never exit 4 `roles-missing` | product | fixed (G12: the tool asks `pg_roles`) |
| 3 | Nothing creates the database `polycarpic`: `provision --stage database` fails on a fresh cluster | product | open: G13, POLY-162 |
| 4 | `worker` has no `command: ["worker"]` in staging.yml and prod.yml: it runs the image's `web` and restart-loops on `config.refused` | product | open: G14, POLY-162 |
| 5 | web serves nothing on :3000 (only the status listener on 127.0.0.1:8081; the public server is POLY-88/161): the compose healthcheck and the tool's `/api/v1/health` probe can never pass, so a first deploy always ends `rollback-unhealthy` | product | open: G15, POLY-162 |
| 6 | Ubuntu's Compose 2.40 renders `bind: {create_host_path: true}` on the plain render and the guard refuses it as `guard-mount` | product (which Compose a box runs) | fixed: one pinned Compose, 5.7.1 (G10) |
| 7 | The stdin re-render used the caller's directory: Compose stat'ed `.env` in `/home/runner/work/…` as uid 10020 (`permission denied`) and would take values and profiles from a `.env` there | product | fixed (G11) |
| 8 | The tool refused the runner's `/opt` (not root-owned or group/world-writable) | harness (a real box's `/opt` is root 0755) | the harness records `/opt`'s mode and makes it root 0755, the undo restores it |

Harness faults of mine, fixed: `install /dev/stdin` fails through sudo (ENXIO); `.test` is a reserved TLD (the app's check-config then demands `TLS_MODE=private-ca`); the legacy builder has no `COPY --chmod`; a stale local `polycarpic:ci` had no `/release/infra`; the install reads the container's own repository, so the tree must be committed there.

Where it stopped: part 1 reaches `first-deploy` #2 for real (install, images, render, guard, check-config, plan, migrate, `up`) and fails at the health window on #4 and #5. Parts 2 (rollback) and 3 (S38) were not reached.

The G15 test file I wrote (red against the missing module, real sockets) is `public-health.test.ts.txt` in this directory, for POLY-162.
