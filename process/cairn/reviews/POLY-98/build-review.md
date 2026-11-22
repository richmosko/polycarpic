# POLY-98 build review (seceng)

seceng-98, 2026-11-22. Reviewed: the built tree at **`5a6ed6ca`**, against K1–K12 (`ruling-review.md`) and ruling
Addenda 1 and 2. All checks were read-only: I read every file under `infra/ops/`, the `--show-rclone-output` path of
`b2-setup.py`, provision-check's D3 append, and `test_lint.py` at `78a9a44c`. I ran no suite, container or database.

**Verdict: CHANGES.** There are three required changes (B1–B3), each small. Everything else meets its condition.

## Required changes

- **B1. The hidden prompt must flush type-ahead (`lib/ctx.py` `_real_getpass`; reverts 73806f79).**
  - **Mechanism.** The terminal driver echoes each character when it arrives, not when it is read. Anything pasted
    before `tcsetattr` turns `ECHO` off has therefore already been displayed in clear, and has landed in tmux
    scrollback and any terminal log.
  - **What `TCSADRAIN` does.** It keeps that already-echoed input and turns it into the secret. `TCSAFLUSH`, which
    `getpass` uses for exactly this reason, throws it away, so only input typed while echo is off can become the value.
    The value cannot be piped in anyway, because `isatty` refuses a non-terminal stdin first.
  - **Fix.** `TCSAFLUSH` on the echo-off call. The restore stays `TCSADRAIN`.
  - **Tests.** If a test depended on type-ahead, it should wait for the prompt before writing to the pty. Add a unit
    case: the echo-off `tcsetattr` is called with `TCSAFLUSH`.
- **B2. `backupdb` caps the union of windows, not only each line (`status/05_backupdb.py`).**
  - **Mechanism.** K9 caps each line at 6 h, but nothing limits how many lines there are. Four 6 h lines written by the
    backup uid, which owns `jobs.log`, cover the whole day. Every unaccounted `poly_backup` connection then reads
    `all accounted`.
  - **Fix.** RED, `jobs.log windows cover <n> h of 24`, when the union of the widened windows that overlap the last 24 h
    exceeds 8 h `(unmeasured; POLY-99 retunes it with the real job set)`.
  - **Test.** Four 5 h lines → RED.
  - **SECURITY C-79** then gains the union cap.
- **B3. `--mail-from` must not start with `-` (`commands/provision.py`).** R1's global contract: no forwarded value
  starts with `-`. `provision.sh` takes the next word as the value, so there is no injection today. The contract
  exists so that this never depends on the callee.
  - **Test.** `--mail-from -x@example.com` → 2, nothing run.

## The three named checks

| Item | Result | Evidence |
|---|---|---|
| (1) 73806f79 `TCSADRAIN` | **Echo is off on every read path, but kept type-ahead was already echoed: B1.** | `_real_getpass`: no termios, or a non-tty → `GetPassWarning`, and `set_secret._read` turns that into exit 2 with nothing written. K5 holds. The `finally` restores the old attributes on success, on `KeyboardInterrupt` and on `EOF`. `ECHO` is cleared before the prompt is written. |
| (2) `production()` and K12 | **Meets K12.** | (a) `production()` is `Ctx(trusted_uid=0)`, the only `Ctx` built outside tests. No `SUDO_*` read and no `trusted_uid` assignment outside `__init__`. The lint at `78a9a44c` fails on a non-literal or non-zero `trusted_uid=`, on `Ctx(**kw)` or `Ctx(*a)`, and on any `.trusted_uid =` outside `lib/ctx.py`'s `__init__`. (b) Is the poisoned-builder test. (c) `set_secret._write` calls `ctx.chown(fd, 0, gid)` with the literal 0. (d) Is the container case. (e) `discover.py` uses `fullmatch` with unanchored patterns, and the lint fails on any pattern literal ending in `$` passed to `re.compile`, `match`, `search`, `fullmatch`, `sub` or `findall`. **Residual (not gating):** `setattr(ctx, "trusted_uid", …)` and a pattern built at runtime escape the lint. Both would be deliberate rather than a slip. |
| (3) `07_revokes.py`: NULL `lanacl` | **Reads as open. Pass.** | `coalesce(l.lanacl, acldefault('l', l.lanowner))`: a language's default ACL grants USAGE to PUBLIC, so a NULL `lanacl` yields a `grantee = 0`, `USAGE` row and `open:plpgsql`. Functions use the same shape with `acldefault('f', …)`, which grants EXECUTE to PUBLIC. A signature that does not resolve prints `missing:`, so it is never read as closed. |

## K1–K12 as built

| K | Result | Where |
|---|---|---|
| K1 | Pass | The dispatcher works from `realpath(__file__)`. `_integrity` walks the resolved `current` up to the root, plus `/usr/local/sbin` and everything below the bundle (`lstat`, uid and `0o022`). `dont_write_bytecode` is set before any import. `RLIMIT_CORE` is 0 (A2). |
| K2 | Pass, apart from B3 | `allow_abbrev=False`, and `--flag=value` is refused. `provision` rebuilds argv from its parsed flags only. |
| K3 | Pass | `cli`'s email is checked for 0x21–0x7E plus the pattern. An unknown subcommand is echoed only after filtering. `out.clean` filters every status detail. |
| K4 | Pass | `O_EXCL\|O_NOFOLLOW` with `dir_fd`, then `fchown(0, gid)`, `fchmod(0o440)`, `fsync`, `rename`, and `fsync` of the directory. The temporary file is unlinked on failure. Every directory is checked to be `trusted_uid`-owned 0750, and every target `S_ISREG`, before anything is written. |
| K5 | Pass, apart from B1 | A `GetPassWarning` exits 2. `bad_value` refuses empty values, values over 4096 bytes, whitespace and C0/C1 controls. |
| K6 | Not re-read here | H6 lives in `provision-check.sh`. qa's rows 44 and 45 carry it, and the gate run proves it. |
| K7 | Pass | `--pull never --no-deps`. Both image references must match the digest pattern, else exit 1 with nothing run. The env is the fixed set plus the two images. |
| K8 | Pass | `backup` reads only the first line of `last-upload`, at most 4 KB, reformats its time, and is RED for a time more than 5 min in the future. `backupdb` prints only counts and `HH:MMZ`. |
| K9 | Pass per line. **B2** covers the union | Log coverage under 23 h is RED unless the container is younger than 24 h. Per-job caps apply, and a bad, reversed or future time is RED. |
| K10 | Pass | `REVOKE` lines are matched with `fullmatch`, there must be exactly 17, and each must match `SIG` before it is quoted. A quote cannot pass `SIG`, so the `'%s'` interpolation is safe. `SET default_transaction_read_only = on` comes first. |
| K11 | Pass | Values are replaced longest first, empty values are skipped, then the output is cut to 4096 bytes, then filtered to printable ASCII. The block prints after `b2_delete_key`. |
| K12 | Pass | See item (2) above. |

**Other points read.** `install.sh` resolves `HEAD` once and passes the same sha to `git show` and `git archive`
(the Addendum 1 note). `install_box.py` refuses links, absolute paths, `..` and non-regular members before `data_filter`
runs. Then it sets the modes, `lchown`s everything to `0:0`, renames, and swaps `current` with `os.replace`.

## Not gating

- provision-check's D3 line is a bash `>>`, which follows a symlink. `/var/lib/polycarpic/state` is root 0755, and the
  backup container mounts only the file, so only root could plant a link there. Accepted.
- `ops.conf` is written through a fixed `.new` name with `O_TRUNC`, under `/etc/polycarpic`, which is root 0755: root
  only, accepted. It is `fchmod`ed to 0644 as ruled.

## SECURITY

This commit edits C-79's Detection bullet and adds a Detection bullet and a unit row to C-87 (version 1.17.1). Each
quotes the built `status` line. B2 adds its union cap to C-79 when it lands.

## Tests that prove B1–B3 (qa writes them first)

- **B1.**
  - **Unit (`test_ctx` or `test_set_secret`).** With a fake `termios`, the call that clears `ECHO` passes
    `termios.TCSAFLUSH`, and the restore in `finally` passes `TCSADRAIN`.
  - **Container (real pty, real sudo).** Write `earlyvalue` to the pty *before* the prompt appears. Then wait for
    `<name> (input hidden): `, type `latevalue` and Enter, and answer `yes` if asked. Expect exit 0. The secret file
    holds exactly `latevalue` plus a newline, and `earlyvalue` appears in no target file. (The echo of `earlyvalue` on the
    pty is the terminal's, from before the prompt; the test asserts only that it does not become the secret.)
- **B2.**
  - **Rule.** Clip each widened window (start − 60 s, end + 60 s) to `[now − 24 h, now]`, then take their union. If the
    union is **more than 8 h (28 800 s)**, the line is
    `RED  backupdb  prod     jobs.log windows cover <n> h of 24`, where `<n>` is the union in whole hours, rounded down.
    The check runs after the per-line checks and before the connection match.
  - **Test, red.** Four `nightly` lines of 5 h each, non-overlapping, inside the last 24 h, each under the 6 h cap. The
    union is 4 × (5 h + 2 min) → `jobs.log windows cover 20 h of 24`, exit 1.
  - **Test, boundary.** Two lines of 3 h 58 min each, non-overlapping. Widened, the union is exactly 8 h → OK.
  - **Test, overlap counted once.** Two identical 5 h lines → a union of 5 h 2 min → OK.
- **B3.** `polycarpic-ops provision --stage host --target hetzner --domain example.com --mail-from -x@example.com` exits
  **2** with stderr exactly `provision: bad --mail-from`, and the runner log is empty.
