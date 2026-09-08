# Previous-release PWA fixture

`release-e7e36c2.json.gz` contains exact UTF-8 sources from commit
`e7e36c2567713d8133b2c02865bbf7186f9c40b7`: `index.html`, `readme.html`,
`storage.js`, `consent.js`, `sw.js`, and `manifest.json`. Each entry includes
its SHA-256 hash. The deterministic gzip bundle hash is
`77c61db66fccaf90ce8a3a1bf174dff57770d832ac14033f95880ae4e2960124`.

The upgrade test serves these sources before switching the same origin to
the candidate checkout. Artwork, icons, and fonts reuse the unchanged assets
in the checkout. This fixture tests an actual v23 service-worker/client
upgrade without requiring Git history or network access in CI.

The offline phase physically closes the HTTP server after requests settle,
then enables browser-context offline mode and opens a fresh tab. Cached game
and guide responses must come from the service worker, an uncached request
must reject, and no origin request may arrive. Chromium 151 and local Chrome
can report `navigator.onLine=true` after that cached navigation even though
offline mode was enabled; the test reports this emulation inconsistency and
uses the unavailable transport to prove offline behavior independently.

Regenerate deliberately when choosing a new baseline: read each listed file
with `git show <full-commit>:<path>`, encode a JSON object containing `revision`
and `files` (`source` and `sha256` per path), then gzip with `mtime=0`. Do not
rewrite the baseline's version numbers to simulate an older release.
