# Flow: Dashboard glance

**Story (PRD §4.1):** As the Principal, I want a dashboard of financial health per entity, so that I can tell at a glance how each entity is doing without opening separate spreadsheets or provider sites.

```mermaid
flowchart TD
  start([User logs in]) --> membership{Holds membership\non 1+ entity?}
  membership -- no --> empty[Empty state:\nNo entities yet, invite/create CTA]
  membership -- yes --> default[Land on default entity\nlast-viewed or first by role]
  default --> render[Render dashboard:\nbalances, cash flow, recent activity,\npending tax liability, allocation snapshot]
  render --> loading{Data cached?}
  loading -- no --> skeleton[Skeleton matches real layout\nno spinner]
  skeleton --> render
  render --> switch{Switch entity?}
  switch -- yes --> picker[Entity switcher\nPerson / Trust / Business / Household]
  picker --> filtered[Re-render scoped to\nuser's membership on that entity]
  filtered --> render
  switch -- no --> drill{Drill into a number?}
  drill -- yes --> source[Navigate to source:\nledger line, lot, or liability detail]
  drill -- no --> idle([Glance complete])
```

**Notes**
- Every number on this screen must be clickable through to its source (Overview principle: "every number earns trust").
- Filtered strictly by membership (owner/manager/viewer) — no transitive access via parent entity (PRD §5 permission model).
- Viewer-role household members see the household's shared accounts + their own entity, never another member's entity (PRD §4.8).
