# POLY-95 — seceng build review @ d5b6d84 (verdict ca46bc5)

**Result: no veto. Five pre-merge conditions, SC1–SC5,** on top of the verdict's C1 and C2. Everything else is as ruled: S1–S9, A1, the gosu removal and the xcaddy rebuild (sign-offs 26bb0f3, 0e54cb0, a06c70b) match the tree. Seceng re-reviews the sha that carries C1, C2 and SC1–SC5.

## Pre-merge (builder)
- **SC1. The bind allowlist is keyed by service name, not by project.** `compose-policy.mjs` checks `policy.binds[sn]`. A staging `postgres` bind of `/srv/polycarpic/pg-prod` passes the lint, which hands prod's data directory to the project that runs unreleased code (TB-10, T-65). So does a prod `postgres` mounting `postgresql.staging.conf` or `pg_hba.staging.conf`.
  - Fix: key `binds` by `<project>.<service>`.
  - Fail fixtures: staging postgres on `pg-prod`; prod postgres on `pg_hba.staging.conf`.
- **SC2. Named volumes are unchecked.** Only `type: bind` reaches the allowlist. A top-level volume with `driver_opts: {type: none, o: bind, device: /var/run}` mounts any host path, the Docker socket's directory included, and passes.
  - Fix: a service volume whose `type` is neither `bind` nor `tmpfs` fails. Any top-level `volumes:` fails (none is used).
  - Fail fixture: the `driver_opts` case above.
- **SC3. The staging allowlist runs after `basic_auth`.** Caddy orders `basic_auth` before `respond`. A client outside `POLY_STAGING_ALLOW` gets 401 for a wrong password and 403 for a right one, which is a password-guessing oracle open to the internet, and the allowlist exists to prevent exactly that.
  - Fix: wrap the staging site's handlers in `route { respond @denied 403; basic_auth …; reverse_proxy … }` so the order is literal.
  - Test: a request from outside the allowlist with no credentials, and one with wrong credentials, both get 403, with the headers.
- **SC4. `backup` mounts the whole spool read-write**, `spool/wal/` included. INFRA §2.2 says backup alone writes `spool/dump/` and `spool/premigration/`. As built, backup can pre-create `<f>.age` names and stall WAL archiving.
  - Fix: bind `/srv/polycarpic/spool/dump` and `/srv/polycarpic/spool/premigration` only, in both `prod.yml` and `policy.json`.
  - Fail fixture: backup on `/srv/polycarpic/spool`.
- **SC5. One name for the age recipient file.** The code uses `/etc/polycarpic/age-recipients.txt`; INFRA (twice) and SECURITY §6.1 say `/etc/polycarpic/backup.pub`. If POLY-97 provisions what the docs say, archiving fails closed and stops backups.
  - The code's name stands. Seceng updates SECURITY §6.1 in this commit; the builder updates INFRA's two mentions.

## Follow-ups (lead files after merge)
- **F11:** lint rule: on `polycarpic-edge-<p>`, the only alias allowed is `<p>-web`. A staging `web` alias of `prod-web` would let Caddy's resolver send prod traffic to staging. Low risk, because the alias is reviewed config.
- **F12 (POLY-97, uploader issue):** Postgres runs `archive_command` under umask 0077, so `.age` files are `999:999 0600` and backup's output is `10004:10004`. The uploader (`10005`, no `group_add`) can neither read nor delete them.
  - Rule: default POSIX ACLs on `spool/{wal,dump,premigration}` grant uid 10005 `rwX`. Never chmod 0644 or 0777, never a shared gid.
  - provision-check asserts the ACL and that nothing in the spool is world-readable.
