'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { ROOT } = require('./browser-helpers.cjs');

test('real service worker survives HTTP 503 and boots game and guide offline with all shared scripts cached', async () => {
  let failHtml = false;
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
    '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const filename = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(ROOT + path.sep)) { response.writeHead(403); response.end(); return; }
    if (failHtml && path.extname(filename) === '.html') {
      response.writeHead(503, { 'Content-Type': 'text/html' });
      response.end('<h1>Temporary outage</h1>'); return;
    }
    try {
      const body = await fs.readFile(filename);
      response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch (_) { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext();
    await context.route(/https:\/\//, route => route.abort());
    await context.addInitScript(() => {
      localStorage.setItem('skior_cookies', 'declined');
      localStorage.setItem('skior_audio', 'off');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const name = names.find(name => name.startsWith('cat-ski-'));
      const cache = await caches.open(name);
      return { name, entries: (await cache.keys()).map(request => new URL(request.url).pathname + new URL(request.url).search) };
    });
    assert.equal(cached.name, 'cat-ski-v22');
    for (const entry of ['/storage.js?v=22', '/consent.js?v=22', '/', '/readme.html', '/fonts/press-start-2p.woff2']) {
      assert.ok(cached.entries.includes(entry), `${entry} is available offline`);
    }
    failHtml = true;
    const outageResponse = await page.reload();
    assert.equal(outageResponse.status(), 200, '503 falls back to the healthy cached document');
    assert.equal(await page.locator('#overlay-start h1').textContent(), 'CAT SKI');
    assert.equal(await page.evaluate(async () => (await (await caches.open('cat-ski-v22')).match('/')).status), 200);
    await context.setOffline(true);
    await page.reload();
    await page.locator('#overlay-start h1').click();
    await page.waitForFunction(() => document.querySelector('#overlay-start').classList.contains('hidden'));
    await page.locator('#btn-pause').click();
    assert.equal(await page.locator('#overlay-paused').isVisible(), true);
    await page.goto(origin + '/readme.html');
    assert.ok(await page.locator('h1').count());
    assert.equal(await page.evaluate(() => typeof window.CatSkiConsent.choose), 'function');
    assert.deepEqual(errors, [], 'Both pages boot without JavaScript errors while offline');
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
