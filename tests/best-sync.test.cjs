'use strict';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { createHarness } = require('./browser-helpers.cjs');

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { if (harness) await harness.close(); });

async function openPair() {
  const first = await harness.openGame({ manualClock: true, storage: {
    skior_intensity: '1', skior_dogs: '2', skior_bests: '{"1.0_2_9":900}',
  } });
  const second = await harness.openGame({ context: first.context });
  return { first, second, context: first.context };
}

test('UI best reset survives a queued run save in another tab using real Web Locks', async () => {
  const { first, second, context } = await openPair();
  const a = first.page, b = second.page;
  try {
    await a.evaluate(() => { window.__test.start(); window.__test.finish(100); });
    await b.locator('[data-preset="hard"]').click();
    await b.evaluate(() => window.__test.start());
    // Hold the existing lock to make two ordinary UI actions overlap.
    await a.evaluate(() => {
      window.__held = navigator.locks.request('cat-ski-scores', () => new Promise(resolve => { window.__release = resolve; }));
    });
    await a.waitForFunction(() => typeof window.__release === 'function', null, { polling: 20 });
    a.on('dialog', dialog => dialog.accept());
    await a.locator('#reset-best').click();
    await b.evaluate(() => window.__test.finish(1000));
    const pending = await a.evaluate(async () => (await navigator.locks.query()).pending);
    assert.equal(pending.length, 2, 'Both reset and run save are queued');
    await a.evaluate(() => window.__release());
    await a.waitForFunction(() => JSON.parse(localStorage.getItem('skior_bests'))['2.5_5_9'] === 1000, null, { polling: 20 });
    const saved = await a.evaluate(() => JSON.parse(localStorage.getItem('skior_bests')));
    assert.deepEqual(saved, { '2.5_5_9': 1000 });
    assert.deepEqual(first.errors, []); assert.deepEqual(second.errors, []);
  } finally { await context.close(); }
});

test('a real quota failure retains the best through another tab save and later lower run', async () => {
  const { first, second, context } = await openPair();
  const a = first.page, b = second.page;
  try {
    await b.locator('[data-preset="hard"]').click();
    // Fill actual browser storage rather than replacing its API with a stub.
    const errorName = await a.evaluate(() => {
      let low = 0, high = 6 * 1024 * 1024, errorName;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        try { localStorage.setItem('quota-fill', 'x'.repeat(middle)); low = middle; }
        catch (error) { high = middle - 1; errorName = error.name; }
      }
      localStorage.setItem('quota-fill', 'x'.repeat(low));
      return errorName;
    });
    assert.equal(errorName, 'QuotaExceededError');
    await a.evaluate(() => { window.__test.start(); window.__test.finish(1000); });
    await a.waitForFunction(() => JSON.parse(window.CatSkiStorage.getItem('skior_bests'))['1.0_2_9'] === 1000, null, { polling: 20 });
    assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('skior_bests'))['1.0_2_9']), 900);
    await b.evaluate(() => { localStorage.removeItem('quota-fill'); window.__test.start(); window.__test.finish(1200); });
    await a.waitForFunction(() => {
      const saved = JSON.parse(localStorage.getItem('skior_bests'));
      return saved['1.0_2_9'] === 1000 && saved['2.5_5_9'] === 1200;
    }, null, { polling: 20 });
    await a.evaluate(() => { window.__test.start(); window.__test.finish(950); });
    assert.equal(await a.evaluate(() => window.__test.snapshot().completedRun.best), 1000);
    assert.deepEqual(first.errors, []); assert.deepEqual(second.errors, []);
  } finally { await context.close(); }
});

test('completed result uses latest persisted best before any storage event arrives', async () => {
  const { page, context, errors } = await harness.openGame({ manualClock: true, storage: {
    skior_intensity: '1', skior_dogs: '2', skior_bests: '{"1.0_2_9":900}',
  } });
  try {
    const best = await page.evaluate(() => {
      window.__test.start();
      // A same-document write deliberately gives no storage event, matching
      // the interval between another tab's write and event delivery.
      localStorage.setItem('skior_bests', '{"1.0_2_9":2000}');
      window.__test.finish(1000);
      return window.__test.snapshot().completedRun.best;
    });
    assert.equal(best, 2000);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
