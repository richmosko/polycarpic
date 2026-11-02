# Flow: Transactions — review, match & correct

**Story (PRD §4.3):** As the Principal, I want my bank and brokerage transactions imported automatically and staged for review, so that I can review and confirm them instead of hand-entering every transaction.

```mermaid
flowchart TD
  poll([Plaid adapter polls\nor fake source generates batch]) --> stage[Raw transaction lands\nin the Pending card]
  stage --> transfer{Two legs match\nwithin date window?}
  transfer -- same posting date --> autoEntry[Locked debit leg +\nsuggested offset leg\ntwo-line preview]
  transfer -- different dates --> citEntry[Two entries via\nCash in Transit clearing account]
  transfer -- unmatched --> openItem[Remains a single-leg\nPending row]
  openItem -- counterpart arrives --> transfer
  openItem -- user approves into CIT --> citOne[One-sided in-flight item:\ncash leg vs. Cash in Transit,\ncounterpart still to come]
  citOne --> post
  openItem --> aging{Older than\nexceptions threshold\ndefault 3 business days?}
  aging -- yes --> exceptions[Surface on\nExceptions card]
  aging -- no --> openItem
  citEntry --> autoEntry
  autoEntry --> expand[User expands the row:\nAuto-Suggest Match view]
  expand --> action{User action}
  action -- edit offset --> editLeg[Inline search dropdown:\noverride the suggested account]
  editLeg --> action
  action -- split --> splitGrid[Split grid:\nadd offsetting rows]
  splitGrid --> liveCheck{Split sum equals\nthe Plaid total?}
  liveCheck -- no --> splitGrid
  liveCheck -- yes --> post
  action -- group --> bulkSelect[Checkbox-select rows,\nbulk action bar appears]
  bulkSelect --> groupModal[Group and Summarize modal:\npre-filled entry, one aggregate\nline + balancing distributions]
  groupModal --> post
  action -- approve --> post[User hits Approve and Post]
  post --> gate{Posting gate:\nbalanced, accounting equation,\ndate match, one entry per draft}
  gate -- fail --> stage
  gate -- pass --> commit[Row fades out of Pending;\nbalanced entry commits to the GL]
  commit --> toast[Toast: entry posted]
  commit --> posted([Appears on Posted,\npaged])
  exceptions --> resolve{Resolved manually?}
  resolve -- yes --> post
  resolve -- no --> exceptions
  posted --> correctQ{User clicks\nCorrect entry?}
  correctQ -- yes --> doCorrect[System posts the reversal\n+ the new corrected entry\nuser never sees reverse as the verb]
  doCorrect --> correctedBadge[Row now shows\nCorrected badge]
  correctedBadge --> clickThrough[Click-through: original lines\nshaded/struck + reversal + new entry]
  correctQ -- no --> complete([Flow complete])
  clickThrough --> complete
```

**Notes**
- **The locked leg is always the custodial cash side** — verified bank reality (the Plaid transaction itself), never editable, in the two-line preview, the Split grid, or the Group modal. **The suggested offset leg** is pre-filled from historical rules + the Plaid category and overridden in place via an inline search dropdown, never a blank field.
- **Split** is one draft → one multi-leg entry, live-validated: submission stays disabled until the rows sum exactly to the raw transaction's absolute total. **Group** is many drafts → one entry (the one many-to-one case, ARCH §3) via the shared journal-entry modal, pre-filled with one aggregate line + balancing distributions.
- **An unmatched transfer leg stays a staged draft** in Pending until its counterpart arrives (then it matches like any transfer), or until the user explicitly approves it into Cash in Transit as a one-sided in-flight item — a balanced entry, cash leg against the CIT clearing account, cleared when the counterpart posts. A draft still unmatched past the exceptions threshold moves to Exceptions.
- **Posting gate:** Σ debits = Σ credits; the accounting equation holds per entity; the entry date matches the bank date (or the Cash-in-Transit rule); every posted draft links to exactly one entry. Any failure keeps the item in Pending — no partial or silent post.
- A posted row's user-facing action is **"Correct entry"**, never "edit" or "reverse" — reversal-only underneath (PRD §5). Click-through shows the full trail: original lines shaded/struck, the reversal, and the new entry. See design-system-spec.md § Correcting a posted entry.
- Badges: `Draft (staged)` (`--secondary`, clock), `Posted` (`--outline`, check), `Corrected` (`--outline` + `--brand-2`-tinted dot, pencil). An auto-posted row carries `Posted` plus a `posted by rule — <name>` line and the same Correct entry action.
- Actor attribution (user / auto-post rule / system job) is shown on every draft and posted row, never inferred (PRD §5).
- Import stats and link status (provider sync time, link health) show as a banner at the top of Transactions, not as a separate nav item.
