# infra/

Scripts that make the box and its surroundings. The runbook that explains when to run each one is `docs/INFRA/index.html` §7.1; this file lists what each is and what it needs.

## On the laptop

| Tool | What it does | Needs |
|---|---|---|
| `hetzner/create.sh --name <n> --location <loc> --type <type> --ssh-key <key.pub>` | Creates or reconciles the server, the firewall (inbound 22, 80, 443 only; reset when it drifts) and the 20 GB data volume. Run twice, the second run prints `no changes`. | `hcloud` with an active context, `jq`, `ssh-keygen`. Refuses to run with `HCLOUD_TOKEN` set. Reads only an `ssh-ed25519` key. |
| `operator/b2-setup.py [--bucket <name>] [--probe]` | Reads the bucket back through the API, makes the put-only key and the read key (exact capability sets), reads every key back, and checks the old master key is refused after you regenerate it. `--probe` measures whether `writeFiles` alone is enough for rclone. | A new master key from Backblaze, typed at hidden prompts. `rclone` for `--probe`. |
| `operator/dns-move-to-cloudflare.py` | Moves a domain's DNS hosting from Porkbun to Cloudflare. | A zone-scoped Cloudflare token and the Porkbun key pair, typed hidden. |
| `operator/dns-records.py --ipv4 <a> --ipv6 <a>` | Writes the allowed DNS set (`operator/dns-allowed.json`) and the `app` and `staging` address records. Creates only; never deletes or overwrites. | A zone-scoped DNS-edit Cloudflare token, typed hidden. |
| `operator/dns-check.py --ipv4 <a> --ipv6 <a>` | Fails on any record outside the allowed set, any wildcard, proxied record or delegation, a changed pinned value, and any address or CAA answer at the two mail-alias targets. | A read-only (Zone:DNS:Read) Cloudflare token, typed hidden. |
| `operator/laptop-check.py` | Fails if the laptop holds an hcloud context, `HCLOUD_TOKEN`, or a token in hcloud's config. | `hcloud` (optional). |
| `ops/install.sh <user@host> [--ssh-key <file>]` | Installs the operator tool on the box (below) from the committed `HEAD`: refuses uncommitted changes under the files it ships, streams a `git archive` over two `ssh` sessions, prints `installed polycarpic-ops <id> at /opt/polycarpic/ops/current (previous: <id>\|none)`. Run twice on one commit it prints `polycarpic-ops <id> already installed` and changes nothing. | `ssh` and `sudo` on the box; a clean checkout. |
| `restore.sh --identity <age key file> (--premigration --from-box <user@host> [--set <TS>] \| --base \| --dump) [--read-credential <file> --bucket <name>] [--instance <i>] [--before <UTC>] [--set <TS>] [--accept-version <fileId>] [--hours <1-24>] [--plaintext-disk-is-encrypted] [--keep]`; `restore.sh --cleanup` | Decrypts a backup on this machine with `age -d -i` and restores it into a throwaway Postgres in a container (no network, no capabilities, no bind mount). Ends `scratch container: <name>` and `connect: docker exec -it <name> psql -U postgres`. The scratch removes itself after `--hours` (default 8, `docker run --rm`), and `--cleanup` removes every labelled scratch. `--accept-version` passes one version of a name that has two. Refuses an identity above mode 0600 (exit 2), a selection with a second version or a hide marker (exit 3, lists each `version <fileId> <time> <object>`), a hash or replay mismatch (exit 4) and a box or bucket line that fails validation (exit 5). | `docker`, `age`, `python3`, `ssh`; the read credential file (two lines) for the bucket modes; macOS needs `fdesetup isactive` (elsewhere `--plaintext-disk-is-encrypted`). `POLY_B2_AUTH_URL` is the one override (loopback or `https://api.backblazeb2.com`). |
| `drill.sh --identity <file> --read-credential <file> --bucket <name> --box-credential <file> [--instance <i>] [--before <UTC>] [--report <path>]` | The restore drill: `restore.sh`'s selection and restore for both `--base` and `--dump`, then `PASS\|FAIL\|SKIP DR1 … DR11` lines and a last line `DRILL PASSED`, `DRILL PASSED WITH SKIPS: <ids>` (exit 3) or `DRILL FAILED: <ids>` (exit 1). `--report` writes the markdown the lead files. | The same as `restore.sh`, plus the box credential file. |

The Python tools are stdlib only and run on the macOS Command Line Tools `python3` (3.9). No tool writes a credential to disk, puts one in argv or the environment, or prints one, except the one-time display of a new B2 key.

A rehearsal run (a throwaway server to see the tools work) ends the same sitting: delete the server, the volume and the firewall, `hcloud context delete <name>`, delete the token in the Hetzner console, then `laptop-check.py`.

## On the box: `polycarpic-ops`

`ops/` is the operator CLI. `install.sh` puts a root-owned bundle (`ops/**`, `provision.sh`, `provision-check.sh`, `postgres/gate-check.sh` and `.sql`, `postgres/archive-wal.sh`, `backup/` (the scripts the containers run and the systemd units), `operator/b2-capabilities.json`, the compose files, `packages/db/sql/roles.sql`) at `/opt/polycarpic/ops/<id>/`, points `/opt/polycarpic/ops/current` at it and links `/usr/local/sbin/polycarpic-ops`. Run it as `sudo polycarpic-ops <subcommand>`; `polycarpic-ops help` lists them, and `docs/INFRA/index.html` §7.5 says what each prints and its exit codes.

| Subcommand | What it does |
|---|---|
| `provision --stage host --target hetzner --domain <d> [--mail-from <addr>] [--b2-bucket <name>] [--b2-endpoint <url>]`, `provision --stage database --project prod\|staging` | Runs `provision.sh` from the bundle. The host stage sets up Docker, daemon settings, unattended upgrades, no swap, the LUKS2 data volume, data and spool directories with their ACLs, state files, generated secrets and `host.env`; idempotent, `host stage: no changes` on a second run. The database stage applies `roles.sql` and sets each login role's password from its secret file (the SCRAM verifier is computed on the host). `--b2-bucket` is saved to `/etc/polycarpic/ops.conf`. |
| `provision-check [--prod] [--b2-bucket <name>]` | Runs `provision-check.sh`: read-only, one line per check (`PASS`, `FAIL` with its fix, `WAIT`, `WARN`, `INFO`) and a summary line; exit 0, 1 or 3. |
| `set-secret [--staging] <name>`, `list-secrets [--staging]` | Writes a secret from a hidden prompt into each service directory that mounts it (0440 `root:<gid>`; `heartbeat_url`, which root reads and no service mounts, goes to `secrets/host/` at 0400 `root:root`); lists the mounted files by state, mode, owner and size without opening any. |
| `backup nightly\|premigration`, `backup list-premigration`, `backup fetch-premigration <name>`, `upload` | The root job runner for the backup and uploader containers: takes the lock, runs the container, validates what it prints, hashes the files itself, and writes `jobs.log`, `spool.sha256` and `last-upload` (root only), deletes the spool copy after its own comparison and pings the monitor. `backup premigration` ends `premigration-set <TS> <dump name>=<sha256> <globals name>=<sha256>`; the deploy migrates only on exit 0. `list-premigration` and `fetch-premigration` are what `restore.sh --from-box` runs over `ssh`. |
| `gate-check [--staging]`, `status`, `restart [--staging] <service>…` | The deploy gate; one screen of health (disk, app, cert, backup, backupdb, slots, revokes); restart with a health wait. |
| `cli [--staging] user invite <email> [--bootstrap]` | The one app-CLI verb enabled; the link goes from the one-shot `operator` container to your terminal. Other verbs are refused. |

### Adding a subcommand

A subcommand is one file, `ops/commands/<name>.py` (`set_secret.py` is `set-secret`), exporting `HELP` (one line), `add_arguments(parser)` and `run(args, ctx) -> int`, with its test `tests/infra/ops/test_<name>.py`. A status item is `ops/status/<nn>_<item>.py` exporting `PROJECTS` and `run(ctx) -> list[Line]`. There is no registry: the dispatcher lists the two directories by file name. Everything the outside world supplies (child processes, the terminal, the clock, paths under a root) comes through `lib/ctx.py`, so tests inject fakes; a new shared helper goes in a new `lib/` module, and editing an existing `lib/` module is a change every subcommand shares. Children get an environment built from nothing and an argv list; never `shell=True`, `os.system` or a string argument, and never a secret in argv, the environment or output.

## On the box without the tool (the provisioning scripts)

`provision.sh`, `provision-check.sh` and `postgres/gate-check.sh` are the scripts `polycarpic-ops` runs from the bundle; run directly they need the same root and the same `roles.sql` two directories up.

## Tests

`tests/infra/image/provision*.test.ts` run the scripts in a container with fakes for the provider, the volume, the packages and Docker (`tests/infra/provision/`). `tests/infra/operator/` runs the Python tools against recorded fixtures. Neither reaches a network or uses a credential.

`tests/infra/backup/` (one `vitest.backup.config.ts` run, one more step of the `image` job) runs the real backup, archive, uploader (the tools image), `restore.sh` and `drill.sh` against a scratch stack and a fake bucket (`fake_b2.py`); `tests/infra/ops/test_backup.py` and `test_upload.py` run the root runner in-process.
