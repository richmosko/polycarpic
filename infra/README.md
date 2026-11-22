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

The Python tools are stdlib only and run on the macOS Command Line Tools `python3` (3.9). No tool writes a credential to disk, puts one in argv or the environment, or prints one, except the one-time display of a new B2 key.

A rehearsal run (a throwaway server to see the tools work) ends the same sitting: delete the server, the volume and the firewall, `hcloud context delete <name>`, delete the token in the Hetzner console, then `laptop-check.py`.

## On the box (run as root, copied from a verified checkout)

| Script | What it does |
|---|---|
| `provision.sh --stage host --target hetzner --domain <d> [--mail-from <addr>]` | Docker, daemon settings, unattended upgrades, no swap, the LUKS2 data volume, data and spool directories with their ACLs, state files, generated secrets, `host.env`. Idempotent; prints `host stage: no changes` on a second run. |
| `provision.sh --stage database --project prod\|staging` | Applies `packages/db/sql/roles.sql` and sets each login role's password from its secret file. The SCRAM verifier is computed on the host; Postgres never receives a plaintext password. |
| `provision-check.sh --b2-capabilities <file> --b2-bucket <name> [--prod]` | Read-only. One line per check (`PASS`, `FAIL` with its fix, `WAIT`, `WARN`, `INFO`) and a summary line; exit 0, 1 or 3. |

Copy `provision.sh`, `provision-check.sh`, `packages/db/sql/roles.sql` and `operator/b2-capabilities.json` into one directory on the box.

## Tests

`tests/infra/image/provision*.test.ts` run the scripts in a container with fakes for the provider, the volume, the packages and Docker (`tests/infra/provision/`). `tests/infra/operator/` runs the Python tools against recorded fixtures. Neither reaches a network or uses a credential.
