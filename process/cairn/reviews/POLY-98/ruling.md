# POLY-98 ruling: the `polycarpic-ops` operator CLI

Architect, 2026-11-22. Tree read at `66bbed77`. Scope: POLY-98's description, five acceptance criteria and seven comments;
the scope the Principal confirmed on 2026-11-22 (relayed by the lead); INFRA §2, §3.2, §6.5, §7, §8; the POLY-97 ruling,
verdict and real run; POLY-146's ruling and security review; POLY-147 R10 and R11. A claim is measured unless tagged
`(unmeasured)`. §M lists the measurements. §D lists the choices for the Principal; the ruling proceeds on each
recommendation unless the issue file says otherwise. §S lists the positions seceng reviews (POLY-98b).

## M — Measurements

| # | Question | Command (abridged) | Result |
|---|---|---|---|
| M1 | After `set-secret` replaces a file by rename, does a container see the new value? | Docker 29.9.3 (Docker Desktop, arm64), compose 5.7.0. File bind-mounted `:ro` into `alpine:3`; write `s.tmp`, `mv s.tmp s`; `docker exec cat`; then `docker restart`; `cat` again | Before the restart the running container could not read the file (`No such file`; Docker Desktop's file sharing). After the restart: the new value. On a Linux host the running container keeps the old inode until a restart `(unmeasured)`. Either way a restart is what applies a new secret, and nothing sees a half-written file. |
| M2 | Does `docker compose -p <project> restart <svc>` work from a directory with no compose file? | the same project, `cd /`, `docker compose -p m98p restart a`, then `exec -T a cat` and `logs` | exit 0, the new value read, `logs` exit 0. With POLY-97 V1 (`ps` and `exec` work with `-p` alone), every read-only and restart call here needs no `-f`. `run` needs `-f` (it creates a container). |
| M3 | Does the app CLI's `user reset-mfa` need a grant poly_operator lacks? | read `apps/worker/src/cli/main.ts`, `packages/db/migrations/0013_second_step_guards.sql:580` | **No.** The app CLI accepts `user reset-mfa <email>`, and 0013 grants `EXECUTE ON FUNCTION app.reset_second_step(text) TO poly_operator`. The confirmed scope's premise for this one verb does not hold; §D1. |
| M4 | Can `cli user invite` run on a box today? | read `infra/compose/prod.yml` `operator`, `packages/config/src/registry.ts` | The service sets only `DB_PASSWORD_FILE`; the config registry reads `DATABASE_PASSWORD_FILE` and the operator also needs `PUBLIC_ORIGIN`. POLY-97 moved that env wiring to POLY-100. Until POLY-100 adds `operator` to it, the wrapper is proven against fakes only, and the first live invite is POLY-104's. |
| M5 | Does H6 accept one secret written to two services? | read `infra/provision-check.sh` lines 171–174 | **No.** Any two files with equal content under `secrets/` and `staging-secrets/` fail H6. `resend_api_key` is mounted by `auth` and `worker` (INFRA §3.2: "two files, one in each service's directory"), so `set-secret resend_api_key` as INFRA specifies it would turn H6 red. R4 settles it. |
| M6 | Is "written 0400" (the description) consistent with the layout? | `provision.sh` R5, `provision-check.sh` H6, INFRA §3.2 | **No.** Files are `root:<service gid>` 0440, so the service's gid can read them. A 0400 root file is unreadable by every service, and H6 fails it. This ruling uses 0440; the description is wrong on this one word. |
| M7 | Where does the operator service run, `exec` or `run`? | `infra/compose/prod.yml` lines 125–143; POLY-146 ruling lines 44, 116–120; `logging-measure.md` | `operator` is a one-shot service: `profiles: [operator]`, `restart: "no"`, `logging: {driver: "none"}`, entrypoint `/app/bin/polycarpic cli`. Nothing long-running exists to `exec` into. INFRA §7.5's `docker compose --profile operator run --rm operator …` is true now. The 2026-11-12 comment's `exec -T worker` predates POLY-146 and is superseded. |
| M8 | Is Python on the box? | POLY-97 real run step 14 | `cloud-init status --wait` → `status: done` on Ubuntu 24.04.4; cloud-init is a Python 3 program, so `/usr/bin/python3` (3.12 on 24.04) exists on every box this runbook builds. |

## Scope

IN: R1–R14. `restart` is IN (R9): §8.1 rotation cannot finish without it, and M1/M2 show it is one compose call plus a
health wait. `logs` is OUT: the runbook can print `sudo docker compose -p polycarpic-prod logs <svc>` directly, and once
R13 corrects step 16 nothing in this loop's runbook text calls it. `show-mounts` is OUT: `list-secrets` prints the
mounting service per file, which is the question show-mounts answered (INFRA §7.4 line "mounted only into caddy" points
at `list-secrets`).

OUT, each to the issue the lead named: `first-deploy`, `rollback`, `redeploy`, `self-update`, `open` (POLY-100, POLY-104);
`restore`, `neon-export` (POLY-99); `heartbeat-url` (POLY-103); the home-box commands (POLY-120); `rotate-db-password`,
`auth-secret`, `init-keyring`, `staging-auth`. Also OUT, and owned elsewhere: the operator service's environment
(`DATABASE_*`, `PUBLIC_ORIGIN`, `APP_ENV`), POLY-100 (M4); the uploader's `last-upload` and the backup's `jobs.log`
writes, POLY-99 (R7 fixes the line formats they write); the GitHub-token-days status item, POLY-100. No grant to
poly_operator changes.

## R1 — Shape: language, location, install, extension

- **Language: Python 3, stdlib only**, targeting the box's 3.12 (M8). Reasons: argv lists for every child process (no shell
  word-splitting under sudo), `getpass`, `os.open` with mode and `O_NOFOLLOW`, `json`, `ssl` for the certificate check, and
  the house style of `infra/operator/`. Bash would need `read -s`, `jq` and quoting rules on a root path.
- **Repo layout (`infra/ops/**`):**
  - `infra/ops/polycarpic-ops`: the dispatcher. Shebang `#!/usr/bin/python3 -IS`.
  - `infra/ops/commands/<name>.py`: one module per subcommand. The file `set_secret.py` is the subcommand `set-secret`.
    Each module exports `HELP` (one line), `add_arguments(parser)` and `run(args, ctx) -> int`.
  - `infra/ops/status/<nn>_<item>.py`: one module per status item, run in filename order. Each exports
    `run(ctx) -> list[Line]`.
  - `infra/ops/lib/`: shared helpers (`ctx.py`, `compose.py`, `out.py`, `secrets.py`).
  - `infra/ops/install.sh` (laptop) and `infra/ops/install_box.py` (box): R2.
- **No registry file.** The dispatcher lists `commands/`, accepting only names matching `^[a-z][a-z0-9_]*\.py$`, and
  `status/`, accepting only `^[0-9]{2}_[a-z][a-z0-9_]*\.py$`; any other file in either is ignored. `help` is generated from the modules. A later issue adds a subcommand as
  `commands/<name>.py` plus `tests/infra/ops/test_<name>.py`, and a status item as `status/<nn>_<item>.py`, editing no
  file another loop edits. Editing an existing `lib/` module is a cross-loop change and is named at that loop's ruling;
  a new helper goes in a new `lib/` module.
- **The context object (`lib/ctx.py`)** carries everything the outside world supplies: `root` (path prefix), `run`
  (argv list, stdin bytes, timeout → code, stdout, stderr), `run_inherit` (the same, with the terminal's stdout and stderr
  inherited), `getpass`, `isatty`, `confirm`, `now`, `chown`, `geteuid`, `tls_probe`, `statvfs`. Production builds it with
  `root="/"`. Tests build it with a temp root and fakes. **The root and the fakes come from the test's constructor only,
  never from argv, the environment or a file**, so no production invocation can point the tool at another tree.
- **Installed on the box at `/opt/polycarpic/ops/<id>/`**, a tree that mirrors the repo paths of R2's bundle, with
  `/opt/polycarpic/ops/current` a symlink to the active `<id>` and `/usr/local/sbin/polycarpic-ops` a symlink to
  `/opt/polycarpic/ops/current/infra/ops/polycarpic-ops`. `<id>` is `git-<12 hex>` for a laptop install. The layout leaves
  room for `sha256-<12 hex>` when POLY-100's self-update installs from the attested release bundle.
- **Run as `sudo polycarpic-ops <subcommand> …`.** Ubuntu's default sudo `secure_path` includes `/usr/local/sbin` `(unmeasured on the box; the R11 container test measures it on ubuntu:24.04)`.

### Global contract

- **Exit codes:** 0 done or green; 1 failed, red, or a child process failed; 2 usage error or refused request (unknown
  subcommand, bad value, a refused secret name or cli verb); 3 green with waiting items (`status`, and `provision-check`
  passed through); 4 precondition (not root, install integrity, compose file unreadable).
- **Preconditions, checked before any subcommand runs:** euid 0, else `polycarpic-ops: run with sudo` exit 4. Every
  directory and file from `/opt/polycarpic/ops/current/` down is owned by root and not group- or world-writable, and so is
  each parent directory up to `/`, else `polycarpic-ops: install is not root-owned: <path>` exit 4.
- **Process hygiene:** `umask 077`. Child processes get an environment built from nothing:
  `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`, `LC_ALL=C.UTF-8`, `HOME=/root`, plus only the
  variables a call names (R8's image references). Never `shell=True`, `os.system`, `os.popen`, or a string argv.
- **Arguments:** each value forwarded to a child is checked against its own pattern (below) and never starts with `-`.
- **Output:** no secret value, generated or pasted, reaches stdout, stderr, argv, the environment, or any file except its
  own secret path. `sudo` logs argv to the system journal, so argv never holds a secret.
- **No arguments:** usage on stderr, exit 2. `help`: every subcommand with its one-line help, exit 0. `--version`:
  `polycarpic-ops <id>`, exit 0.

## R2 — Install: the permanent home for the provisioning files

INFRA §7.1 step 11 copies four files to `/tmp`, which a reboot clears (POLY-97 real run F4). They now ship inside the ops
bundle, installed once, root-owned, and survive reboots.

- **Bundle contents** (repo-relative, kept as such under `<id>/`): `infra/ops/**`, `infra/provision.sh`,
  `infra/provision-check.sh`, `infra/postgres/gate-check.sh`, `infra/postgres/gate-check.sql`,
  `infra/operator/b2-capabilities.json`, `infra/compose/{prod,staging,edge}.yml`, `packages/db/sql/roles.sql`.
  `provision.sh` already finds `roles.sql` at `../packages/db/sql/roles.sql` from its own directory.
- **Laptop:** `laptop$ infra/ops/install.sh polyops@<host> [--ssh-key <file>]`, from the verified checkout of step 6:
  1. Refuses (exit 2, listing the paths) if `git status --porcelain` shows any change under the bundle paths.
  2. `<id>` = `git-` + `git rev-parse --short=12 HEAD`.
  3. Streams `git archive --format=tar HEAD -- <bundle paths>` (committed content only, never the working tree) over one
     `ssh` session. The remote command is a fixed string with only `<id>` substituted (validated `^git-[0-9a-f]{12}$`):
     as root, extract into `mktemp -d /opt/polycarpic/.ops-incoming.XXXXXX` with `--no-same-owner`, then run
     `/usr/bin/python3 -I <dir>/infra/ops/install_box.py <dir> <id>`.
- **Box (`install_box.py`):** creates `/opt/polycarpic` root 0755 if absent; refuses a tar member that is absolute, holds
  `..`, or is a link; sets every directory 0755 and every file 0644 (0755 for `polycarpic-ops`, `install_box.py`,
  `provision.sh`, `provision-check.sh`, `gate-check.sh`), all `root:root`; renames the tree to `/opt/polycarpic/ops/<id>`;
  swaps `current` atomically (a new symlink, then `rename`); creates the `/usr/local/sbin` link; keeps the previous `<id>`
  and deletes older ones. When `<id>` is already current it prints `polycarpic-ops <id> already installed`, changes
  nothing, and exits 0.
- **Output:** `installed polycarpic-ops <id> at /opt/polycarpic/ops/current (previous: <id>|none)`, exit 0. Any failure
  exits 1 with the cause, and `current` stays where it was.
- **Trust:** the same as today's `scp` from the verified checkout. It is not attested; self-update (POLY-100) is where the
  installed bundle starts coming from the attested image.

## R3 — `provision` and `provision-check`

- `sudo polycarpic-ops provision [--stage host] --target hetzner --domain <d> [--mail-from <addr>] [--b2-bucket <name>]`
  and `sudo polycarpic-ops provision --stage database --project prod|staging`.
  - Patterns: `--domain` `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$`; `--mail-from` 1–254
    printable characters with no control character (provision.sh validates the address itself); `--b2-bucket`
    `^[a-z0-9-]{6,50}$`; `--target` exactly `hetzner` (`home` exits 2 with `--target home is not available`).
  - `--b2-bucket` is consumed by the wrapper. It writes `/etc/polycarpic/ops.conf`, root:root 0644, one line
    `B2_BUCKET=<name>`, printing `change: ops.conf B2_BUCKET=<name>` when it changes, and nothing when it is equal. Every
    other flag is forwarded unchanged to `/bin/bash <bundle>/infra/provision.sh --stage …`. Output and exit code are the
    script's own, passed through.
  - `--stage database` is the named command for INFRA §8.10 step 4 (re-apply `roles.sql` after a restore), satisfying the
    criterion that the restore step gets one. It also sets fresh verifiers, which is harmless (POLY-97 verdict).
- `sudo polycarpic-ops provision-check [--prod] [--b2-bucket <name>]` runs
  `/bin/bash <bundle>/infra/provision-check.sh --b2-capabilities <bundle>/infra/operator/b2-capabilities.json --b2-bucket <name> [--prod]`.
  `<name>` comes from the flag, else `ops.conf`, else exit 2 `no bucket: run provision --b2-bucket <name> once, or pass --b2-bucket`.
  Output and exit (0, 1, 3) are passed through.
- **Changes to `provision-check.sh` this loop needs:** H6 accepts `ops.conf` as world-readable, and fails it unless it
  holds only `B2_BUCKET=` lines matching the pattern. R4's same-name rule. D3 records its probe window in `jobs.log` (R7).

## R4 — `set-secret`

`sudo polycarpic-ops set-secret [--staging] <name>`

- `<name>` matches `^[a-z][a-z0-9_]{0,63}$`, else exit 2.
- **Targets come from compose, the single source** (as POLY-97 R5): every top-level `secrets:` entry whose `file:` path
  lies under the project's secret root and whose basename is `<name>`. Prod reads `prod.yml` and `edge.yml` under
  `/etc/polycarpic/secrets/`; `--staging` reads `staging.yml` under `/etc/polycarpic/staging-secrets/`. `lib/compose.py`
  parses that block with a strict line pattern (`^  ([a-z0-9_]+)__([a-z0-9-]+): \{file: (/\S+)\}$`). Any other line inside
  the block exits 4 with `compose secrets block unreadable: <file>:<line>`. A test asserts that the parse equals the set the
  existing compose-equals-table vitest test reads.
- **Refused names (exit 2), each naming who writes it:** `db_superuser_password` and every `db_password_*`
  (`provision`), `auth_secret` (`provision`), `credential_keyring` (`init-keyring`), `staging_basic_auth`
  (`staging-auth`). `lib/secrets.py` holds this list, and a test asserts the `provision` part equals `provision.sh`'s
  generated set. A name no service mounts: exit 2,
  `no service in <file> mounts <name>; names you can set: <list>`.
- **Reading:** only from a terminal (`isatty` on stdin), else exit 2 `set-secret reads from a terminal only`. `getpass`
  prompt `<name> (input hidden): `. `backup_store_credential` takes two prompts, `key id (input hidden): ` and
  `application key (input hidden): `, and is written as `<id>\n<key>\n` (POLY-97 R6's format). Any other name is one line,
  written as `<value>\n` (provision.sh's form). Refused (exit 2, nothing written): empty, any whitespace or control
  character inside the value; for `heartbeat_url`, anything not starting `https://`.
- **Replacing:** if any target exists, it prints `<name> exists for: <services>; type yes to replace:` and reads the
  answer from the terminal. Anything but `yes` exits 1, `not replaced`.
- **Writing, per target:** open the service directory with `O_DIRECTORY|O_NOFOLLOW` and require `root:<g>` 0750, else exit
  4 `<dir> is not root:<gid> 0750: run provision`. Then, relative to that directory fd: create `.<name>.tmp-<random>` with
  `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW` and mode 0440, `fchown` it `0:<g>`, write, `fsync`, and `rename` it over `<name>`.
  No other temporary file, anywhere. `<g>` is the directory's own group, which H6 checks against the service gid.
- **Output** (exit 0): one line per target, `written: <path> (<n> bytes, 0440 root:<gid>)`, then
  `set-secret: <name> written for <services>; run: sudo polycarpic-ops restart <long-running services>`. For a name only
  one-shot services mount (`backup_store_credential`, `heartbeat_url`), the last line instead ends `; the next uploader run reads it`.
- **One value, several services (M5):** H6 changes so that files with equal content pass **only** when they have the same
  basename and sit in the same tree (`secrets/` or `staging-secrets/`), which is exactly what `set-secret` writes. Equal
  content under two names, or across prod and staging, still fails. The alternative is §D2.

## R5 — `list-secrets`

`sudo polycarpic-ops list-secrets [--staging]`. It reads each mounted path with `stat` only and never opens a secret file.
A test makes `open` and `os.open` raise for any path under the secret roots.

```
SERVICE   NAME                      STATE    MODE OWNER         BYTES
auth      auth_secret               set      0440 root:10007       45
auth      resend_api_key            missing
...
14 files: 11 set, 3 missing
```

- One row per compose-mounted file (R4's parse), sorted by service then name. Columns padded as shown, and no row is
  wider than 80 characters.
- A present file that is not `0440 root:<dir gid>`, or is not a regular file, shows `WRONG` in STATE with its real mode
  and owner. The last line then adds `; <k> wrong: run provision-check`, and the exit is 1. Otherwise the exit is 0;
  missing files do not fail.

## R6 — `gate-check`

`sudo polycarpic-ops gate-check [--staging]` runs
`/bin/sh <bundle>/infra/postgres/gate-check.sh docker compose -p polycarpic-<project> exec -T postgres psql -U postgres -d polycarpic`
and passes its output and exit code through: one line `gate: pass` with exit 0, otherwise `FAIL …` lines or
`gate: error (…)` with exit 1. If the project has no running `postgres`, it prints
`gate: error (polycarpic-<project> postgres is not running)`, exit 1, and runs nothing.

## R7 — `status`

`sudo polycarpic-ops status`. Read-only. It fits one screen: at most 24 lines, each at most 80 characters (a long detail is
cut with `…`). Each item has a 10 s timeout, and a timeout is RED.

```
polycarpic-ops status  <hostname>  2026-11-22 18:40Z  ops git-66bbed77c0de
OK   disk      host     / 23%, /srv/polycarpic 4%
OK   app       prod     sha256:1a2b3c4d5e6f, deployed 2026-11-22 18:21Z (19 m)
OK   cert      prod     app.example.com, 84 days left
OK   backup    prod     last upload 2026-11-22 02:31Z (16 h)
OK   backupdb  prod     0 poly_backup connections in 24 h, all accounted
OK   slots     prod     no non-temporary replication slot
OK   revokes   prod     plpgsql and 17 built-ins closed to PUBLIC
WAIT app      staging  not deployed
…
STATUS GREEN
```

- **Line:** `<STATE> <item> <project> <detail>`, STATE one of `OK`, `RED`, `WAIT`, padded to 4, item to 9, project to 8.
- **Summary, last line, and exit:** `STATUS GREEN`, exit 0; `STATUS GREEN; <n> WAITING: <item project,…>`, exit 3 (no RED,
  at least one WAIT); `STATUS RED: <n>: <item project,…>`, exit 1.
- **Items, in order** (prod lines, then staging; `backup` and `backupdb` are prod only, since staging has no backup):

| Item | Source | OK | RED | WAIT |
|---|---|---|---|---|
| `disk` (host) | `statvfs` of `/` and `/srv/polycarpic` | both under 80 % used | either at or over 80 %, or `/srv/polycarpic` not mounted | — |
| `app` | `docker compose -p polycarpic-<p> ps -a --format json`; `docker inspect` of `web` for `Config.Image` and `Created` | postgres, web, auth and worker running, each `healthy` where it has a health check; web, auth and worker on one image. Detail: the digest (first 12 hex of the `@sha256:` reference, else of the image id) and web's creation time | any of the four missing, stopped or unhealthy, or the three app images differ | the project has no containers |
| `cert` | TLS to the host in `PUBLIC_ORIGIN` (`host.env` / `staging-host.env`) on 443, resolved by DNS, verified against the system CA store with hostname check; `notAfter` | verifies, at least 14 days left | fails to verify (the reason), or under 14 days | nothing answers on 443 and `polycarpic-edge` has no containers |
| `backup` | first line of `/var/lib/polycarpic/state/last-upload`: `YYYY-MM-DDTHH:MM:SSZ` | under 26 h old (INFRA §6.5) | 26 h or older, or a first line that does not parse | the file is empty or absent |
| `backupdb` | `docker logs --timestamps --since 24h` of prod `postgres`, lines matching `(replication )?connection authorized: user=poly_backup\b`; windows from `jobs.log` | every connection falls inside a `jobs.log` window, widened 60 s each side. Detail: the count | any connection outside every window (detail: up to three times, `HH:MMZ`), or a `jobs.log` line that does not parse (its line number) | prod postgres not running |
| `slots` | `SELECT slot_name FROM pg_replication_slots WHERE NOT temporary` | none | any (names) | postgres not running |
| `revokes` | R7a | both closed | either open (which) | postgres not running |

- **R7a, the bootstrap revokes (criterion 5; POLY-147 R10, R11; SECURITY C-87).** On database `polycarpic`, through
  `docker compose -p polycarpic-<p> exec -T postgres psql -U postgres -d polycarpic -XAtq -v ON_ERROR_STOP=1`, SQL on
  stdin:
  - plpgsql: no row of `aclexplode(coalesce(l.lanacl, acldefault('l', l.lanowner)))` for `lanname = 'plpgsql'` with
    `grantee = 0` and `privilege_type = 'USAGE'`. A NULL `lanacl` means the default, which grants PUBLIC, so it is RED.
  - The built-ins: the signatures are read from the installed `roles.sql`'s
    `REVOKE EXECUTE ON FUNCTION pg_catalog.<sig> FROM PUBLIC;` lines (one source). There must be exactly 17, else RED
    `roles.sql lists <n> built-ins, want 17`. For each, `to_regprocedure('pg_catalog.<sig>')` must resolve (else RED
    `<sig> not found`: a major upgrade renamed it and the list needs review), and its `aclexplode(coalesce(proacl,
    acldefault('f', proowner)))` holds no `grantee = 0`, `EXECUTE` row. RED names the open ones, up to the line width.
  - The fix line for both: `run: sudo polycarpic-ops provision --stage database --project <p>`, printed under the
    summary, once.
- **Formats this ruling fixes for other writers:**
  - `last-upload`: first line `YYYY-MM-DDTHH:MM:SSZ` (UTC, the verified upload's time), then object names, one per line
    (INFRA §6.5's "a timestamp and the object names"). POLY-99's uploader writes it.
  - `jobs.log`: one line per run, `<start> <end> <job> <result>`, both times in the format above, `<job>` matching
    `^[a-z0-9-]+$`, `<result>` `ok` or `failed`. POLY-99's backup writes it. **This loop:** provision-check's D3 probe
    connects as poly_backup (the positive case), so it appends `<start> <end> provision-check-d3 ok|failed` around its
    probe. Without that line, every provision-check would turn `backupdb` red for 24 hours.

## R8 — `cli` pass-through

`sudo polycarpic-ops cli [--staging] user invite <email> [--bootstrap]`

- **Accepted:** exactly `user invite <email>` with an optional `--bootstrap`, `<email>` 3–254 characters matching
  `^[^\s@\-][^\s@]*@[^\s@]+\.[^\s@]+$`. The app CLI validates it again (`validOperatorEmail`).
- **Refused by name, exit 2, nothing run:** `user reset-mfa`, `membership remove-owner`, `entity set-founder`,
  `secrets rotate`, `secrets init`, each printing `refused: cli <verb> is not enabled in polycarpic-ops: it needs its own
  security review first`. Any other verb: `refused: unknown cli command; available: user invite`, exit 2. (`reset-mfa`
  needs no new grant, M3; §D1.)
- **The call:** `docker compose -f <bundle>/infra/compose/<project>.yml -p polycarpic-<project> --profile operator run --rm -T operator user invite <email> [--bootstrap]`.
  - `run`, never `exec` (M7). `--rm` removes the container. `-T` keeps stdout (the link) and stderr (the status line)
    separate. `logging: none` keeps both out of Docker's log (POLY-146).
  - The compose process (not the container) gets `POLY_APP_IMAGE` = the running `web` container's `Config.Image`, and
    `POLY_POSTGRES_IMAGE` = the running `postgres` container's. So the one-shot runs the deployed release, never a pull.
    No `-e`: the container's environment is compose's (POLY-100, M4).
  - stdout and stderr are inherited (`run_inherit`), so the link goes from the container to the terminal and is never in
    the wrapper's memory, a pipe it reads, or a file. The exit is the app's: 0 recorded, 1 failed, 2 refused.
- **Preconditions:** the project's `postgres` and `web` are running, else exit 1
  `polycarpic-<project> is not running: deploy it first`.
- **What the operator sees** (from `user-invite.ts`): the link on one line of stdout, then
  `invitation recorded (bootstrap|operator), expires <ISO time>` on stderr. Nothing is emailed (POLY-142; email is POLY-144).

## R9 — `restart`

`sudo polycarpic-ops restart [--staging] <service>…`. `<service>` is a non-profiled service of the project's compose file
(`postgres`, `web`, `auth`, `worker`) or `caddy` (project `polycarpic-edge`, prod only). Anything else: exit 2, listing the
valid names. It runs `docker compose -p <project> restart <service>` (M2), then polls the container's health for up to
120 s. It prints `<service>: healthy` (or `<service>: running`, where the service has no health check), or
`<service>: not healthy after 120 s (<state>)` with exit 1. It exits 0 when all are healthy.

## R10 — `b2-setup.py --probe --show-rclone-output`

`--show-rclone-output` is valid only with `--probe`; on its own it is a usage error, exit 2. After the `PROBE:` line, and
only after the temporary key's deletion has returned, it prints
`--- rclone output (temporary key already deleted) ---`, rclone's combined output cut to 4096 bytes, then `--- end ---`.
Before printing, every occurrence of the temporary key id, its secret, the master key id, the master key and any
`authorizationToken` value is replaced with `<redacted>`. rclone's verbosity flags are never added. R10's sweep from
POLY-97 covers it: a fixture rclone that echoes all five values, and the test fails on any of them in the output.

## R11 — Tests (98c): the harness

- **Unit tests:** `tests/infra/ops/test_<command>.py` and `test_status_<item>.py`, `unittest`, run by
  `python3 -m unittest discover -s tests/infra/ops -t tests/infra/ops`. Each builds a context with a temp root holding
  the fake host tree it needs (secret dirs, `host.env`, state files, the bundle with the real compose files and
  `roles.sql`) and a fake runner that answers from fixtures and records argv, stdin and env. The base class makes
  `socket.create_connection`, `urllib.request.urlopen` and `subprocess.*` raise, so a missed injection fails.
- **Container test, real where it matters:** `tests/infra/provision/ops.test.ts` in the POLY-97 box (it has `sudo` and
  `python3`). From the provisioned `HOST` snapshot: run `install.sh` with a fake `ssh` that runs the remote command inside
  the box. Then, as a non-root user with a sudoers drop-in, `sudo polycarpic-ops …`: real ownership, modes, `O_NOFOLLOW`,
  sudo's environment reset, and a fake `docker` installed at `/usr/bin/docker` (the fixed PATH ignores the fakes dir).
- **CI:** both run in the `provision` job. `infra/ci/changes.mjs`: add `^infra\/ops\/` and `^tests\/infra\/ops\/` to
  `provision`, and exclude `ops\/` from the `image` patterns (`infra\/(?!ci\/|hetzner\/|operator\/|ops\/)`,
  `tests\/infra\/(?!operator\/|ops\/)…`). One new step after the operator-tool tests. No new job.

## R12 — Acceptance text per stage

**98c (tests red).** Each case is red before the build for its own missing behaviour, and asserts the message and exit
code, not just non-zero:

- Dispatcher: not root → 4; a group-writable file in the install → 4, naming it; an unknown subcommand → 2 with the
  list; `help` lists exactly the modules present; a planted `commands/evil-name.py` is ignored. A child's env holds
  exactly the fixed keys, even with a poisoned parent env (`PATH`, `PYTHONPATH`, `LD_PRELOAD`). A lint test fails on
  `shell=True`, `os.system`, `os.popen` or a string argument to `subprocess` anywhere under `infra/ops/`.
- `install.sh`: a dirty bundle path → 2; a working-tree-only change does not reach the box; the installed tree is root
  0755/0644 with the five executables; a second install of the same `<id>` changes nothing; a third `<id>` deletes the
  oldest; a tar member with `..` → 1 with `current` unchanged; `provision-check` runs from the bundle after a simulated
  reboot that clears `/tmp`.
- `provision`: forwards exactly the flags given; `--target home` → 2; a domain starting with `-` → 2; `--b2-bucket`
  writes `ops.conf` once and prints `change:` only the first time; `--stage database` forwards `--project`.
- `provision-check`: the bucket from `ops.conf`; none → 2 with the hint; exit 3 passed through; H6 passes `ops.conf` and
  fails it with an extra line; D3 writes one `jobs.log` line.
- `set-secret`: every refused name with its owner; a name no service mounts → 2 with the list; non-tty → 2; empty or
  space-containing values → 2; `resend_api_key` lands in auth and worker as 0440 `root:10007` and `root:10002`, and H6
  passes; equal content under two names fails H6; a staging value equal to prod's fails H6; replacing without `yes`
  leaves the old file; a symlinked target or service dir → 4 with nothing written; `backup_store_credential` is two
  lines; the R10-style sweep (stdout, stderr, argv log, env log, every file outside the target) finds no fixture value.
- `list-secrets`: the exact table on a fixture tree; no secret file is opened; a 0644 file → `WRONG`, exit 1.
- `gate-check`: the exact argv; `gate: pass` → 0; a `FAIL` line → 1; postgres down → 1 with the line, and no psql run.
- `status`: for each item, its OK, RED and WAIT case with the exact line; the summary and exit for green, waiting and
  red; a 30-line fixture never prints more than 24 lines or a line over 80 characters; plpgsql open → RED; one of the 17
  executable by PUBLIC → RED naming it; a missing signature → RED; `roles.sql` with 16 revokes → RED; a `poly_backup`
  connection outside every window → RED with its time; the same inside the D3 window → OK; an empty `last-upload` →
  WAIT; one 27 h old → RED.
- `cli`: the exact compose argv and image env; the four refused verbs and an unknown one → 2 with nothing run; an email
  starting with `-` → 2; stdout is inherited (the fake's link never passes through the wrapper).
- `restart`: an unknown service → 2; healthy → 0; a 120 s timeout (fake clock) → 1.
- `b2-setup.py`: `--show-rclone-output` without `--probe` → 2; the five values redacted; the block printed after
  `b2_delete_key` in the request log.

**98d (build green).** Every 98c case green with no test loosened; the full `provision` job green on CI within the guard
below; R13's INFRA edits and `infra/README.md` in the same PR, each quoting the built output; the builder's unmeasured
list in the build-green commit.

## R13 — Docs (owners)

**devops (INFRA), each passage stating the built output verbatim:**
- §7 section hint: `polycarpic-ops` is installed by `infra/ops/install.sh` into `/opt/polycarpic/ops/current` and run as
  `sudo polycarpic-ops`; `polycarpic-ops help` lists its subcommands.
- §2 host-layout table: add `/opt/polycarpic/ops/` (the bundle, `current`, the previous one), `/usr/local/sbin/polycarpic-ops`,
  `/etc/polycarpic/ops.conf`; the state-files row gains R7's `last-upload` and `jobs.log` line formats.
- §3.2 secrets table: `set-secret` writes 0440 `root:<gid>` into each mounting service's directory and refuses names no
  service mounts or that a tool generates.
- §7.1 step 4: `--probe --show-rclone-output` when the probe says INCONCLUSIVE.
- §7.1 step 11: `infra/ops/install.sh polyops@<host>`, then `sudo polycarpic-ops provision --target hetzner --domain …
  --b2-bucket …` and `sudo polycarpic-ops provision-check`. The scp-to-`/tmp` lines and the reboot sentence go.
- §7.1 step 12: the `list-secrets` table; `backup_store_credential`'s two prompts; `heartbeat_url` and
  `backup_store_credential` are prod only (staging has no uploader); provider secrets only for names a service mounts
  (`oauth_google_secret` is not mounted today, so `set-secret` refuses it).
- §7.1 step 16: `sudo polycarpic-ops gate-check` first. The fallback without the helper is
  `/opt/polycarpic/ops/current/infra/postgres/gate-check.sh docker compose -p polycarpic-prod exec -T postgres psql -U postgres -d polycarpic`;
  today's text lacks `-p polycarpic-prod` and works only from the compose directory. The invite prints the link once on
  the terminal, followed by `invitation recorded (bootstrap), expires …`. Nothing is emailed. Copy the link into the
  browser; it is stored nowhere. The Resend and spam-folder sentence and `polycarpic-ops logs web` go.
- §7.1 step 17: "Open the link step 16 printed" in place of "Click your emailed link".
- §7.1 step 18: R7's status lines. "heartbeat OK" goes: status does not read Healthchecks.io; the monitor shows it.
- §7.5: the header keeps `run --rm`, adds `-T` and `-p`, and says the one-shot runs the deployed release's image. One
  table row per built subcommand (`set-secret`, `list-secrets`, `status`, `gate-check`, `provision`, `provision-check`,
  `restart`, `cli user invite`) with its "you should see" and exit codes. The invite row: the link and the
  `invitation recorded` line, no email. The four refused verbs say `polycarpic-ops` refuses them (exit 2) until each has
  its own security review.
- §8.1: after `set-secret`, restart the services it names; for the bucket key, the next uploader run reads it.
- §8.10 step 4: `sudo polycarpic-ops provision --stage database --project prod`, then `status` shows `revokes` OK.
- §6.5 dashboard line: R7's item list.
- §7.4 (home): "mounted only into caddy" is read from `list-secrets`' SERVICE column; `show-mounts` goes.
- `infra/README.md`: `infra/ops/`, install, and how to add a subcommand (R1).

**architect (ARCH):** §8 Hetzner topology, the provisioning bullet gains the operator CLI's install path and its role as
the box-side entry point. Edited in this commit.

**seceng (SECURITY), if the review agrees:** C-87's detection names `status`' `revokes` item; C-79's detection names
`backupdb` and the `jobs.log` contract.

## R14 — Guards

- The `provision` job stays ≤ 200 s on CI (POLY-97's limit; 116 s on its last run). The new unit tests take ≤ 20 s
  locally and the container test ≤ 60 s `(unmeasured)`. Over either, an addendum moves them.
- `status` completes in ≤ 15 s against the fakes. The real-box figure is POLY-104's `(unmeasured)`.
- The test-suite time delta is reported at build-green.

## S — Positions for seceng (POLY-98b)

polyops already holds `NOPASSWD: ALL` (POLY-97 §D4), so the CLI grants no privilege. What remains is the CLI turning a
value it reads into something nobody intended, and a secret leaking on the way through.

- **S1. Interpreter and install integrity.** `#!/usr/bin/python3 -IS`, own directory only on `sys.path`, modules found
  by pattern in their own directory, a root-owned and not-writable check on the whole chain, a test root injectable
  only in-process.
- **S2. Children.** Env built from nothing with a fixed PATH; argv lists only; the lint test; every forwarded value
  matched to its own pattern and never starting with `-`.
- **S3. Secret entry.** A terminal only, hidden, one read (two for the credential); no fingerprint printed, only a byte
  count; an `O_EXCL|O_NOFOLLOW` temporary file in the target directory, then rename; the directory opened `O_NOFOLLOW`
  and checked; 0440 `root:<gid>`. `list-secrets` prints sizes, never content.
- **S4. One Resend key in two files (R4, §D2).** H6 relaxed to same basename, same tree. Equal content across names or
  projects still fails.
- **S5. argv in the journal.** sudo logs `cli user invite <email>`, so the invitee's address lands in the box's journal.
  No secret is ever in argv. Accept, or move the email to a hidden prompt.
- **S6. The cli pass-through.** One verb, inherited stdout, `run --rm -T`, `logging: none`, the running images, no `-e`.
  The other four verbs are refused by name; `reset-mfa` holds its grant already (M3, §D1).
- **S7. Install trust.** Committed HEAD via `git archive` over one ssh session, unattested until self-update; members
  with `..`, absolute paths or links refused; `current` swapped atomically.
- **S8. `status` reads.** The Postgres log is matched for poly_backup connection lines and only their times are printed.
  `last-upload` is read for its first line only. The TLS probe goes to the public name.
- **S9. `--show-rclone-output`.** Printed after the temporary key's deletion, five values redacted, 4 KB cap, no verbose flags.
- **S10. The D3 `jobs.log` line.** provision-check, as root, appends to a file the backup uid owns, so a probe
  connection is accounted for. Name the window: the probe's start and end, plus 60 s each side.

## D — Decisions for the Principal

- **D1. `cli user reset-mfa` in this loop?** M3: the app CLI has it, and poly_operator already holds EXECUTE on
  `app.reset_second_step(text)` from POLY-89, so passing it through widens no grant. It does put the recovery path for a
  passkey-only person, and the takeover path for someone who holds only a password, one command away.
  - (a) **As ruled, recommended for this loop:** refused by name, as the confirmed scope says. It is a separate
    pass-through with its own seceng review (the identity check INFRA §7.5 asks of the operator), a small follow-up.
  - (b) Enable it here. Cost: one more R8 verb, its tests, and seceng's review of the reset in this loop.
- **D2. `resend_api_key` in two services.**
  - (a) **Recommended:** one key, two files, with H6 relaxed only for same-name, same-tree duplicates (R4). Revoking it
    stops mail from both services, which is what a leak calls for anyway.
  - (b) Two Resend keys, one per service. Each can be revoked alone and H6 stays strict. Cost: a second key at Resend,
    and `set-secret` gains `--service`.

## Addendum 1 — seceng's ruling review (`ruling-review.md` @ `84290d20`)

K1–K11 are adopted as written there, each with its tests, as part of R12's 98c list. They amend: **R1** (K1 real path, `sys.dont_write_bytecode`; K2 `allow_abbrev=False` on every parser; K3 printable ASCII 0x21–0x7E for every forwarded or echoed value), **R3** (K2: only listed flags are forwarded, an unknown one exits 2 with nothing run), **R4** (K4 `fchmod(0o440)` after `fchown`, since `umask 077` masks the `os.open` mode to 0400; the temporary file is removed on failure; directory `fsync`; K5 a `GetPassWarning` or a value over 4096 bytes exits 2), **H6** (K6), **R7** (K8 details built from parsed values only, future timestamps RED; K9 a log covering under 23 h is RED unless the container is younger, window caps `provision-check-d3` 10 min and other jobs 6 h `(unmeasured)`; K10 signatures matched and passed as literals, `SET default_transaction_read_only = on` first), **R8** (K7 `--pull never --no-deps` and digest-pinned image references, else exit 1 with nothing run; both flags exist in compose 5.7.0's `run --help`, measured), and **R10** (K11 redact, then cut, then filter).
Advisories adopted: **A1** `install_box.py` reads the tar from stdin and extracts it itself with `tarfile` `filter='data'` (3.12), so members are refused before anything is written; R2's shell `tar -x` goes. `install.sh` makes two ssh calls: `git show HEAD:infra/ops/install_box.py` piped to `sudo install -d -m 0700 /opt/polycarpic/.incoming && sudo tee /opt/polycarpic/.incoming/install_box.py`, then `git archive …` piped to `sudo /usr/bin/python3 -I /opt/polycarpic/.incoming/install_box.py <id>`; **A2** `RLIMIT_CORE` 0 at start; **A3** INFRA §7.1 step 16 tells the operator to clear the screen and scrollback once the link is used.
Residuals R-a (jobs.log written by the uid it audits; windows from the journal) and R-b (bundle compose drift) go to POLY-99 and POLY-100 respectively; the lead notes them there. SECURITY's C-87/C-79 text lands at the build review, per the review.
