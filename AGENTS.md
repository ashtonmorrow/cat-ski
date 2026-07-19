# Analytics Tracking — Mixpanel

This project uses **Mixpanel** for product analytics, running alongside Google Analytics 4. Do not introduce any other analytics tools, SDKs, or tracking libraries without explicit instruction from a user.

---

## Before You Add or Modify Any Tracking

⛔ **Do not write Mixpanel tracking code without reading this file first.**

### Mandatory checklist before writing any Mixpanel code

- [ ] Use the Mixpanel **browser** SDK (already loaded via CDN snippet in `index.html`). Do not add a second SDK.
- [ ] No CDP is in use — track through the Mixpanel SDK directly.
- [ ] Consent gating **is required**: no event may fire before the visitor accepts the cookie banner. The SDK is opted-out by default; see below.
- [ ] Review the existing tracking plan below before adding new events. Reuse names and property conventions.

---

## Tech Stack

| Detail | Value |
|---|---|
| **Platform** | Single-file static site — vanilla HTML/CSS/JS, HTML5 Canvas, no build step, no framework |
| **Mixpanel SDK** | `mixpanel-browser` (2.x), loaded from `cdn.mxpnl.com` via the standard snippet |
| **Tracking method** | Client-side only |
| **CDP** | none |
| **Consent required** | **yes** — reuses the existing cookie banner (localStorage key `skior_cookies`) |
| **Project token** | Hardcoded in `index.html` head. This is intentional: it is a browser (publishable) token, the site has no build/env system, and GA's ID is hardcoded the same way. Do not treat it as a secret. |
| **Environments** | One project. Every event carries an `environment` super-property: `production` on `ski.mike-lee.me`, `development` everywhere else (localhost, previews). Filter `environment == "development"` out of real analysis. |

---

## Mixpanel Initialization

Initialized once in the `index.html` `<head>`, immediately after the GA block:

```js
mixpanel.init('<token>', {
  opt_out_tracking_by_default: true,   // nothing sends until consent
  persistence: 'localStorage',
  track_pageview: false,
  ignore_dnt: false,
});
// returning visitor who already accepted:
if (localStorage.getItem('skior_cookies') === 'accepted') mixpanel.opt_in_tracking();
```

Consent opt-in for a first-time accept is wired into the cookie banner's OK handler (bottom of `index.html`): `mixpanel.opt_in_tracking()` fires there, next to the existing `gtag('consent', ...)` grant. Decline leaves the SDK opted-out; no events send.

**Do not** initialize Mixpanel anywhere else or create additional instances.

---

## Identity

**None. This game has no accounts and no login.** All tracking is anonymous, keyed to Mixpanel's auto-generated `$device_id`. Do **not** add `identify()`, `reset()`, or user profiles — there is no stable user ID to anchor them to, and adding them would create orphaned profiles. If accounts are ever introduced, wire `identify()` on login and `reset()` on logout at that point.

---

## Tracking Plan

All tracking runs through one thin wrapper in the game IIFE — call it, don't call `mixpanel.track` directly:

```js
analytics('event_name', { property_name: value });   // no-op while opted out
```

Super-properties (auto-attached to every event, registered in `registerSuperProps()`): `platform` (`web`), `environment`, `display_mode` (`standalone`/`browser`), `language` (`en`/`es`).

### Naming conventions

- Event names: `snake_case`, past-tense `object_verb` (e.g. `run_completed`).
- Property names: `snake_case`, no abbreviations. Values lowercase.
- Never use `$` / `mp_` prefixes on custom names. Send numbers unquoted.

### Current events

| Event | Trigger | Key properties | Location in `index.html` |
|---|---|---|---|
| `game_started` | a run begins | `cat_color`, `mountain_theme`, `intensity`, `dog_count`, `lives_mode`, `control_mode`, `is_touch` | `startRun()` |
| `run_completed` ⭐ | a run ends (Value Moment) | `score`, `distance_m`, `duration_seconds`, `cause` (`tree`/`log`/`dog`/`snowman`), `cat_color`, `mountain_theme`, `intensity`, `dog_count`, `lives_mode`, `tricks_landed`, `flags_collected`, `jumps`, `qualified_for_leaderboard` | `endRun()` |
| `leaderboard_submitted` | player enters a name on a top-3 run | `score`, `rank`, `lives_mode`, `name_length` | `submitLbEntry()` |
| `run_shared` | share succeeds | `method` (`web_share_file`/`web_share_text`/`download`/`clipboard`), `score` | `shareRun()` |
| `pwa_installed` | app installed to home screen | — | `appinstalled` listener |

---

## How to Add a New Event

1. Check the table above — reuse an existing event/property before creating a new one.
2. Name it `snake_case`, past tense, descriptive. No dynamic/runtime-constructed names.
3. Include only properties available at the moment it fires. No PII (no names, emails, IPs).
4. Call `analytics('event_name', {...})` at the point the action actually succeeds.
5. Update the table above.
6. Verify in Mixpanel Live View (`environment == "development"` while testing).

---

## What Not to Do

- Do not add another analytics tool. GA4 + Mixpanel is the full set.
- Do not call `mixpanel.track` directly — use `analytics()`, which respects the consent gate.
- Do not fire events before consent, or on a timer/loop.
- Do not track PII as properties.
- Do not add `identify()`/`reset()` — this game is anonymous by design (see Identity).

---

## Governance next steps (Mixpanel UI — not done in code)

These require the Mixpanel web UI and are not yet set up:

- **Lexicon** (Data Management → Lexicon): add a one-line description for each of the 5 events above.
- **Data Standards** (Project Settings): require `snake_case`.
- Delete the `integration_test` / `gate_test_*` events created during setup verification, or just filter `environment == "development"`.
- Optional: create a dedicated **dev project** for hard isolation instead of the `environment` super-property split.
