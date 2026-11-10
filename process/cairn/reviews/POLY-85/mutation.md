# POLY-85 mutation sanity (qa-engineer, green @ 5344986)

Method: with the green suite, each guard below was broken alone (one edit, restored with `git checkout`) and the owning suite re-run. CAUGHT = the suite went red.

| Guard broken | Result |
|---|---|
| status listener bind `127.0.0.1` → `0.0.0.0` | CAUGHT (4: address, non-loopback refused, host not configurable, source pins it) |
| health memo 5000 ms → 0 | CAUGHT (memo test) |
| probe timeout removed (`Promise.race` dropped) | CAUGHT (S-8b, hung fake Postgres) |
| `SECRET_NAME_RE` loses `DSN` | CAUGHT (3: SENTRY_DSN in staging and production, pattern test) |
| per-service `*_FILE` forbid check disabled | CAUGHT (4: keyring in web/migrate, auth in migrate, price key in web) |
| `Secret.toString/toJSON/inspect` return the value | CAUGHT (4) |
| Dockerfile `ENV POLY_IMAGE_REVISION` removed | CAUGHT (static) |
| Dockerfile 40-hex sha guard `RUN` removed | CAUGHT (static) |
| logger value check (`passes`) bypassed | CAUGHT (15, every S-5 case) |
| logger allowlist (`!rule`) removed | equivalent mutant: `passes(undefined, v)` throws and the catch drops the key |

First attempt at the value-check mutant produced a syntax error (files failed to load, 254 of 298 ran); redone as `true ||`. Not run here: crash-handler removal (the dynamic S-7b test and the static grep each own it), single-flight removal.
