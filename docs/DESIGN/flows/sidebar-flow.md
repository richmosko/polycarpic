# Flow: Sidebar & app shell

**Story:** As a signed-in user, I want one consistent shell on every app screen — the sidebar, the header's entity selector and my account menu — so that I can move between screens and entities without thinking about where things are.

```mermaid
flowchart TD
  load([Any app screen loads]) --> state{Remembered\nsidebar state}
  state -- expanded --> full[Expanded, ~240px:\nmark + wordmark, collapse button,\n8 labelled items, avatar + name]
  state -- collapsed --> rail[Icon rail, ~64px:\nmark, 8 icons, avatar]
  full -- collapse button --> rail
  rail -- click the mark --> full
  full --> nav[Pick a nav item:\nDashboard, Transactions, General Ledger,\nCustodial Accounts, Allocation,\nTax, Reports, Entities]
  rail --> nav
  nav --> screen([Screen renders,\nitem marked current])
  full --> avatar[Avatar trigger]
  rail --> avatar
  avatar --> pop[Popover to the right:\nProfile, Settings, Notifications,\nPreferences, Theme, Shortcuts, Log out]
  pop -- Settings --> settings([Settings:\nno nav item active])
  header([Header entity selector:\nname + avatar cluster]) --> switcher[Entity switcher:\nentities by membership]
  switcher --> rescope([Current screen re-renders\nfor the chosen entity])
```

**Notes**
- **Eight flat items, no nesting** (design-system-spec.md § Sidebar information architecture). Flat is what makes the icon rail work.
- **Collapse to an icon rail.** The cue sits in the brand row: expanded shows a `panel-left-close` button right of the wordmark; collapsed shows the mark alone, which is itself the expand button and swaps to `panel-left-open` on hover or keyboard focus.
- **Remembered state:** the expanded or collapsed choice persists per user across screens and reloads (shadcn `Sidebar`'s stored `open` state).
- **Header entity selector:** the current entity's name and its member avatar cluster (max 3 + "+N"); it opens the entity switcher, and the current screen re-renders for the chosen entity (flow 5.7).
- **Avatar popover** opens to the right of the trigger, in both widths. Settings and Notifications are proposed entry points (`.proposed-tag`); Log out is last, `--destructive`-styled.
- **Keyboard:** Tab order is brand-row button → nav items → avatar trigger; the header follows in the main region. Enter or Space activates; Esc closes the popover and returns focus to its trigger. Every control shows the `--sidebar-ring` focus outline.
