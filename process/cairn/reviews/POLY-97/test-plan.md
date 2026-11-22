# POLY-97 test plan (qa-engineer-97)

Authority: `ruling.md` at 1eafa6c5 (R1–R12 + Addenda 1–3) and `pins-review.md` at a483460d (precisions 3a–c, 5a–b). Harness per R3: fakes, no network, no credential. Paths (after the CI remedy, architect pins-review @ 5b2a5e90): `V:` = `tests/infra/provision/` (vitest, `vitest.provision.config.ts`, the new `provision` job): `create.test.ts` (create.sh, cloud-init), `host.test.ts` (host stage + H), `checks-db.test.ts` (D checks + summaries, on the pinned base Postgres image). `V-db:` = `tests/infra/image/provision-db.test.ts` (the database stage and the M2 log sweep, on the infra/postgres derivative; stays in the `image` job). `P:` = `tests/infra/operator/` (unittest, `provision` job). Harness: `tests/infra/provision/` (Dockerfile pinned by digest, `fakes/`, `prelude.sh`, `apply-cloud-init.py`, `box.ts`, `pg.ts`). Row labels below say `V:create`, `V:prov` (= host), `V:db` (= V-db for rows 45–51, checks-db for rows 92–105).

## Contract pins

Ruled by the architect: `ruling.md` Addendum 2 @ 512d9c50 and Addendum 3 @ 1eafa6c5 (D3 probe, D5 on staging, cloud-init key placeholder and key-file check). Tests cite those shas. Pins still mine, not yet ruled (tell qa if wrong; devops builds to the tests):

1. Python tools: `main(argv, *, transport, getpass, input, stdout, stderr, runner=None, env=None, home=None) -> int`, nothing at import; `transport(method, url, headers, body) -> (status, json)`; `runner(argv, env=None, stdin=None) -> returncode` (laptop-check: `(rc, stdout)`). Routed to architect-97 as the lead asked; awaiting a ruling.
2. `provision-check.sh` takes `--b2-capabilities <file> --b2-bucket <name>`; the file holds `capabilities`, the bucket comes from the flag alone (a `bucketName` key is ignored: tested), a missing flag or unreadable file is `FAIL H12 … fix: pass --b2-capabilities <file> --b2-bucket <name>`, never WAIT (pins-review 3a–c; R7 copies four files).
3. R7 layout: `provision.sh`, `provision-check.sh`, `roles.sql` side by side in one directory.
4. Volume device: the glob `/dev/disk/by-id/scsi-0HC_Volume_*` must match exactly one device (zero or two: exit 1, names matches, writes nothing); `wipefs` only with `--no-act` (the fake exits 98 otherwise); the fake refuses `luksFormat` on LUKS (pins-review 5a–b); the fakes answer `blkid wipefs file lsblk cryptsetup findmnt mount`; an unfaked verb exits 99 "FAKE: unsupported …".
5. D checks detect a running Postgres with `docker compose … ps` and reach it with `docker compose … exec -T postgres psql …`; D6 reads `docker network inspect` (compose names: `polycarpic-prod_default`, `polycarpic-prod_backup-net`, `polycarpic-edge-prod`, …). D3 probe per Addendum 2/3: `docker run --network container:<svc> --tmpfs … -v <db_password_backup>:…:ro`, `require_auth=scram-sha-256` in the connection string, no `-e`, stderr reason asserted.
6. `stat %a` of a spool dir shows the ACL mask (770); R5's 0700 is asserted as base entries `user::rwx group::--- other::---` plus `mask::rwx`.
7. dns tools print relative names (`planted TXT`, `@ TXT`); `dns-allowed.json` format is free but must contain the strings the tests read.

## Rows (one per ruled item)

| # | Ruled item | File :: case |
|--|--|--|
| 1 | R1 `--type` required, exit 2, 4 vCPU/8 GB shared x86 only | V:create :: exits 2 without --type… |
| 2 | R1 refuses `HCLOUD_TOKEN` (exit 2, no echo) + positive case | V:create :: refuses HCLOUD_TOKEN…; refuses without a token too… |
| 3 | R1 run 1: change lines, addresses, `created:` line | V:create :: run 1 creates… |
| 4 | R1 token-removal lines on every run | V:create :: prints both token-removal steps… |
| 5 | R1 run 2 no changes, no mutating verb | V:create :: run 2 on the same state… |
| 6 | R1 firewall attached at create | V:create :: attaches the firewall AT server creation… |
| 7 | R1 three rules exactly | V:create :: the firewall is exactly three… |
| 8 | R1 no other port in argv | V:create :: no port other than… |
| 9 | R1 volume 20 GB attached not formatted | V:create :: volume <name>-data… |
| 10 | R1 labels | V:create :: every resource carries the label… |
| 11 | R1 key matched by fingerprint | V:create :: an SSH key already uploaded… |
| 12 | R1/R2 user-data from file, key substituted | V:create :: passes the public key… |
| 13 | R1 drift 5432 reset and reported | V:create :: drift: a planted 5432 rule… |
| 14 | R1 drift ICMP + outbound | V:create :: drift: an added ICMP rule… |
| 15 | R1 drift narrowed source | V:create :: drift: a rule with a narrowed source… |
| 16 | R1 reads no token, only hcloud | V:create :: reads no token… |
| 17–19 | shellcheck ×3 scripts | V:create :: shellcheck (3 cases) |
| 20 | R2 schema valid | V:create :: starts with #cloud-config and passes schema |
| 21 | R2 polyops user, no group, one key | V:create :: defines user polyops… |
| 22 | R2 root/pw off, package_update, nothing outside archive | V:create :: disables root… |
| 23 | R2/H1/H15 sshd drop-in values + AllowUsers | V:create :: the sshd drop-in… |
| 24 | R2/H15 sudoers drop-in exact, 0440 | V:create :: the sudoers drop-in… |
| 25 | R2/R10 user-data holds no secret | V:create :: holds no secret… |
| 26 | R5 second run changes nothing, per stage | V:prov :: a second run changes nothing… |
| 27 | R5 Docker repo, key fingerprint pinned | V:prov :: installs Docker Engine… |
| 28 | R5 wrong fingerprint refused | V:prov :: refuses a Docker key… |
| 29 | R5 daemon.json | V:prov :: writes /etc/docker/daemon.json… |
| 30 | R5 unattended upgrades + reboot, swap off | V:prov :: turns on unattended upgrades… |
| 31 | R5 LUKS2, key 0400, crypttab/fstab | V:prov :: formats the data volume… |
| 32 | R5 existing LUKS opened not reformatted | V:prov :: an existing LUKS header… |
| 33 | R5 foreign volume stops, writes nothing | V:prov :: a non-empty volume… |
| 34 | R5 data dirs, spool owners, ACL entries | V:prov :: data dirs and the spool… |
| 35 | R5/M1 spool read/sibling/delete by 10005, chmod removes read | V:prov :: M1… |
| 36 | R5 state files | V:prov :: state: … |
| 37 | R5 secrets layout/modes/gids, staging six, no backup/uploader | V:prov :: secrets: both roots… |
| 38 | R5 generated: 32 random bytes, distinct, never overwritten | V:prov :: generated secrets are… |
| 39 | R5 table equals compose `file:` paths | V:prov :: the generated set equals the compose… |
| 40 | R5 host.env contents/modes | V:prov :: host.env and staging-host.env… |
| 41 | R5 `--mail-from` accepted/refused, nothing written | V:prov :: --mail-from under… |
| 42 | R5 rewritten only on difference | V:prov :: host.env is rewritten only when… |
| 43 | R5 no host account in the service gid set; polyops not docker | V:prov :: no host account other than root… |
| 44 | R10 generated secrets never in output/log/files | V:prov :: R10: no generated secret… |
| 45 | R5 database stage: roles.sql, every verifier authenticates, wrong password rejected | V:db :: runs roles.sql and sets… |
| 46 | R5 stdin carries SCRAM $4096 verifiers only, SET log_statement/min_error_statement first | V:db :: the plaintext never reaches… |
| 47 | M2 no plaintext/verifier in PG log (success) | V:db :: M2: after a successful run… |
| 48 | M2 forced failing ALTER, nothing in log, non-zero exit | V:db :: M2: a forced failing ALTER… |
| 49 | R5 no password/verifier in argv/output | V:db :: no password or verifier in argv… |
| 50 | R5 database stage idempotent | V:db :: idempotent… |
| 51 | R5 `--project` validated, prod/staging accepted | V:db :: refuses an unknown --project… |
| 52 | R4 positive: PASS H1–H15, INFO H12b, WAIT D1–D6, exit 3, exact summary | V:prov :: a complete host box… |
| 53 | R4 read-only | V:prov :: is read-only… |
| 54 | R4 FAIL line format, `<n> CHECKS FAILED`, exit 1 | V:prov :: every FAIL line is… |
| 55 | R4 FAIL beats WAIT | V:prov :: the first summary-rule case… |
| 56–57 | H1 passwords on; forwarding on | V:prov :: H1 ×2 |
| 58 | H2 | V:prov :: H2 |
| 59–60 | H3 live-restore; pool overlap | V:prov :: H3 ×2 |
| 61–63 | H4 plain device; LUKS1; key mode | V:prov :: H4 ×2 cases (3 plants) |
| 64 | H5 swap active + fstab | V:prov :: H5 |
| 65 | H6 world-readable, wrong dir, equal content, luks.key | V:prov :: H6 (4 plants) |
| 66–67 | H7 chmod-0600 mask (M1); owner; stripped ACL | V:prov :: H7 ×2 |
| 68–69 | H8 stray file, old inflight; fresh inflight passes | V:prov :: H8 ×2 |
| 70 | H9 service gid, docker group | V:prov :: H9 |
| 71 | H10 MAIL_FROM, secret-named keys | V:prov :: H10 |
| 72 | H11 zero, two | V:prov :: H11 |
| 73 | H14 | V:prov :: H14 |
| 74 | H12 PASS exact set | V:prov :: H12 PASS… |
| 75 | H12 extra capability (listFiles) + fix text | V:prov :: …holds listFiles… |
| 76 | H12 missing capability | V:prov :: …missing a capability… |
| 77 | H12 unrestricted key | V:prov :: …unrestricted key… |
| 78 | H12 other bucket | V:prov :: …another bucket… |
| 79 | H12 namePrefix | V:prov :: …namePrefix… |
| 80 | H12 401 | V:prov :: …rejected credential… |
| 81 | H12 WAIT while absent | V:prov :: WAIT while… |
| 82 | H12 stdin credential, none in argv/output, no token/header | V:prov :: sends the credential to curl on stdin… |
| 83 | H12 failure path prints no authorizationToken | V:prov :: the failure path… |
| 84 | H13 PASS | V:prov :: H13 PASS… |
| 85 | H13 WARN exact text | V:prov :: H13 absent: WARN… |
| 86 | H13 `--prod` FAIL | V:prov :: H13 absent under --prod… |
| 87 | H15 AllowUsers | V:prov :: H15 sshd… |
| 88 | H15 sudoers drop-in exact/0440 | V:prov :: H15 the polyops sudoers… |
| 89 | H15 other sudoers file | V:prov :: H15 any other… |
| 90 | H15 second login account | V:prov :: H15 a second account… |
| 91 | H15 positive (service account) | V:prov :: H15 positive… |
| 92 | all-good: ALL CHECKS PASSED, exit 0 | V:db :: everything good… |
| 33a | pins-review 5a/5b: two devices, no device, wipefs only --no-act, luksFormat on LUKS refused | V:prov :: 5a ×2, 5b ×2 |
| 81a | pins-review 3b/3c: flag wins over file bucketName; missing flag/unreadable file FAIL H12 with fix, never WAIT | V:prov :: 3b, 3c |
| 93a | create.sh key file (Addendum 2/3): RSA, 2nd line, non-base64, empty, newline injection refused (exit 2); `"` `'` `:` `#{}` comments dropped, schema valid; plain key accepted | V:create :: create.sh key file (10 cases) |
| 93 | D1 (three settings, incl. S8 shared_preload_libraries and log_min_duration_statement) | V:db :: D1… |
| 94 | D2 on staging while prod good | V:db :: D2… |
| 95 | D3 probe (Addendum 2/3): positive with hygiene (tmpfs, require_auth, :ro, no -e, no password in output/log); web wrong reason; uploader; backup | V:db :: D3 ×4 |
| 96 | D4 slot | V:db :: D4… |
| 97 | D5 role without verifier; staging poly_backup has no verifier, one there fails | V:db :: D5 ×2 |
| 98–99 | D6 wrong subnet, stray network; positive | V:db :: D6 ×2 |
| 100 | R4 `PASSED WITH 1 WARNINGS: H13`, exit 0, never ALL CHECKS PASSED | V:db :: a WARN with no FAIL… |
| 101 | R4 `--prod` → `1 CHECKS FAILED` | V:db :: --prod turns… |
| 102 | R4 prod cluster detected = --prod | V:db :: a prod cluster on disk… |
| 103 | R4 staging-only warns and passes | V:db :: a staging-only box… |
| 104 | R4 FAIL beats WARN/WAIT | V:db :: FAIL beats WARN… |
| 105 | R10 no B2 fixture secret in a full run | V:db :: R10: no fixture B2 key… |
| 106 | R8 b2-setup constant file | P:b2 :: the box key constant… |
| 107 | R8 b2 happy path, PASS lines | P:b2 :: happy path… |
| 108 | R8 exact capability sets, bucket-restricted | P:b2 :: creates exactly two keys… |
| 109 | R8/R10 new key secret printed once, nothing else | P:b2 :: each new key's secret… |
| 110 | R10 nothing on disk; getpass for ids | P:b2 :: no secret reaches disk… |
| 111–113 | R8 bucket not private; governance/period/lock off/lifecycle; encryption reported | P:b2 :: 3 cases |
| 114–116 | R8 same-name key replaced; declined never duplicates; web-form read key replaced | P:b2 :: 3 cases |
| 117–119 | R8 read-back FAIL outside names; other bucket ok; drifted caps | P:b2 :: 3 cases |
| 120–121 | R8 old master 401 PASS / still valid FAIL | P:b2 :: 2 cases |
| 122 | R8 no typed yes, nothing changes | P:b2 :: without a typed yes… |
| 123–124 | R8 provider error; wrong master | P:b2 :: 2 cases |
| 125–127 | R8 `--probe` success, refusal, no leak | P:b2 :: 3 cases |
| 128–133 | R8 dns-move: hidden creds, flow, no-yes, Porkbun refusal, bad zone token, no leak | P:move :: 6 cases |
| 134–143 | R8 dns-records ×10 (set, ttl/proxied, only-allowed, idempotent ×2, no-yes, no delete/conflict, no addresses, token, API error) | P:records :: 10 cases |
| 144–168 | R9 dns-check ×25 (allowed file, pass, absent, case, 255-join, exact TXT, unknown, page 2, wildcard, CNAME, pins ×2, ruf, CAA, duplicate, proxied, NS, A, AAAA, fail-closed ×2, health requests, health answers ×6, read-only/token, HTTP error) | P:check :: 25 cases |
| 169–175 | R8 laptop-check ×7 | P:laptop :: 7 cases |
| 176–181 | R3 CI wiring: no new job, build step, shellcheck step, unittest step, files selected, digest pin | `tests/infra/provision-wiring.test.ts` (green by construction: qa owns the wiring) |

## Counts (a reader can add these up)

- vitest dry run: create 36 (26 + 10 for the key-file rules of Addendum 2/3) + provision 58 + 6 (pins-review) = 64 + db 25 (D3 now 4 tests, D5 now 2) = **125** (all red at tests-red).
- Python: b2_setup 22 + dns_check 25 + dns_records 10 + dns_move 6 + laptop_check 7 = **70** (all red).
- Wiring: **6** (green; they guard the CI steps this commit adds).
- Total new: **201** (125 + 70 + 6). The rows above (numbered by ruled item; a few rows hold two or three tests) cover R1 (1–19), R2 (20–25), R3 (176–181), R4 (52–55, 100–104), R5 (26–51), R6 H1–H15 (56–91) and D1–D6 (92–99), R8 (106–143, 169–175), R9 (144–168), R10 (44, 47–49, 82–83, 105, 109–110, plus the secret sweeps in every Python file), M1 (35, 66), M2 (47–48).
- Ruled items without a test, with reason: R12 (the Principal's real run), R11 (docs, seceng/devops/architect verdicts), the INFRA/SECURITY text; H12's real-key behaviour and the Docker apt key (only the pinned-fingerprint branch is testable; unmeasured until E7); `userland-proxy` effect (needs a live daemon, POLY-104); H3's overlap check against a real daemon (fake `docker info`).
- Guards: the dry run's local time is in `red-run.md`; the image job's ≤120 s and ≤60 s guards are measured at build-green.

## Added after gate 3 (build-review d07244e8, CAA, CI remedy)

- B1: `b2-setup --probe` runs rclone's S3 backend (env `RCLONE_CONFIG_PROBE_TYPE=s3`, `PROVIDER=Other`, `ENDPOINT=<s3ApiUrl>`, `NO_CHECK_BUCKET=true`, no B2-backend vars). B2: unrestricted key that can write = FAIL (5 capability cases), unrestricted read-only = WARN rc 0, restricted to another bucket id = silent. A-probe2: `--probe` ends with the regeneration prompt and the 401 check; a still-live old key exits non-zero. P:b2_setup, +6 tests.
- CAA: dns-records POSTs `data {flags, tag, value}` with no `content`; dns-check passes on content-only, data-only and both list replies and catches CAA faults in data-only mode. P:dns_records +2, P:dns_check +2.
- Second firewall drift (lead, same rule as R1/D-7): pinned `change: firewall detached (<name>)`, via `hcloud firewall remove-from-resource`, never delete; positive case prints no such line. V:create +2.
- A-M2 mutation: with the two SET lines stripped, the verifier does reach the Postgres log. V-db +1; plus a staging-stage test (five roles authenticate, poly_backup has no verifier) V-db +1.
- CI remedy: `provision` job, changes key and paths, `app` aggregate (REQUIRED, result list), `budgets.json` 200 s, 10 `changes.test.ts` rows, aggregate/ci-workflow expectations, wiring test rewritten.

## Probe outcomes (lead + build-review 5e6846e0 C1)

- Runner contract change: `runner(argv, env=None, stdin=None) -> (returncode, output_text)`; a runner that raises (rclone missing) is also an outcome.
- Three outcomes, three pinned strings: success prints `writeFiles alone is enough` (exit 0); permission refusal prints `listBuckets is needed` ONLY when the output carries the S3 code `AccessDenied` (or B2's own wording `not entitled` / `not authorized to perform`) and none of `SignatureDoesNotMatch`, `RequestTimeTooSkewed`, `InvalidAccessKeyId`, `InvalidToken`, `ExpiredToken` (build-review C2; a wrong clock or mistyped key must not read as a capability answer); anything else, including a bare 401/403/Forbidden/Unauthorized, no such host, timeout, connection refused, other rc, empty text, runner raising, prints `INCONCLUSIVE`, exits non-zero, and prints neither recommendation. The temporary key is deleted on every outcome.
- `--s3-no-head` must be in the rclone argv (the uploader never sends HEAD).

## Verdict conditions C1, C2 (verdict.md @ d263d844)

- C1 (D3 on a real box): the probe joins `container:$(docker compose -p polycarpic-prod ps -q web)`, `polycarpic-prod_backup-net` (backup) and `polycarpic-prod_upload-net` (uploader), with the image of the running postgres container (`docker inspect --format {{.Config.Image}} <id>`), no default tag. The fake models one-off run names: it refuses a join by name (`polycarpic-prod-backup-1`, `container:*backup*`) and `postgres:17`, and a missing web container or network is a FAIL D3 naming it. Tests: checks-db D3 positive (updated) + the missing-thing case.
- C2: create.sh prints `IPv4: <addr>` and `IPv6: <prefix>::1 (network <prefix>/64)`; dns-records accepts `<prefix>::1` and exits 2 on the bare /64 (both tested); dns-check accepts `<prefix>::1`.

## Real-run findings (real-run.md)

- F1: no stock in the asked location: create.sh exits non-zero, keeps hcloud's error, names `--location nbg1` (`--location fsn1` when nbg1 was asked), key and firewall stay, no server. Fake switch `no-stock-<location>`.
- F2: H14 waits up to `POLY_NTP_WAIT` seconds (default 60, literally `POLY_NTP_WAIT:-60` in the script) for NTPSynchronized=yes before judging: becomes yes within the wait = PASS; never = FAIL H14 with the fix line after about the wait; already yes = one look. Fake switch `ntp-no-calls` (N answers of "no", then "yes"). All other check runs set `POLY_NTP_WAIT=2`.
