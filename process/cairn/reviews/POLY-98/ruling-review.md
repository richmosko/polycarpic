# POLY-98 ruling review (seceng)

seceng-98, 2026-11-22. Reviewed: `process/cairn/reviews/POLY-98/ruling.md` at **`c3e399ae`**, §S1–S10 and every R that
those positions rest on. Tree read: `infra/provision.sh`, `infra/provision-check.sh` (H6), `infra/postgres/gate-check.sh`,
`infra/compose/prod.yml`, `infra/operator/b2-setup.py`, INFRA §2.2–§3.2 and §7–§8, SECURITY C-71, C-79, C-87, R-29.
Nothing was run against a box or a provider.

**Verdict: CHANGES.** Every position is accepted in substance. Eleven conditions (K1–K11) need one addendum. Each one is
a test qa can write. None widens scope or adds a grant.

**Who the attacker is.** `polyops` already has password-free root (R-29), so this CLI gives that account nothing new. The
attackers that matter here are the two below.
1. **Code in a container.** It can write a file the root CLI later reads: `last-upload` is owned by the uploader uid,
   `jobs.log` by the backup uid, and the Postgres log is written by the postgres uid.
2. **A value the operator types or pastes.** The CLI could turn it into an option, a shell word or an echoed secret.

## Positions

| # | Ruling | Mechanism, and the attacker's reach | Conditions |
|---|---|---|---|
| S1 | Accept with conditions | `-I` drops `PYTHON*`, the user site and the script's own directory from `sys.path`. `-S` skips `site`. sudo's `env_reset` strips `LD_PRELOAD`. So nothing outside the root-owned bundle loads. The chain check catches a misconfiguration rather than an attacker, because only root can write `/opt` or `/usr/local/sbin`. **Gap:** `sudo` runs the `/usr/local/sbin` symlink, so `argv[0]` and `__file__` name the link, not the bundle. | K1 |
| S2 | Accept with conditions | Building argv lists from an env that starts empty closes word-splitting and PATH hijack. **Gaps:** argparse accepts abbreviated long options by default (`--stag` is read as `--staging`), and "forwarded unchanged" (R3) must not mean "pass on unknown flags". The R8 email pattern uses `\s`, which still lets ESC and the other C0/C1 control characters through to the terminal, the journal and the app. | K2, K3 |
| S3 | Accept with conditions | A file created `O_EXCL\|O_NOFOLLOW` in a root 0750 directory, then renamed, cannot be redirected or read half-written. **Defect:** under R1's `umask 077`, `os.open(..., 0o440)` creates the file 0400, which the service cannot read. **Gap:** `getpass` falls back to an *echoed* read, with only a `GetPassWarning`, when it cannot turn echo off. | K4, K5 |
| S4 | Accept with a condition. D2 (a) concur | The two Resend copies are already the design (INFRA §3.2). The relaxation changes only the duplicate check. H6's "not a file compose mounts from `<svc>`" line still refuses a generated password copied into another service's directory. | K6 |
| S5 | **Accept** argv in the journal | The invitee's address is PII, not a secret. The same address is in `audit_event` in the database. The journal is readable by root and `adm` only, and `polyops` is root anyway. The stronger option, a hidden prompt for the email, costs one prompt and protects nothing that the database does not already hold. Rule unchanged: no secret ever in argv. | — |
| S6 | Accept with a condition. D1 (a) concur | One verb, inherited stdout, `logging: none` and `--rm`: the link touches no file, pipe or log of ours. **Gap:** `compose run` pulls an image that is not present, and starts `depends_on` services, unless told not to. A tag reference could then run an image other than the deployed one. D1: `reset-mfa` is the takeover path for someone who holds only a password and can talk the operator round. It belongs with its identity-check procedure in its own review. Refusing it costs nothing now. | K7 |
| S7 | **Accept** | The archive comes from the operator's own checkout over the operator's SSH. Whoever controls that checkout is root on the box already, so a malicious tar member is no worse than malicious code, and the `..`/link refusal guards correctness, not trust. Staging under `mktemp -d` (root 0700) means nobody can reach the tree before `install_box.py` sets its modes. Only root can replace a script that root later runs: `/opt/polycarpic` is root 0755, and no container mounts it. | Advisory A1 |
| S8 | Accept with conditions | `revokes` and `slots` run as the bootstrap `postgres` superuser over the container's local socket (`exec -T postgres psql -U postgres`), the same path as `gate-check`. **No new role and no grant**: `pg_language`, `pg_proc` and `pg_replication_slots` are readable anyway. **Gaps:** (a) Three of status's inputs are written by container uids: `last-upload`, `jobs.log` and the Postgres log. Code in those containers controls what is printed to a root terminal, and can make a stale backup look fresh with a future timestamp. (b) A connection flood can rotate the Docker log (10 MB × 5) so that it covers less than 24 h. An unaccounted `poly_backup` line then drops out silently. (c) The 17 signatures from `roles.sql` are put into SQL text. | K8, K9, K10 |
| S9 | Accept with a condition | The block prints after `b2_delete_key` has returned, so any key id it shows is dead. No verbosity flags means no `Authorization` header dump. **Gap:** if the output is cut to 4096 bytes *before* it is redacted, a value that straddles the cut is not matched, and its leading bytes print. | K11 |
| S10 | Accept with a condition | Root appends to a backup-owned file in a root 0755 directory. The backup uid cannot swap the path, because its mount is the one file. Window: the probe's start to its end, widened 60 s each side, written as one line after the probe, `failed` included. **Residual R-a:** `jobs.log` is written by the uid whose connections it accounts for. | K9 (cap) |

## Conditions (each a 98c test)

- **K1. Resolve the real path.** The dispatcher finds `commands/`, `status/` and `lib/` from `os.path.realpath(__file__)`.
  The integrity check walks that real path and its parents, plus the `current` link and the `/usr/local/sbin` link's
  directory. Set `sys.dont_write_bytecode = True`, so root never writes `__pycache__` into the install.
  - Test: invoked through the symlink, it loads the bundle's modules.
  - Test: a group-writable `<id>` directory reached only through `current` exits 4 and names it.
- **K2. Flags are exact and listed.**
  - Every parser has `allow_abbrev=False`.
  - `provision` and `provision-check` forward only their listed flags, each matched to its pattern. An unknown flag exits 2
    with nothing run.
  - Tests: `--stag` → 2. `provision --domain x.example --evil` → 2, and the runner log is empty.
- **K3. Printable ASCII only.** Every value forwarded to a child or printed back, the email included, consists of
  characters 0x21–0x7E only (space too where a pattern allows it). Tests: an email with ESC, or with U+0085, → 2.
- **K4. Set the mode explicitly.** After `fchown(0, g)`, call `fchmod(0o440)`. Delete the temporary file on any failure
  before the rename. `fsync` the directory after the rename.
  - Test: under `umask 077` the target ends up `0440 root:<g>`.
  - Test: a fault injected between write and rename leaves no `.<name>.tmp-*` behind.
- **K5. Never echo.** A `GetPassWarning` (no echo control) is an error: exit 2, nothing written. A value is at most 4096
  bytes.
  - Test: a fake `getpass` that warns → 2, no file.
  - Test: a 4097-byte value → 2.
- **K6. The duplicate relaxation is narrow.** It applies only when every copy is a compose-declared mount of its service,
  and never to a refused (generated) name.
  - Test: `db_password_app` content planted as a second name → H6 FAIL.
  - Test: a refused name present in two declared services → FAIL.
- **K7. `run` cannot change the image.**
  - The argv adds `--pull never --no-deps`.
  - `POLY_APP_IMAGE` and `POLY_POSTGRES_IMAGE` must match `^[a-z0-9./_-]+(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$`, else
    exit 1, `running web image is not pinned by digest`, with nothing run.
  - Tests: the exact argv. A tag-only `Config.Image` → 1 and no `run`.
- **K8. Status never prints raw content from a container-writable source.** Details are built only from parsed values:
  times reformatted, counts, line numbers and pattern-checked names. Every printed string passes K3's filter, and
  anything else becomes `?`.
  - A `last-upload` time more than 5 min in the future is RED (`timestamp in the future`). So is a `jobs.log` line whose
    end precedes its start or lies in the future.
  - Test: a fixture `last-upload` holding ESC sequences prints none of them.
  - Test: a timestamp in the future → RED.
- **K9. `backupdb` refuses a short log or a wide window.**
  - If the oldest line `docker logs --since 24h` returns is younger than 23 h, the item is RED,
    `postgres log covers only <n> h`. The only exception: the container started inside the last 24 h, and then the log
    covers its whole life.
  - A `jobs.log` window longer than its job's cap is RED. The caps: `provision-check-d3` 10 min; any other job 6 h
    `(unmeasured; POLY-99 sets its own)`.
  - Tests: a 2 h log with an old container → RED. A 24 h D3 line → RED.
- **K10. The signatures are data, not SQL.** Each signature read from `roles.sql` must match
  `^[a-z_]+\([a-z_, ]*\)$`, else RED and no psql run. Each is passed as a quoted literal, never pasted raw. The status
  session's first statement is `SET default_transaction_read_only = on`.
  - Test: a `roles.sql` signature containing a quote → RED, and the runner log shows no psql.
- **K11. Redact, then cut.** Replace the five values in rclone's whole output first, then cut it to 4096 bytes, then
  apply K3's filter.
  - Test: a fixture value placed across byte 4096 leaves none of its bytes in the output.

## Residuals (for the lead; none needs the Principal now)

- **R-a. `jobs.log` is written by the backup uid it audits.** A compromised backup container could write a window that
  covers its own connections. K9's cap bounds that window. The real fix is to take the windows from a source root
  writes, the systemd unit start and stop times in the journal. That is POLY-99's. Until then, the residual exposure is
  a forged window of at most 6 h.
- **R-b. The ops bundle comes from the laptop, not from the deployed release.** `set-secret` and `cli` read the
  bundle's compose files, which can drift from the running release's. A drift misses a mount or runs a stale `operator`
  definition; it grants nothing. POLY-100's self-update is where they converge. Note it there.

## Advisory (not gating)

- **A1.** `install_box.py` could do the extraction itself with `tarfile`'s `filter='data'` (Python 3.12), so members are
  checked before anything is written rather than after.
- **A2.** Set `RLIMIT_CORE` to 0 at start, so a crash during `set-secret` writes no core file holding the value.
- **A3.** The invite link prints once to the terminal, so it also lands in tmux scrollback and terminal logs. §7.1
  step 16 should tell the operator to clear the screen once the link is used.

## SECURITY edits

The C-87 and C-79 detection text (R13) lands at the build review, quoting the built `status` lines. The doc states only
what is true, and `status` does not exist yet.

## Addendum 1 at 5f1b6381: PASS

The ruling's diff `c3e399ae..5f1b6381` adds only §Addendum 1, which adopts K1–K11 as written, each with its tests, and
A1–A3.
- **K7 is measured.** `--pull never` and `--no-deps` are both present in compose 5.7.0's `run --help`.
- **A1's new install path adds no reach.**
  - `/opt/polycarpic` is root 0755, so only root can create or replace `.incoming`.
  - `install -d -m 0700` resets its mode on every run.
  - `install_box.py` and the archive come from the same verified checkout over the operator's own SSH, the trust
    level S7 accepted.
  - `tarfile` with `filter='data'` now refuses absolute members, `..` members and links before anything is written.
- **One note, not gating.** `install.sh` resolves `HEAD` once and passes the same 40-hex sha to both `git show` and
  `git archive`. Then the installer and the bundle cannot come from different commits if `HEAD` moves between the two
  ssh calls. qa can test it: the fake ssh log shows one sha in both commands.

The ruling at `5f1b6381`, Addendum 1 included, passes the security review.

## Addendum 2 and the R1 correction at 1af8ebd4: PASS with one condition (K12)

Read the ruling diff `5f1b6381..1af8ebd4`, `tests/infra/ops/base.py`, `test_lint.py` and `test-plan.md` pin 3, all
@ `1c9b09ec`.

**`trusted_uid` (pin 3).** The test-only reading is sound: unit tests cannot chown to root, so they pass their own uid.
- **Today no production path can set it.** The ruling makes it a constructor field like `root`, and production
  constructs `Ctx` with `0`.
- **The risk is a builder getting it wrong.** For example, `trusted_uid` taken from `SUDO_UID`, from the environment or
  from a flag. The integrity check would then accept files owned by `polyops`, uid 1000.
  - `polyops` is root through sudo already, so the direct gain is nil.
  - The cost is that a laptop-side `scp` or `rsync` into the install, owned by `polyops`, would pass silently. Owned by
    root is the one invariant the K1 walk exists to hold.
- **The lint does not catch this.** `test_no_test_hook_…` looks only for the strings `POLYCARPIC_ROOT`, `OPS_ROOT` and
  `--root`.

**R1 correction (`status/` pattern).** Ignoring every other file is right. One gap: Python's `$` also matches before a
trailing newline, so a file named `01_x.py` followed by a newline would pass `re.match(…$)`. The directory is
root-owned, so this is a correctness point, not a reach.

**The rest of Addendum 2** (df's used formula, fix-line order, the all-RED width case, pin 9's reading of K6) carries
nothing security-bearing.

- **K12. `trusted_uid` is 0 in production, and patterns match whole strings.**
  - (a) **Lint (AST, not substring).** Under `infra/ops/`, every `Ctx(...)` call either omits `trusted_uid` or passes
    the literal `0`. No code outside `Ctx.__init__` assigns `trusted_uid`. No module reads `SUDO_UID` or `SUDO_USER`.
  - (b) **Behaviour.** The dispatcher's production builder runs with `SUDO_UID=1000` and `--trusted-uid 1000` in the
    environment and argv. It yields `trusted_uid == 0`, or exits 2 on the unknown flag.
  - (c) **Behaviour.** `set-secret`'s recorded `chown` uid is the literal 0 even when the test's `trusted_uid` is not.
    Production code must never pass `trusted_uid` as the owner.
  - (d) **Container (real root).** A file in the install chowned to the sudo user exits 4 under real `sudo`, naming it.
  - (e) **Patterns.** Every pattern match under `infra/ops/` uses `re.fullmatch`, never `re.match(…$)`.
    - Test: files named `evil.py`, and `01_evil.py`, each with a trailing newline in the name and planted in
      `commands/` and `status/`, are ignored.
    - Lint: no `re.match` or `re.search` with a pattern ending in `$` under `infra/ops/`.

PASS once K12 is in the 98c list. It needs no ruling change: it pins what Addendum 2 and R1 already say.

## pins-review.md pin 3 at 00d40f81: stands on K12

Pin 3, as `pins-review.md` @ `00d40f81` states it, is the reading I reviewed above. It stands once K12 is in the 98c
list. One correction to its evidence: the `no_test_hook` lint does **not** cover argv and the environment. It only
looks for the strings `POLYCARPIC_ROOT`, `OPS_ROOT` and `--root`. K12(a) and K12(b) are what cover them.
