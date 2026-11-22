---
kind: finding
from: seceng-97
to: architect-97, team-lead
issue: POLY-97 (2026-11-22 comment, items 1, 6, 7, 8; state as built)
date: 2026-11-22
---

# seceng positions for the POLY-97 gate-1 ruling

Sources read: POLY-97 issue file and comments; SECURITY C-70…C-79, TB-2, R-27; INFRA §2.2 secret table, §6.1, §6.5, §7.0–7.1, D-3, OQ-INFRA-4; `packages/auth/src/options.ts`, `packages/auth/src/session-handle.ts`, `apps/web/src/hooks.server.ts`, `packages/auth/src/options.test.ts`, `infra/caddy/Caddyfile`.
Provider claims cite the doc. Anything I could not check is marked **(unmeasured)**. I called no provider API. The only network reads were public DNS lookups (`dig`) of the Resend targets and of our apex.

---

## 1. Backup bucket key: `listBuckets, writeFiles`, restricted to one bucket

**Verdict: acceptable. Keep `listBuckets` only if the rclone measurement shows it is needed. `provision-check` asserts the key's capability set exactly. Two real attacks remain, poisoning a restore and denying backups, and each needs a control named below.**

### What `writeFiles` allows (Backblaze capability table)
`b2_upload_file`, `b2_start_large_file`, `b2_get_upload_url`, `b2_get_upload_part_url`, `b2_upload_part`, `b2_list_parts`, `b2_finish_large_file`, `b2_cancel_large_file`, `b2_hide_file`. It does not allow `b2_delete_file_version` (`deleteFiles`), `b2_update_file_retention` (`writeFileRetentions`), legal holds, bucket settings, `bypassGovernance`, or any read or list of files. Uploading with an explicit retention needs `writeFileRetentions`, so every upload made with this key gets the bucket default (35 days, compliance). Compliance mode cannot be shortened or removed by any key, the master key included (Backblaze Object Lock doc).

### What someone who breaks into the box and takes this key can do

| Action | Effect | Severity |
|---|---|---|
| **Upload under an existing name** | Adds a new version. The old one stays, locked for 35 days. **But a restore that takes "the latest version" gets the attacker's file.** The age *public* key is on the box, so the attacker can write a validly encrypted fake dump or WAL segment. `pg_restore` / replay runs whatever SQL the file holds, as the restoring role. | **High: a poisoned restore.** Needs a control (1a). |
| **Hide markers** (`b2_hide_file`; an S3 DeleteObject without a version id probably does the same **(unmeasured)**) | The file vanishes from normal listings and a restore by name. Data survives, because the locked version is kept. The lifecycle rule (delete 1 day after hiding) **cannot remove a version that is still locked**, so a hidden backup lives 35 days instead of about 37. | Medium: the restore finds nothing unless it reads by version. Needs a control (1a). |
| **Fill the bucket** (uploads, plus unfinished large-file parts, which also count toward storage) | **No card (today):** the account is capped at the 10 GB free tier, so real uploads start failing. The junk is locked in compliance mode for 35 days and **no one can delete it, us included.** That denies backups for 35 days or more. **With a card:** the attacker runs up locked-storage cost for 35 days, up to the storage cap, after which uploads fail as above. | **High (availability).** Recovery is a new bucket plus a new put-only key, made with the master key. Needs a control (1b). |
| `b2_cancel_large_file` | Cancels in-progress uploads, including our own. | Low: the next run retries. |
| `listBuckets` (restricted to one bucket) | Returns this bucket's metadata only: id, name, type, and the lock and lifecycle settings it can see **(unmeasured: which fields a restricted key sees)**. | Low: the name is already in the box's config. |
| Read, download, delete, change retention, change lifecycle or encryption | Not possible with this key. | — |

**What the key does not change:** an attacker on the box already has the live database. This key adds no confidentiality loss, because the bucket holds only age ciphertext. Its whole risk is to **integrity and availability of the backups.**

### Controls the ruling must carry
- **(1a) Restores pick by version, never by "latest name".** The restore and drill tooling (POLY-99, which this issue blocks) lists versions with the read key and picks the newest version uploaded *before* the suspected break-in. It alerts when a name has more than one version or any hide marker, because our uploader never writes the same name twice. That rule depends on spool file names being unique, with a timestamp and a WAL segment id; the architect should confirm it. A restore runs into a throwaway Postgres in a container, never into the production instance. Record this as a SECURITY C-73 addendum, which I will write after the ruling.
- **(1b) A loud upload failure.** The uploader must fail loudly when an upload is refused, and the alert must reach a person. Alert path B (Healthchecks) is deferred (item 8), so today a filled bucket fails **silently**. That is acceptable only while staging holds test data. Before real data: Healthchecks plus the B2 storage cap with a 75% alert (C-73, already a condition).
- **`listBuckets`: keep it only if measured necessary.** With `no_check_bucket = true`, rclone's S3 backend should not need it **(unmeasured; this is OQ-INFRA-4)**. devops measures an upload, and the uploader's verify step, with a key holding `writeFiles` only. If that works, drop `listBuckets`. If the verify step needs a HEAD or a list, change the verify step instead: HEAD needs `readFiles` and list needs `listFiles`, and **neither may be added to the box key.** Verify by the upload response's checksum, or let the off-box drill verify.

### What `provision-check` must assert about the box key
Use `b2_authorize_account` with the box key's own id and secret, read from the secret file, and **never print the secret**. Assert:
1. `allowed.capabilities`, as a set, **equals** `{writeFiles}` or `{listBuckets, writeFiles}`: whichever the ruling fixes after the measurement, and exactly that. Anything more or less fails.
2. `allowed.bucketId` and `allowed.bucketName` equal the configured bucket. A key that is not restricted to a bucket fails.
3. `allowed.namePrefix` is null, or equals the ruled prefix.
4. The bucket's lock configuration reads `enabled`, mode `compliance`, period 35 days. This needs `readBucketRetentions`, which the box key does not have, **so this assertion runs with the read key on the laptop** (the B2 operator tool, item 9), not on the box. The box-side check reports it as "checked off-box" and never as a pass.
5. Each FAIL line names its fix: "delete key X; create it with `infra/operator/b2…`".

The behaviour tests in C-73 (with the box key, delete, overwrite, shortening retention and changing the bucket default are each refused) stay in the drill. The capability assertion is the gate. The behaviour tests are the proof.

### What the read key (`polycarpic-read`, laptop only) may carry
Allowed: `listBuckets`, `listFiles`, `readFiles`, `readBucketRetentions`, `readFileRetentions`, `readFileLegalHolds`, `readBucketEncryption`, plus `readBucketLifecycleRules` if B2 offers it **(unmeasured: the exact name)**. It is restricted to the one bucket.
**Forbidden:** any `write*`, `deleteFiles`, `bypassGovernance`, `shareFiles`, `writeBucket*`, `listKeys`, `writeKeys`, `deleteKeys`. The B2 operator tool asserts that set when it creates the key, and the drill asserts it before each run. It holds only ciphertext, so its loss exposes nothing without the age private key. It still stays off the box.

---

## 2. DNS allowed set (item 6)

**Verdict: acceptable. The two Resend aliases under `mail.` do not open the attack R-27 describes today, because both targets have no A or AAAA record and so serve no web page. The residual is trust in Resend's (rmta.net) zone. Pin the full record set, add CAA, and keep R-27's domain rule with an explicit allowed list.**

### Cookie scoping, verified in code (not assumed)
- `__Host-poly_handle`: `packages/auth/src/session-handle.ts` builds it with `Path=/` and `ATTRS = 'HttpOnly; Secure; SameSite=Lax'`. **No `Domain=`.** `apps/web/.../sessions/+page.server.ts` deletes it with the path, secure, httpOnly and sameSite options, also with no `domain`.
- BetterAuth cookies: `packages/auth/src/options.ts`, `advanced`, sets `cookiePrefix: '__Secure-better-auth'`, `defaultCookieAttributes { secure, sameSite: lax, path: '/api/auth', httpOnly }`, and **no `domain`**. `crossSubDomainCookies` is unset, and `options.test.ts:77` asserts it stays off.
- So none of our cookies is sent to `*.mail.polycarpic.com`. **The risk runs the other way (R-27):** an HTTPS page on any sibling name can *set* `__Secure-better-auth.*` with `Domain=polycarpic.com; Path=/api/auth`, and `app` will receive it. `__Host-poly_handle` cannot be planted (the cookie-prefix rules in RFC 6265bis).

### Why the aliases are acceptable
- That plant needs a **page served over HTTPS** at the sibling name, which means an A or AAAA record and a certificate for `send.mail.polycarpic.com` or `rsend.mail.polycarpic.com`.
- Public DNS today (`dig`): `send.forge.rmta.net` and `rsend-euw1.forge.rmta.net` have **no A and no AAAA**, only MX and SPF TXT. They are bounce and return-path names, as the Resend Forge doc describes ("the Return-Path… receivers use to return bounces and to check SPF"). So the sibling serves nothing, and no CA can validate it over HTTP-01 or TLS-ALPN-01.
- TXT `resend._domainkey.mail` is data only, with no web risk.
- Apex `MX 0 .` and SPF `-all` publish no host.

### What is left (residual, to add to R-27 as written risk)
- **(a)** Whoever controls `rmta.net` (Resend, or anyone who takes that domain over if it ever lapses) can add an A record to a target at any time. They can then obtain a certificate for our sibling name and serve the R-27 plant. Our DNS check cannot see that, because the CNAME's *target* changes, not our record.
- **(b)** Resend may change the targets. Then the check fails, which is the correct result.
- **(c)** Mail-side reach: Resend can send DKIM-signed, DMARC-passing mail as `@mail.polycarpic.com`. That is inherent to using a mail provider and is not a cookie risk.

### Controls the ruling must carry
1. **Allowed set, default deny, pinned by (name, type, content):**

| Name | Type | Content pinned |
|---|---|---|
| `polycarpic.com` | TXT | exactly `v=spf1 -all` |
| `polycarpic.com` | MX | exactly `0 .` |
| `polycarpic.com` | CAA | the set in control 3 |
| `_dmarc.polycarpic.com` | TXT | exactly the string in §3 |
| `resend._domainkey.mail.polycarpic.com` | TXT | starts `p=`, with the value's hash pinned in config. A change fails and tells the operator to re-pin after a Resend key rotation. |
| `send.mail.polycarpic.com` | CNAME | exactly `send.forge.rmta.net` |
| `rsend.mail.polycarpic.com` | CNAME | exactly `rsend-euw1.forge.rmta.net` |
| `app.polycarpic.com` | A / AAAA | **equal to the server's current IPv4 and IPv6** |
| `staging.polycarpic.com` | A / AAAA | same as `app` |

   The check passes only on this set. It also fails on:
   - any other name;
   - any second record at an allowed name;
   - a wildcard;
   - any NS record below the apex (a delegated subzone is outside our control);
   - SRV, HTTPS, SVCB or URI records;
   - any record with Cloudflare `proxied: true`;
   - a target that differs.

   The app and staging IPs are pinned because a stale A record left after a Hetzner IP is released points our name at whoever is given that IP next. That is the same takeover as a stale alias.
2. **Target health (closes residual a, partly):** the same check resolves both CNAME targets in public DNS and **fails if either gains an A or AAAA record.** Today they have none. A failure means "stop and ask seceng", not "re-pin". This runs in the deploy gate and in the monthly window, like the rest of the DNS check.
3. **CAA at the apex:** `0 issue "letsencrypt.org"` and `0 issuewild ";"`. Once the box's ACME account exists, narrow `issue` with `accounturi=<the Caddy account URL>`. Then even an attacker who controls a target and adds an A record cannot get a certificate from Let's Encrypt for our sibling name. Mechanics: CAA lookup for `send.mail.polycarpic.com` follows the CNAME to `send.forge.rmta.net`, finds no CAA there (`dig` today: none, and none at `rmta.net`), then climbs our tree to the apex (RFC 8659 §3). If Resend ever publishes CAA on the target, theirs wins, so the target-health check (control 2) also fails on a CAA record appearing at a target.
   - **Caddy's default issuers are Let's Encrypt, with ZeroSSL as fallback.** `infra/caddy/Caddyfile` uses `tls {$POLY_TLS}`, and I could not see whether the Hetzner value pins the issuer **(unmeasured)**. The ruling must either pin Caddy to Let's Encrypt or add `0 issue "sectigo.com"` for ZeroSSL. If neither is done, a fallback issuance fails under CAA.
   - The home box's DNS-01 issuance (C-76, R-18) uses its own ACME account. When it arrives, its accounturi is added as a second `issue` line.
4. **CT monitoring (cheap, detects what controls 1–3 cannot):** subscribe `polycarpic.com` to a free certificate-transparency alert (for example Cert Spotter's free tier) **(unmeasured: current free-tier terms)**. Any certificate for a name other than `app` or `staging` is an incident. This is optional before staging and recommended before real data.
5. **The check's token** is read-only DNS for the one zone, as already stated. Separately: the Cloudflare token the DNS tooling (item 9) used to *write* the mail records must be deleted after use. The Porkbun API key (prompt not hidden, so possibly in terminal scrollback) must be deleted and API access turned off for the domain. The home box's DNS-01 token (C-76) can add a sibling name, so a break-in there defeats the domain rule until the next check run. R-18 already carries that; no change.
6. **Registrar:** registrar lock on and 2FA on at Porkbun and at Cloudflare. DNSSEC (Cloudflare sign, DS record at Porkbun) is **recommended, not gating.** It protects ACME validation and DMARC lookups from spoofing.

**R-27's domain rule is reworded** (the SECURITY edit is mine, after the ruling): "under the domain, only `app` and `staging` have address records. The only aliases are the mail provider's return-path names under `mail.`, pinned by target, whose targets must have no address record. No wildcard, no delegation." The guide wording in the issue (INFRA, devops) changes to match.

---

## 3. DMARC policy (item 7)

**Verdict: `p=reject` is confirmed. Add strict DKIM alignment and an aggregate-report address. Never add `ruf`. The null-MX and `-all` apex alongside the `mail.` sending subdomain is correct.**

Recommended record, exactly:
```
_dmarc.polycarpic.com  TXT  "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=r; rua=mailto:<rua address>"
```
- **`sp=reject`, stated explicitly.** It already defaults to `p`, but stating it lets the DNS check pin it and guards against someone later relaxing only `p`. `mail.polycarpic.com` has no `_dmarc` of its own, so receivers fall back to the organizational domain's record. That is RFC 7489 §6.6.3; DMARCbis's tree-walk gives the same result here **(unmeasured: DMARCbis RFC status)**.
- **`adkim=s`.** Resend signs with `d=mail.polycarpic.com` **(unmeasured: confirm from a test mail's DKIM-Signature header)**, and From is `@mail.polycarpic.com`, so strict alignment passes. Strict means that a DKIM key someone adds later under another subdomain cannot pass DMARC for `mail.`.
- **`aspf=r` must stay relaxed.** The return-path is `send.mail.polycarpic.com`, which aligns with From `mail.polycarpic.com` only under relaxed alignment. DKIM alone would carry DMARC anyway.
- **`MAIL_FROM` must be `<local>@mail.polycarpic.com`.** A From at the apex would fail DMARC and be rejected, which is correct, because the apex sends nothing. The deploy gate's test mail asserts that the received headers show `dkim=pass header.d=mail.polycarpic.com` and `dmarc=pass`.
- **`rua`:** recommended, not gating. Use Cloudflare's free DMARC Management, which writes a `rua=` address at `dmarc-reports.cloudflare.net`. Cloudflare already holds the zone, so this adds **no new trusted party** **(unmeasured: the exact address and whether it needs the external-destination authorization record; Cloudflare's dashboard sets it)**. Without `rua` we are blind both to spoofing and to our own alignment failures.
- **Never add `ruf`.** Forensic reports can carry the failed message's content, which includes sign-in, invite and recovery links. That would send account-takeover material to a third party.
- **`pct`** is left out, which means 100. `fo` is left out because it only affects `ruf`.

---

## 4. "State as built" items

| Item | Position |
|---|---|
| **No password manager (C-78 assumes one)** | **Fix before real data; it gates.** The macOS Passwords app (iCloud Keychain, end-to-end encrypted) is acceptable if the Apple account has 2FA and a strong device passcode. Turning on Advanced Data Protection is recommended. It must hold: the B2, Cloudflare, Porkbun, Resend, Hetzner and GitHub logins and their 2FA recovery codes; the B2 read key; the SSH key passphrase; and, at the home box, the LUKS recovery passphrase and the root and bootloader passwords. **Now:** find where the `polycarpic-put-only` and `polycarpic-read` secrets currently sit (terminal scrollback, a file, shell history). Move them into Passwords and wipe the other copies. The put-only secret is needed once, at `set-secret`. Do **not** store the B2 master key: it can be regenerated from the web console behind 2FA, and the tooling should say so. |
| **Hetzner Read & Write token in the `hcloud` context** (plaintext in `~/.config/hcloud/cli.toml` **(unmeasured: path on this hcloud version)**) | Acceptable **only while the project is empty**. After `create.sh`, the token can snapshot the server and its volume. The volume's LUKS key is a file on the root disk (C-72), so a snapshot of both disks is the whole database. The runbook step right after `create.sh`: delete the token in the Hetzner console **and** run `hcloud context delete polycarpic`. `provision-check`, or the operator tool, fails if the local context still exists. Next time, create a token per run. |
| **Healthchecks.io deferred** | Acceptable with staging test data. **This is what makes the bucket-fill attack (1b) silent**, so it gates real data, as DECISIONS already says. The "not configured" state (item 8) prints a WARN line on every `status` and every check run, never a pass. The deploy gate for real data turns that WARN into a FAIL. |
| **Backblaze caps deferred, no card** | Acceptable for test data. Without a card the 10 GB free tier is in effect a hard cap, so cost cannot grow, but backups can be denied (1b). With a card, the cap and the 75% alert are required (C-73), with downloads left uncapped so a restore is never blocked. |
| **Resend keys made at `set-secret` time** | Agreed. Each key is sending-only and restricted to the `mail.polycarpic.com` domain, if Resend offers that restriction **(unmeasured)**. Four keys, never written outside the box. |
| **The SSH key has a passphrase; the age private key is off the laptop** | Fine. |

---

## Follow-ups for the lead to file (named, not filed)
- **F-A (POLY-99):** restores and drills pick the version, alert on more than one version or on hide markers, and restore only into a throwaway Postgres (1a).
- **F-B (seceng, after the ruling):** SECURITY edits: C-73 key-capability assertion and restore-by-version; R-27 rewording and residual (a); the DMARC record; CAA and the CNAME target-health check as a new control.
- **F-C (devops, POLY-97 or POLY-104):** the CAA record and Caddy's issuer pin, then the accounturi after first issuance.
- **F-D (Principal):** move credentials into Passwords, clean up wherever the B2 key secrets landed, and delete the Porkbun API key and the write-capable Cloudflare token.

Sources: [Backblaze key capabilities](https://www.backblaze.com/docs/cloud-storage-application-key-capabilities), [Backblaze Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock), [Backblaze: Digging Deeper Into Object Lock](https://www.backblaze.com/blog/digging-deeper-into-object-lock/), [Resend Forge](https://resend.com/docs/resend-forge), [Resend Enable Forge API](https://resend.com/docs/api-reference/domains/enable-forge), RFC 8659 (CAA), RFC 7489 (DMARC), RFC 6265bis (cookie prefixes).
