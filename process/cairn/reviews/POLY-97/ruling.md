# POLY-97 ruling: infra scaffolding and provisioning

Architect, 2026-11-22. This replaces the ruling at `3381b155` whole. It folds in seceng-97's positions
(`seceng-positions.md` in this directory; items 1, 6, 7, 8 and the built state). Tree read at
`46bce70ff7b3c7b3356d3115b6265c5942248097`. Scope: the description, six acceptance
criteria and eleven comments on `POLY-97.md`, plus the operator prototypes in the lead checkout
(`temp/poly-97-operator-scripts/`, untracked). A claim is measured unless tagged `(unmeasured)`; §M lists the
measurements (this Mac, Docker 29.9.3, arm64). The Principal's choices are in §D. The ruling proceeds on each
recommendation unless the issue file says otherwise.

## M — Measurements

| # | Question | Command (abridged) | Result |
|---|---|---|---|
| M1 | Do default POSIX ACLs on the spool let uid 10005 read and delete what Postgres and backup write (F12)? | `ubuntu:24.04` with `acl`, `age`: dirs `999:999` / `10004:10004` 0700, `setfacl -m u:10005:rwx` and `-d -m u::rwx,g::---,o::---,u:10005:rwx`; as 999 run the `archive-wal.sh` sequence under `umask 077`; as 10004 `age -o` with and without a following `chmod 0600`; as 10005 `cat`, write `.sha256`, `rm` | WAL file `-rw-rw----+`, 10005 effective `rw-`: read OK, sibling OK, delete OK. Backup file without chmod: the same. **Backup file after `chmod 0600`: mask `---`, read DENIED** (delete still OK, through the directory ACL). The default ACL overrides `umask 077`; an explicit chmod cancels it. |
| M2 | Does `ALTER ROLE … PASSWORD` reach the Postgres log under `log_statement = ddl`? | `postgres:17` (17.10), `-c log_statement=ddl`, statements piped to `psql` on stdin, `grep -c <password> pg.log` | (A) plain ALTER: **1 hit**. (B) `SET log_statement='none';` then ALTER: 0. (C) as B but the ALTER fails: **1 hit** (error-statement logging). (D) as C plus `SET log_min_error_statement='panic'`: 0. |
| M3 | Is there a CI home for Python and Docker tests already? | `ci.yml` read | `cairn` job runs Python 3.14; `image` job runs Docker container tests and is triggered by `^infra\/(?!ci\/)` and `^tests\/infra\/`, so every path this loop adds already selects it. |

Unmeasured: real `hcloud` output shapes, a real LUKS open on a Hetzner volume, real `apt`/`systemd` on the box,
B2's and Cloudflare's live responses beyond the prototypes' runs. §R12 is where the real run measures them.

## Scope

IN this loop: R1–R12. OUT, with the issue each item moves to:

| Item | Goes to | Why |
|---|---|---|
| Criterion 6: POLY-147 marker measurement on the VPS | POLY-104 | Needs the deployed app and database. Criterion moves verbatim. |
| Caddy real-address proof (POLY-138 F5); Caddy-to-auth live probe (POLY-152); memory caps | POLY-104 | Need a live compose up. `userland-proxy: false` itself is set here (R5). |
| Resend keys, DMARC test mail | POLY-104 | Keys are made at `set-secret` time on the box. The DMARC pass is a deploy-gate condition. |
| Clock sync when the database runs on another host (POLY-150) | POLY-121 | Applies only to the Neon path. The Hetzner box's own NTP check is in R6 (H14). |
| `env_file:` wiring of `host.env` into auth and worker; worker `DATABASE_*` and `PUBLIC_ORIGIN` (POLY-142) | POLY-100 | `infra/compose/**` is not in this issue's paths and the deploy owns how compose is invoked. This loop writes the files (R5). |
| `set-secret`, `list-secrets`, `polycarpic-ops provision` wrapper | POLY-98 | Operator CLI. Until then the runbook calls the two scripts directly (R7). |
| Restore runbook F4 (`app.session_handle` with `session`) | POLY-99 | Restore. |
| Deploy timer, `allowed_signers` install, poly_backup ACL preflight | POLY-100 | Deploy. Their provision-check lines are added there, using R6's format. |
| Alert when the worker's `job.run` lines stop | POLY-103 | Monitoring. |
| Prod maintenance page (POLY-138 F4) | **new issue** (lead files): "Prod maintenance page", before the first prod deploy | Caddyfile, not in paths; prod is from v1.0. This loop corrects the INFRA text only (R11). |
| `_acme-challenge` records for the home box's DNS-01 | POLY-120 | Adds a `--target home` allowance to R9's allowed set. |
| Restores and drills pick by version and alert on more than one version or a hide marker; restore only into a throwaway Postgres; the uploader verifies from the upload response's checksum, never by HEAD or list (seceng 1a) | POLY-99 | Restore and uploader. Spool names are unique: WAL by segment name (`archive-wal.sh` refuses an existing target); POLY-99 gives dumps a UTC timestamp. |
| Caddy pinned to Let's Encrypt as its only issuer, then CAA `accounturi` after first issuance (seceng F-C) | POLY-104 | `infra/caddy/**` is not in paths. Until then a ZeroSSL fallback fails under R9's CAA, which is loud (certificate alert) and safe. |
| CT-log alert for the domain; DNSSEC | Principal, before real data (recommended, not gating) | Account set-up, no code. |

## R1 — `infra/hetzner/create.sh`

- Bash, `set -euo pipefail`, shellcheck clean. Flags: `--name`, `--location`, `--ssh-key <path.pub>`, `--type`
  (**required**; when missing the script exits 2 and prints the 4 vCPU / 8 GB shared-x86 types from
  `hcloud server-type list`, because Hetzner renames plans, INFRA §2.1).
- Resources, each found by name and the label `polycarpic=managed`: SSH key (matched by fingerprint), firewall
  `<name>`, server `<name>` (image `ubuntu-24.04`), volume `<name>-data` 20 GB, attached and **not** formatted (R5
  formats it LUKS2).
- The firewall exists and is attached **at** server creation (`hcloud server create --firewall <name>`), so the server
  is never reachable unfirewalled. Its rule set is exactly three inbound TCP rules, ports 22, 80, 443, each with
  sources `0.0.0.0/0` and `::/0`. No ICMP rule, no outbound rules.
- Drift (D-7): on every run the live rule set is compared with that set. On any difference the script runs
  `hcloud firewall replace-rules` with the set and prints `change: firewall rules reset (was: <ports>)`.
- Every mutating `hcloud` call is printed first as one `change: …` line. A run with nothing to do prints `no changes`
  and exits 0. The last line on a creating run is `created: server, firewall (22,80,443 in), volume 20 GB`, after the
  server's IPv4 and IPv6.
- No port number other than 22, 80, 443 appears in any argument the script passes to `hcloud`.
- It reads no token: `hcloud` uses its active context. The script refuses (exit 2) when `HCLOUD_TOKEN` is set in the
  environment, so a token is never placed where shell history or `ps` shows it.
- Its last lines, on every run, print the two token-removal steps (`hcloud context delete <name>` and the console
  deletion). Once the server exists, the token can snapshot both disks, and the LUKS key is on the root disk.

## R2 — `infra/hetzner/cloud-init.yaml`

- User `polyops`, the one public key from `--ssh-key`, shell bash, sudo `ALL=(ALL) NOPASSWD:ALL` (§D4), in no
  group except its own; `disable_root: true`; `ssh_pwauth: false`; an `sshd_config.d/10-polycarpic.conf` drop-in with
  R6 H1's values; `package_update: true`; nothing installed from outside Ubuntu's archive.
- User-data holds **no secret**: any process on the box, containers included, can read it from the metadata service
  (unmeasured on Hetzner). A test fails on any line matching the secret patterns in R10.
- `cloud-init schema --config-file` passes in the test container.

## R3 — Test harness: fakes, no network, no credential

- **Never live.** No teammate runs `hcloud`, the operator tools or `curl` against Hetzner, Backblaze, Cloudflare or
  Porkbun, and no teammate uses the `polycarpic` `hcloud` context. Only the Principal runs R12.
- **Shell (create.sh, provision, provision-check).** `tests/infra/provision/fakes/` holds executables put first on
  `PATH`: `hcloud` (stateful: a JSON state file; the verbs create.sh uses, `-o json` shapes taken from the hcloud
  CLI's documented output), `apt-get`, `systemctl`, `cryptsetup`, `mkfs.ext4`, `mount`, `findmnt`, `swapon`, `docker`
  (canned replies for `info`, `compose exec … psql`, `network inspect`), `timedatectl`, `curl` (B2 replies from
  fixtures). Each fake appends its argv to a call log. The harness sets `HCLOUD_TOKEN=` unset,
  `HCLOUD_CONFIG=<tmp>/none.toml`, and fails before the test runs if `command -v hcloud` or `command -v curl` resolves
  outside the fakes dir.
- **Real where it matters.** The dry run runs as root in a throwaway `ubuntu:24.04` container pinned by digest, built
  from `tests/infra/provision/Dockerfile` with `openssh-server acl age shellcheck cloud-init python3 jq`. Users,
  ownership, modes, ACLs, file generation and `sshd -T` are real. Volume, packages, services and Docker are faked.
- **Python (operator tools).** Each tool takes an injected transport (one function: method, URL, headers, body →
  status, JSON). Tests pass a fake that replays fixtures and records requests; the test base class replaces
  `urllib.request.urlopen` and `socket.create_connection` with functions that raise, so a missed injection fails
  rather than reaching the network. Prompts are injected (`getpass` and `input`).
- **CI.** All of it runs in the existing `image` job (M3), as three steps gated on
  `needs.changes.outputs.image == 'true'`: shellcheck (inside the test container, so the version is pinned with it),
  `python3 -m unittest discover -s tests/infra/operator`, and the vitest dry run
  (`tests/infra/image/provision.test.ts`, driving `docker run` of the test container, beside the existing container
  tests). No new job, no change-filter change.

## R4 — The provision-check output contract

- One line per check: `PASS <id> <what>`, `FAIL <id> <what>: <found> — fix: <command or step>`,
  `WAIT <id> <what>: <what it waits for>`, `WARN <id> <what> not configured: <consequence>`,
  `INFO <id> <what>: checked off-box by <tool>`. INFO is never counted as a pass. Ids are stable (`H1`…, `D1`…), so
  a test asserts the exact id that fails.
- Summary, last line, and exit code:
  - `ALL CHECKS PASSED`, exit 0: no FAIL, WAIT or WARN.
  - `PASSED WITH <n> WARNINGS: <ids>`, exit 0: no FAIL or WAIT, at least one WARN. The words `ALL CHECKS PASSED`
    never appear with a WARN.
  - `HOST CHECKS PASSED; <n> checks wait for the first deploy`, exit 3: no FAIL, at least one WAIT.
  - `<n> CHECKS FAILED`, exit 1: any FAIL.
- `--prod` (passed once a prod project exists; detected when `/srv/polycarpic/pg-prod` holds a cluster) turns every
  WARN into a FAIL. This is the real-data gate for the heartbeat: without path B a filled bucket fails silently
  (seceng 1b). Staging-only boxes report and pass with the warning.
- Every check has a positive case and a planted-fault case in the dry run, and the fault case asserts the id and the
  `fix:` text, not just exit 1.

## R5 — `infra/provision.sh`

Bash, idempotent, run as root on the box, two stages. A second run changes nothing and says so per stage.

- `--stage host --target hetzner --domain <d> [--mail-from <addr>]`:
  - Docker Engine and the compose plugin from Docker's apt repository; the repository key is checked against its
    published fingerprint before use (fingerprint pinned in the script, unmeasured until R12).
    `/etc/docker/daemon.json`: `live-restore: true`, `log-driver: json-file`, `max-size 10m`, `max-file 5`,
    `default-address-pools` base `10.200.0.0/16` size 24, `userland-proxy: false`.
  - Unattended upgrades on, with automatic reboot (INFRA §6.5's Hetzner reboot policy). Swap off and absent from fstab.
  - The data volume: LUKS2 with a random key file `/etc/polycarpic/luks.key` root 0400, opened as
    `polycarpic-data`, ext4, mounted at `/srv/polycarpic` through crypttab and fstab. An existing LUKS header is
    opened, never reformatted. A non-empty volume without a LUKS header stops the script (exit 1, nothing written).
  - Data dirs `/srv/polycarpic/pg-prod`, `pg-staging` `999:999` 0700 (F6).
  - Spool (F12, M1): `spool/wal` `999:999` 0700, `spool/dump` and `spool/premigration` `10004:10004` 0700; on each,
    access ACL `u:10005:rwx` and default ACL `u::rwx,g::---,o::---,u:10005:rwx`. Never chmod, never a shared gid.
    **Rule for every spool writer (POLY-99 too):** never chmod a spool file after creating it; M1 shows a chmod 0600
    removes the uploader's read.
  - State: `/var/lib/polycarpic/state` root 0755; `last-upload` owned 10005, `last-dump` and `jobs.log` owned 10004,
    each 0644, created empty if absent.
  - Secrets (F6, POLY-146): `/etc/polycarpic/secrets` and `staging-secrets` root 0700; one dir per service,
    `root:<gid>` 0750, files 0440. Gids: postgres 999, web 10001, worker 10002, migrate 10003, backup 10004,
    uploader 10005, operator 10006, auth 10007, caddy 10010. Generated, 32 random bytes base64, written once and never
    overwritten: `db_superuser_password` (postgres), `db_password_app` (web), `db_password_auth` and `auth_secret`
    (auth), `db_password_worker` (worker), `db_password_migrator` (migrate), `db_password_operator` (**operator
    only**), `db_password_backup` (**backup only**); staging gets its own values for its six services and no
    backup or uploader dir. The table in the script is tested equal to the `file:` paths in
    `infra/compose/{prod,staging,edge}.yml` (a vitest test parsing the compose files), so compose stays the single
    source.
  - `/etc/polycarpic/host.env` (prod) and `/etc/polycarpic/staging-host.env`, root 0644: `TLS_MODE=real-domain`,
    `PUBLIC_ORIGIN=https://app.<d>` / `https://staging.<d>`, `MAIL_FROM` (default `Polycarpic <no-reply@mail.<d>>`;
    refused unless the address is under `mail.<d>`, the domain Resend verified and DMARC aligns), `POLY_INSTANCE`.
    Rewritten only when a value differs.
  - No host account other than root has a primary or supplementary gid in the service gid set; `polyops` is not in
    the `docker` group.
- `--stage database --project prod|staging` (run by first-deploy once Postgres is up, POLY-100/104): runs
  `packages/db/sql/roles.sql` as the superuser over the local socket, then sets each login role's password from its
  file. **Plaintext never reaches the server:** the script computes the SCRAM-SHA-256 verifier on the host (Python
  stdlib, 4096 iterations, random 16-byte salt) and sends `ALTER ROLE … PASSWORD '<verifier>'`, on stdin to
  `docker compose exec -T postgres psql`, after `SET log_statement = 'none'` and
  `SET log_min_error_statement = 'panic'` as separate statements (M2: without both, the statement or its error
  reaches the log). No password or verifier in argv or the environment.

## R6 — `infra/provision-check.sh`

Read-only. Host checks run always; database checks WAIT while the project's Postgres is not running.

| Id | Asserts | Source |
|---|---|---|
| H1 | `sshd -T` (running config): `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin no`, `pubkeyauthentication yes`, `allowtcpforwarding no`, `allowagentforwarding no`, `allowstreamlocalforwarding no`, `x11forwarding no`, `permittunnel no` | C-71 |
| H2 | Unattended upgrades enabled (`apt-config dump`) | C-72 |
| H3 | `docker info` effective values equal R5's daemon.json; the address pool does not overlap `10.201.0.0/16` or `10.202.0.0/16` | §2.2 |
| H4 | `/srv/polycarpic` is mounted from `/dev/mapper/polycarpic-data`, the device is LUKS2, the key file is root 0400 | C-72 |
| H5 | No active swap, none in fstab | §2.1 |
| H6 | Secrets layout and modes as R5; nothing under `/etc/polycarpic` world-readable except `host.env`, `staging-host.env`, `age-recipients.txt`; each secret only in the dirs compose mounts it from; no two files under `secrets/` and `staging-secrets/` with equal content | F6, C-74, C-77 |
| H7 | Data-dir and spool owners and modes, and the exact ACL entries of R5 (`getfacl`); every `.age` file in the spool gives 10005 an effective `r` | F6, F12 |
| H8 | The spool holds only `.age` and `.sha256` files, plus `spool/wal/.inflight/` with no file older than 10 minutes | §2.3, F2 |
| H9 | R5's gid rule | — |
| H10 | `host.env` and `staging-host.env` present, `MAIL_FROM` under `mail.<d>`, and no key matching R10's secret-name pattern | D-1 |
| H11 | `age-recipients.txt` holds exactly one `age1…` line | §6.1 |
| H12 | The box B2 key: `b2_authorize_account` with `secrets/uploader/backup_store_credential` reports `allowed.capabilities` **exactly** the box-key constant, `allowed.bucketId` and `bucketName` the configured bucket (an unrestricted key fails), `allowed.namePrefix` null. Any capability more or less fails, naming it, with `fix: delete key <name>; recreate it with infra/operator/b2-setup.py`. WAIT while the file is absent. Credential sent to curl on stdin (`--config -`), never argv. Then `INFO H12b bucket lock: checked off-box by b2-setup.py`: the box key cannot read retention | item 1 |
| H13 | `secrets/uploader/heartbeat_url` present; when absent, `WARN H13 heartbeat not configured: alert path B does not exist; a box going quiet or a full bucket goes unnoticed` | item 8 |
| H14 | `timedatectl show -p NTPSynchronized` is `yes` | — |
| D1 | `SHOW` on each project's Postgres: the C-75 three, `archive_mode on`, `archive_timeout 300`, `max_replication_slots 2`, `max_wal_senders 3`, `max_slot_wal_keep_size 2GB`, `log_connections on`, `password_encryption scram-sha-256` | D-8, C-79 |
| D2 | `SELECT array_agg(extname ORDER BY extname) FROM pg_extension` is exactly `{plpgsql}` on prod **and** staging | criterion 5 |
| D3 | The C-79 set as INFRA §7.1 step 11 lists it | C-79 |
| D4 | No non-temporary row in `pg_replication_slots` | C-79 |
| D5 | Every login role in `roles.sql` has a `SCRAM-SHA-256$` verifier | R5 |
| D6 | The fixed networks carry their §2.2 subnets; no other Docker network lies in `10.201.0.0/16` or `10.202.0.0/16` | §2.2 |

**The box-key constant** lives in `infra/operator/b2-capabilities.json` and is shared by H12 and R8's tool. It is
`{writeFiles}`, or `{listBuckets, writeFiles}` only if R12 E9 shows that rclone's upload (`no_check_bucket = true`)
fails without `listBuckets`. The file starts as `{listBuckets, writeFiles}`, the key as built, and E9's result sets
it in this loop. `listFiles` and `readFiles` are never added to the box key. If the uploader's verify needs a HEAD
or a list, the verify step changes instead (POLY-99). The key never gains a capability that deletes, hides beyond
`writeFiles`, or changes retention, lifecycle, encryption or keys.

`backup_store_credential` format: two lines, the key id then the application key, nothing else. POLY-99's uploader reads
the same file.

## R7 — How the scripts reach the box (until POLY-98/100)

From the operator's verified checkout (step 6): `scp infra/provision.sh infra/provision-check.sh
packages/db/sql/roles.sql` to `/tmp/` on the box, then `sudo bash /tmp/provision.sh --stage host …` and
`sudo bash /tmp/provision-check.sh`. Expected before the first deploy: `HOST CHECKS PASSED; <n> checks wait for the
first deploy`. After it, `ALL CHECKS PASSED`. POLY-98 replaces these lines with `polycarpic-ops provision` and
`provision-check`, running the copies from the ops bundle.

## R8 — Operator tooling under `infra/operator/`

**Language: Python 3, stdlib only, no syntax newer than 3.9** (the macOS Command Line Tools `python3`). Reason: the
prototypes already are, the APIs are JSON, hidden prompts are `getpass`, and CI already runs Python. Shell plus `curl`
would put credentials in argv or temp files. Tests in `tests/infra/operator/`, `unittest`, R3's fakes.

Common to every tool: every credential part, **key ids and API key ids included**, is read with `getpass`. No
credential is written to disk, put in argv or the environment, or printed. A test captures stdout and stderr, walks the
temp HOME and cwd, and fails on any occurrence of the fixture secrets. Every change is listed and confirmed with a typed
`yes`. An API error exits 1 with the provider's message and no request headers. Fixtures come from the prototypes'
real runs, with secrets replaced.

- `b2-setup.py` (item 9; supersedes `b2-make-put-key.py` and `b2-bucket-check.py`):
  1. Prints: "In Backblaze, App Keys → Generate New Master Application Key." Reads the new master id and key.
  2. Reads the bucket back and asserts `bucketType allPrivate`; `fileLockConfiguration`: enabled, mode `compliance`,
     period 35 days; lifecycle hide 36 / delete 1 (item 2: the lock is read through the API, not the dialog).
     Prints each as PASS or FAIL. Encryption is reported, not asserted (item 3).
  3. Creates `polycarpic-put-only` with exactly the box-key constant, and `polycarpic-read` with exactly
     `{listBuckets, listFiles, readFiles, readBucketRetentions, readFileRetentions, readFileLegalHolds,
     readBucketEncryption}`, plus B2's lifecycle-read capability if one exists under that role (the name is
     unmeasured; E9 reads it from the API). Both keys are restricted to the bucket. The read key never holds any
     `write*`, `deleteFiles`, `bypassGovernance`, `shareFiles`, `listKeys`, `writeKeys` or `deleteKeys`; the
     web-form "Read Only" key is checked against this set and replaced if it differs. If a key of that
     name exists, it shows its capabilities and offers delete-and-recreate. It never makes two keys with one name.
     Each new key's secret is printed **once**, marked, for the password manager. That is the tool's purpose and the
     only secret it ever prints.
  4. Reads every key back through `b2_list_keys` and asserts each one's capability set and bucket exactly. A key
     outside these two names that holds this bucket is listed as FAIL with "delete it".
  5. Prints: "Now generate a new master key again." Waits for `done`, then authorizes with the old master key
     (still in memory) and expects 401. PASS proves the regeneration. The old key is then discarded. The tool says
     the master key is never to be stored, since it can be regenerated from the console behind two-step sign-in.
  - `--probe` (E9 only): with the master key, creates a temporary `writeFiles`-only key, runs one rclone upload of a
    1-byte `probe/<UTC timestamp>` object through it, reports success or the refusal, then deletes the temporary key.
    The object stays locked for 35 days, at negligible cost.
- `dns-move-to-cloudflare.py`: as prototyped, with the Porkbun API key read hidden too.
- `dns-records.py`: writes the allowed set of R9 (mail and lock-down records, and `app`/`staging` A and AAAA with
  `--ipv4`/`--ipv6`, TTL 300, `proxied: false`), idempotent, and never writes a record outside the allowed set
  (tested). Token: zone-scoped DNS edit, deleted after use.
- `dns-check.py`: R9.
- `laptop-check.py`: fails if `hcloud context list` shows any context, if `HCLOUD_TOKEN` is set, or if hcloud's config
  file holds a token. Runs at the deploy gate and in the monthly window, beside `dns-check.py` (seceng, built state).

## R9 — The DNS allowed set and its check

One file, `infra/operator/dns-allowed.json`, read by both `dns-records.py` and `dns-check.py`. The zone is
`polycarpic.com`. Names below are relative to it.

| Name | Type | Value (exact, after trimming quotes and a trailing dot, case-insensitive) |
|---|---|---|
| `@` | TXT | `v=spf1 -all` |
| `@` | MX | priority 0, `.` |
| `@` | CAA | exactly two: `0 issue "letsencrypt.org"` and `0 issuewild ";"`. POLY-104 narrows `issue` with `accounturi=` after first issuance. |
| `_dmarc` | TXT | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=r; rua=mailto:<Cloudflare DMARC Management address>` (§D3). Never `ruf`. |
| `send.mail` | CNAME | `send.forge.rmta.net` |
| `rsend.mail` | CNAME | `rsend-euw1.forge.rmta.net` |
| `resend._domainkey.mail` | TXT | starts `p=`; the SHA-256 of the normalised value is pinned. A change fails with `fix: confirm a Resend key rotation, then re-pin in dns-allowed.json` |
| `app`, `staging` | A, AAAA | one record each, equal to `--ipv4` / `--ipv6`; absent is allowed and reported as `absent`. Pinned, so a record left behind when a Hetzner address is released fails (seceng) |

`dns-check.py --ipv4 <a> --ipv6 <a>` lists every record through Cloudflare's API (all pages; fails closed if
`result_info` shows more than it fetched or `success` is false) with a **read-only** (Zone:DNS:Read) token. It prints
`FAIL <name> <type> <value>: <reason>` and exits 1 for each of these:
- a name or type not in the table;
- any name containing `*`;
- any CNAME other than the two above, or either of them pointing anywhere else;
- a value differing from its pinned value;
- two records for one name and type;
- `proxied: true` on any record;
- an NS record below the apex (a delegation);
- A or AAAA for `app`/`staging` not equal to the given address.

**Target health.** The check also resolves both CNAME targets through public DNS-over-HTTPS (Cloudflare's JSON
endpoint, `type=A`, `AAAA`, `CAA`; stdlib `urllib`, the same injected transport). It fails on any A, AAAA or CAA
answer at either target, with `fix: stop and ask seceng; do not re-pin`. An address there would let whoever runs
`rmta.net` serve an HTTPS page on our sibling name and plant a `Domain=polycarpic.com` cookie (R-27). Today neither
target has one (seceng, `dig`).

It ends `DNS CHECK PASSED` with exit 0. The dry run plants each fault in a fixture and asserts the exact FAIL line.
The planted-record proof on the live zone is R12 E6. Runs at the deploy gate (with INFRA §7.1 step 16) and in the
monthly window (§8.2), on the laptop, never on the box.

## R10 — No secret printed or logged (criterion 4)

The dry run fixes every generated secret, B2 key, Cloudflare and Porkbun token and master key to known fixture values
and fails if any of them appears in stdout, stderr, the fakes' argv log, `/var/log`, or any file outside its secret
path. Secret-name pattern for R2 and H10: `(PASSWORD|SECRET|TOKEN|_KEY|CREDENTIAL)` in a key name, case-insensitive.

## R11 — Docs (owners; this loop)

- **devops (INFRA):**
  - §6.1 B2 specifics: the box key holds exactly `{listBuckets, writeFiles}`, made through the API, asserted by
    provision-check H12. The read key holds exactly R8's set. "Cannot shorten retention or delete" is restated as
    true of those keys only.
  - §7.0: Backblaze region chosen at signup (EU Central, item 4); Caps & Alerts need a payment method (item 5).
  - §7.1:
    - Step 4 becomes `b2-setup.py`. It drops "If only governance is offered, stop" (item 2) and "encryption off"
      (item 3).
    - Step 7 gains `--type`.
    - Step 8 becomes `dns-records.py`, then `dns-check.py`, plus the POLY-153 domain rule: only `app` and `staging`
      as web names, no wildcard, no outside alias except the two pinned mail aliases.
    - Step 11 follows R7 and R4's two summaries.
    - Step 14 says the maintenance page is not built yet (POLY-138 F4).
    - Step 16 runs `dns-check.py` too.
  - §6.5: the NOT CONFIGURED state.
  - §8.2: run `dns-check.py` and `b2-setup.py`'s read-back.
  - §8: the two POLY-137/138 runbook sentences: only a database superuser can correct a user's email, and an
    undeliverable notice keeps its method held.
  - `infra/README.md`: the tools.
- **seceng (SECURITY):**
  - C-73: the B2 capability sets, API-made keys, and restore-by-version.
  - C-78: the password manager. macOS Passwords is acceptable with 2FA, and it gates real data.
  - The DMARC record.
  - R-27: the reworded domain rule, and residual (a), the `rmta.net` takeover.
  - CAA and target health as a new control.
  - User-data and the metadata service (R2).
- **architect (ARCH), at the verdict:** §7 integration points gain Backblaze's and Cloudflare's APIs at provisioning
  (laptop only, read-only token for the check); the Hetzner deploy topology's provisioning sentence names the two
  stages.

## Tests qa pins, and what makes each red

Red before the build, each by its own missing behaviour:
- create.sh: two runs on empty fake state, where the second call log holds no mutating verb; a planted 5432 rule
  that is reset and reported; `--firewall` present on `server create`; no other port in the argv log; refuses
  `HCLOUD_TOKEN`; exits 2 without `--type`.
- cloud-init: schema valid; no secret pattern.
- provision host stage: run twice, the second reports no change; then every H check's positive case.
- One planted fault per H and D check, with its id and fix.
- The M1 sequence run as 999, 10004 and 10005 against the provisioned spool; a chmod-0600 file trips H7.
- The database stage against the image job's Postgres derivative, where each role's verifier authenticates its
  plaintext and neither the plaintext nor the verifier appears in the Postgres log, including after a forced
  failing ALTER.
- Each operator tool's flow against fixtures, every R9 fault, the old-master 401, and the secret sweep of R10.
- An A, AAAA and CAA answer, each planted at a CNAME target, fails target health.
- `laptop-check.py` fails on a planted hcloud context.
- An unconfigured heartbeat yields `PASSED WITH 1 WARNINGS: H13`, never `ALL CHECKS PASSED`, and FAILs under
  `--prod`.
- A box-key fixture holding `listFiles`, or one with no bucket restriction, fails H12.
- The compose-equals-table test of R5.

## Guards

The `image` job's added steps take ≤ 120 s on the first green CI run (unmeasured; the dry run's apt layer is cached as
a built image within the job). Over that, an addendum moves them to their own job. The vitest dry run alone is
≤ 60 s locally. The test-suite time delta is reported at build-green.

## R12 — The real run (criterion 2; the Principal only)

On the Principal's laptop, `hcloud` context `polycarpic`. The Principal pastes the output and the lead records it in
`process/cairn/reviews/POLY-97/real-run.md`. Nothing in it is secret: `hcloud` prints no token.

- E1. `create.sh` run 1: the change lines, the two addresses, the `created:` line.
- E2. `create.sh` run 2: only `exists` lines and `no changes`, exit 0.
- E3. `hcloud firewall describe <name> -o json | jq '.rules'`: exactly R1's three rules; `applied_to` names the server.
- E4. `nmap -Pn -p-` on IPv4 and on IPv6: 22 open, 80 and 443 closed (nothing listens yet, the firewall passes them),
  every other port filtered.
- E5. Drift: in the console, add an inbound 8080 rule; rerun create.sh; it prints `change: firewall rules reset`;
  E3 again shows three rules.
- E6. DNS: `dns-check.py` passes on the live zone. Then add TXT `planted` in the console: the check fails naming
  `planted TXT`. Delete it: the check passes.
- E9. Backblaze: `b2-setup.py` run live. Its read-back passes, or it replaces the read key and then passes. Then
  `--probe`: if the `writeFiles`-only upload succeeds, the box-key constant becomes `{writeFiles}`, and the put-only
  key is recreated to match. The lead records which.
- E7 (if §D1 is taken). R7's host stage and provision-check on the box; expected
  `HOST CHECKS PASSED; <n> checks wait for the first deploy`; any FAIL is a finding for this loop.
- E8. Cleanup (§D2), then `hcloud context delete polycarpic`, then the token is deleted in the console (C-78), then
  `laptop-check.py` passes. All of this happens in the same sitting as E1, never later: the box is a fake-data
  test box, but the token can snapshot it.

## D — Decisions for the Principal

- **D1. Provision the real box in this loop too?**
  - (a) **Recommended:** yes, E7. The dry run fakes the disk encryption, the package installs and the services, which
    are the three things most likely to break on a real box. About 30 minutes, and a box that exists anyway.
  - (b) Leave it to POLY-104. It saves the half hour, and a fake-only mistake surfaces in the first staging deploy
    instead.
- **D2. After the real run, keep or delete the server?**
  - (a) **Recommended:** delete the server, volume and firewall. The cost is cents. POLY-104 then runs step 7 fresh, as a
    novice would, which is what it is for.
  - (b) Keep it, about €10–15 a month, and POLY-104 starts from a running box. Step 7 becomes a no-op there, and the
    token must stay alive or be remade.
- **D3. DMARC reports, and pinning.** seceng's record adds `sp=reject; adkim=s; aspf=r` and a `rua=` report
  address. The check pins DMARC exactly, and DKIM by hash. The check fails the day Resend rotates its key or anyone
  edits the record, until a PR re-pins it.
  - **Recommended:** turn on Cloudflare's free DMARC Management. It gives the `rua=` address, and Cloudflare already
    holds the zone, so no new party sees anything. That is about 5 minutes in the console during R12; the lead puts
    the address in `dns-allowed.json`. Without reports, nobody sees someone forging our mail, or our own mail
    failing.
  - The alternative is no `rua`: the record is pinned without it, and we stay blind.
  - `ruf` (forensic reports) is refused either way. Those reports can carry sign-in and recovery links.
- **D4. Password-free `sudo` for `polyops`.** The SSH key and its passphrase are then the only things between a
  stolen laptop session and root.
  - **Recommended:** accept it. A sudo password typed over that same session adds little against the attacker who
    already has the session (a keylogger sees both). You do not keep a password manager, so it would be one more
    secret to lose.
  - The alternative is a sudo password: it costs a stored secret, and it stops someone who has the key file but not
    the session.
  - seceng to concur at the ruling review.

## Addendum 1 — seceng's ruling review (`ruling-review.md` @ `c83fddb8`), against `d7dd2d1a`

S3, S4(a), S5, S6(a–c) and A1 are already in `d7dd2d1a` (target health, bucketId/namePrefix, no widening, restore by version, read-key set). Added:
- **S1/§D3.** `_dmarc` is pinned to `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=r` until the Principal turns on Cloudflare DMARC Management; then `; rua=mailto:<addr>` is appended by a re-pin PR. `dns-check.py` fails on any `ruf=` whatever the pin says.
- **S2.** R9's CAA rows are three: `0 issue "letsencrypt.org"`, `0 issue "sectigo.com"` (Caddy's ZeroSSL fallback; identifier unmeasured, devops confirms from ZeroSSL's docs), `0 issuewild ";"`. POLY-104 pins Caddy to one issuer, drops the other row and adds `accounturi=`.
- **S4(b,c).** No tool or check prints, logs or writes an `authorizationToken` or any provider response header, on success, FAIL or HTTP-error paths. R10's sweep adds fixture `authorizationToken` values for H12, `b2-setup.py` and the DNS tools.
- **S6(d) → POLY-99.** The uploader exits non-zero on any refused upload, so the heartbeat trips.
- **S7, H15** (condition of seceng's §D4 concurrence): `sshd -T` shows `allowusers polyops`. The cloud-init sudoers drop-in is exactly `polyops ALL=(ALL) NOPASSWD:ALL`, mode 0440, and no other sudoers file grants beyond Ubuntu's defaults. No account but root and `polyops` has both a login shell and an `authorized_keys`. R2 sets `AllowUsers polyops` in its drop-in. Each has a planted fault.
- **S8, D1** adds: `shared_preload_libraries` is empty and `log_min_duration_statement = -1`.
- **A4.** R9 compares names and CNAME targets case-insensitively. TXT values (DKIM before hashing, DMARC, SPF) are compared exactly, after joining the 255-byte strings.
- **Scope.** Criterion 6 leaves this issue verbatim for POLY-104 (Scope table). §D4 is concurred on S7's conditions. It is an accepted risk with the Principal as approver, and seceng records it in SECURITY Open Risks.

## Addendum 2 — qa's three pins (qa-engineer-97, before tests-red)

- **D3 probe.** "Any command exits 0" is not the probe. A rejection only counts if the right password was offered, and the test asserts the reason, not just the exit code. Each service has its own probe:
  - **web:** run the backup tools image inside web's network namespace (`docker run --rm --network container:<web> <tools image>`), with `db_password_backup` bind-mounted read-only as a passfile. Try `psql "host=postgres dbname=polycarpic user=poly_backup"`, then the same with `replication=database` (`IDENTIFY_SYSTEM`). Expect exit ≠ 0 and `no pg_hba.conf entry` or `pg_hba.conf rejects` on stderr.
  - **uploader:** the same probe from uploader's namespace. Expect exit ≠ 0 with a name or route failure: there is no path to Postgres at all.
  - **backup:** the same probe from backup's container. Expect `SELECT 1` and `IDENTIFY_SYSTEM` to succeed.

  Any other outcome is FAIL. The fake keys on (namespace, mode) and returns the stderr text.
- **D5 on staging.** Agreed, with a positive assertion: staging's `poly_backup` has **no** verifier. Staging has no backup service and no `db_password_backup`, so a null password cannot authenticate. A verifier present there is a FAIL. The other five login roles are checked on both projects.
- **cloud-init key.** Agreed: the placeholder `__SSH_PUBLIC_KEY__`, `users:` for the user, `write_files` for the sshd drop-in and sudoers, and `--user-data-from-file`. Before substituting, create.sh requires the `--ssh-key` file to be exactly one line matching `^ssh-ed25519 [A-Za-z0-9+/]+=* [^\n]*$`. Anything else exits 2, so a key file cannot inject YAML.
