# Flow: Tax liability & safe-harbor

**Story (PRD §4.4):** As the Principal, I want a continuously updated view, per entity and jurisdiction, of my pending tax liability, the required safe-harbor payment, and the gap between them, so that I know exactly how much to wire by each due date.

```mermaid
flowchart TD
  view([Open Tax Liability view\nfor entity + jurisdiction]) --> accrual[Running accrual annualizes\nincome to date by tax treatment]
  accrual --> pending[Pending liability =\n100% annualized − prepaid balance]
  accrual --> safeharbor[Two safe-harbor bases computed:\nprior-year and current-year]
  safeharbor --> required[Required payment =\nlesser of the two − prepaid balance]
  pending --> gap[Gap = required − pending]
  required --> gap
  gap --> tier{Gap status}
  tier -- "gap <= 0" --> onTrack[Tier: Normal / on track\npositive token]
  tier -- "gap > 0, due date > 14d out" --> caution[Tier: Caution\nwarning token]
  tier -- "gap > 0, due date passed" --> danger[Tier: Danger / overdue\ndestructive token]
  onTrack --> display[Display gauge + figures]
  caution --> display
  danger --> display
  display --> pay{User initiates payment?}
  pay -- yes --> post[Post estimated-tax payment:\ntransfer bank -> prepaid-tax asset\nper jurisdiction]
  post --> display
  pay -- no --> wait([Wait for next period cutoff])
  wait --> freeze[Period cutoff freezes\nannualized figure for due date]
  freeze --> accrual
```

**Notes**
- The three-tier status (normal/caution/danger) reuses the product-wide status vocabulary — see design-system-spec.md § Financial semantics — not a bespoke tax-page color.
- Jurisdiction due dates, multipliers, and cumulative percentages are data-driven (a lookup table), so this screen must render correctly for an arbitrary number of jurisdictions per entity, not just federal (PRD §5).
- At filing, frozen per-period figures export for Schedule AI / Form 2210 and the state equivalent — this flow's "freeze" step is the source of that export.
