# Flow: Tax liability & safe-harbor

**Story (PRD §4.5):** As the Principal, I want a continuously updated view, per entity and jurisdiction, of my pending tax liability, the required safe-harbor payment, and the gap between them, so that I know exactly how much to wire by each due date.

```mermaid
flowchart TD
  view([Open Tax Liability view\nfor entity + jurisdiction]) --> accrual[Running accrual annualizes\nincome to date by tax treatment]
  accrual --> pending[Pending liability =\nannualized tax to date minus\ncustodial prepaid balance]
  accrual --> safeharbor[Two safe-harbor bases computed:\nprior-year and current-year]
  safeharbor --> required[Required payment to date =\nlesser of the two safe-harbor bases]
  required --> gap[Gap = required payments to date\nminus custodial balance,\nare you current with the authority]
  pending --> display[Display gauge + figures]
  gap --> tier{Gap status}
  tier -- "gap < 0" --> onTrack[Tier: Normal / on track\nprepaid ahead of safe harbor\npositive token]
  tier -- "gap >= 0, due date > 14d out" --> caution[Tier: Caution\nwarning token]
  tier -- "gap >= 0, due date passed" --> danger[Tier: Danger / overdue\ndestructive token]
  onTrack --> display
  caution --> display
  danger --> display
  display --> extPay[User pays the tax authority\nat their own bank, the app\nnever initiates a payment]
  extPay --> imported[Payment appears as an imported\nbank transaction, no counterparty]
  imported --> postEntry[User posts the GL entry:\ndebit the tax-authority custodial\naccount, pending liability itself\ndoes not change, not filed yet]
  postEntry --> accrual
  display --> waitNode([Wait for next period cutoff])
  waitNode --> freeze[Period cutoff freezes\nannualized figure for due date]
  freeze --> accrual
```

**Notes**
- **Tiers:** on track when `gap < 0` (prepaid ahead of the safe-harbor requirement); caution when `gap >= 0` and the due date is more than 14 days out; danger when `gap >= 0` and the due date has passed. They reuse the product-wide status vocabulary — design-system-spec.md § Status tiers.
- **Gap = 0 is not on track.** It means exactly at the safe-harbor line, with nothing in hand beyond the requirement, so it takes the caution or danger tier by due date.
- **Two figures,** both measured against the custodial account's balance but not against each other: **Pending liability = annualized tax to date − custodial prepaid balance** (what you would owe net of prepayments, if filed today); **Gap = required payments to date (safe harbor) − custodial balance** ("are you current with the authority"). Gap is never `required − pending`.
- **v1 never moves money.** There is no pay button: the user pays the tax authority at their own bank; the payment lands as an imported transaction with no counterparty; the user posts the GL entry, debiting the custodial tax-authority account (a prepaid-tax asset). Copy says "post your payment" or "record your payment", never "pay" or "transfer".
- Jurisdiction due dates, multipliers and cumulative percentages are data-driven (a lookup table), so the view renders for any number of jurisdictions per entity, not just federal (PRD §5).
- At filing, the frozen per-period figures export for Schedule AI / Form 2210 and the state equivalent; the flow's freeze step is the source of that export.
