# POLY-97 verdict (architect, gate 4)

architect-97, 2026-11-22. Read from the code at `89d921f3`. That tip equals `060d49ae` in `infra/`, `tests/` and
`.github/`, so the green CI run 45048891331 covers it. Authority: `ruling.md` at `1eafa6c5` (Addenda 1–3) and
`pins-review.md` at `060d49ae`. One new measurement (V1, this Mac, Docker 29.9.3, compose 5.7.0): with a project
started by `docker compose -f … -p poly97m up`, from a directory with no compose file, `docker compose -p poly97m ps`
and `exec -T postgres …` both work (exit 0), and a `run` of a profiled one-off service is named
`poly97m-backup-run-<hash>`, never `poly97m-backup-1`.

**Verdict: PASS on conditions C1–C3.** Each is a small fix in this issue's files, with a test. All three must land
before R12 is run, because R12 would otherwise measure the wrong thing.

## Axes

| Axis | Result | Evidence |
|---|---|---|
| R1 create.sh | PASS, except C2 | `infra/hetzner/create.sh`. `--type` is required and lists the plans; `HCLOUD_TOKEN` is refused. The firewall is attached at `server create`. Drift is reset with `replace-rules`, and a foreign firewall is detached (beyond the ruling, sound). Every mutating call prints a `change:` line, and an unchanged run prints `no changes`. Only ports 22/80/443 appear. The token-removal lines print on every run. |
| R2 cloud-init | PASS | `cloud-init.yaml`: the user is in `users:` with no `sudo:` key; the drop-ins are in `write_files`, sudoers 0440 with one line, and `AllowUsers polyops`. It holds no secret. The placeholder is substituted with `ssh-ed25519 <base64>` only (Addendum 3, P2). |
| R3 harness | PASS | Fakes are on `PATH`, `HCLOUD_TOKEN` is unset, and the Python base class blocks the network. The container is pinned by digest. |
| R4 output contract | PASS | `provision-check.sh` prints the five line kinds and the four summaries with exits 0/0/3/1. `--prod`, or `pg-prod/PG_VERSION`, turns WARN into FAIL. |
| R5 host stage | PASS | `provision.sh`. The Docker key fingerprint is checked. `daemon.json` matches the ruling. `luksFormat` runs only on an `empty` device, and a `foreign` one stops. The ACLs match M1. Secret files are written under `umask 0377` and never overwritten. `MAIL_FROM` must be under `mail.<d>`. |
| R5 database stage | PASS | `emit_alters` computes the SCRAM verifier in stdlib (4096 iterations, 16-byte salt) and sends it on stdin after the two `SET`s, with stderr redacted. A rerun sets fresh verifiers rather than printing "no changes", which is harmless. V1 measures that `-p` without `-f` works. |
| R6 H1–H15 | PASS | Each check is read against its row. H12 sends the credential through the builtin `printf` to `curl --config -`, `-f`, with stderr discarded, so neither the response nor the token is printed (Addendum 1, S4). H15 is as Addendum 1. |
| R6 D1, D2, D4–D6 | PASS | D1 includes `shared_preload_libraries` empty and `log_min_duration_statement -1`. D5 asserts that staging's `poly_backup` has no verifier. |
| R6 D3 | **GAP, C1** | `d3_probe` joins `container:polycarpic-prod-<svc>-1`. backup and uploader are one-off services, so V1 shows no such container exists at check time. The image is `${POLY_POSTGRES_IMAGE:-postgres:17}` with `--pull never`. On a real box D3 therefore always FAILs, though it fails closed. The fake accepts those names, so the dry run cannot see this. |
| R7 | PASS | INFRA step 11 copies four files (pins 3a). |
| R8 operator tools | PASS | Every credential is read with `getpass`. `b2-setup.py` asserts the bucket, makes both keys through the API, reads every key back, flags any other key on the bucket or any unrestricted key with write rights, and checks the old master key gets 401; `--probe` does the same. The probe runs rclone's S3 backend (seceng B1). Its temporary key sits in the child's environment, an accepted deviation (seceng A-probe1). An unrestricted read-only key is a WARN, which I accept: it can reach ciphertext only. |
| R9 DNS | PASS | `dns-allowed.json` is as Addendum 1, with no `rua` until §D3 is taken. `dns-check.py` pages and fails closed. TXT values are compared exactly, after joining, with DKIM by SHA-256; CNAMEs case-insensitively. `ruf=` always fails. Target health reads A/AAAA/CAA over DoH, and a transport error is a FAIL. `dns-records.py` sends CAA as `data`, which settles devops's unmeasured item 1 in code; the live POST is R12. |
| R10 no secret printed | PASS | The sweeps include the generated secrets, fixture tokens and `authorizationToken`. |
| Harness-fix table (11 rows) | PASS | None was loosened. Row 7 is stricter. Row 4 keeps M2's case D proven: the rewritten ALTER still carries the real verifier and fails inside Postgres, and the A-M2 mutation (SETs stripped → the verifier reaches the log) shows the sweep has power. Row 11 is checked in `pins-review.md`. |
| CI limits | PASS on one run; the second is the PR's run | Run 45048891331: provision 116 s ≤ 200, image 245 s ≤ 290. The ruling asks for two runs. If the PR run is over either limit, it reopens this axis. |
| INFRA vs real output | PASS, except C2 and C3 | Steps 4, 7, 8, 11 and 16 and §8.2 quote the tools' real last lines (`B2 SETUP PASSED`, `created: …`, `DNS CHECK PASSED`, `HOST CHECKS PASSED; <n> …`, `LAPTOP CHECK PASSED`). They list exactly the staging-only WAIT set, which seceng accepted (build review, call b). |
| Builder's unmeasured list | 1 settled in code; 2 measured (V1); 3 is C1; 4 is R12 E1–E7; 5 accepted (`docker info` does not expose those keys, so `daemon.json` is the source) | `…devops-engineer-97/temp/2026-11-22-devops-engineer-97-gate3-findings.md` |
| ARCH | Done | `docs/ARCH/index.html` 1.26.0: the provisioning paragraph in the Hetzner topology, the B2 key row, and a Cloudflare zone row in integration points. |

## Conditions (devops builds, qa adds the failing case first)

- **C1. D3 joins networks, and uses the running image.**
  - web: `--network container:$(docker compose -p polycarpic-prod ps -q web)`.
  - backup: `--network polycarpic-prod_backup-net`. uploader: `--network polycarpic-prod_upload-net`. Each of these
    is that service's only network, so the probe stands exactly where the service would.
  - The image is the one the running `postgres` container uses
    (`docker inspect --format '{{.Config.Image}}' <id>`), with no default tag.
  - A missing container or network is a FAIL naming it.
  - The fake asserts these exact argv and refuses `polycarpic-prod-backup-1` and `polycarpic-prod-uploader-1`.
- **C2. create.sh prints the IPv6 host address.**
  - Hetzner, and the fake, give `public_net.ipv6.ip` as a `/64` network (`fakes/hcloud:167`).
  - create.sh prints `IPv6: <prefix>::1 (network <prefix>/64)`.
  - INFRA steps 8 and 15 use `<prefix>::1`, which `dns-records.py --ipv6` accepts. Today it would exit 2 on the `/64`.
- **C3. INFRA step 8: an existing `_dmarc` reports CONFLICT.** `dns-records.py` never overwrites, so the
  hand-made `v=DMARC1; p=reject` stops it. The step says: edit `_dmarc` in Cloudflare to the value printed, then run
  the tool again.

## Carried, not blocking

- POLY-104's criterion "provision-check passes" means the staging-only result: exit 3 with exactly INFRA step 11's
  WAIT set and `WARN H13`. `ALL CHECKS PASSED` needs prod and the heartbeat. The lead words POLY-104 to match.
- `b2-setup.py` could give `polycarpic-read` a lifecycle-read capability (ruling R8 step 3, "if one exists"); it does
  not. The master-key run asserts the lifecycle, so this only matters to POLY-99's drill.

## R12: the Principal's run, in order

Run on the laptop, from the feature branch after C1–C3 land:
`git -C ~/polycarpic switch feature/poly-97-infra-provisioning && git -C ~/polycarpic pull`. Then `cd ~/polycarpic`.
Paste each output for the lead, who records it in `real-run.md`. Steps 1–6 hold no Hetzner token. Steps 7–17 are one
sitting.

| # | Command | Expect |
|---|---|---|
| 1 (E9) | `python3 infra/operator/b2-setup.py --probe --bucket polycarpic-hetzner-backups` (generate a new master key first, as it says) | `PROBE: the writeFiles-only upload was accepted …` **or** `… refused or failed (exit N). Keep listBuckets …`; then `The temporary key was deleted.`; then, after you generate the master key again and type `done`: `PASS the old master key is rejected (401)` |
| 2 | Only if step 1 said "accepted": the lead has `b2-capabilities.json` set to `["writeFiles"]` and pushed; you run `git pull` | the file shows `"capabilities": ["writeFiles"]` |
| 3 (E9) | `python3 infra/operator/b2-setup.py --bucket polycarpic-hetzner-backups`; at the plan type `yes`; for `polycarpic-read` answer `yes` (recreate); for `polycarpic-put-only` answer `yes` only if step 2 ran, else anything else (keep) | PASS ×6 for the bucket, `INFO encryption: SSE-B2 …`; each new key printed once (move it to Passwords); `PASS polycarpic-read: exactly …; bucket-restricted`, `PASS polycarpic-put-only: exactly …`; no other FAIL; the 401 PASS; `B2 SETUP PASSED` |
| 4 | Cloudflare console: edit TXT `_dmarc` to `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=r`; create a token for this zone only, DNS:Edit | saved |
| 5 | `python3 infra/operator/dns-records.py` (no address flags: no box records in this run) | `exists` for the six mail records; `Records to create` lists the three CAA rows; type `yes`; `created  @ CAA` ×3; `RESULT: all records in place`. Then delete that token in the console |
| 6 (E6) | Create a read-only (Zone:DNS:Read) token, then `python3 infra/operator/dns-check.py` | `INFO app A absent …` ×4 lines for app/staging A/AAAA; `DNS CHECK PASSED` |
| 6b (E6) | Console: add TXT `planted` = `x`; rerun step 6; then delete `planted` and rerun again | `FAIL planted TXT x: not in the allowed set`, `1 DNS CHECKS FAILED`; then `DNS CHECK PASSED`. Delete the read token afterwards |
| 7 | `hcloud context use polycarpic && hcloud server list` | an empty table |
| 8 | `infra/hetzner/create.sh --name polycarpic --location fsn1 --ssh-key ~/.ssh/polycarpic_ed25519.pub` | exit 2 and a list of 4 vCPU / 8 GB shared x86 types; pick one as `<type>` |
| 9 (E1) | the same with `--type <type>` | four `change:` lines (ssh key, firewall, server, volume), `IPv4: …`, `IPv6: …::1 (network …/64)`, the token-removal lines, `created: server, firewall (22,80,443 in), volume 20 GB` |
| 10 (E2) | the same command again | four `exists:` lines, the addresses, `no changes` |
| 11 (E3) | `hcloud firewall describe polycarpic -o json \| jq '{rules: [.rules[] \| {direction, protocol, port, source_ips}], applied_to: [.applied_to[].server.id]}'` and `hcloud server describe polycarpic -o json \| jq .id` | exactly three `in`/`tcp` rules, ports `22`, `80`, `443`, each `["0.0.0.0/0","::/0"]`; `applied_to` holds the server id |
| 12 (E4) | `nmap -Pn -p- <IPv4>` then `nmap -Pn -6 -p- <IPv6 ::1>` (10–20 min each) | both: `22/tcp open`, `80/tcp closed`, `443/tcp closed`, `Not shown: 65532 filtered tcp ports` |
| 13 (E5) | Console: add an inbound TCP 8080 rule to firewall `polycarpic`; rerun step 9's command; rerun step 11 | `change: firewall rules reset (was: …8080…)`, `changed: 1`; step 11 again shows three rules |
| 14 (E7, if §D1 (a)) | `ssh-add -t 1h ~/.ssh/polycarpic_ed25519`; `ssh polyops@<IPv4>` (compare the fingerprint with the console boot log); `cloud-init status --wait`; `exit` | `status: done` |
| 15 (E7) | `scp infra/provision.sh infra/provision-check.sh packages/db/sql/roles.sql infra/operator/b2-capabilities.json polyops@<IPv4>:/tmp/`; `ssh polyops@<IPv4> "sudo tee /etc/polycarpic/age-recipients.txt" < ~/polycarpic-backup.key.public` | 100 % ×4; the `age1…` line echoed |
| 16 (E7) | on the box: `sudo bash /tmp/provision.sh --stage host --target hetzner --domain polycarpic.com`, run it twice; then `sudo bash /tmp/provision-check.sh --b2-capabilities /tmp/b2-capabilities.json --b2-bucket polycarpic-hetzner-backups; echo "exit=$?"` | first run: `change:` lines, `host stage: <n> changes`; second run: `host stage: no changes`. Check: PASS H1–H11, H14, H15; `WAIT H12`; `INFO H12b`; `WARN H13 heartbeat not configured: …`; `WAIT` D1–D6; `HOST CHECKS PASSED; 7 checks wait for the first deploy`; `exit=3`. Any FAIL is a finding for this loop |
| 17 (E8) | `hcloud server delete polycarpic`; `hcloud volume delete polycarpic-data`; `hcloud firewall delete polycarpic`; `hcloud ssh-key delete polycarpic`; `hcloud server list; hcloud volume list; hcloud firewall list`; `hcloud context delete polycarpic`; console: delete the token; `ssh-keygen -R <IPv4>`; `python3 infra/operator/laptop-check.py` | three empty tables; then `PASS hcloud holds no context`, `PASS HCLOUD_TOKEN is not set`, `LAPTOP CHECK PASSED` |

§D2 (delete) is assumed in step 17. If the Principal keeps the box, skip the first five commands of step 17 but still
delete the context and the token. §D3 (DMARC reports) is not part of this run: turning it on adds `rua=`, and the
re-pin is its own PR. Seceng's F-D items remain the Principal's: move credentials into Passwords, wipe the
scrollback copies of the B2 secrets, and delete the Porkbun API key and the old write token.
