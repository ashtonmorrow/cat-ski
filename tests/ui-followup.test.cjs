'use strict';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { createHarness } = require('./browser-helpers.cjs');

const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let harness;
before(async () => { harness = await createHarness(); });
after(async () => { if (harness) await harness.close(); });
async function withGame(options, run) {
  const game = await harness.openGame({ manualClock: true, ...options });
  try {
    await run(game.page);
    assert.deepEqual(game.errors, [], 'No application JavaScript errors');
  } finally { await game.context.close(); }
}
const snapshot = page => page.evaluate(() => window.__test.snapshot());
async function assertUnobstructed(page, selector) {
  const control = page.locator(selector);
  await control.scrollIntoViewIfNeeded();
  assert.equal(await control.evaluate(el => {
    const r = el.getBoundingClientRect();
    const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el === target || el.contains(target);
  }), true, selector + ' receives its center tap');
}
async function assertGameVisible(page, height) {
  const screen = await page.locator('#screen').boundingBox();
  assert.ok(screen.y >= -1 && screen.y + screen.height <= height + 1,
    'Returning from scrolled Settings restores the whole game to the viewport: ' + JSON.stringify(screen));
  assert.equal(await page.locator('#controls-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#stick-area').isVisible(), true);
  assert.equal(await page.locator('#trick-pad').isVisible(), true);
}

test('cancelling file or text sharing stops without fallback, download, clipboard or analytics', async () => {
  for (const files of [true, false]) {
    await withGame({ storage: { skior_cookies: 'accepted' } }, async page => {
      let downloads = 0;
      page.on('download', () => downloads++);
      await page.evaluate(files => {
        window.__shareCalls = [];
        window.__clipboardCalls = [];
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => files });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => {
          window.__shareCalls.push({ files: !!payload.files });
          throw new DOMException('User cancelled', 'AbortError');
        } });
        Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: async text => window.__clipboardCalls.push(text) } });
        window.__test.start();
        window.__test.finish();
      }, files);
      await page.evaluate(() => window.__test.share());
      assert.deepEqual(await page.evaluate(() => window.__shareCalls), [{ files }]);
      assert.deepEqual(await page.evaluate(() => window.__clipboardCalls), []);
      assert.equal(downloads, 0);
      assert.equal(await page.locator('#btn-share').textContent(), 'SHARE');
      assert.deepEqual(await page.evaluate(() => window.__analyticsEvents.filter(event => event.name === 'run_shared')), []);
    });
  }
});

test('a file-share capability failure still permits the text-share fallback', async () => {
  await withGame({ storage: { skior_cookies: 'accepted' } }, async page => {
    await page.evaluate(() => {
      window.__shareCalls = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => {
        window.__shareCalls.push({ files: !!payload.files });
        if (payload.files) throw new DOMException('Files unsupported', 'NotSupportedError');
      } });
      window.__test.start();
      window.__test.finish();
    });
    await page.evaluate(() => window.__test.share());
    assert.deepEqual(await page.evaluate(() => window.__shareCalls), [{ files: true }, { files: false }]);
    const events = await page.evaluate(() => window.__analyticsEvents.filter(event => event.name === 'run_shared'));
    assert.equal(events.length, 1);
    assert.equal(events[0].properties.method, 'web_share_text');
  });
});

test('expanded phone Settings pause input and remain tappable; Resume and Restart restore the visible game', async () => {
  for (const [width, height] of [[320, 568], [360, 800], [667, 375]]) {
    for (const swapped of [false, true]) {
      await withGame({ viewport: { width, height }, mobile: true,
        storage: { skior_swap: swapped ? '1' : '0' } }, async page => {
        await page.locator('#overlay-start h1').tap();
        await page.evaluate(() => window.__test.frame(0));
        await page.keyboard.down('ArrowLeft');
        assert.equal((await snapshot(page)).keys.left, true);
        await page.locator('#controls-toggle').tap();
        assert.equal((await snapshot(page)).state, 'paused');
        assert.equal((await snapshot(page)).keys.left, false);
        await page.keyboard.up('ArrowLeft');
        for (const selector of ['#stick-area', '#trick-pad', '#btn-swap']) {
          assert.equal(await page.locator(selector).isVisible(), false, selector + ' does not cover Settings');
        }
        assert.equal(await page.locator('#btn-touch-pause').isVisible(), true);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
        for (const selector of ['[data-preset="hard"]', '#diff-slider', '#dogs-slider', '[data-touch="on"]', '#btn-pause']) {
          await assertUnobstructed(page, selector);
        }
        await page.locator('#diff-slider').tap();
        assert.notEqual(await page.locator('#diff-slider').inputValue(), '100', 'A real slider center tap changes the setting');
        await page.locator('#btn-pause').tap();
        assert.equal((await snapshot(page)).state, 'play');
        await assertGameVisible(page, height);
        await page.locator('#controls-toggle').tap();
        await page.locator('#btn-restart').tap();
        assert.equal((await snapshot(page)).state, 'play');
        assert.equal((await snapshot(page)).stats.elapsed, 0);
        await assertGameVisible(page, height);
      });
    }
  }
});

test('iOS install instructions fit a scrolled phone viewport, contain keyboard focus and require deliberate resume', async () => {
  for (const [width, height] of [[320, 568], [360, 800], [667, 375]]) {
    await withGame({ viewport: { width, height }, mobile: true, userAgent: IOS_SAFARI }, async page => {
      await page.locator('#overlay-start h1').tap();
      await page.evaluate(() => window.__test.frame(0));
      await page.locator('#controls-toggle').tap();
      await page.locator('#btn-install').tap();
      const dialog = page.getByRole('dialog', { name: 'INSTALL', exact: true });
      assert.equal(await dialog.isVisible(), true);
      for (const selector of ['#overlay-install-ios', '#btn-close-install']) {
        const r = await page.locator(selector).boundingBox();
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= width + 1 && r.y + r.height <= height + 1,
          selector + ' fits entirely inside the viewport');
      }
      assert.equal((await snapshot(page)).state, 'paused');
      for (const key of ['Tab', 'Shift+Tab', 'p', 'r', 'ArrowLeft']) {
        await page.keyboard.press(key);
        assert.equal((await snapshot(page)).state, 'paused', key + ' cannot resume or restart behind the modal');
        assert.equal(await page.evaluate(() => document.activeElement === document.body ||
          document.querySelector('#overlay-install-ios').contains(document.activeElement)), true,
          'Tab cannot focus a background control (browser chrome may take focus)');
      }
      await page.evaluate(() => document.querySelector('#btn-restart').focus());
      assert.notEqual(await page.evaluate(() => document.activeElement.id), 'btn-restart', 'Background controls are inert');
      assert.equal((await snapshot(page)).keys.left, false);
      await page.evaluate(() => { window.__test.frame(1000); window.__test.frame(2000); });
      assert.equal((await snapshot(page)).stats.elapsed, 0, 'No time passes while instructions are open');
      await page.keyboard.press('Escape');
      assert.equal(await dialog.isVisible(), false);
      assert.equal((await snapshot(page)).state, 'paused', 'Escape does not resume');
      await page.locator('#btn-install').tap();
      await page.locator('#btn-close-install').press('Space');
      assert.equal(await dialog.isVisible(), false);
      assert.equal((await snapshot(page)).state, 'paused', 'Close does not resume');
      await page.locator('#btn-pause').tap();
      assert.equal((await snapshot(page)).state, 'play');
      await assertGameVisible(page, height);
    });
  }
});

test('native install prompts are consumed once, hide after dismissal/failure, and accept a fresh browser offer', async () => {
  await withGame({}, async page => {
    // Controlled browser event: no operating-system install UI is opened.
    await page.evaluate(() => {
      window.__promptCalls = 0;
      window.__offerInstall = failure => {
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = async () => {
          window.__promptCalls++;
          if (failure === 'prompt') throw new Error('Browser prompt unavailable');
        };
        event.userChoice = failure === 'choice' ? Promise.reject(new Error('Browser choice unavailable')) :
          new Promise(resolve => { window.__resolveChoice = resolve; });
        // A browser promise may reject before the click; silence that unused branch until consumed.
        event.userChoice.catch(() => {});
        window.dispatchEvent(event);
      };
      window.__test.start();
      window.__offerInstall();
    });
    assert.equal(await page.locator('#btn-install').isVisible(), true);
    await page.locator('#btn-install').click();
    assert.equal((await snapshot(page)).state, 'paused');
    assert.equal(await page.locator('#btn-install').isVisible(), false);
    await page.evaluate(() => document.querySelector('#btn-install').click());
    assert.equal(await page.evaluate(() => window.__promptCalls), 1, 'Repeated activation does not double-prompt');
    await page.evaluate(() => window.__resolveChoice({ outcome: 'dismissed' }));
    assert.equal(await page.locator('#btn-install').isVisible(), false, 'Dismissal does not leave an inert action');
    for (const failure of ['prompt', 'choice']) {
      await page.evaluate(failure => window.__offerInstall(failure), failure);
      assert.equal(await page.locator('#btn-install').isVisible(), true);
      await page.locator('#btn-install').click();
      assert.equal(await page.locator('#btn-install').isVisible(), false, failure + ' failure consumes the action');
    }
    assert.equal(await page.evaluate(() => window.__promptCalls), 3);
  });
});
