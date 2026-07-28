# QA decisions

Adjudicated calls that arch-review should not re-raise. See `arch-review` skill rule 3.

## Settled

- **ARCH-DUP-shared-chrome** (2026-07-27) — Deferred, not rejected. `readme.html` duplicating index's tokens/fonts/cookie-banner is known and accepted for now; extraction into `theme.css` + `consent.js` is planned as a deliberate pass, not urgent. Re-surface only if the copies actually drift.
- **Single-file `index.html`** — Not a finding. Single-file, no-build is the project's stated purpose (see README). Do not report the monolith as drift.
- **Hardcoded Mixpanel/GA tokens** — Not a finding. Publishable browser tokens, no env system; documented as intentional in AGENTS.md.
