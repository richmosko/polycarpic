# Flow: Tax liability & safe-harbor

**Story (PRD §4.4):** As the Principal, I want a continuously updated view, per entity and jurisdiction, of my pending tax liability, the required safe-harbor payment, and the gap between them, so that I know exactly how much to wire by each due date.

```mermaid
flowchart TD
  view([Open Tax Liability view\nfor entity + jurisdiction]) --> accrual[Running accrual annualizes\nincome to date by tax treatment]
  accrual --> pending[Pending liability =\n100% annualized − balance of the\ntax-authority custodial account]
  accrual --> safeharbor[Two safe-harbor bases computed:\nprior-year and current-year]
  safeharbor --> required[Required payment =\nlesser of the two − balance of the\ntax-authority custodial account]
  pending --> gap[Gap = required − pending\nmeasured against that account's balance]
  required --> gap
  gap --> tier{Gap status}
  tier -- "gap <= 0" --> onTrack[Tier: Normal / on track\npositive token]
  tier -- "gap > 0, due date > 14d out" --> caution[Tier: Caution\nwarning token]
  tier -- "gap > 0, due date passed" --> danger[Tier: Danger / overdue\ndestructive token]
  onTrack --> display[Display gauge + figures]
  caution --> display
  danger --> display
  display --> extPay[User pays the tax authority\nat their own bank — the app\nnever initiates a payment]
  extPay --> imported[Payment appears as an imported\nbank transaction, no counterparty]
  imported --> postEntry[User posts the GL entry:\ndebit the tax-authority custodial\naccount — pending liability itself\ndoes not change, not filed yet]
  postEntry --> accrual
  display --> waitNode([Wait for next period cutoff])
  waitNode --> freeze[Period cutoff freezes\nannualized figure for due date]
  freeze --> accrual
```

**Notes**
- The three-tier status (normal/caution/danger) reuses the product-wide status vocabulary — see design-system-spec.md § Financial semantics — not a bespoke tax-page color.
- Jurisdiction due dates, multipliers, and cumulative percentages are data-driven (a lookup table), so this screen must render correctly for an arbitrary number of jurisdictions per entity, not just federal (PRD §5).
- At filing, frozen per-period figures export for Schedule AI / Form 2210 and the state equivalent — this flow's "freeze" step is the source of that export.
- **Redrawn pass 6 (the Principal, review 4):** v1 never moves money — there is no "User initiates payment?" button in the app. The real sequence is: the user pays the tax authority at their own bank; that payment lands as an imported bank transaction with no counterparty; the user posts the GL entry themselves, with the debit to the custodial tax-authority account (a prepaid-tax asset) — the pending-liability figure itself doesn't change at that moment, since the tax isn't filed yet. **The gap is measured against the balance of that tax-authority account**, not against a separate "amount paid" figure. Any dashboard/tax-panel copy that implies the app itself pays or transfers funds is wrong and should read "post your payment" / "record your payment," never "pay" or "transfer."
