'use strict';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { createHarness } = require('./browser-helpers.cjs');

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { if (harness) await harness.close(); });

test('boot restores each language and life mode before presenting an idle, usable game', async () => {
  const configurations = [
    { lang: 'en', lives: true, cat: 'black', theme: 'alps', intensity: 1, dogs: 2, touch: 'off', sound: 'off' },
    { lang: 'es', lives: true, cat: 'orange', theme: 'rockies', intensity: 2.5, dogs: 5, touch: 'on', sound: 'on' },
    { lang: 'en', lives: false, cat: 'calico', theme: 'himalayas', intensity: 5, dogs: 10, touch: 'on', sound: 'off' },
    { lang: 'es', lives: false, cat: 'tabby', theme: 'alps', intensity: 1.7, dogs: 3, touch: 'off', sound: 'on' },
  ];
  for (const config of configurations) {
    const key = `${config.intensity.toFixed(1)}_${config.dogs}${config.lives ? '_9' : ''}`;
    const game = await harness.openGame({ manualClock: true, storage: {
      skior_lang: config.lang, skior_lives: config.lives ? '1' : '0',
      skior_cat: config.cat, skior_theme: config.theme,
      skior_intensity: String(config.intensity), skior_dogs: String(config.dogs),
      skior_touch: config.touch, skior_audio: config.sound, skior_controls: 'wasd', skior_swap: '1',
      skior_cookies: null, skior_bests: JSON.stringify({ [key]: 650 }),
      skior_leaderboard_v3: JSON.stringify({ lives9: [{ name: 'NINE', score: 900 }], lives1: [{ name: 'ONE', score: 700 }] }),
    } });
    try {
      const { page } = game;
      const initial = await page.evaluate(() => {
        const snapshot = window.__test.snapshot();
        const painted = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
          .data.some((value, index) => index % 4 === 3 && value > 0);
        return {
          state: snapshot.state, lives: snapshot.player.lives, elapsed: snapshot.stats.elapsed,
          active: snapshot.activeRunConfig, completed: snapshot.completedRun,
          lang: document.documentElement.lang,
          cats: [...document.querySelectorAll('[data-cat][aria-pressed="true"]')].map(el => el.dataset.cat),
          themes: [...document.querySelectorAll('[data-theme][aria-pressed="true"]')].map(el => el.dataset.theme),
          mode: document.getElementById('btn-lives').getAttribute('aria-pressed'),
          livesClass: document.body.classList.contains('lives-mode'),
          touchClass: document.body.classList.contains('touch-active'),
          swapped: document.body.classList.contains('controls-swapped'),
          painted: [...document.querySelectorAll('#game, .cat-swatch canvas')].every(painted),
          events: window.__analyticsEvents,
        };
      });
      assert.equal(initial.state, 'title');
      assert.equal(initial.lives, config.lives ? 9 : 1);
      assert.equal(initial.elapsed, 0);
      assert.equal(initial.active, null);
      assert.equal(initial.completed, null);
      assert.equal(initial.lang, config.lang);
      assert.deepEqual(initial.cats, [config.cat]);
      assert.deepEqual(initial.themes, [config.theme]);
      assert.equal(initial.mode, String(config.lives));
      assert.equal(initial.livesClass, config.lives);
      assert.equal(initial.touchClass, config.touch === 'on');
      assert.equal(initial.swapped, true);
      assert.equal(initial.painted, true, 'The title field and every picker are painted on boot');
      assert.deepEqual(initial.events, [], 'Restoring settings does not start or complete a run');
      assert.equal(await page.locator('#diff-slider').inputValue(), String(config.intensity * 100));
      assert.equal(await page.locator('#dogs-slider').inputValue(), String(config.dogs));
      assert.equal(await page.locator('#sound-toggle').inputValue(), config.sound === 'on' ? '1' : '0');
      assert.equal(await page.locator('#lang-value').textContent(), config.lang.toUpperCase());
      assert.equal(await page.locator('[data-ctrl="wasd"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#leaderboard .lb-name').first().textContent(), config.lives ? 'NINE' : 'ONE');
      assert.equal(await page.locator('#cookie-decline').textContent(), config.lang === 'es' ? 'NO' : 'NO THANKS');
      assert.equal(await page.locator('#settings-next-run').isVisible(), false);
      assert.equal(await page.locator('#btn-pause').isDisabled(), true);
      assert.equal(await page.locator('.trick-btn:enabled').count(), 0);

      // Start through the real key listener, then process its queued frame.
      await page.keyboard.press('Space');
      await page.evaluate(() => window.__test.frame(0));
      assert.deepEqual(await page.evaluate(() => window.__test.snapshot().activeRunConfig), {
        catColor: config.cat, mtnTheme: config.theme, intensity: config.intensity,
        dogCount: config.dogs, livesMode: config.lives,
      });
      await page.evaluate(() => window.__test.finish(5));
      assert.equal(await page.evaluate(() => window.__test.snapshot().completedRun.best), 650);
      assert.deepEqual(game.errors, []);
    } finally { await game.context.close(); }
  }
});

test('startup does not throw ReferenceErrors even when an exception would be caught', async () => {
  const game = await harness.openGame({ manualClock: true,
    storage: { skior_lang: 'es', skior_lives: '0', skior_cat: 'black', skior_theme: 'rockies' } });
  const session = await game.context.newCDPSession(game.page);
  const referenceErrors = [];
  try {
    await session.send('Debugger.enable');
    session.on('Debugger.paused', event => {
      const error = event.data;
      if (error && (error.className === 'ReferenceError' || /^ReferenceError:/.test(error.description || ''))) {
        referenceErrors.push(error.description);
      }
      session.send('Debugger.resume').catch(() => {});
    });
    await session.send('Debugger.setPauseOnExceptions', { state: 'all' });
    // Reload through normal startup with the debugger listening before any
    // script executes, including exceptions that a catch block would hide.
    await game.page.reload({ waitUntil: 'load' });
    await session.send('Debugger.disable');
    assert.deepEqual(referenceErrors, [], 'Startup must not use caught TDZ/undefined-reference errors as control flow');
    assert.deepEqual(game.errors, []);
    assert.equal(await game.page.locator('html').getAttribute('lang'), 'es');
    assert.equal(await game.page.evaluate(() => window.__test.snapshot().player.lives), 1);
  } finally {
    await session.detach();
    await game.context.close();
  }
});
