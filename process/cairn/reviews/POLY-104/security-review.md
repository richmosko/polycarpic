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

## Must be true before a prod box

1. The host key is verified out-of-band, or the box is rebuilt with a verified one, by a method that puts no private key where containers can read it (F1, C-71).
2. The public CAA answer equals the pinned set, and `dns-check.py` checks the public answer (F14).
3. The C-83 negative cases are refused on staging with the real gh, and that check also runs outside the box (F16).
4. The keyring commands are built, and prod's keyring is real, with distinct `key_id`s (F13, C-77).
5. `edge-2` runs healthy under edge.yml: Caddy issues its certificate into the 0700 directories, and its capability sets read 0. This is shown in PR 2.
6. The outside scans in PR 2 show exactly 22, 80 and 443 on IPv4, and 22 only on IPv6 (C-70, F7). There is an IPv6 decision for prod (OQ-INFRA-13).
7. Recovery for a lost release key is decided.
8. CI's floating gh in `build.yml` and `release-lookup.sh` is pinned or accepted with a reason. It decides nothing on the box, but release.yml's mirror check uses it.

## SECURITY doc edits (1.21.4)

- **§8 Signing.** The Principal signs release tags with a dedicated key that is never in an agent; no agent signs one.
- **C-90.** `app` and `staging` have A records only (no AAAA while IPv4-only). A "Not in force" line says the public CAA answer is wider than the pinned set.
- **C-70.** No file capability in our images. The image job's capability scan and the up-under-edge.yml test are listed under Tested by.
