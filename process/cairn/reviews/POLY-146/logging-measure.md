# POLY-146 A1.1 — operator `logging: {driver: "none"}` measurement (devops-engineer-146)

Docker 29.9.3, local. The `operator` service definition is the one `docker compose -f infra/compose/prod.yml --profile '*' config`
renders (entrypoint `/app/bin/polycarpic cli`, `restart: "no"`, profile `operator`, read_only, cap_drop ALL, `logging.driver: none`).
Changed for the local run only: image → the local `polycarpic:ci` (the prod digest is a placeholder that cannot be pulled), the secret
mount and healthcheck removed (no host secret files), network → a throwaway one, user → 1000:1000 (the image's `node`).
Caveat: `polycarpic:ci` predates the `cli` verb, so the real `user invite` could not run (it needs the new image and a database).

1. `docker compose -f real.json --profile operator run --name lr-op operator user invite a@b.test`
   → attached terminal printed `usage: polycarpic web|worker|migrate|status [args...]`, exit 64 (stderr reaches the terminal).
2. `docker logs lr-op` → `Error response from daemon: configured logging driver does not support reading`, no log text, exit 1.
   `docker inspect lr-op --format '{{.HostConfig.LogConfig.Type}}'` → `none`.
3. Same definition, `--entrypoint sh operator -c 'echo STDOUT-LINK-https://x/invite/abc; echo STDERR-LINE >&2'` (lr-op2)
   → attached terminal printed both lines; `docker logs lr-op2` → only the same "does not support reading" error, no log text.

Result: with driver none the attached `run` still prints stdout and stderr, and `docker logs` yields nothing. Containers and network removed.
Not measured: the real `cli user invite` link output (needs the rebuilt image and a database).
