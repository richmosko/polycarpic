# Polycarpic UX prototype (throwaway)

A SvelteKit dev server that serves the 15 `docs/DESIGN/styled-screens/` pages as running routes, so look-and-feel is judged on live pages (POLY-123).

## Start

```
cd prototype && npm install && npm run dev
```

Opens on <http://localhost:5173/> (redirects to `/home`; `--strictPort`, so it fails rather than moves). Smoke check (server running): `npm run smoke` hits every route at 960 and 1280, light and dark, and fails on console errors or page/card overflow. It uses an installed Chrome (`CHROME=/path` to override).

## How it is built

- **Tokens:** `src/routes/+layout.svelte` imports `../../../docs/DESIGN/tokens.css` and `screen.css` by relative path. No copy, no symlink: the prototype can never drift from DESIGN. No palette value is written in any prototype file.
- **Routes:** one per screen under `src/routes/<screen>/`. `npm run gen` regenerates `src/lib/screens/*.ts` from the DESIGN HTML (comments stripped, `x.html` links rewritten to `/x`, so sidebar and click flows are real client-side navigation). Hash states (`/login#local`, `#second-step`, `/transactions#pending`, `/general-ledger#je-…`) work.
- **Shell:** the sidebar-07 shell is `+layout.svelte` (active item per route; avatar menu and the page "more" menu open on click, they are closed by default instead of drawn open; "Theme" in the avatar menu and the corner button switch light/dark, `.dark` on `<html>`). Shell-less screens (home, get-started, admin, login, sign-up) render without it.
- **Fixtures:** `src/lib/fixtures/shell.ts` (`EntityList`, nav mapping).

## What is faked

Everything. Screen bodies are DESIGN's markup verbatim, so their numbers are DESIGN's sample data, not computed from fixtures. Charts are DESIGN's static SVG/CSS (treemap, bars, lines); no chart library (LayerChart, per ARCH §5, arrives with the real app). No backend, auth, persistence or state beyond the theme in `localStorage`.

## Deletion trigger

Delete `prototype/` once the real app's first screens ship. DESIGN keeps the screenshots (`docs/DESIGN/styled-screens/thumbs/`) as the durable record.
