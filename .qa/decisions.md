# QA decisions

Adjudicated calls that arch-review should not re-raise. See `arch-review` skill rule 3.

## Settled

- **ARCH-DUP-shared-chrome** (2026-07-27) — Deferred, not rejected. `readme.html` duplicating index's tokens/fonts/cookie-banner is known and accepted for now; extraction into `theme.css` + `consent.js` is planned as a deliberate pass, not urgent. Re-surface only if the copies actually drift.
- **Single-file `index.html`** — Not a finding. Single-file, no-build is the project's stated purpose (see README). Do not report the monolith as drift.
- **Hardcoded Mixpanel/GA tokens** — Not a finding. Publishable browser tokens, no env system; documented as intentional in AGENTS.md.
- **Late-game ordinary ramps** (2026-09-08) — Owner accepts ordinary jumps/moguls disappearing at maximum difficulty; dog escape ramps remain. Do not rebalance this as an implementation cleanup.
- **Personal leaderboard comparison** (2026-09-08) — Keep the local top-three boards separated by lives mode, combining custom difficulties. This is a personal score record; the guide explains the comparison. Per-configuration BEST remains separate. Do not add accounts, a backend, or a board for every slider combination to address this tradeoff.
