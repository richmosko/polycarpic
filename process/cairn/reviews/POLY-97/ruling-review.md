# POLY-97 ruling review (seceng)

seceng-97, 2026-11-22. Reviewed: `process/cairn/reviews/POLY-97/ruling.md` at `3381b155`. Compared against
the seceng positions (lead holds them, `temp/2026-11-22-seceng-97-positions.md` in the seceng-97 worktree).
Checked in the tree: `packages/auth/src/options.ts`, `packages/auth/src/session-handle.ts` (no cookie sets `Domain=`),
`infra/postgres/**` and `infra/compose/**` (no `shared_preload_libraries` set). No provider API was called.

**Verdict: CHANGES.** All eight changes are additive and fit in one addendum. None reopens the ruling's structure.

## Positions: carried, changed, missing

| Position | Status | Where |
|---|---|---|
| Box key capability set asserted exactly | Carried | H12, R8 step 4 |
| Box key bucket-restricted | Partly carried: bucketName only | H12, see **S4** |
| Never print the B2 auth token returned by `b2_authorize_account` | Missing | **S4** |
| `listBuckets` only if measured; never widen to `readFiles` / `listFiles` | Changed: the ruling pre-approves widening "with seceng's review" | §R6 last paragraph, **S5** |
| Read key: read and list only | Carried (`{listBuckets, listFiles, readFiles, readBucketRetentions}`) | R8 step 3. Advisory A1 |
| 1a Restore by version; alert on more than one version or any hide marker; throwaway restore target | Missing | **S6** |
| 1b Loud upload failure; heartbeat absence reported | Carried for the heartbeat (H13, NOT CONFIGURED, `--prod` turns it into FAIL). The uploader's refusal handling is POLY-99's | **S6** |
| DNS allowed set, default deny, pinned by value; delegation, proxied and wildcard fail | Carried | R9 |
| `app` / `staging` pinned to the server's addresses | Carried | R9 |
| DMARC string | Missing: pinned to `v=DMARC1; p=reject` pending this review | **S1** |
| CAA at the apex | Missing; R9 as written would FAIL a CAA record | **S2** |
| Caddy issuer pin, then `accounturi` | Missing. Caddyfile is outside this issue's paths | **S2** (moves to POLY-104) |
| CNAME target health (a target gaining A, AAAA or CAA) | Missing | **S3** |
| Hetzner token and `hcloud` context deleted after the run | Carried | R12 E8 |
| Porkbun key prompt hidden; DNS edit token deleted after use | Carried | R8 |
| `MAIL_FROM` under `mail.<d>` | Carried | R5, H10 |
| Password manager before real data | Not a ruling item. The lead carries it into the DECISIONS conditions; seceng writes C-78 | R11 |

## Required changes

- **S1. DMARC pin.** In R9 the `_dmarc` value becomes exactly
  `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=r`.
  - `dns-records.py` writes that value, replacing the record now published.
  - A `rua=` address (Cloudflare DMARC Management) is the Principal's later option. Adding it is a re-pin by PR.
  - No `ruf=` ever: forensic reports can carry sign-in links. `dns-check.py` fails on any `ruf=`, even after a re-pin.
  - The POLY-104 test mail asserts `dkim=pass header.d=mail.<d>` and `dmarc=pass`.
- **S2. CAA.** Add rows to R9, written by `dns-records.py` and pinned like the rest:
  - `@ CAA 0 issue "letsencrypt.org"`
  - `@ CAA 0 issue "sectigo.com"`. This covers Caddy's ZeroSSL fallback, which uses the identifier `sectigo.com` (unmeasured; devops confirms it from ZeroSSL's docs).
  - `@ CAA 0 issuewild ";"`

  Why: a CAA lookup for `send.mail.<d>` follows the CNAME to Resend, finds no CAA there (public DNS today), and then climbs our tree to the apex (RFC 8659 §3). So these rows bound who can issue a certificate for the alias names. Pinning Caddy to one issuer and adding `accounturi=` goes to POLY-104, at the first issuance, because the Caddyfile is not in this issue's paths.
- **S3. CNAME target health.** `dns-check.py` resolves `send.forge.rmta.net` and `rsend-euw1.forge.rmta.net` through DNS-over-HTTPS JSON. That fits stdlib only and the injected transport. It prints FAIL when a target has any A, AAAA or CAA record, with the reason `outside target now serves an address; stop and ask seceng` and no re-pin hint. Today neither target has any of the three.

  Why: an address record behind a target lets its owner obtain a certificate for our sibling name and plant the R-27 cookie, and our own records would not change. The dry run plants an A and a CAA in fixtures and asserts each FAIL line.
- **S4. H12 completeness.**
  - (a) H12 also asserts that `allowed.bucketId` is non-null and that `allowed.namePrefix` is null.
  - (b) The `b2_authorize_account` response carries an `authorizationToken`, a working credential for 24 hours. H12 parses the response in memory and never prints, logs or writes it, including on a FAIL or an HTTP error path.
  - (c) R10's secret sweep adds a fixture `authorizationToken` to its list. The same applies to every operator tool that authorizes: `b2-setup.py` and `dns-*.py` responses.
- **S5. No pre-approved widening.** Replace §R6's last paragraph with this rule:
  - POLY-99 may **narrow** the constant to `{writeFiles}` if rclone works without `listBuckets`.
  - `readFiles`, `listFiles` and every capability that deletes, hides, or changes retention, lifecycle, encryption or keys are never added to the box key.
  - If the verify step needs a HEAD or a list, the verify step changes: check the upload response's checksum, or leave verification to the off-box drill. The key does not change.

  Why: `listFiles` lets an attacker on the box find and target files for hide markers, and `readFiles` takes the ciphertext off-site, where it is only one leaked age key from plaintext.
- **S6. POLY-99 obligations in the Scope table.** These are named here so they are not lost. The lead adds them to POLY-99:
  - (a) A restore and the drill choose an object *version* by upload time. They do not take the latest name.
  - (b) Both alert when one name has more than one version, or any hide marker. This relies on the uploader never reusing a name, so spool file names must be unique.
  - (c) A restore runs only into a throwaway Postgres, never the live instance.
  - (d) The uploader exits non-zero, and so trips the heartbeat, on any refused upload.

  Why: the box holds the age public key, so an attacker can upload a validly encrypted fake dump under an existing name. A restore that takes the latest version runs their SQL.
- **S7. H15, login and sudo surface** (the conditions of the §D4 concurrence):
  - `sshd -T` shows `allowusers polyops`.
  - The cloud-init sudoers drop-in is exactly one line, `polyops ALL=(ALL) NOPASSWD:ALL`, mode 0440.
  - No other sudoers file grants anything beyond the Ubuntu defaults.
  - No account other than root and `polyops` has a login shell and an `authorized_keys`.

  Each has a planted-fault case.
- **S8. D1 covers the other paths the ALTER statement could take into a log.** D1 also asserts:
  - `shared_preload_libraries` is empty. Nothing sets it today. `pg_stat_statements` and `auto_explain`, if loaded, keep utility statement text whatever `log_statement` says (unmeasured on 17).
  - `log_min_duration_statement = -1`.

  R5's database stage keeps its two `SET`s.

## §D4: password-free sudo for `polyops`

**Concur, on the conditions in S7.** Who is stopped and who is not:

- **Not stopped by a sudo password:** malware or a person holding the laptop's unlocked session. They can run `ssh` with the loaded key and capture whatever password is typed next. This is the likelier attacker, and the ruling's reading is right.
- **Stopped by a sudo password:** someone who has the key file and its passphrase but not the session, and code running as `polyops` on the box. The first group must already have the passphrase, which is the same keylogger case. The second does not exist, because `polyops` runs nothing (containers run as their own uids, and `polyops` is not in `docker`).
- **The real lever is the key's exposure in the session.** Advisory A2 covers it.

Record this as an accepted risk with the Principal as approver. seceng writes it in SECURITY Open Risks after the verdict.

## R5's measured points

- **SCRAM verifier computed on the host, logging off for the session: concur.**
  - M2 shows both `SET`s are needed, and the failing-ALTER case is covered in qa's red list.
  - The verifier of a 32-byte random secret cannot be brute-forced, so the two `SET`s are defence in depth, not the only control.
  - Stdin, not argv: no shell history and no `ps` exposure.
  - S8 closes the two log paths M2 did not cover.
- **No chmod on spool writers: concur.**
  - M1 is the right measurement: the default ACL survives `umask 077`, and an explicit `chmod 0600` sets the mask to `---`.
  - H7's effective-`r` assertion on every `.age` file is the guard, and qa's chmod-0600 planted case proves it trips.
  - Accepted consequence: the uploader's `rwx` on the spool directories lets a compromised uploader delete or alter files not yet uploaded. It already holds the put key, so this adds no new reach beyond losing those files.

## Advisory (not gating)

- **A1.** The read key adds `readFileRetentions`, so the drill can assert that each restored version is still under compliance lock.
- **A2.** On the laptop:
  - Load the SSH key with a lifetime (`ssh-add -t 1h`) rather than `UseKeychain yes`, so an unlocked session does not mean root on the box indefinitely.
  - Keep FileVault and the screen lock on.
- **A3.** The Hetzner metadata service (169.254.169.254) is reachable from containers. Today user-data holds no secret (R2). If a later issue puts anything sensitive there, add a `DOCKER-USER` drop for that address.
- **A4.** R9 compares values case-insensitively. Keep that for names and CNAME targets only. TXT values (DKIM base64, DMARC) compare exactly, after joining 255-byte strings.
- **A5.** After `dns-move-to-cloudflare.py`, delete the Porkbun API key and turn off API access for the domain. Turn on registrar lock and 2FA at Porkbun and at Cloudflare. DNSSEC is recommended.
