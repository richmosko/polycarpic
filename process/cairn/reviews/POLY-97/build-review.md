# POLY-97 build security review (seceng)

seceng-97, 2026-11-22. Build reviewed at **`ea78daae`**, against the ruling `1eafa6c5` (Addenda 1–3) and the review
conditions in `ruling-review.md`. I read the code itself:
- `infra/hetzner/{create.sh,cloud-init.yaml}`
- `infra/provision.sh`, `infra/provision-check.sh`
- `infra/operator/*`
- the matching tests where a condition depends on them, and qa's harness-fix table in `red-run.md`

I ran no containers and made no provider calls.

**Verdict: CHANGES.** Two code changes (B1, B2) and one runbook condition (call b). Every other condition is met in the code.

## Conditions checked in the code

| Condition | Result | Evidence |
|---|---|---|
| R1 firewall attached at creation, exactly 22/80/443, drift reset | Met | `create.sh`: `hcloud server create … --firewall "$name"`. Rules come from the heredoc, three inbound TCP rules on both address families. A normalised comparison triggers `replace-rules` on any difference. An existing server without the firewall gets `apply-to-resource`. |
| P2 key comment dropped | Met | `create.sh`: the regex `^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( .*)?$`, a second non-empty line refused, then `cut -d' ' -f1,2`. The `sed s|…|$key|` substitution is safe because the base64 class holds no `|`, `&` or `\`. |
| No luksFormat on an existing LUKS volume | Met | `provision.sh` `volume_state`: `cryptsetup isLuks` gives `luks`, which is opened only. `wipefs --no-act` or `blkid` signatures give `foreign`, which exits 1 before any write. `luksFormat` runs only in the `empty` branch. The key file is created only in that branch, so a LUKS volume without its key fails at `open` rather than being reformatted. |
| R10 / R5 verifier path | Met | `emit_alters`: Python stdlib PBKDF2 / HMAC, 4096 iterations, 16-byte random salt. Verifiers go on stdin after the two `SET`s. psql's stdout is discarded. Its stderr goes to a `/dev/shm` file, which is redacted (`SCRAM-SHA-256$…` → `[verifier]`) and removed. No secret appears in argv or the environment. |
| S4 / H12 B2 `authorizationToken` | Met | `provision-check.sh` H12: the credential reaches `curl --config -` through the `printf` builtin, never argv. curl's stderr goes to `/dev/null`. The response stays in a variable that is unset after parsing. No path prints it, the FAIL texts included. `b2-setup.py` keeps the token in `hdr`, and `ApiError` carries only Backblaze's code and message. |
| H12 assertion | Met | The exact capability set comes from `b2-capabilities.json`. `bucketId` and `bucketName` must both be set and equal the configured bucket. `namePrefix` must be empty. The FAIL text names the extra or missing capability, and `INFO H12b` is not counted as a pass. |
| P1 / D3 probe | Met | `d3_probe`: the secret is mounted read-only, the probe runs as `--user 10004:10004`, and the pgpass is written on `--tmpfs /pgpass` under `umask 077`. The password stays inside the container: the `printf` is a builtin of the image's shell. `require_auth=scram-sha-256` is set on every connection. Refusal reasons are asserted per service. `provision-db.test.ts:182–183` pins `--tmpfs` and `require_auth`. |
| S7 / H15 | Met | `allowusers` must be exactly `polyops`. Exactly one sudoers drop-in with the one line, `440 0`. Any other non-empty sudoers file fails, `/etc/sudoers` is limited to Ubuntu's default lines, and no other account may have both a login shell and an `authorized_keys`. cloud-init writes `AllowUsers polyops` and the 0440 drop-in. |
| S8 / D1 | Met | `shared_preload_libraries=` (empty) and `log_min_duration_statement=-1` are in D1's set. |
| R9 / S1 / S3 / A4 DNS | Met | `dns-check.py`: the listing is paged and fails closed. Wildcard, proxied and delegation records fail. Pins are by value; DKIM is pinned by SHA-256 over the joined TXT; CAA is compared exactly. `ruf=` always fails. Target health reads A, AAAA and CAA over DoH, and a transport failure is a FAIL, never a pass. The token is deleted after listing. |
| R8 laptop-check | Met | Any hcloud context, `HCLOUD_TOKEN`, or a `token =` line in either config path fails. The token is never printed. |
| R4 WARN contract | Met | `warn()` becomes a FAIL under `--prod`, or when `pg-prod/PG_VERSION` exists. `ALL CHECKS PASSED` never appears together with a WARN. |

## Required changes

- **B1. `b2-setup.py --probe` measures the wrong backend.**
  - **What is wrong:** `run_probe` configures rclone with `RCLONE_CONFIG_PROBE_TYPE=b2`, which is rclone's native B2 backend. The uploader uses the **S3** backend (INFRA §6.1: `type = s3`, `provider = Other`, endpoint `s3.<region>.backblazeb2.com`, `no_check_bucket = true`). The native backend resolves the bucket by name through `b2_list_buckets` (unmeasured), so E9 can report "keep `listBuckets`" for a path the uploader never takes. `RCLONE_B2_NO_CHECK_BUCKET` is not an option of the S3 backend.
  - **Fix:** probe through the S3 backend, set from the environment exactly as the uploader is: `TYPE=s3`, `PROVIDER=Other`, `ENDPOINT` (from the authorize response's `s3ApiUrl`), `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `NO_CHECK_BUCKET=true`. Also use the uploader's upload flags, once POLY-99 fixes them.
  - **Test:** asserts the child's `TYPE` is `s3` and that `NO_CHECK_BUCKET` is set.
- **B2. A Backblaze key not restricted to any bucket (builder call a): FAIL, not WARN, when it can write.**
  - **Why:** a key with no bucket restriction reaches this bucket just as the web form's "Write Only" key did in finding 1. With `writeBucketRetentions`, `deleteFiles`, `bypassGovernance`, `writeFiles` or `writeKeys` it can unlock new backups, delete versions that are no longer locked, plant files, or mint keys. That is the attack this loop exists to close.
  - **Rule:**
    - A key with no bucket restriction holding any capability outside the read set (`READ_CAPS` plus `listAllBucketNames`) prints `FAIL <name> is not restricted to a bucket and can write to <bucket>: restrict it to another bucket or delete it`.
    - A key with no bucket restriction that holds only read capabilities stays a WARN. It can read ciphertext only.
    - A key restricted to *another* bucket passes silently.
  - **The test that "requires" the WARN:** `test_a_key_for_another_bucket_is_not_a_failure` models "another bucket" as `bucket=False`, which means *no restriction at all*. It should restrict the fixture to a different bucket id (rc 0). Add two cases:
    - a key with no bucket restriction holding `writeFiles` fails, naming the key;
    - one holding only `listBuckets, readFiles` gives the WARN with rc 0.

## Builder call (b): a staging-only box ends with exit 3 and WAIT lines for prod

**Accepted.** The failure mode is the safe one: WAIT never prints a pass, exit 3 is non-zero, and any FAIL still takes precedence.

**Condition (devops, INFRA §7.1 step 11):** the runbook lists the WAIT ids expected on a staging-only box, in exactly this form:
- H12, while no uploader credential exists;
- D3, which is prod only;
- the `prod` part of D1, D2, D4, D5 and D6.

It also says that any other WAIT, or a WAIT naming `staging`, is a finding. Otherwise the operator learns to accept exit 3 and stops reading what is waiting.

## qa's harness fixes: do the log sweeps still prove M2?

**Yes.**
- The success case keeps its control: DDL logging is live, because the `roles.sql` statements appear in the log. Its sweep is unchanged.
- Gap 4 (the failing ALTER) still sends the real verifier into Postgres. The fake psql inserts one word, so Postgres rejects the statement in the parser ("unrecognized role option"). The control asserts that error is in the log, so the error-statement path really ran.
- With the default `log_min_error_statement = error`, Postgres would also write the `STATEMENT:` line, which contains the verifier. M2 case C measured exactly that at the ruling. So the sweep's `not.toMatch(/SCRAM-SHA-256\$/)` proves case D, the `panic` setting.
- Gap 7 makes the secret sweep stricter (one value per file). Gap 8 compares CAA exactly. Neither weakens an assertion.

## Advisory (not gating)

- **A-M2. Self-contained proof for the M2 sweep.** Add one mutation case: the same broken ALTER with the two `SET`s stripped, asserting the verifier *does* reach the log. Then the sweep proves its own power on every run instead of relying on the ruling-time M2 measurement.
- **A-probe1. Temporary key in the child's environment.** The probe hands its temporary key to rclone through the child's environment. That departs from R8's rule of no credentials in the environment, and I accept it: the key is writeFiles-only, deleted in `finally` within seconds, and the environment is visible only to the same user.
- **A-probe2. Master-key regeneration in `--probe` mode.** `--probe` tells the operator to regenerate the master key but does not check the old one gets 401. Run the same 401 check there too.
- **A-fw. A second firewall on the server.** Hetzner applies the union of every firewall attached to a server. `create.sh` reconciles its own firewall but would not notice a second one. E4's outside-in scan would catch the result. Adding a check that `server describe`'s `public_net.firewalls` lists only ours closes it at the source.

## gitleaks entry

`df6ed743…:tests/infra/image/provision-create.test.ts:generic-api-key:31` was read at that commit. The line is
`HCLOUD_TOKEN=tok-FIXTURE-1234`, in the test that `create.sh` refuses a token in the environment. That is a 16-character
fixture with the word FIXTURE in it, passed only to the fake `hcloud`. A Hetzner API token is 64 random characters, so
this is not one. The line was replaced later (`c61d6b68`), and history is not rewritten. Added to `.gitleaksignore` as
one exact fingerprint, with its reason. SECURITY's gitleaks paragraph now names both entries.
