# POLY-101 ruling review (seceng-101)

## Part 1: what the ruling must settle (written before the ruling, at fb814595)

The three checks: **RP** = `tests/db/auth-route-policy.test.ts`; **POOL** = `tests/db/auth-routing-pool.test.ts`;
**LINT** = the ESLint run over `packages/auth` plus `packages/auth/src/boundaries.test.ts`, which proves the rule refuses.

Measured: branch protection (`gh api .../branches/main/protection`) requires `cairn` AND `app`, strict, admins included, 0 reviews.
So `app` is the gate. Output keys below come from `printf '%s\0' <path> | node infra/ci/changes.mjs`.

### Conditions

1. **LINT runs by name whenever the row fires.** It runs today, but indirectly: the `lint` job's "Layer map checks" step (on `layers` or `node`) runs
   `tests/layers/structure.test.ts`, whose "auth: its vitest tests run alone" spawns the package's own suite. Measured: with the
   `better-auth/adapters/drizzle` lines removed from `scripts/layers/generate.mjs`, `vitest run tests/layers` exits 1 on that one test (568 pass
   on the unedited tree). `unit` is skipped for that path (only `layers` is set), so this is the only run. `node` covers the lockfile, root manifests,
   `eslint.config.js` and packages, so LINT has no path hole found. Required: name it. Either a step running the LINT files, or a `tests/ci` pin
   that the Layer map step keeps its `layers || node` condition and that structure.test.ts runs `auth`. Nothing should rest on it by accident.
2. **The row's trigger set, pinned in `tests/ci`:** `packages/auth/**`, `apps/auth/**`, `packages/tenancy/**`, `pnpm-lock.yaml`, root
   `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `scripts/layers/**`, `layers.json`, `eslint.config.js`. One case per path, each
   red when dropped. A bump only in the lockfile, a root override or a catalog already sets `db_auth` (DB_SHARED): pin it.
   Match on path; parsing for "better-auth changed" misses transitive packages (`@better-auth/core`, `better-call`).
3. **`.pnpmfile.*` and `patches/**` set the row.** Measured: both set no key today. A patch to better-auth also moves the lockfile hash, so this
   is a second line; it is one regex.
4. **RP and POOL are pinned to `db_auth`** by name in `tests/ci`, outside the map they check. `db-areas.test.ts` TABLE does this; say it is relied on.
   Its suite runs in the `db` preflight and on `ci`, so an edit to `changes.mjs` alone runs it (it is in DB_SHARED).
5. **Ran is not skipped.** A `it.skip`, `describe.skip`, `it.todo` or an emptied file in RP, POOL or LINT passes today: vitest exits 0.
   Required: a check over vitest's JSON report that each named file is present, all passed, with at least a floor of passed tests and 0 skipped or todo.
   A rename fails `--db-select` for RP and POOL; LINT needs the same.
6. **A skipped job is not a pass.** Measured by reading: `aggregate.mjs` goes red when `db=true` and `db` is not `success`. The ruling puts LINT in a job
   that REQUIRED ties to the same key, and an aggregate test has that job `skipped` with the key true: red.
7. **The unclassified-route case is real.** `dist-enumeration.test.ts` does NOT enumerate routes: it scans session and user writer calls.
   Only RP compares live routes to AUTH_ROUTES. Criterion 1 needs a test that builds an instance from `authOptions` plus a synthetic plugin
   with one extra endpoint and asserts RP's own predicate names it; classified, the predicate is empty. Same function as RP, not a copy.
8. **Method widening.** RP's set is of paths only, so a bump that adds a method to a listed path is not seen. Pin path plus method, or
   state the residue with what the hook does on that path.
9. **LINT's reach.** The rule names only `better-auth/adapters/drizzle`. State whether `@better-auth/drizzle-adapter` is refused too. The override
   removes that package from better-auth's own tree, but a direct dependency in `packages/auth` is not covered by it.
10. **`workflow_dispatch` with `base`.** It runs the filter over a range the caller chooses, so the rest is skipped and a check named `app` goes
   green on that head sha. Whether protection accepts it for the PR is (unmeasured). Who can reach it: anyone with Actions write (the
   Principal, and any session holding his `gh` token). Either the aggregate is red on a dispatch with a non-empty `base` (one env var,
   one condition, plus a test) or the ruling shows that protection ignores it. The first is my preference.
11. **Same-PR edits to the gate.** `pull_request` runs the PR's own `ci.yml`, `changes.mjs`, `aggregate.mjs` and tests, so a PR can disarm its own gate.
   No condition here removes that. Mechanism: one commit edits both. Reach: anyone who can push a branch and merge, 0 reviews required.
   Stronger option: a required code-owner review on `.github/`, `infra/ci/`, `tests/ci/`, RP, POOL and LINT. Cost: the author cannot approve
   their own PR, so it needs a second GitHub identity. The ruling states this residue; the lead decides.
12. **The bot.** Measured: no npm bot exists (`renovate.json` covers two Dockerfiles; Dependabot security updates disabled). The ruling says a bump
   today is a human or agent PR through the same `pull_request` filter, and that a later bot gets no skip by actor. A `tests/ci`
   assertion that `ci.yml` has no `github.actor` condition is enough.

### Must be shown red
1 (drop the rule in `generate.mjs`: red already today, record it; and drop the named run or pin), 2 and 3 (each path dropped), 5 (a skipped RP test), 6, 7, 10.

### Left out (for the lead; not conditions)
- INFRA §4.3 says a "dependency bot's bump" cannot merge; no such bot exists for npm. Wording, devops-101's to judge.
- A plugin's `onRequest` hook can answer before the router, so its path is in no endpoint list. The exact plugin-id pin in `dist-enumeration` covers new plugins, not new behaviour in the five.
