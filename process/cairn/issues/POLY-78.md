---
id: POLY-78
title: Decouple cairn theme tooling and tests from docs/DESIGN
status: todo
milestone: null
parent: null
blocked_by: []
assignee: devops-engineer
paths: [scripts/cairn/**, docs/DESIGN/variants.css]
labels: [tooling, ci, design]
priority: P1
pr: null
created: 2026-09-28
updated: 2026-09-28
---

## Context

`docs/DESIGN/` is the product's design-system directory (owner: ux-designer). Inherited from the template, its `tokens.css`, `variants.css`, and `design-system-spec.md` currently document the **cairn board/dashboard** UI, not polycarpic, and cairn's tooling treats them as its own:

- `scripts/cairn/board/theme/gen_variants.py` `_TARGETS` writes `docs/DESIGN/variants.css` (PT-69 ruling, inherited).
- `scripts/cairn/tests/test_board_tokens_parity.py` asserts shared keys in `docs/DESIGN/tokens.css` agree with `scripts/cairn/board/tokens.css`. It runs in CI's required `cairn` status check (`scripts/cairn/run_tests.py`), so any product palette change fails the merge gate.
- `scripts/cairn/tests/test_chart_color_drives_charts.py` and `test_theme_variants_generator.py` read/pin the `docs/DESIGN/variants.css` target.
- Header comments in `board/tokens.css`, `dashboard/src/app.css`, and `board/theme/NOTICE.md` name `docs/DESIGN/*` as parity copies.

Principal's ruling (2026-09-28): cairn must not write or update anything under `docs/`; the product design system will deliberately diverge from cairn's look. The ux-designer is rebuilding `docs/DESIGN/` on `phase/plan-design` now, so this must merge **before** that branch can pass CI.

## Acceptance criteria

- [ ] `gen_variants.py` no longer lists any `docs/` path as a target; regenerated outputs are limited to `scripts/cairn/board/variants.css` and `scripts/cairn/dashboard/src/variants.css`.
- [ ] No test under `scripts/cairn/tests/` or `tests/workflow/` reads any file under `docs/` (grep `docs/` returns only comments, or nothing). Parity between `board/tokens.css` and `dashboard/src/app.css` is kept.
- [ ] Cairn's own design reference (the current cairn-specific content of `design-system-spec.md` and the token reference) is relocated under `scripts/cairn/` (e.g. `scripts/cairn/docs/` or `board/theme/`), consistent with `test_docs_layout.py`'s POLY-57 layout pins, and header comments updated to point there.
- [ ] `docs/DESIGN/variants.css` is deleted from the product tree (ux-designer owns anything that replaces it).
- [ ] `scripts/cairn/run_tests.py` and the JS suite pass locally with `docs/DESIGN/tokens.css` replaced by an arbitrary palette (prove the decoupling, e.g. temporarily blank the file).
- [ ] DECISIONS.md entry drafted for the team-lead: PT-69 reversed for this repo; cairn theme assets are localized to `scripts/cairn/`.
