'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const { ROOT } = require('./browser-helpers.cjs');

const digest = text => createHash('sha256').update(text).digest('hex');
const cacheName = source => source.match(/const CACHE_NAME = '([^']+)'/)[1];
const scriptUrls = source => [...source.matchAll(/<script src="(\/(?:storage|consent)\.js\?v=\d+)"/g)].map(match => match[1]);
async function waitFor(predicate, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  assert.fail(message);
}

test('previous-release live tab upgrades, reloads and relaunches offline without losing saved data', { timeout: 60000 }, async t => {
  const compressed = await fs.readFile(path.join(__dirname, 'fixtures/release-e7e36c2.json.gz'));
  assert.equal(digest(compressed), '77c61db66fccaf90ce8a3a1bf174dff57770d832ac14033f95880ae4e2960124');
  const prior = JSON.parse(gunzipSync(compressed));
  assert.equal(prior.revision, 'e7e36c2567713d8133b2c02865bbf7186f9c40b7');
  for (const entry of Object.values(prior.files)) assert.equal(digest(entry.source), entry.sha256);
  const currentHtml = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const currentWorker = await fs.readFile(path.join(ROOT, 'sw.js'), 'utf8');
  const oldCache = cacheName(prior.files['sw.js'].source), newCache = cacheName(currentWorker);
  const oldScripts = scriptUrls(prior.files['index.html'].source), newScripts = scriptUrls(currentHtml);
  assert.notEqual(newCache, oldCache, 'The candidate must be an actual new service-worker release');
  assert.notDeepEqual(newScripts, oldScripts, 'The candidate has its own shared-script URLs');

  let candidate = false, failHtml = false, inflight = 0, lastRequestAt = 0;
  const requests = [];
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
    '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const server = http.createServer(async (request, response) => {
    inflight++;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; inflight--; } };
    response.once('finish', finish); response.once('close', finish);
    lastRequestAt = Date.now();
    const url = new URL(request.url, 'http://localhost');
    const filename = path.resolve(ROOT, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!filename.startsWith(ROOT + path.sep)) { response.writeHead(403); response.end(); return; }
    const relative = path.relative(ROOT, filename);
    requests.push({ candidate, url: request.url });
    if (failHtml && path.extname(filename) === '.html') {
      response.writeHead(503, { 'Content-Type': 'text/html' }); response.end('Temporary outage'); return;
    }
    try {
      const body = !candidate && prior.files[relative] ? prior.files[relative].source : await fs.readFile(filename);
      response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch (_) { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let originStopped = false;
  async function stopOrigin() {
    if (originStopped) return;
    originStopped = true;
    await new Promise(resolve => server.close(resolve));
  }
  let browser;
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext();
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(() => {
      if (localStorage.getItem('__upgrade_seeded')) return;
      const values = {
        skior_cookies: 'declined', skior_audio: 'off', skior_cat: 'black', skior_theme: 'rockies',
        skior_intensity: '1', skior_dogs: '2', skior_lives: '1', skior_lb_last_name: 'OLD',
        skior_bests: JSON.stringify({ '1.0_2_9': 1234, '2.5_5': 888 }),
        skior_leaderboard_v3: JSON.stringify({ lives9: [{ id: 'old-nine', name: 'OLD', score: 1234 }],
          lives1: [{ id: 'old-one', name: 'ONE', score: 888 }] }),
      };
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      localStorage.setItem('__upgrade_seeded', '1');
    });
    const errors = [];
    const makePage = async () => {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      return page;
    };
    const savedData = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
      .filter(key => key.startsWith('skior_')).sort().map(key => [key, localStorage.getItem(key)])));
    const loadedScripts = page => page.locator('script[src*="/storage.js"], script[src*="/consent.js"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')));

    const oldTab = await makePage();
    await oldTab.goto(origin);
    await oldTab.evaluate(() => navigator.serviceWorker.ready);
    await oldTab.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.deepEqual(await loadedScripts(oldTab), oldScripts);
    assert.ok(await oldTab.evaluate(async name => (await caches.keys()).includes(name), oldCache));
    await oldTab.locator('[data-cat="calico"]').click();
    await oldTab.locator('[data-theme="himalayas"]').click();
    await oldTab.locator('#overlay-start h1').click();
    await oldTab.waitForFunction(() => document.querySelector('#overlay-start').classList.contains('hidden'));
    await oldTab.locator('#btn-pause').click();
    assert.equal(await oldTab.locator('#overlay-paused').isVisible(), true);
    const before = await savedData(oldTab);
    await oldTab.evaluate(() => {
      window.__oldDocument = true;
      window.__oldController = navigator.serviceWorker.controller;
      window.__controllerChanges = 0;
      navigator.serviceWorker.addEventListener('controllerchange', () => { window.__controllerChanges++; });
    });

    candidate = true;
    const freshTab = await makePage();
    await freshTab.goto(origin);
    await freshTab.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    // Playwright's DOM predicate polling does not await async predicates.
    // Await these asynchronous storage/registration reads from Node instead.
    await waitFor(() => oldTab.evaluate(async ({ oldCache, newCache }) => {
      const names = await caches.keys();
      const registration = await navigator.serviceWorker.getRegistration();
      return navigator.serviceWorker.controller !== window.__oldController && window.__controllerChanges > 0 && registration.active?.state === 'activated' &&
        !registration.installing && !registration.waiting && names.includes(newCache) && !names.includes(oldCache);
    }, { oldCache, newCache }), 'Candidate controller activation and old-cache cleanup did not complete');
    assert.equal(await oldTab.evaluate(() => window.__oldDocument), true, 'Existing game document remains alive during activation');
    assert.deepEqual(await loadedScripts(oldTab), oldScripts);
    assert.equal(await oldTab.locator('#overlay-paused').isVisible(), true);
    assert.deepEqual(await savedData(oldTab), before);
    assert.equal(await oldTab.evaluate(async name => (await caches.keys()).includes(name), oldCache), false);
    assert.deepEqual(await loadedScripts(freshTab), newScripts);
    for (const url of newScripts) {
      assert.ok(requests.some(request => request.candidate && request.url === url), `${url} was fetched for the new release`);
      const cached = await freshTab.evaluate(async ({ name, url }) => {
        const response = await (await caches.open(name)).match(url);
        return response && { status: response.status, text: await response.text() };
      }, { name: newCache, url });
      assert.equal(cached.status, 200);
      assert.equal(cached.text, await fs.readFile(path.join(ROOT, new URL(url, origin).pathname), 'utf8'));
    }

    // The old JS instance can still resume under the new controller.
    await oldTab.locator('#btn-pause').click();
    assert.equal(await oldTab.locator('#overlay-paused').isVisible(), false);
    await oldTab.locator('#btn-pause').click();
    await oldTab.reload();
    assert.equal(await oldTab.evaluate(() => window.__oldDocument), undefined);
    assert.deepEqual(await loadedScripts(oldTab), newScripts);
    assert.deepEqual(await savedData(oldTab), before);

    // A later outage cannot poison the newly installed shell.
    failHtml = true;
    assert.equal((await oldTab.reload()).status(), 200);
    assert.deepEqual(await loadedScripts(oldTab), newScripts);
    assert.deepEqual(await savedData(oldTab), before);
    await oldTab.close(); await freshTab.close();
    await waitFor(() => inflight === 0 && Date.now() - lastRequestAt > 200, 'Outstanding origin requests did not settle');
    // Closing the actual transport makes this proof independent of Chromium's
    // navigator.onLine inconsistency after service-worker navigation.
    await stopOrigin();
    await assert.rejects(fetch(origin + '/offline-transport-probe', { signal: AbortSignal.timeout(2000) }));
    await context.setOffline(true);
    const offlineRequestBaseline = requests.length;
    const relaunched = await makePage();
    assert.equal(await relaunched.evaluate(() => navigator.onLine), false, 'Browser reports offline before navigation');
    const gameResponse = await relaunched.goto(origin);
    assert.equal(gameResponse.status(), 200);
    assert.equal(gameResponse.fromServiceWorker(), true);
    const onlineAfterGame = await relaunched.evaluate(() => navigator.onLine);
    assert.equal(await relaunched.evaluate(() => fetch('/uncached-offline-probe', { cache: 'no-store' }).then(() => false, () => true)), true,
      'An uncached same-origin request must fail while the cached game loads');
    assert.deepEqual(await loadedScripts(relaunched), newScripts);
    assert.deepEqual(await savedData(relaunched), before);
    assert.equal(await relaunched.evaluate(() => typeof window.CatSkiStorage.getStoredState), 'function');
    assert.equal(await relaunched.evaluate(() => typeof window.CatSkiConsent.choose), 'function');
    await relaunched.locator('#overlay-start h1').click();
    await relaunched.waitForFunction(() => document.querySelector('#overlay-start').classList.contains('hidden'));
    await relaunched.locator('#btn-pause').click();
    assert.equal(await relaunched.locator('#overlay-paused').isVisible(), true);
    const guideResponse = await relaunched.goto(origin + '/readme.html');
    assert.equal(guideResponse.status(), 200);
    assert.equal(guideResponse.fromServiceWorker(), true);
    const onlineAfterGuide = await relaunched.evaluate(() => navigator.onLine);
    assert.ok(await relaunched.locator('#privacy').count());
    assert.deepEqual(await loadedScripts(relaunched), newScripts);
    assert.deepEqual(await savedData(relaunched), before);
    assert.equal(requests.length, offlineRequestBaseline, 'Offline game and guide must not reach the origin server');
    assert.equal(await relaunched.evaluate(async name => (await caches.keys()).includes(name), oldCache), false);
    if (onlineAfterGame || onlineAfterGuide) {
      t.diagnostic('Chromium reported navigator.onLine=true after cached navigation. Offline is verified by the stopped origin, rejected uncached fetch, service-worker responses, and zero origin requests.');
    }
    assert.deepEqual(errors, [], 'Old and new documents stay compatible throughout upgrade and offline relaunch');
    await context.close();
  } finally {
    if (browser) await browser.close();
    await stopOrigin();
  }
});
