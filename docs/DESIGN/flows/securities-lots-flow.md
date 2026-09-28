# Flow: Securities lots & balance sheet reconciliation

**Stories (PRD §4.5–4.7):** lot-based tracking with GL book value + daily market value; a balance sheet by GL account and a separate one by custodial account; an asset-allocation view against target.

```mermaid
flowchart TD
  view([Open Securities view\nfor entity]) --> lots[Lot table per custodial account:\nbook value, market value, cost basis]
  lots --> priceFeed[Daily EOD price feed\nupdates market value]
  priceFeed --> lots
  lots --> toggle{Balance sheet basis}
  toggle -- GL --> glSheet[Balance sheet by GL account]
  toggle -- Custodial --> custSheet[Balance sheet by custodial account\n+ NAV delta from prior book period]
  glSheet --> reconcile[Reconcile GL balance\nagainst custodian-reported balance]
  custSheet --> reconcile
  reconcile --> match{Balances match\nwithin tolerance?}
  match -- yes --> clean[Reconciliation: clean\npositive tier]
  match -- no --> break[Reconciliation: break\ndanger tier, flagged]
  clean --> allocation[Asset-allocation view:\nactual vs. target]
  break --> allocation
  allocation --> adjust{User adjusts target?}
  adjust -- yes --> saveTarget[Save new target allocation]
  saveTarget --> allocation
  adjust -- no --> done([View complete])
```

**Notes**
- GL-vs-custodial is a `Tabs` toggle on one screen, not two separate pages — both read from the same lot data, different aggregation.
- A reconciliation break uses the danger tier (`--destructive`) and must surface on the dashboard glance too, not only here (cross-reference with Dashboard glance flow).
- Nominal vs. inflation-adjusted (CPI-U) is an orthogonal toggle available on any time-series chart on this screen, including the allocation-over-time view (PRD §4.9).
