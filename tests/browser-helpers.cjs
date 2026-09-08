'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://catski.test';

// Only injected into test responses. Production has no debug API.
const hook = `
  window.__test = {
    snapshot: () => ({ state, keys: { ...keys }, player: { ...player },
      stats: { ...stats }, objects: objects.map(object => ({ ...object })), worldY, activeRunConfig, completedRun }),
    start: () => startRun(),
    frame: timestamp => loop(timestamp),
    pause: () => pauseGame(),
    resume: () => resumeGame(),
    update: () => update(),
    spawn: (y, density) => spawnObjectsAround(y, density),
    crash: cause => crash(cause),
    setAir(frames = 120) {
      player.air = player.airMax = frames;
      player.trick = null;
      player.trickChain = [];
      syncTrickControls();
    },
    stage(values) {
      if (values.player) Object.assign(player, values.player);
      if (values.stats) Object.assign(stats, values.stats);
      if ('objects' in values) objects = values.objects;
      if ('yeti' in values) yeti = values.yeti;
      syncTrickControls();
    },
    finish(score = 100000) {
      stats.distance = score;
      stats.flags = stats.jumps = stats.trickScore = 0;
      endRun('TEST RUN', 'REGRESSION CHECK', 'tree');
    },
    save: (...args) => insertLeaderboardEntry(...args),
    boards: () => leaderboardCache,
    share: () => shareRun()
  };
`;

async function createHarness() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const contexts = new Set();
  async function openGame({ viewport = { width: 1280, height: 900 }, mobile = false,
    storage = {}, manualClock = false, storageFailure = null, userAgent, context: existingContext } = {}) {
    const context = existingContext || await browser.newContext({ viewport,
      isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', acceptDownloads: true,
      ...(userAgent ? { userAgent } : {}) });
    if (!existingContext) {
      contexts.add(context);
      await context.addInitScript(({ storage, manualClock, storageFailure }) => {
        if (!localStorage.getItem('__catski_test_seeded')) {
          for (const [key, value] of Object.entries(storage)) {
            if (value !== null) localStorage.setItem(key, value);
          }
          localStorage.setItem('__catski_test_seeded', '1');
        }
        if (storageFailure === 'read') {
          Storage.prototype.getItem = () => { throw new DOMException('Blocked storage', 'SecurityError'); };
        } else if (storageFailure === 'write') {
          Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
        }
        if (manualClock) window.requestAnimationFrame = () => 1;
        // Deterministic world generation and no external telemetry.
        let seed = 12345;
        window.__resetRandom = () => { seed = 12345; };
        Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        window.__analyticsEvents = [];
        window.mixpanel = {
          __SV: 1.2, optedIn: false,
          init(token, config) { this.config = config; config.loaded?.(this); },
          opt_in_tracking() { this.optedIn = true; },
          opt_out_tracking() { this.optedIn = false; },
          has_opted_in_tracking() { return this.optedIn; },
          has_opted_out_tracking() { return !this.optedIn; },
          register() {},
          track(name, properties) { if (this.optedIn) window.__analyticsEvents.push({ name, properties }); }
        };
      }, { storage: { skior_cookies: 'declined', skior_audio: 'off', ...storage }, manualClock, storageFailure });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) return route.abort();
        const filename = path.resolve(ROOT, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
        if (!filename.startsWith(ROOT + path.sep)) return route.abort();
        try {
          if (filename === path.join(ROOT, 'index.html')) {
            const source = await fs.readFile(filename, 'utf8');
            const marker = '  // Kick things off\n';
            assert.equal(source.split(marker).length, 2, 'Game test-hook marker is unique');
            return route.fulfill({ contentType: 'text/html', body: source.replace(marker, hook + marker) });
          }
          return await route.fulfill({ path: filename });
        } catch (error) {
          return route.fulfill({ status: 404, body: 'Not found' });
        }
      });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__test);
    await page.evaluate(() => document.fonts.ready);
    return { page, context, errors };
  }
  return { openGame, browser, origin: ORIGIN,
    async close() { for (const context of contexts) await context.close(); await browser.close(); } };
}

module.exports = { createHarness, ROOT, ORIGIN };
