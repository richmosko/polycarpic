# POLY-84 mutation sanity (qa-engineer, green @ 8a5f630)

Method: with the green suite, each guard below was disabled alone (one string edit, restored after) and the owning test file re-run. CAUGHT = the file went red.
Result: every mutant is caught except one equivalent mutant (row trigger) and one first-run survivor that led to a new canary (below).

| Guard disabled | Result |
|---|---|
| probe: rls_disabled / not_forced / no_policy / for_all_policy / no_truncate_trigger | each CAUGHT |
| probe: matview / foreign_table / view_not_security_invoker | each CAUGHT |
| probe: partitions (rls_disabled on kind p only; kind p out of scope entirely) | both CAUGHT (the bare-parent canary) |
| probe: temp-relation filter removed | CAUGHT (pgTAP's `__tcache__` shows up) |
| probe: exemption by name pattern; exemption of a whole schema | both CAUGHT |
| probe: BEFORE not required; disabled trigger accepted | both CAUGHT |
| probe: row trigger accepted | equivalent mutant: PostgreSQL only allows TRUNCATE triggers at statement level |
| exemption list: misspelled entry; entry removed; extra entry | each CAUGHT |
| exemption: existence check (ghost entry `public.ghost`) | CAUGHT by `exemption exists`; disabling the check alone survives only because the real list is intact, so the ghost run is the proof |
| hygiene: login TRUNCATE/REFERENCES/TRIGGER probe blind; TEMP probe blind; C-10 owns-nothing blind | each CAUGHT |
| definers: search_path unchecked; substring match instead of exact element | both CAUGHT |
| definers: owner unchecked; allowlist owner unchecked; unlisted unreported; ghost entry unreported | each CAUGHT |
| definers: PUBLIC grantee ignored | CAUGHT |
| battery: unprotected canary made protected (inversion) | CAUGHT |
| battery: protected canary not FORCEd and owned by the connecting role | CAUGHT |
| battery: SELECT policy leaks when context is empty; policy without nullif | each CAUGHT |
| battery: INSERT / UPDATE WITH CHECK replaced by `true` (on the table whose SELECT policy admits all rows) | each CAUGHT |
| matrix: missingProbes blind; activation ignores tables; duplicate ids; illegal cells | each CAUGHT |

Not a kill: the first run mutated `qa_canary_rls`'s UPDATE WITH CHECK and survived, because that table's SELECT policy also refuses the forged row. `qa_canary_wc` (SELECT admits all) was added so WITH CHECK is the only defence on one canary; its mutants are the two rows above.

Finding: ruling R6 says no poly_* role holds TEMP; `poly_owner` does, as database owner (NOLOGIN, reached by poly_migrator's SET ROLE). 03_role_hygiene.sql asserts "all but poly_owner" and asserts poly_owner cannot log in.
