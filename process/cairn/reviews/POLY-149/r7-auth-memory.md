# POLY-149 R7: the `auth` process's memory (devops-engineer)

Measured 2026-11-19 on branch tip 002cda1f (migrations 0016, 0017), for ARCH §7.3.

**Image.** Built from 002cda1f with `GIT_COMMIT=002cda1f684fdaa9a743b3df953a5e3c094193b5`, Node 26.12.0-slim. Image id (config digest) `sha256:a4bb405e0dbd8ef4cda40826d9a9806a04473d7e0ff03c99709ebba49a11992e`. A local build has no registry digest; the CI build of the same commit has its own.

**Method.** `docker run … polycarpic auth` (pid 1 is the node process), `-m 256m --memory-swap 256m` (the prod cap, INFRA §2.2), against a migrated database on the harness Postgres; `VmRSS` of pid 1 read from `/proc/1/status`. `POLY_IMAGE_REVISION` is blanked and `APP_ENV=development` so the release image accepts an `http://localhost` origin; no other difference from the shipped container.

| | RSS |
|---|---|
| Idle, 60 s after `/api/auth/ok` (capped at 256 MB) | **131,084 kB (128 MiB)**, flat within 25 kB over the minute; anon 71,028 kB, file 60,056 kB |
| Peak during the e2e suite, 57 passed, 0 failed (capped at 256 MB) | **133,376 kB (130 MiB)**, 18 samples at about one per 1.3 s |
| Same idle with no memory limit on the container | 276,000 to 294,000 kB (270 to 287 MiB) |

- **The cap changes the number.** Node sizes its heap from the cgroup limit; with no limit on a large Docker VM the same process idles at about 280 MiB. ARCH §7.3 should quote the capped figures, which match what runs on the box.
- 130 MiB at peak leaves half of the 256 MB prod cap. The staging cap is 192 MB and was not run; at that limit V8 would size smaller still (unmeasured).
- The e2e run pointed web at this container instead of a host node process; the suite is otherwise the repo's (`playwright test`, 57 passed). Sampling was once a second, so a spike shorter than that is not seen.
- Reproduce: `temp/` scripts were throwaway and are not kept.
