# POLY-104 security review (PR 1)

Reviewer: seceng-104. Branch `feature/poly-104-first-staging-deploy` at `0fa08737`. This covers PR 1, the code fixes. The outside scans and edge-2 are added in PR 2.

"Measured" means I ran it, or it was seen on the real box as recorded in `staging-deploy.md`. "Read" means I read it in the code and did not run it.

## Fixes

| Fix | Sha | Verdict | Basis |
|---|---|---|---|
| F11: staging secrets carry the gids staging.yml runs; a rerun re-owns them | `936f833b` | Pass. No prod secret changes owner or mode, and neither project can read the other's secrets through this change. provision-check fails the wrong-gid layout. | gid table measured against both compose files; `test_set_secret*` (32) and `test_list_secrets*` (7) OK; on the box, 11 re-owns then `no changes` |
| S1: a linked secrets root, service directory, file, `host` directory or `heartbeat_url` stops the stage | `f674a6d3` | Pass | Read: `refuse_link` before every chown and chmod. qa box suite 228/228. The linked `host` / `heartbeat_url` case is read only; no test plants it. |
| S4: `gid_of` strips trailing slashes before it picks the staging range | `f674a6d3` | Pass | Read; qa box suite |
| S2: a hard link to a prod inode would be re-owned | none | Recorded, Info. It needs root. H6's same-content check across trees should flag it (read, not measured). | read |
| S3: set-secret checks a directory's uid and mode, not its gid | none | Recorded, Info. A host-stage rerun repairs the file and H6 flags it. | read |
| F15: gh comes from the pinned release tarball; both the tarball and `bin/gh` are pinned by sha256; H26; refusal `gh`; no raw gh stderr | `00b5d14a` | Pass. The `tar -xzOf` departure is accepted: no archive entry, owner or link reaches the disk before both hash checks. | `test_deploy_gh*` (13) OK. gh's environment is built from nothing (`fixed_env`). On the box: hash equal to the pin, `PASS H26`, and the first real `attestation verify` passed. |
| F18: Caddy is built with no file capability (`XCADDY_SETCAP=0`); edge.yml, compose-allow and the lint policy are unchanged | `0fa08737` | Pass. Not yet on the box: it ships only as `edge-2` from `main`. | `caddy-compose-edge.test.ts` at `b13622de`: the merged-filesystem scan has a positive control. Under edge.yml's settings the container is still up after 30 s and healthy, and its process 1 has CapPrm, CapEff and CapBnd = 0. Red 5/10 on the old Dockerfile, 10/10 on `0fa08737` (qa; not run by me). |
| F8: drill DR3 counts matches to the end of the stream; a stream that fails is a FAIL | `ff62d0d0` | Pass. It no longer fails open on SIGPIPE. | Read: `grep -c` with `pipefail` (`drill.sh:3`), and the exit status of a stream that fails is caught. Red/green at `2034dff2` / `84dc7374` (qa). |
| F2: install.sh ships the repository it lives in | `c1aaa6e3` | Pass | Read; measured on the box (the right `git-` ids installed) |
| F10: install.sh checks git's output before any ssh; `--commit` lists its hex characters | `c8f9d5f9` | Pass | Read: both payloads are written to a 0700 `mktemp -d` and git's status is checked before the first ssh. Red at `02e90374` (qa). |
| F6: Caddy data directories `0700 10010:10010` | `ff62d0d0` | Pass. ACME keys are not readable by other uids. | Measured on the box |
| F9: H25 runs as the render user with HOME `root:root 0755`, empty | `410a3e47` | Pass. The render user still owns nothing writable. | Measured on the box |

## Decisions

| Decision | Approver | Judgment | Condition |
|---|---|---|---|
| The host key was accepted as first seen, for the staging box only (F1) | Principal | Accepted for staging. If the first connection had been relayed by an attacker, they could have run commands as root on the box, since `polyops` has passwordless sudo (R-29). They would also have seen what was typed: the real `github_read_token` (read-only; the C-83 box token) and staging placeholders. | Prod runs on this same host. **Before prod, either check the host key fingerprint out-of-band, or rebuild the box with a verified key.** The candidate "give the server its host key at creation" puts a private key in cloud-init user-data, which C-71 forbids: any container can read user-data from the metadata service. It is acceptable only if the metadata service is blocked from containers, or the key is replaced after first boot. |
| Staging is IPv4-only, with no AAAA (F7) | lead | Accepted. It removes surface and weakens nothing. The Cloud Firewall still admits 80 and 443 from `::/0` with nothing listening. | The PR 2 outside IPv6 scan must show 22 only. For prod, OQ-INFRA-13 decides between serving IPv6 and dropping 80/443 on `::/0` in the Cloud Firewall. C-90 text updated (no AAAA). |
| Hand-made keyring placeholder `staging-secrets/worker/credential_keyring`: random, `root:10102 0440`, never read (F13) | lead | Accepted. It holds no key material that protects any data. C-77 holds trivially: staging has no keyring that prod could share. | `init-keyring`, `keyring-fingerprint` and `restore-keyring` are built before prod (C-77: distinct `key_id`s). The placeholder is never copied to prod; H6's same-content check across trees flags a copy. |
| The release-signing key is held only by the Principal: its own passphrase, never in an agent | Principal | Accepted, and stronger than the old text (`/merge-pr` signing). A compromised agent or CI cannot produce a deployable tag. SECURITY §8 Signing updated. | Before prod, the Principal decides recovery for loss of the key: a second enrolled key, or a recorded re-enrolment step. A lost key means no release, not a breach. |
| The public CAA answer is wider than the pinned set (F14, OQ-INFRA-14) | open | Not accepted. While Universal SSL is on, Cloudflare's issuers and an `issuewild` mean CAA does not narrow issuance. This is part of R-27's defence (a sibling certificate plants a cookie). C-90 now states it is not in force. | **Before prod:** the public answer equals the pinned set (Universal SSL off; the records are DNS-only), and `dns-check.py` compares the public answer from two resolvers. |
| CI never runs a real `gh attestation verify` (F16) | open | Not accepted as standing. A wrong verify that refuses is safe; one that passes when it should not, like CVE-2025-25204 (exit 0 with no match), would be seen nowhere before the box. | **Before prod:** a check outside the box runs the pinned gh against a real attested digest, plus the negative cases C-83 lists (another workflow, another repo, a branch other than `main`, another commit: each refused). The same check runs at every gh pin bump. |

## Core dumps go to apport (measured on the box)

`/proc/sys/kernel/core_pattern` is `|/usr/share/apport/apport … -- %E`. The four staging containers have core size soft 0 / hard 0, and `/var/crash` is empty.

The limits are not the control. core(5) says a piped pattern is not bound by a core limit of 0 (read, not measured). So a crash in `web`, `auth`, `worker` or `postgres` hands that process's memory to apport, running as root on the host. That memory can hold session tokens, database passwords, keyring keys and, on prod, ledger rows.

Whether apport then writes it to `/var/crash` for a process in a container is unmeasured. apport also has a record of root-level bugs in handling crashes from other namespaces.

**Severity: Medium.** The memory can hold secrets and data, it would land on the root disk outside the encrypted data volume, and root parses input from a crashing container.

**Control.**
- `provision --stage host` purges the `apport` package (its service rewrites `core_pattern` at boot).
- It writes `/etc/sysctl.d/50-polycarpic-core.conf` with `kernel.core_pattern=|/bin/false` and `fs.suid_dumpable=0`, then applies it.
- **provision-check** gets a new row that FAILs unless `/proc/sys/kernel/core_pattern` reads exactly `|/bin/false`, `fs.suid_dumpable` is 0, and no `apport` package is installed. It reads the live `/proc` value, not the file.
- The row must be shown red on today's box value.

**Gate.** It does not gate PR 1: staging holds fake data and staging secrets only, nothing has crashed, and prod is not on this box. It is on the before-prod list (item 9). The lead put it in PR 1.

**Build at `5c980a03`: Pass.**
- `no_core_dumps` purges apport before it applies the setting, writes the file, and re-reads both live values, dying on a mismatch.
- H27 reads the live values with `sysctl -n` and treats an apport package in `config-files` as present.
- Info: the purge's output goes to `/dev/null`. On the box, read `apt-get -s purge apport` once to see that nothing beyond apport and its own dependents (for example `apport-core-dump-handler`) is removed. This is unmeasured.
- Info: a later-sorting file in `sysctl.d` could set `core_pattern` again at boot. H27 reads the live value, so it would FAIL and not pass.
- Box and qa runs are pending; I did not run them.

## PR 2: `edge-2` on the box

Sources: `staging-deploy.md` at `943d100b` ("`edge-2` on the box", F21 to F25) and the lead's run notes.

What the box shows:
- Caddy is up from a signed `edge-2`, with Let's Encrypt certificates written only by uid 10010 into its 0700 directories (M1 to M3).
- The security headers are on served pages and on errors (M5 to M8).
- Password SSH is refused (M10).
- From another network, the allowlist judges the real client address and answers before the password; a forged `X-Forwarded-For` gets 403 (O1, O2).
- The IPv4 full TCP scan shows 22, 80 and 443 only (M11).
- The core-dump control holds over a reboot (F20).
- Pending: the IPv6 full scan.
- Not scanned: UDP.

| Finding | Severity | Ruling | Blocks prod? |
|---|---|---|---|
| **F21.** No command applies a changed `edge.env` (the staging allow address among it) to a running Caddy | Low | Removing an address from the allowlist does not take effect until the next `edge-<n>`; staging's basic auth still stands behind it. Wanted: a command that re-renders and re-ups the **current** edge release from the current `edge.env` through the guard. Also a provision-check row that FAILs when the running Caddy's environment (`docker inspect`) differs from `edge.env`, so the gap is visible and not silent. Until both exist, the runbook says: to revoke an address, ship a new `edge-<n>`. | No. Prod has no allowlist. It is needed before staging holds anything real. |
| **F23.** `alt-svc: h3=":8443"` on every response | Info | The advertised port cannot be reached (UDP is not published), clients fall back, and the internal port is disclosed. Ruled: `servers { protocols h1 h2 }` in the Caddyfile and in the lint's line list. Publishing 443/udp is refused: it adds a published port, a firewall rule and a guard rule for no need. | No. It rides the next `edge-<n>`, which prod's takeover needs anyway. |
| **F24.** Caddy's log filter was not exercised on the box; an upstream failure leaves no Caddy line | Info | Leak side: the box shows no line written at all, so nothing leaked; `caddy-edge.test.ts` exercises the filter on a site without `handle_errors`, and that test is the evidence. This matches SECURITY §9 ("Caddy keeps no access log"). Detection side: an upstream that is down is seen by `status` and the health probes, not by Caddy's log, so it is a monitoring follow-up, not a control gap. | No |
| **F25b.** Every new `main` build recreates Postgres, on prod too | none (availability) | Accepted, and it should stay. The weekly no-cache rebuild exists so that Debian security fixes reach the Postgres image (C-83). Keeping the running image when the digest changes would hold those fixes back. The prod backup runs before `up` (read: `deployer.py`, the `premigration` backup before `run["up"] = True`; not run on prod). INFRA §4.6 should say that a deploy restarts Postgres. F25a (an unreachable database logged as its own event) removes the confusion. | No |

**None of F21, F23, F24 or F25b blocks prod.**

## Must be true before a prod box

1. The host key is verified out-of-band, or the box is rebuilt with a verified one, by a method that puts no private key where containers can read it (F1, C-71). The laptop's `known_hosts` then pins the key under the host name as well as the address (M10).
2. The public CAA answer equals the pinned set, and `dns-check.py` checks the public answer (F14).
3. The C-83 negative cases are refused on staging with the real gh, and that check also runs outside the box (F16).
4. The keyring commands are built, and prod's keyring is real, with distinct `key_id`s (F13, C-77).
5. **Done:** `edge-2` runs healthy under edge.yml, and Caddy issues its certificates into the 0700 directories (M1 to M4). Its zero capability sets are shown in the image job, not read on the box.
6. The outside scans show exactly 22, 80 and 443 on IPv4 (**done**, TCP, M11) and 22 only on IPv6 (**pending**). The Cloud Firewall's three rules are read and shown to be TCP only, because UDP was not scanned. There is an IPv6 decision for prod (OQ-INFRA-13).
7. Recovery for a lost release key is decided.
8. CI's floating gh in `build.yml` and `release-lookup.sh` is pinned or accepted with a reason. It decides nothing on the box, but release.yml's mirror check uses it.
9. **Done:** no core dump leaves a crashing process. H27 failed on the old values, then passed, and held over a reboot (F20).

Follow-ups that do not block prod: F21 (apply `edge.env`, plus a drift row), F23 (h1/h2 only, in the next `edge-<n>`), F24 (upstream failures visible to monitoring), F25a, and F25b's INFRA §4.6 sentence.

## SECURITY doc edits (1.21.5)

- **§4 invitation link.** Caddy keeps no access log; the old text named one.

- **§8 Signing.** The Principal signs release tags with a dedicated key that is never in an agent; no agent signs one.
- **C-90.** `app` and `staging` have A records only (no AAAA while IPv4-only). A "Not in force" line says the public CAA answer is wider than the pinned set.
- **C-70.** No file capability in our images. The image job's capability scan and the up-under-edge.yml test are listed under Tested by.
