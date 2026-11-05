# Flow: Allocation vs. target

**Story (PRD §4.8):** an asset-allocation view with target adjustments, so actual holdings compare to where I want them.

```mermaid
flowchart TD
  open([Open Allocation\nfor entity]) --> actual[Actual by asset class:\nmarket value from lots,\nacross every custodial account]
  actual --> map[Current allocation treemap:\none tile per class, sub-categories\nnested, area is share of market value]
  map --> target[Actual vs. target card:\noverlay the target per class]
  target --> drift[Drift per class:\nactual minus target, in points]
  drift --> act{User action}
  act -- expand a class --> subs[Sub-category rows:\nactual vs. target and drift\nper sub-category]
  subs -- drill a sub-category --> lots
  act -- drill a tile or class --> lots([Custodial Accounts lots,\nfiltered to that class\nor sub-category])
  act -- click the gear --> edit[Target editor popover, two levels:\npercent per class, then\nper sub-category behind a pull-down]
  edit -- cancel --> drift
  edit --> sum{Classes total 100%\nand each class equals\nthe sum of its sub-targets?}
  sum -- no --> edit
  sum -- yes --> save[Save target]
  save --> drift
  act -- none --> done([View complete])
```

**Notes**
- **Same data, different aggregation:** actual allocation is the lots' market value summed by asset class across every custodial account for the entity — not a new data source.
- **Drift is information, not a warning.** Over or under target shows as a neutral `outline` badge ("+2 pt over", "−2 pt under"); on target shows the positive soft badge. No caution or danger hue.
- **Treemap first, table second.** The page opens on the current allocation as a nested treemap: one tile per asset class in its fixed categorical slot, its sub-categories inside it in the same slot. The Actual vs. target card below is its table view and carries every figure.
- **Drill:** each treemap tile and each asset-class or sub-category name opens Custodial Accounts' lots, filtered to it, so every percentage traces to the lots behind it.
- **Sub-categories behind a pull-down.** Every class row, in the Actual vs. target card and in the target editor, has a chevron that reveals its sub-categories (the lots sub-card's disclosure pattern). Seeded defaults: US Equity → Large cap, Mid/Small cap; Intl Equity → Developed, Emerging; Fixed Income → Treasuries, Corporate, Municipal; Cash → Cash, Money market. In the Actual vs. target card, each sub-row shows its own actual / target and drift badge.
- **The gear opens the target editor.** A gear icon button at the top right of the Actual vs. target card opens the editor in a popover anchored to it, non-modal so the bars stay readable while targets change. Cancel or Esc closes it and discards the edits; a click outside closes it only when nothing has been edited. Focus moves to the first input on open and returns to the gear on close.
- **Target editor, two levels:** sub-targets are whole-portfolio percent and must sum to their class target; the class row stays editable and carries a reconcile badge (positive soft "Sub-targets sum to N%", or neutral outline "N pt unassigned"). Save is enabled only when the classes total 100% and every class reconciles. Viewers see the treemap and the bars but no gear (write controls are omitted, not greyed).
- **No nominal / inflation-adjusted toggle here.** Allocation is a contemporaneous snapshot of today's holdings, so a CPI-U restatement adds no information; the toggle (PRD §4.10) belongs to the time-series views (Dashboard net-worth chart, Reports).
