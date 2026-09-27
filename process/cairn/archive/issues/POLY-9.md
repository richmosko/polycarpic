---
id: POLY-9
title: Unquoted leading-* paths: entry hits the YAML alias check before lint
status: done
milestone: POLY-A
parent: POLY-49
blocked_by: []
assignee: null
labels: [cairn, workflow]
priority: P3
pr: null
created: 2026-09-23
updated: 2026-09-27
---

Found during POLY-2 (qa-engineer, architect re-review @ 8c41351). A hand-typed
`paths:` entry that starts with `*` and is not quoted (`- **/**`, `- *.py`) is
rejected by cairn's YAML-subset parser as an anchor/alias (`raw[0] in "&*"`)
before `validate_path_glob` ever runs. The failure is loud, never a silent pass,
and cairn's own writer quotes such entries (`"*.py"`) and reads them back
unchanged, so `cairn new --paths` / `cairn set paths=` are unaffected.

Ruled (architect): no parser exception — an unquoted `*x` really is an alias in
YAML. Scope is a hint only.

## Acceptance criteria

- [ ] The parser error for a `*`-leading unquoted scalar says to quote the entry (`"**/**"`)
- [ ] `process/TRACKER.md` → Path ownership notes that `*`-leading globs must be quoted when hand-edited
- [ ] A unit test covers the hint text

## Comments

### @implementation-lead — 2026-09-27

Resolved by affd63d (exact ruled hint text for an unquoted leading-* paths entry) plus process/TRACKER.md -> Path ownership (:433) -- POLY-60 ruling R3. Flipped to done.
