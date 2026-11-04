# Flow: Transactions — review, match & correct

**Story (PRD §4.3):** As the Principal, I want my bank and brokerage transactions imported automatically and staged for review, so that I can review and confirm them instead of hand-entering every transaction.

```mermaid
flowchart TD
  nav([Open Transactions\nfrom the sidebar]) --> filter[Account filter:\nAll Transactions by default,\nor one custodial account]
  filter -. scopes .-> tabs[Tabs with count badges:\nExceptions, Pending, Posted;\nopens on Pending]
  tabs --> stage
  tabs --> exceptions
  tabs --> posted
  poll([Plaid adapter polls\nor fake source generates batch]) --> stage[Raw transaction lands\nin the Pending tab]
  stage --> transfer{Two legs match\nwithin date window?}
  transfer -- same posting date --> autoEntry[Locked debit leg +\nsuggested offset leg\ntwo-line preview]
  transfer -- different dates --> citEntry[Two entries via\nCash in Transit clearing account]
  transfer -- unmatched --> openItem[Remains a single-leg\nPending row]
  openItem -- counterpart arrives --> transfer
  openItem -- user approves into CIT --> citOne[One-sided in-flight item:\ncash leg vs. Cash in Transit,\ncounterpart still to come]
  citOne --> post
  openItem --> aging{Older than\nexceptions threshold\ndefault 3 business days?}
  aging -- yes --> exceptions[Surface on\nExceptions tab]
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
  commit --> posted([Each transaction appears on\nPosted with the Journal ID,\npaged])
  exceptions --> resolve{Resolved manually?}
  resolve -- yes --> post
  resolve -- no --> exceptions
  posted --> correctQ{User clicks\nCorrect entry?}
  correctQ -- yes --> doCorrect[System posts the reversal\n+ the new corrected entry\nuser never sees reverse as the verb]
  doCorrect --> correctedBadge[The entry's rows now show\nCorrected badge]
  correctedBadge --> clickThrough[Click-through: original lines\nshaded/struck + reversal + new entry]
  correctQ -- no --> complete([Flow complete])
  clickThrough --> complete
```

**Notes**
- **Account filter.** A selector at the right end of the tab row scopes Exceptions, Pending and Posted together, count badges included. Opening Transactions from the sidebar always lands on **All Transactions** (every custodial account in the entity); the popover lists each custodial account by the name Custodial Accounts uses, with its provider and open-item counts. The Known delta badge on a Custodial Accounts card deep-links here with the filter preset to that account.
- **Tabs with count badges.** Exceptions, Pending and Posted are one `Tabs` row, left of the account filter, one visible at a time, in urgency order. Each tab carries its count, so every stage's load stays visible while another is open: `secondary`, `destructive-soft` on Exceptions when non-zero. Transactions opens on Pending, the review inbox; a non-zero Exceptions count does not take the default, its badge is red instead. The counts follow the account filter, changing the filter keeps the current tab, and the URL hash carries the tab.
- **Every row names its source.** Each Exceptions, Pending and Posted row carries one muted line under the payee: `landmark` icon + `<account> · <institution> via <provider>` (e.g. "Primary Checking · Bank Y via Plaid"). With the filter on one account, the line is omitted — the trigger already names it.
- **The locked leg is always the custodial cash side** — verified bank reality (the Plaid transaction itself), never editable, in the two-line preview, the Split grid, or the Group modal. **The suggested offset leg** is pre-filled from historical rules + the Plaid category and overridden in place via an inline search dropdown, never a blank field.
- **Split** is one draft → one multi-leg entry, live-validated: submission stays disabled until the rows sum exactly to the raw transaction's absolute total. **Group** is many drafts → one entry (ARCH §3), the same many-to-one shape as a same-date matched transfer, via the shared journal-entry modal, pre-filled with one aggregate line + balancing distributions.
- **Posted is transaction-scoped.** Every posted transaction is a row, mirroring Pending, and carries its entry's Journal ID. An entry built from several transactions appears as several rows with one ID: a group, or a same-date matched transfer (two legs, one entry). The rows sit together, because an entry has one date and same-date rows order by Journal ID. A split stays one row, however many legs its entry has. A transfer whose legs land on different dates posts as two entries through Cash in Transit, so its two rows carry two IDs. With the filter on one account, only that account's leg of a transfer shows. The Posted badge counts transactions, so it differs from the entry count on the GL Journal entries card, which is the entry-grained view.
- **An unmatched transfer leg stays a staged draft** in Pending until its counterpart arrives (then it matches like any transfer), or until the user explicitly approves it into Cash in Transit as a one-sided in-flight item — a balanced entry, cash leg against the CIT clearing account, cleared when the counterpart posts. A draft still unmatched past the exceptions threshold moves to Exceptions.
- **Posting gate:** Σ debits = Σ credits; the accounting equation holds per entity; the entry date matches the bank date (or the Cash-in-Transit rule); every posted draft links to exactly one entry, and several drafts may share it (a group, a same-date matched transfer). Any failure keeps the item in Pending — no partial or silent post.
- A posted row's user-facing action is **"Correct entry"**, never "edit" or "reverse" — reversal-only underneath (PRD §5). Click-through shows the full trail: original lines shaded/struck, the reversal, and the new entry. Correct entry on any row of a multi-row entry corrects that one entry, and every row of it then carries the corrected entry's ID and the Corrected badge. See design-system-spec.md § Correcting a posted entry.
- Badges: `Draft (staged)` (`--secondary`, clock), `Posted` (`--outline`, check), `Corrected` (`--outline` + `--brand-2`-tinted dot, pencil). An auto-posted row carries `Posted` plus a `posted by rule — <name>` line and the same Correct entry action.
- Actor attribution (user / auto-post rule / system job) is shown on every draft and posted row, never inferred (PRD §5).
- Import stats and link status (provider sync time, link health) show as a banner at the top of Transactions, not as a separate nav item.
