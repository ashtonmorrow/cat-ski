'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness } = require('./browser-helpers.cjs');

const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

for (const engine of ['chromium', 'webkit', 'firefox']) {
  test(`${engine}: keyboard play, saved scores/settings, guide, and phone controls`, { timeout: 90000 }, async () => {
    const harness = await createHarness({ engine });
    try {
      // Keep each engine's real animation clock running. Fixed-step behavior
      // is covered separately; this smoke flow checks ordinary browser input.
      const desktop = await harness.openGame();
      const { page } = desktop;
      await page.getByRole('button', { name: 'START', exact: true }).press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'game');
      await page.keyboard.down('ArrowRight');
      await page.waitForFunction(() => {
        const current = window.__test.snapshot();
        return current.player.x > 195 && current.stats.elapsed > 0;
      });
      await page.keyboard.up('ArrowRight');
      const playing = await page.evaluate(() => window.__test.snapshot());
      assert.equal(playing.state, 'play');
      assert.ok(playing.player.x > 180, 'Native keyboard input steers the skier');
      assert.ok(playing.stats.elapsed > 0, 'Simulation advances');

      await page.locator('#btn-pause').click();
      assert.equal(await page.locator('#overlay-paused').isVisible(), true);
      await page.locator('[data-theme="rockies"]').click();
      await page.locator('#lang-toggle').focus();
      await page.keyboard.press('End');
      assert.equal(await page.locator('html').getAttribute('lang'), 'es');
      assert.equal(await page.locator('#settings-next-run').isVisible(), true);
      await page.locator('#btn-pause').click();
      assert.equal(await page.locator('#overlay-paused').isVisible(), false);

      // End the setup run at a known score to isolate the real submission/reload flow.
      // Natural collision/life/dog/snowman transitions have separate progression tests.
      await page.evaluate(() => window.__test.finish(1234));
      await page.locator('#lb-name-input').fill('ALEX');
      await page.locator('#lb-submit').click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('skior_leaderboard_v3'))?.lives9[0]?.name === 'ALEX', null, { polling: 20 });
      await page.reload();
      assert.equal(await page.locator('html').getAttribute('lang'), 'es');
      assert.equal(await page.locator('[data-theme="rockies"]').getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#leaderboard').textContent(), /ALEX.*1234/);
      assert.equal(await page.getByRole('button', { name: 'EMPEZAR', exact: true }).isVisible(), true);
      await page.goto(harness.origin + '/readme.html');
      assert.match(await page.locator('h1').textContent(), /CAT SKI\s*\/\/ HOW TO PLAY/);
      assert.equal(await page.evaluate(() => typeof window.CatSkiConsent.choose), 'function');
      assert.deepEqual(desktop.errors, [], `${engine} desktop has no JavaScript errors`);
      await desktop.context.close();

      const phone = await harness.openGame({ mobile: true,
        viewport: { width: 360, height: 800 },
        ...(engine === 'webkit' ? { userAgent: IOS_SAFARI } : {}) });
      await phone.page.getByRole('button', { name: 'START', exact: true }).tap();
      await phone.page.locator('#controls-toggle').tap();
      assert.equal((await phone.page.evaluate(() => window.__test.snapshot())).state, 'paused');
      assert.equal(await phone.page.locator('#stick-area').isVisible(), false);
      if (engine === 'webkit') {
        // Real WebKit modal behavior; the OS Add to Home Screen UI is not automated.
        await phone.page.locator('#btn-install').tap();
        const dialog = phone.page.getByRole('dialog', { name: 'INSTALL', exact: true });
        assert.equal(await dialog.isVisible(), true);
        await phone.page.keyboard.press('r');
        assert.equal((await phone.page.evaluate(() => window.__test.snapshot())).state, 'paused');
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 361 && box.y + box.height <= 801);
        await phone.page.locator('#btn-close-install').tap();
        assert.equal(await dialog.isVisible(), false);
      }
      await phone.page.locator('#btn-pause').tap();
      assert.equal((await phone.page.evaluate(() => window.__test.snapshot())).state, 'play');
      const screen = await phone.page.locator('#screen').boundingBox();
      assert.ok(screen.y >= -1 && screen.y + screen.height <= 801, `${engine} phone game fits after Resume`);
      assert.equal(await phone.page.locator('#controls-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await phone.page.locator('#stick-area').isVisible(), true);
      assert.deepEqual(phone.errors, [], `${engine} phone has no JavaScript errors`);
      await phone.context.close();
    } finally { await harness.close(); }
  });
}
