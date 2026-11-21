# POLY-137g: wording review (ux-designer)

Pages as built at `8e6ed534`: `apps/web/src/routes/sign-in/{+page,forgot/+page,reset/+page,cancel-method/+page}.svelte`. Judged against DESIGN's voice (plain, short sentences that say what happened and what to do; the same word for the same thing on every page), the built Sign in, Sign up and second-step pages, and the ruling (R1.7, R2.5, R3.7, D3).

**31 strings: 28 ACCEPT, 3 changes** (one marked needs architect). The two constraints hold for every string: the forgot page reads the same for a known and an unknown address, and nothing reveals whether an account exists or what methods it has.

## `/sign-in`

| # | String | Source | Verdict |
|---|---|---|---|
| 1 | `Forgot your password?` (link) | R2.5 | ACCEPT. DESIGN's Login mock is aligned to it. |

## `/sign-in/forgot`

| # | String | Source | Verdict |
|---|---|---|---|
| 2 | `polycarpic` (wordmark) | builder | ACCEPT. Same wordmark on all three pages. |
| 3 | `Reset your password` (h1) | builder | ACCEPT. Matches the mail's subject. |
| 4 | `Email` (label) | builder | ACCEPT. Same label as Sign in. |
| 5 | `Send the link` (button) | builder | ACCEPT. |
| 6 | `If that address has an account, we have sent it a link. The link works for 15 minutes.` | R2.5 | ACCEPT. Security text: identical for any address. |
| 7 | `Back to sign in` (link, form and sent states) | builder (one of the four) | ACCEPT. Neutral. Shown in both states, so it reveals nothing. |
| 8 | `Too many tries. Wait a minute and try again.` (429) | builder (one of the four) | ACCEPT. A 429 here comes only from the per-IP limit (C-04). A capped address gets the unknown-address 200 (R1.8, M30), so the 429 reveals nothing about the address. The text matches the ruling's cancel-page 429. |
| 9 | `Could not send the link. Try again.` (other error, network) | builder | ACCEPT. Not-ok answers are the same for known and unknown addresses (R2.6 c, d, g). |

## `/sign-in/reset`

| # | String | Source | Verdict |
|---|---|---|---|
| 10 | `polycarpic` | builder | ACCEPT. |
| 11 | `Choose a new password` (h1) | builder | ACCEPT. Echoes the mail ("choose a new password"). |
| 12 | `New password` (label) | builder | ACCEPT. |
| 13 | `New password again` (label) | builder | ACCEPT. |
| 14 | `Change password` (button) | builder | ACCEPT. Same verb as Settings' Change password. |
| 15 | `The two passwords do not match.` | builder (one of the four) | ACCEPT. Checked in the browser, before any request. |
| 16 | `Too many tries. Wait a minute and try again.` (429) | builder (a fifth string the dispatch did not list) | ACCEPT. Per-IP limit (R2.4); the same text as #8 and #30. |
| 17 | `body.message` from the server, shown as it comes | builder | **CHANGE.** Show our own text keyed on `body.code`: `PASSWORD_TOO_SHORT` → `Use at least 8 characters.`; `PASSWORD_TOO_LONG` → `Use at most 128 characters.`; any other code → #18. **Why:** BetterAuth's English ("Password too short") is not our voice and can change at a library upgrade without a test noticing. No other page shows a server message. 8 and 128 are BetterAuth's defaults (no `minPasswordLength` is set). The builder confirms the codes against `password.mjs`. |
| 18 | `Could not change the password.` (fallback, network) | builder | **CHANGE** → `Could not change the password. Try again.` **Why:** the same shape as forgot's #9 and cancel's #31: say what failed, then what to do. |
| 19 | `Your password is changed and every device is signed out.` | R2.5 | ACCEPT. |
| 20 | `Sign in` (link after done) | builder | ACCEPT. |
| 21 | `This link no longer works. Ask for a new one.` (invalid token, no token) | R2.5 | ACCEPT. One text for a bad, used, expired or missing token. |
| 22 | `Ask for a new link` (link to forgot) | builder | ACCEPT. |

## `/sign-in/cancel-method`

| # | String | Source | Verdict |
|---|---|---|---|
| 23 | `polycarpic` | builder | ACCEPT. |
| 24 | `Cancel the new sign-in method` (h1) | R3.7 | ACCEPT. |
| 25 | `Someone added a sign-in method to your account. If it wasn't you, cancel it. This removes the new method and signs your account out on every device.` | R3.7 | ACCEPT. It names no method, so it reveals nothing to someone holding a link, and it is shown before any request. |
| 26 | `Cancel the new method` (button) | R3.7 | ACCEPT. |
| 27 | `Cancelled. The new method is removed and every device is signed out. Sign in and change your password now.` | R3.7 | ACCEPT. |
| 28 | `Sign in` (link after done, after invalid) | builder | ACCEPT. |
| 29 | `This link no longer works. It may have been used already, or the 24 hours are over. Sign in, check Settings, Second step, and change your password if anything there is not yours.` | R3.7 | **CHANGE, needs architect** → `This link no longer works. It may have been used already, or the 24 hours are over. Sign in, check Settings, Sign-in and second step, and change your password if anything there is not yours.` **Why:** the Settings panel is titled "Sign-in and second step" (`settings/second-step/+page.svelte`, DESIGN 5.11), so "Second step" names a place the user will not find. This is a navigation fix, not a security change. It is marked for the architect because R1.7's "link not armed" mail has the same "Settings, Second step" and should change in the same ruling. |
| 30 | `Too many tries. Wait a minute and try again.` (429) | R3.7 | ACCEPT. |
| 31 | `Could not cancel. Try again.` (network) | builder (one of the four) | ACCEPT. The same shape as #9 and #18. |

## Outside the strings (not counted)

- **No page title.** None of the three pages (or Sign in) sets `<title>`, so the tab shows the URL. Recommended, cheap, and it helps screen readers (WCAG 2.4.2): `<svelte:head><title>Reset your password · polycarpic</title>` on forgot, `Choose a new password · polycarpic` on reset, `Cancel the new sign-in method · polycarpic` on cancel-method. Static strings, so nothing is revealed. This is the lead's call, in this loop or later.
- **"tries" and "attempts".** Sign in, Sign up and the second-step page say `Too many attempts. Wait a minute and try again.`; the three new pages say `Too many tries.` (the ruling's cancel text). DESIGN's plain word is "tries" ("10 wrong tries"). The older pages should move to "tries" when they are next touched. Not a blocker for this loop.
