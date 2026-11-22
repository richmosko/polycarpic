# POLY-97 real run (ruling R12, verdict steps 7–17)

Recorded by the team-lead, 2026-11-22. Code at `af7baf82` (branch tip `50f837c1`, docs and tracker only since). Hetzner project `polycarpic`, empty before and after. The Principal authorised the lead to run the Hetzner half ("yes, go ahead with the Hetzner half"); the Principal loaded the SSH key with `ssh-add -t 1h` and deletes the API token in the console. No teammate touched a credential. Nothing below is secret.

**Not run in this loop, by the Principal's decision:** verdict steps 1–6 (the Backblaze probe E9, `b2-setup.py`, `dns-records.py`, `dns-check.py` and its planted record E6). They are not in POLY-97's acceptance criteria and move to POLY-104, which walks the whole runbook. Until then the operator tools are proven against fakes only, and the box key keeps `listBuckets, writeFiles`.

## Results

| Step | Evidence | Result |
|---|---|---|
| 7 | `hcloud server list`, `volume list`, `firewall list`, `ssh-key list`: four empty tables | PASS |
| 8 | `create.sh` without `--type`: exit 2, lists `cpx31`, `cpx32`, `cx33` | PASS |
| 9 (E1) | `--location fsn1 --type cx33`: `change:` ssh key, `change:` firewall, then `hcloud: error during placement (resource_unavailable, …)`, exit 1. Rerun with `--location nbg1`: `exists:` ssh key, `exists:` firewall, `change:` server create `--firewall polycarpic`, `change:` volume create; `IPv4: 46.225.112.78`; `IPv6: 2a01:4f8:1c18:31b5::1 (network 2a01:4f8:1c18:31b5::/64)`; the token-removal lines; `created: server, firewall (22,80,443 in), volume 20 GB`; exit 0 | PASS, with finding F1 |
| 10 (E2) | Same command again: four `exists:` lines, the addresses, `no changes`, exit 0 | PASS |
| 11 (E3) | `firewall describe`: three rules, `in`/`tcp`, ports 22, 80, 443, each `["0.0.0.0/0","::/0"]`; `applied_to` = `[177220366]` = the server id; `server describe … public_net.firewalls` = `[12133805]` only | PASS |
| 12 (E4) IPv4 | TCP connect to every port 1–65535 from the Principal's network, two attempts each, 2.5 s timeout, 821 s: `open: [22]`, `closed: [80, 443]`, `filtered: 65532`. `nmap -Pn -p 22,80,443,8080,5432,3000,2375,3306`: 22 open, 80 and 443 closed, the rest filtered | PASS |
| 12 (E4) IPv6 | **Not measured.** The laptop's network has no IPv6 route (`route -n get -inet6 default`: not in table; `ping6`: No route to host); nmap's "65535 filtered (host-unreach)" in 2.6 s is the local network, not the firewall. The only IPv6 evidence is step 11's `::/0` in each rule | NOT MEASURED → POLY-104 |
| 13 (E5) | Planted TCP 8080 on firewall `polycarpic` (`hcloud firewall add-rule`, the same change the console makes): rules `22,80,443,8080`. `create.sh`: `change: firewall rules reset (was: 22,80,443,8080)`, `changed: 1`; rules back to `22,80,443` | PASS |
| 13b (seceng A-fw) | Planted a second firewall `stray-test` (TCP 9999) applied to the server: `public_net.firewalls` = two ids. `create.sh`: `change: firewall detached (stray-test)`, `changed: 1`; the server holds only ours; `stray-test` is left in the project, not deleted | PASS |
| 14 (E7) | `ssh polyops@46.225.112.78 'cloud-init status --wait'`: `status: done`. Ubuntu 24.04.4 LTS, kernel 6.8.0-138. Host key `SHA256:aH3NvwD7gduHUU6FwHcMdcMdquCllcLIp+JJDgUpfSc` accepted on first use, not compared with the console boot log | PASS (fingerprint unverified) |
| 15 (E7) | `scp` of the four files; `age-recipients.txt` written from `~/polycarpic-backup.key.public` | PASS |
| 16 (E7) | `provision.sh --stage host --target hetzner --domain polycarpic.com`: 58 `change:` lines (unattended-upgrades fragment, `luks.key` 0400, LUKS2 format and open, ext4, mount, crypttab, fstab, data dirs, spool ACLs for 10005, state files, per-service secret dirs for prod and staging, generated secrets, `host.env`, `staging-host.env`), `host stage: 58 changes`, exit 0. Second run: `host stage: no changes`, exit 0 | PASS |
| 16 (E7) | `provision-check.sh --b2-capabilities … --b2-bucket polycarpic-hetzner-backups`: PASS H1–H11, H14, H15; `WAIT H12`; `INFO H12b`; `WARN H13 heartbeat not configured`; WAIT D1–D6; `HOST CHECKS PASSED; 7 checks wait for the first deploy`; exit 3 | PASS (the expected staging-only result) |
| extra | On the box: `lsblk` shows `sdb` 20G `crypto_LUKS` → `polycarpic-data` crypt ext4 at `/srv/polycarpic`; `sshd -T`: `permitrootlogin no`, `passwordauthentication no`, `allowusers polyops`, `allowtcpforwarding no`; `unattended-upgrades`, `apt-daily-upgrade.timer`, `docker` enabled; Docker 29.10.0, `json-file`, live restore on | PASS |
| extra | **Reboot** (`systemctl reboot`; boot time 17:58 → 18:21 UTC): `/srv/polycarpic` mounted from `/dev/mapper/polycarpic-data` (LUKS2, active) with no input; docker, ssh, unattended-upgrades active; `provision.sh` again: `no changes`; `provision-check` again: 13 PASS, `HOST CHECKS PASSED; 7 checks wait…`, exit 3 | PASS, with findings F2–F4 |
| 17 (E8) | Deleted server, volume, firewall `polycarpic`, firewall `stray-test`, ssh key; `server list`, `volume list`, `firewall list`, `ssh-key list`, `primary-ip list`, `floating-ip list`, snapshot/backup `image list`: all empty. `hcloud context delete polycarpic`; `ssh-keygen -R`; `ssh-add -d`. `laptop-check.py`: `PASS hcloud holds no context`, `PASS HCLOUD_TOKEN is not set`, `PASS …/cli.toml holds no token`, `LAPTOP CHECK PASSED` | PASS; the console token deletion is the Principal's |

## Findings

- **F1. No stock, and no fix named.** `fsn1` had no `cx33`. create.sh passed Hetzner's raw `resource_unavailable` through and exited 1; INFRA step 7 promises it says to use `nbg1`. The partial state (key and firewall created) was handled correctly on the rerun. Fix: on a placement failure print the fallback location.
- **F2. H14 fails for the first seconds after a boot.** The first check after the reboot printed `FAIL H14 clock: NTP is not synchronised (NTPSynchronized=no)`, exit 1; seconds later it was synchronised and the check passed. The fix line already says to wait. Fix: H14 waits a bounded time (for example up to 60 s) for synchronisation before it judges.
- **F3. A reboot can wait about a minute.** `systemctl reboot` returned and the box stayed up roughly 80 s while `apt-daily.service` finished; a second `reboot` answered "already a shutdown … in progress". Runbook note only.
- **F4. `/tmp` is cleared at boot,** so the four copied files had to be copied again. Expected until POLY-98 gives them a home; INFRA step 11 should say so.
- **F5. IPv6 was not scanned from outside** (see E4). POLY-104 needs an IPv6-capable vantage point.
- **F6. The host key was trusted on first use.** Acceptable for a box deleted the same hour; POLY-104 must compare it with the console boot log as INFRA says.

## Answers to open questions (OQ-INFRA-7)

- The 4 vCPU / 8 GB shared-x86 plan ARCH calls CX32 is sold as **`cx33`** (80 GB disk): 9.99 EUR a month, 0.0160 EUR an hour, net, the same in `fsn1` and `nbg1` (`hcloud server-type describe cx33`, 2026-11-22). Alternatives listed by create.sh: `cpx31` 20.49, `cpx32` 41.99.
- Firewall: one firewall, three rules; a rule lists IPv4 and IPv6 sources together, so three rules cover both families.
- IPv6: the server gets a `/64`; create.sh prints `<prefix>::1`, which answered nothing from this network (F5).
- This run existed for about an hour: a few cents.
