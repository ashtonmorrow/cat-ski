'use strict';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { createHarness } = require('./browser-helpers.cjs');

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

test('native Start and Retry support pointer, Enter and Space without duplicate starts or lost game focus', async () => {
  for (const activation of ['click', 'Enter', 'Space']) {
    await withGame({ storage: { skior_cookies: 'accepted' } }, async page => {
      const field = page.getByRole('img', { name: 'Cat Ski playing field', exact: true });
      assert.equal(await field.count(), 1);
      assert.equal(await field.getAttribute('aria-describedby'), 'game-instructions');
      assert.match(await field.textContent(), /browser with Canvas support/);
      const activate = async locator => activation === 'click' ? locator.click() : locator.press(activation);
      await activate(page.getByRole('button', { name: 'START', exact: true }));
      assert.equal((await snapshot(page)).state, 'play');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'game');
      await page.evaluate(() => { window.__test.frame(0); window.__test.frame(20); });
      await page.keyboard.down('ArrowLeft');
      assert.equal((await snapshot(page)).keys.left, true);
      await page.keyboard.up('ArrowLeft');
      await page.evaluate(() => window.__test.finish(0));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-retry', 'Non-qualifying results focus Retry');
      await activate(page.getByRole('button', { name: 'RETRY', exact: true }));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'game');
      await page.evaluate(() => { window.__test.frame(40); window.__test.frame(60); });
      assert.equal((await snapshot(page)).state, 'play');
      const starts = await page.evaluate(() => window.__analyticsEvents.filter(event => event.name === 'game_started'));
      assert.equal(starts.length, 2, activation + ' starts each run once, including the following animation frame');
    });
  }
});

test('game state announcements are restrained and follow the current English/Spanish language', async () => {
  await withGame({}, async page => {
    const status = page.locator('#game-status');
    assert.equal(await status.getAttribute('role'), 'status');
    assert.equal(await status.getAttribute('aria-live'), 'polite');
    assert.equal(await status.getAttribute('aria-atomic'), 'true');
    await page.evaluate(() => {
      window.__announcements = [];
      new MutationObserver(() => window.__announcements.push(document.querySelector('#game-status').textContent))
        .observe(document.querySelector('#game-status'), { childList: true, characterData: true, subtree: true });
    });
    await page.locator('#btn-start').click();
    assert.equal(await status.textContent(), 'Run started.');
    await page.evaluate(() => {
      window.__test.stage({ objects: [] });
      for (let i = 0; i < 30; i++) window.__test.frame(i * 1000 / 60);
    });
    assert.deepEqual(await page.evaluate(() => window.__announcements), ['Run started.'], 'Routine HUD changes are not announced');
    await page.locator('#btn-pause').click();
    assert.equal(await status.textContent(), 'Run paused.');
    await page.locator('#lang-toggle').press('End');
    assert.equal(await status.textContent(), 'Bajada pausada.');
    assert.equal(await page.getByRole('img', { name: 'Pista de Cat Ski', exact: true }).count(), 1);
    assert.match(await page.locator('#game-instructions').textContent(), /Dirigí con las flechas/);
    await page.locator('#btn-pause').click();
    assert.equal(await status.textContent(), 'Seguís la bajada.');
    await page.evaluate(() => window.__test.finish(123));
    assert.equal(await status.textContent(), 'Terminó la bajada. Puntaje: 123. Distancia: 123 metros.');
    assert.equal(await page.getByRole('button', { name: 'REINTENTAR', exact: true }).count(), 1);
    await page.locator('#btn-retry').click();
    await page.waitForTimeout(70);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'game', 'Old name-entry focus does not steal focus from a retried run');
  });
});

test('submitting initials moves focus to Retry without starting a new run', async () => {
  await withGame({}, async page => {
    await page.locator('#btn-start').press('Enter');
    await page.evaluate(() => window.__test.finish(100));
    await page.waitForFunction(() => document.activeElement.id === 'lb-name-input', null, { polling: 20 });
    await page.locator('#lb-name-input').fill('CAT');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement.id === 'btn-retry', null, { polling: 20 });
    assert.equal((await snapshot(page)).state, 'over');
    await page.keyboard.press('Space');
    assert.equal((await snapshot(page)).state, 'play');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'game');
  });
});

test('camera shake respects live reduced-motion changes and stops on pause and game over', async () => {
  await withGame({ storage: { skior_lives: '0' } }, async page => {
    await page.locator('#btn-start').click();
    await page.evaluate(() => {
      const ctx = document.querySelector('#game').getContext('2d');
      const translate = ctx.translate.bind(ctx);
      let record = false;
      window.__cameraOffsets = [];
      ctx.translate = (x, y) => {
        if (record) { window.__cameraOffsets.push([x, y]); record = false; }
        return translate(x, y);
      };
      window.__renderAndRecord = timestamp => { record = true; window.__test.frame(timestamp); };
      window.__test.stage({ objects: [], stats: { shakeT: 18 } });
      window.__renderAndRecord(0);
    });
    assert.notDeepEqual(await page.evaluate(() => window.__cameraOffsets.at(-1)), [0, 0]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.__renderAndRecord(0));
    assert.deepEqual(await page.evaluate(() => window.__cameraOffsets.at(-1)), [0, 0]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => window.__renderAndRecord(0));
    assert.notDeepEqual(await page.evaluate(() => window.__cameraOffsets.at(-1)), [0, 0]);
    for (const transition of ['pause', 'crash']) {
      await page.evaluate(transition => {
        if (transition === 'pause') window.__test.pause();
        else { window.__test.resume(); window.__test.crash('tree'); }
        window.__cameraOffsets = [];
        for (let i = 0; i < 300; i++) window.__renderAndRecord(i * 1000 / 60);
      }, transition);
      assert.equal((await snapshot(page)).stats.shakeT, 0, transition + ' clears unfinished shake');
      assert.equal(await page.evaluate(() => window.__cameraOffsets.every(([x, y]) => x === 0 && y === 0)), true,
        transition + ' remains still across five seconds of renders');
    }
  });
});

test('reduced motion keeps the invincible skier visible without changing immunity', async () => {
  await withGame({}, async page => {
    await page.locator('#btn-start').click();
    await page.evaluate(() => window.__test.stage({ objects: [], stats: { shakeT: 0 } }));
    async function frameAtImmunity(frames) {
      return page.evaluate(frames => {
        window.__test.stage({ player: { invincT: frames } });
        window.__test.frame(0);
        return document.querySelector('#game').toDataURL();
      }, frames);
    }
    assert.notEqual(await frameAtImmunity(60), await frameAtImmunity(55), 'Normal mode retains the existing immunity indicator');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await frameAtImmunity(60), await frameAtImmunity(55), 'Reduced motion renders the same visible skier in both strobe phases');
    assert.equal((await snapshot(page)).player.invincT, 55, 'Rendering does not alter gameplay immunity');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.notEqual(await frameAtImmunity(60), await frameAtImmunity(55), 'A live preference change restores the normal indicator');
  });
});

test('English and Spanish Start/Retry buttons fit small portrait and landscape game panels', async () => {
  for (const [width, height] of [[320, 568], [360, 800], [667, 375]]) {
    for (const lang of ['en', 'es']) {
      await withGame({ viewport: { width, height }, mobile: true, storage: { skior_lang: lang } }, async page => {
        for (const selector of ['#btn-start', '#btn-retry']) {
          const button = page.locator(selector);
          await button.scrollIntoViewIfNeeded();
          const r = await button.boundingBox();
          const field = await page.locator('#screen').boundingBox();
          assert.ok(r.height >= 44 && r.width >= 44, 'Action meets the touch target size');
          assert.ok(r.x >= field.x && r.y >= field.y && r.x + r.width <= field.x + field.width &&
            r.y + r.height <= field.y + field.height, selector + ' is fully visible inside the game panel');
          await button.tap();
          assert.equal((await snapshot(page)).state, 'play');
          if (selector === '#btn-start') await page.evaluate(() => window.__test.finish(0));
        }
      });
    }
  }
});
