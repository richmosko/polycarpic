# Styled Screens

Every page of the product, rendered with the design system. There is one fidelity tier: every page is a styled screen.

- **Format:** self-contained HTML that links the design system:
  ```html
  <link rel="stylesheet" href="../tokens.css">
  <link rel="stylesheet" href="../screen.css">
  ```
  Use the token-backed component classes (`.btn`, `.input`, `.card`, …). Never hardcode values.
- **Naming:** `<screen>.html` (e.g. `dashboard.html`, `settings.html`).
- **Shell:** app screens reuse the sidebar-07 shell verbatim. Copy it from `dashboard.html`, and point every nav link at the real screen file. Shell-less pages (membership setup, Admin) use `.app-bar`.
- **Explanatory notes** go in an HTML comment at the top of the file. They are never rendered as on-screen text.
- **States shown open** (menus, popovers, dialogs) are static references. They are listed in `../design-system-spec.md` § Screen list.
- **Review check:** each screen renders with 0 console errors and no page or in-card overflow at 960px and 1280px, in light mode and in dark mode (`.dark` on `<html>`).
- **Thumbnails:** `thumbs/<screen>.png` (1280×800 light, scaled to 640px wide) feed the gallery in `../index.html` § Screens. Regenerate them whenever a screen changes visibly.
- **Why HTML, not just images:** these double as a visual-regression reference and a head start for `frontend-lead` during Implement. The markup + token usage is the contract.
