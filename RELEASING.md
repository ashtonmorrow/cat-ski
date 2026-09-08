# Releasing Cat Ski

## Automated gate

Run `npm ci`, `npx playwright install chromium webkit firefox`, and `npm test`.

The suite includes isolated regressions, natural gameplay progression, an upgrade from a pinned previous release, and smoke flows in Chromium, WebKit and Firefox. The test-only hooks are injected into local responses and do not ship to players.

Linux CI runs WebKit headed under Xvfb (`PLAYWRIGHT_WEBKIT_HEADED=1 xvfb-run -a npm test`). This avoids the headless backend used in reports of stalled animation frames and actionability checks ([upstream report](https://github.com/microsoft/playwright/issues/33057), [Playwright CI guidance](https://playwright.dev/docs/ci#running-headed)). The smoke flow keeps the normal animation clock and native pointer/keyboard checks; it does not force clicks or retry failed assertions.

Push a working branch and wait for its `Regression tests` check to pass on the exact commit. Fast-forward or merge the checked commit to protected `main`; Vercel's Git integration publishes it. After deployment, verify the custom domain serves the expected commit/assets.

When changing cached application files, update the cache version and shared script query versions together, plus the corresponding cache assertions. The upgrade fixture's provenance is recorded in `tests/fixtures`; it represents an actual earlier release.

## Native-device release checks

WebKit automation exercises its browser engine. It does not exercise the installed iOS app, the operating system's Share sheet, or a physical touchscreen. Record device/OS/browser and results for these checks when shipping changes to those areas:

- On iPhone Safari and Android Chrome, start with the visible START action, steer, pause, rotate, open Settings, and resume. Keep the game and controls usable in both orientations.
- With the screen reader enabled, find START/RETRY through button navigation. Confirm controls and the playing field have names, and start/pause/resume/results are announced without continual score chatter. The downhill gameplay itself remains visual.
- Enable the OS reduced-motion preference. Confirm crash shake and invulnerability blinking are suppressed, including a preference change while the page is open.
- Finish a run, open Share, and cancel. Confirm it returns to the result without another prompt, download, or clipboard action.
- Check Safari's installation instructions. On a browser offering native installation, dismiss its prompt and confirm no dead Install button remains; test installation when an offer is available.
- Install and open the game from the home screen, background it, lock/unlock the phone, and resume. Check that sound and input recover without advancing the paused run.
- Load the release online, switch the device offline, and relaunch the installed game. Play a run and open the guide. For an update, repeat in an existing installation with saved scores/preferences.

Do not record an emulated device, a mocked OS prompt, or an unperformed step as a physical-device pass. Keep the native results with the release record.
