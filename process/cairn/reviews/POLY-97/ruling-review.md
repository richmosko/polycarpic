# POLY-97 ruling review (seceng)

seceng-97, 2026-11-22. Reviewed: `process/cairn/reviews/POLY-97/ruling.md` at **`d7dd2d1a`**, the ruling re-issued
whole. Each position was checked against `seceng-positions.md`, which sits beside the ruling. I also read the tree:
- `packages/auth/src/options.ts` and `packages/auth/src/session-handle.ts`: no cookie sets `Domain=`.
- `infra/postgres/**` and `infra/compose/**`: nothing sets `shared_preload_libraries`.

No provider API was called.

**Verdict: CHANGES.** Four additions remain (S4, S6, S7, S8). They are small and need one addendum, not a re-issue. Everything else in my positions is carried.

## Positions: carried, changed, missing

| Position | Status at d7dd2d1a | Where |
|---|---|---|
| Box key capability set asserted exactly | Carried | H12, `b2-capabilities.json` |
| Box key restricted to the bucket, with no name prefix | Carried | H12 |
| `listBuckets` only if measured | Carried: E9 `--probe` sets the constant | §R6 constant, E9 |
| Never widen the box key to `listFiles` or `readFiles`; change the verify step instead | Carried | §R6 constant, POLY-99 scope row |
| Bucket lock checked off-box, never reported as a box pass | Carried | `INFO H12b`, R4 |
| Read-key set, and the capabilities it must never hold | Carried, including `readFileRetentions` | R8 step 3 |
| B2 `authorizationToken` never printed or logged | **Missing** | **S4** |
| 1a: restores pick by version, alert on more than one version or a hide marker, restore into a throwaway database only, spool names unique | Carried | Scope row, POLY-99 |
| 1b: the heartbeat's absence is reported, and gates real data | Carried: WARN, never `ALL CHECKS PASSED`, FAIL under `--prod` | R4, H13 |
| 1b: the uploader exits non-zero on a refused upload | **Missing** | **S6** |
| DNS allowed set: deny by default, pinned by value, delegations and proxied records fail | Carried | R9 |
| `app` / `staging` pinned to the server's addresses | Carried | R9 |
| DKIM pinned, with a re-pin path | Carried (by hash) | R9 |
| DMARC string, `rua` through Cloudflare, never `ruf` | Carried | R9, §D3 |
| CAA at the apex | **Changed, accepted**: only Let's Encrypt, no `sectigo.com`. A ZeroSSL fallback fails loudly until POLY-104 pins Caddy's issuer. That is stricter than my position. | R9, scope row |
| CNAME target health (A, AAAA or CAA at a target) | Carried | R9 target health |
| Hetzner token and context removed in the same sitting, and checked | Carried (R1's last lines, `laptop-check.py`, E8) | R1, R8, E8 |
| B2 master key never stored | Carried | R8 step 5 |
| CT alert and DNSSEC | Carried: the Principal sets them up before real data, recommended, not gating | Scope row |
| Password manager gates real data | Carried as a SECURITY C-78 edit (mine). The lead adds it to the DECISIONS conditions. | R11 |
| `MAIL_FROM` under `mail.<d>` | Carried | R5, H10 |

## Required changes (addendum)

- **S4. Never print the B2 `authorizationToken`.** The `b2_authorize_account` response carries an `authorizationToken`, a working bucket credential for 24 hours.
  - H12 parses that response in memory only. It never prints, logs or writes it, including on a FAIL or an HTTP-error path. The same holds for every response `b2-setup.py` and `dns-*.py` receive.
  - R10's sweep adds a fixture `authorizationToken`, and a fixture Cloudflare response token, to the values that must not appear anywhere.
- **S6. The uploader fails loudly (POLY-99 scope row, one clause).** On any refused upload the uploader exits non-zero and does not ping the heartbeat. Without this clause, a full bucket can still look healthy once path B exists. That would defeat the reason for H13's real-data gate.
- **S7. New check H15: login and sudo surface.** These are the conditions of my concurrence on §D4. Each gets a planted-fault case.
  - `sshd -T` shows `allowusers polyops`. R2's drop-in sets it.
  - The cloud-init sudoers drop-in is exactly `polyops ALL=(ALL) NOPASSWD:ALL`, root 0440, with nothing more.
  - No other sudoers file grants anything beyond Ubuntu's defaults.
  - No account other than root and `polyops` has both a login shell and an `authorized_keys`.
- **S8. D1 closes the other ways the password-setting statement could reach a log.** D1 also asserts:
  - `shared_preload_libraries` is empty. If `pg_stat_statements` or `auto_explain` is loaded, it keeps the text of statements like `ALTER ROLE` whatever `log_statement` says (unmeasured on Postgres 17).
  - `log_min_duration_statement = -1`.

  R5's two `SET`s stay as they are.

## §D4: password-free sudo for `polyops`

**Concur, on the condition that S7 lands.**
- **Not stopped by a sudo password:** whoever holds the laptop's unlocked session. They can use the loaded key, and they can capture any password typed next. This is the likelier attacker, so the ruling's reasoning holds.
- **Stopped by a sudo password:** someone with the key file and its passphrase but not the session. That person already has the passphrase, which is the same keylogger case. Also code running as `polyops` on the box, and none exists: containers run as their own uids, and `polyops` is not in `docker`.
- What actually limits the exposure is how long the key stays usable in the session (advisory A2).

Record the decision as an accepted risk, with the Principal as approver. I add it to SECURITY Open Risks after the verdict.

## R5's measured points

- **SCRAM verifier computed on the host, logging off for that session: concur.**
  - M2 shows that both `SET`s are needed, and qa's red list covers the failing-ALTER case.
  - A 32-byte random secret's verifier cannot be brute-forced, so the `SET`s are defence in depth.
  - The statement goes in on stdin, never argv, so it reaches neither shell history nor `ps`.
  - S8 closes the two log paths that M2 did not cover.
- **No chmod on spool writers: concur.**
  - M1 shows that the default ACL survives `umask 077`, and that `chmod 0600` sets the mask to `---`.
  - H7's effective-`r` check, with qa's planted chmod-0600 case, is the guard.
  - Accepted: the uploader's `rwx` on the spool lets a compromised uploader delete files it has not yet uploaded. It already holds the put key, so this gives it no new reach beyond losing those files.

## Advisory (not gating)

- **A2. On the laptop.** Load the SSH key with a lifetime (`ssh-add -t 1h`), not `UseKeychain yes`. Keep FileVault and the screen lock on.
- **A3. Metadata service.** Containers can reach Hetzner's metadata service at 169.254.169.254. User-data holds no secret (R2). If a later issue ever puts one there, add a `DOCKER-USER` drop for that address.
- **A4. How R9 compares values.** Case-insensitive comparison is right for names and CNAME targets only.
  - The DMARC value and the DKIM hash input compare exactly, after the 255-byte TXT strings are joined.
  - The DKIM "normalised value" must not lowercase base64.
- **A5. Registrar.** Once `dns-move-to-cloudflare.py` has run, delete the Porkbun API key and turn off API access for the domain. Turn on registrar lock and 2FA at Porkbun and at Cloudflare.
- **A6. Two small points.**
  - `dns-records.py` refuses to write a `_dmarc` value containing `ruf=`. The exact pin already makes the check fail on one.
  - POLY-99's version and hide-marker alert ignores E9's `probe/` objects.

## Addendum 1 at f7730d73

**PASS.** Ruling `f7730d73` = `d7dd2d1a` plus §Addendum 1. The diff `d7dd2d1a..f7730d73` touches only `ruling.md`
(12 added lines, the addendum) and this review file; nothing else in the ruling changed.

| Item | Met by |
|---|---|
| S4 (authorizationToken never printed; sweep fixture) | Addendum S4(b,c), with S4(a) already in H12 |
| S6 (uploader fails loud) | Addendum S6(d) → POLY-99 |
| S7 (H15) | Addendum S7, H15, plus `AllowUsers polyops` set by R2's drop-in |
| S8 (D1 log paths) | Addendum S8 |
| S1, A4 | Addendum: DMARC pinned without `rua` until Cloudflare DMARC Management is on (re-pin PR), `ruf=` fails regardless; TXT compared exactly |

**CAA, the answer on record: the addendum's three rows stand.** `issue "letsencrypt.org"`, `issue "sectigo.com"`
(confirm the ZeroSSL identifier from its docs), `issuewild ";"`. POLY-104 pins Caddy to one issuer, drops the other
row and adds `accounturi=`. The two-issuer window until then matches Caddy's default and costs no certificate outage; a second CA, CAA-bound, is a smaller risk than a failed issuance. This supersedes the
"Let's Encrypt only, accepted" row above.

§D4 concur stands on H15 as written.

## Addendum 2 at 512d9c50: CHANGES (two conditions, one line each)

The diff `f7730d73..512d9c50` adds only §Addendum 2 to the ruling. I read nothing beyond it.

**D3 probe, using the real `db_password_backup`.** It does not leak the password through argv, the Postgres log or libpq stderr, provided condition P1 below is met.
- **argv:** the `docker run` line carries a namespace and a mount path, never the secret.
- **Postgres log:** the web case is refused at `pg_hba`, before any authentication exchange. Under SCRAM the password never crosses the wire, only a proof of it. `log_connections` records host, user and the `pg_hba` reason, never a password.
- **libpq stderr:** the asserted refusal text carries no password.

Two leak paths remain open, and P1 closes them:

- **P1. Build the passfile inside the probe container.** libpq cannot use the raw secret file as a `.pgpass`, so the probe must build one. It does this inside the probe container on a `--tmpfs` mount, mode 0600, from the read-only secret mount. It never writes it on the host disk, never sets `PGPASSWORD` (`docker inspect` shows the environment), and never puts it in a `-e` flag.
- **P1, continued.** The probe's connection string sets `require_auth=scram-sha-256` (libpq 16 or later). Then a misconfigured `pg_hba` line asking for `password` or `md5` makes the probe refuse, instead of sending the secret.
- **P1, test.** R10's sweep covers the probe's stdout, stderr and the fakes' call log, with a fixture backup password.

**D5 on staging: PASS.** A LOGIN role with no password always fails password authentication. A verifier present there is a FAIL, which is correct.
- Advisory: if `roles.sql` can take a per-project flag later, make staging's `poly_backup` NOLOGIN. That is stronger than having no verifier.

**cloud-init key check: one gap.**
- **P2. The key's comment field can still inject YAML.** The regex `^ssh-ed25519 [A-Za-z0-9+/]+=* [^\n]*$` lets that field hold `"`, `'`, `,`, `]`, `:` or `#`. If the placeholder sits inside a quoted or flow-style YAML value, a comment such as `x", "ssh-ed25519 AAAA…other` adds a second authorized key. Also, `[^\n]` inside a bash or ERE bracket is not "no newline"; it is literally "not a backslash and not an n".
  - Fix: substitute only the first two fields (`ssh-ed25519 <base64>`) and drop the comment. Or restrict the comment to `[A-Za-z0-9@._-]*`.
  - Test: a planted quote in the comment and a planted second key are each refused with exit 2.

PASS once P1 and P2 are in the ruling. Nothing else needs a condition.

## Addendum 3 at 1eafa6c5: PASS

The diff `80c1bd6e..1eafa6c5` adds only §Addendum 3 to the ruling, five lines.
- **P1 is met.** The pgpass is written on a tmpfs inside the probe, mode 0600. It is never on the host and never in the environment or argv. Every connection string carries `require_auth=scram-sha-256`, and the sweep covers the probe's output and the fake's call log.
- **P2 is met.** Only `ssh-ed25519 <base64>` is substituted, from a character class that cannot hold any YAML syntax. The comment is dropped, a second non-empty line exits 2, and a comment with a quote or colon is a test.

The ruling at `1eafa6c5` passes the security review, Addenda 1–3 included.
