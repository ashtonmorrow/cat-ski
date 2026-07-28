# Architecture Review — cat-ski — 2026-07-27

Run: qa-kit@8a51f983. Read-only audit.

## Verdict
For a single-file vanilla game this is in good shape: consistent idioms (21 uniform `catch(_){}`, one `skior_` storage prefix across all 14 keys), zero dead functions, clearly comment-bannered sections, and a clean analytics layer. The one structural risk with teeth was a silent-failure hide mechanism that shipped a bug (now fixed in this pass). The second theme is that `readme.html` is a shadow front-end that hand-copies `index.html`'s shared chrome.

## Scorecard
| Dimension | Rating | Note |
|---|---|---|
| Layer clarity | Holding | Single-file by design; internal sections well-marked |
| Reuse | Drifting | Tokens, fonts, and the whole cookie banner live twice (index + readme) |
| Consistency | Holding | Was two hide mechanisms (one failed silently); unified this pass |
| Dead weight | Strong | No dead functions; one tiny legacy migration shim |

## P1 — Urgent

### ARCH-CON-hidden-attr-hide — FIXED 2026-07-27
**Where:** was `index.html` `#install-group[hidden]` / `.cookie-banner[hidden]` bespoke overrides vs the `.hidden` class approach.
**Problem:** The bare `[hidden]` attribute is silently defeated by any author `display` rule, so it only hid where someone remembered a per-element override.
**Cost:** Shipped a real bug — the install button was visible to every user on every platform until hotfixed.
**Resolution:** Added a global `[hidden] { display: none !important; }` and removed the two bespoke overrides. Verified: install-group + cookie-banner hide correctly, `.hidden` class path unaffected, reveal/re-hide work.
**Effort:** S (done)

## P2 — Worthwhile

### ARCH-DUP-shared-chrome — DEFERRED (see decisions.md)
**Where:** `readme.html` vs `index.html` — `:root` tokens (readme's 19 are a subset of index's 34), both `@font-face` blocks, and the whole cookie-consent component (CSS + markup + `close()`/accept/decline JS + GA Consent-Mode at `readme.html:685-695`).
**Problem:** `readme.html` re-declares index's shared chrome by hand. Identical today, but every change must be mirrored or they drift.
**Cost:** Real on every visit to shared chrome. The consent duplication is the sharp edge — a consent change made in one file and forgotten in the other is a compliance drift.
**Refactor:** Extract shared tokens + `@font-face` into a committed `theme.css` both files `<link>`, and the consent banner into one `consent.js` both files load. Same-origin static assets, no build step needed.
**Effort:** M

## P3 — Taste
- `ARCH-DEAD-legacy-best-key` — `index.html` migrates the pre-`skior_bests` singular `skior_best` key. One line, harmless, still helps returning players with the old key. Drop whenever the migration window is considered closed.

## Phased plan
1. **Stop the bleeding** — ARCH-CON-hidden-attr-hide. **Done this pass.**
2. **Consolidate** — ARCH-DUP-shared-chrome: extract `theme.css` + `consent.js`. Consent first (higher stakes), tokens/fonts second. Deferred by owner.
3. **Opportunistic** — drop the legacy `skior_best` shim next time that area is touched.

## Not covered
- Binary assets (icons, fonts, `preview.png`) — inventory only.
- `sw.js` cache correctness — read for structure, not exercised against the actual request set.
- Runtime behavior — static read only; the game loop was not exercised (headless-preview rAF throttle).
- `readme.html` prose/SEO — treated as content, not audited.
