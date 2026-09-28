# Flow: Import & confirm transactions

**Story (PRD §4.2):** As the Principal, I want my bank and brokerage transactions imported automatically and staged as drafts, so that I can review and confirm them instead of hand-entering every transaction.

```mermaid
flowchart TD
  poll([Provider adapter polls\nor fake source generates batch]) --> stage[Stage as draft transactions\nunposted, editable]
  stage --> transfer{Two legs match\nwithin date window?}
  transfer -- same posting date --> oneEntry[One multi-leg journal entry]
  transfer -- different dates --> citEntry[Two entries via\nCash in Transit clearing account]
  transfer -- unmatched --> openItem[Remains open item in\nCash in Transit]
  openItem --> aging{Older than\nexceptions threshold\ndefault 3 business days?}
  aging -- yes --> exceptions[Surface on\nExceptions report]
  aging -- no --> stage
  oneEntry --> review[User reviews staged batch:\ncategory, tax-treatment tag,\ncounterparty]
  citEntry --> review
  review --> edit{Needs correction\nbefore posting?}
  edit -- yes --> editDraft[Edit draft fields\nstill mutable]
  editDraft --> review
  edit -- no --> confirm[User confirms]
  confirm --> post[Post as journal entry\nsource becomes immutable]
  post --> toast[Toast: batch posted]
  post --> ledger([Appears in ledger,\nposted badge])
  exceptions --> resolve{Resolved manually?}
  resolve -- yes --> post
  resolve -- no --> exceptions
```

**Notes**
- Once posted, a transaction is immutable — the UI never offers an "edit" affordance on a posted row, only "reverse" (Overview principle: immutability is visible).
- Draft rows carry the `Draft (staged)` badge (`--secondary`, clock icon); posted rows carry `Posted` (`--outline`, check icon) — see design-system-spec.md § Financial semantics.
- Actor attribution (user / auto-post rule / system job) is shown on every draft and posted row, never inferred (PRD §5).
