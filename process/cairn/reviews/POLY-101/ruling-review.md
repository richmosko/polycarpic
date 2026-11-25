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

## Part 2: verdict on `ruling.md` @ 45556d16: CHANGES (3, all small; the shape is right)

1. **G1, the §1 table row for `scripts/layers`, and V1's premise are false.** They copy my condition 1 at 1d76e58f, which I corrected at 53991f7e: with the rule deleted,
   `vitest run tests/layers` exits 1, because structure.test.ts runs the package's own suite, and the `lint` job runs it on `layers` or `node`. Restate G1 as "LINT runs
   only through structure.test.ts; nothing names it". §9's last bullet falls for the same reason, and so does "only if turbo calls the package affected" in §1.
   B1 stays worthwhile (named, unconditional, reported) at about 1 s.
2. **B2 must refuse `it.fails`.** Measured (vitest JSON): a failing `it.fails` is `"status":"passed"`, `describe.skip` is `skipped`, `todo` is `todo`. So
   `it.fails` on the live-route test hides an unclassified route and passes every B2 rule. `auth-row.mjs` also reads the three source files and exits 1 on
   `.fails` applied to `it`, `test` or `describe`, or a `fails:` option. None is present today (grep). This is a mistake guard; deliberate edits are condition 11.
3. **V7 is a standing test.** "Both steps have no `if:`, no `--affected`, no `continue-on-error`; the `db` step directly follows the battery; `DB_AUTH` comes from
   `needs.changes.outputs.db_auth`" goes in `ci-workflow.test.ts`, not only in the verdict. The same suite asserts that the two `VITEST_JSON` paths differ.

Accepted as ruled: conditions 2 to 4, 6, 7, 9 to 12. Condition 8: the pin normalises an absent, single and array `method`, so a widening cannot hide in the form.
Residue 11 carries mechanism, reach, stronger option and cost; not accepted as closed (lead files it). SECURITY A-34 needs no edit: its text already says
the test lists the instance's endpoints and fails on a missing path. ARCH 1.31.1's gate rows match the ruling.

## Build conditions

**qa-101:** (a) RP's live-route test and the control call one predicate. (b) The control is red when `isAction` filtering returns and when the predicate returns nothing.
(c) `METHOD path` literal, normalised, in both modes. (d) A path case per entry of conditions 2 and 3. (e) `auth-row.mjs` cases: V3 plus `it.fails`. (f) V6 and the skipped-job cases.
(g) Floors are measured counts, not guesses. (h) One-offs of §5 in the single container run, with output kept.
**devops-101:** (a) B1 to B6 as ruled; `auth-row.mjs` matches each file by exact path relative to the repo root, not by suffix. (b) No `${{ }}` in `run:`. (c) No new secret, token or permission.
(d) `auth-row.mjs` is in DB_SHARED, with its OWN entry.

**Must be shown red:** rule deleted in `generate.mjs` (B1's step by itself); each path of 2 and 3 dropped; skip, todo, `fails`, missing file, below floor, one TLS mode; the two control
faults; `lint` or `db` skipped with its key true; based dispatch.

## Part 3: the lead's two questions, and the ruling @ f0bf6d03

**G1: the retraction is the true statement.** The rule cannot be deleted in `generate.mjs` with `lint` green (measured, Part 1 condition 1). f0bf6d03 now says so: item 1 of Part 2 closed.
B1 is the right size: one named step, about 1 s, and no job or key. Smaller (pin structure.test.ts alone) would not give B2 a report that shows LINT ran.

**G3: confirmed from the code (read; not run over HTTP).** An unlisted path is refused twice, and neither place looks at `isAction`:
(a) `handleAuthRequestInner` answers 404 when `matchAuthPath` finds no template, before `auth.handler`; (b) `routePolicyHook` throws NOT_FOUND when `AUTH_ROUTES[ctx.path]` is absent.
better-auth's `dispatch.mjs` sets that `path` to `endpoint.path` (line 204) and puts the user `hooks.before` ahead of the plugin ones; every endpoint passes through `toAuthEndpoints`.
A new literal that fits a listed template (`/callback/x` under `/callback/:id`) passes (a) and is stopped by (b). So it is a test hole, not a control hole.
Two limits: a plugin `onRequest` answers inside `auth.handler` before (b), though (a) still precedes it for unlisted paths; and a synthetic-route 404 over `auth.handler` exercises (b) alone.
The ruling names `refusedByHandle` as the first refusal. Nothing in `packages/auth/src` or `apps/auth/src` calls it (grep); the refusal is `handleAuthRequestInner`.

**Verdict on f0bf6d03: CHANGES.** Open: Part 2 items 2 (`it.fails`) and 3 (standing V7). One added line for B3, from G3:
4. The control's synthetic routes are asked through `handleAuthRequest` as well as `auth.handler`, so (a) and (b) are each shown to refuse; and one of the two uses a path that fits a listed
   template (for example `/callback/:id`'s shape), where only (b) can refuse. Name `handleAuthRequestInner`, not `refusedByHandle`.
Condition 7: agreed, RP's predicate becomes the router's own rule. Build conditions and the red list stand as in Part 2; add a red for 4: with the hook removed from the control's options, the template-shaped
synthetic route no longer answers the hook's 404.

## Part 4: ruling @ d51c4d3a: PASS

Part 2 items 1 to 3 are closed. Part 3 item 4 becomes **qa-101 build condition (i)** and needs no ruling edit; where the ruling says `refusedByHandle`, read `handleAuthRequestInner`.
The build lists and the red list of Parts 2 and 3 are the ones I check at the build sha.
