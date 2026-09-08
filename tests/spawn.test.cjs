'use strict';
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { createHarness } = require('./browser-helpers.cjs');

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { if (harness) await harness.close(); });

async function withClassic(run) {
  const game = await harness.openGame({ manualClock: true,
    storage: { skior_lives: '0', skior_audio: 'off' } });
  try {
    // Audio is outside this test and must not consume the world RNG.
    await game.page.evaluate(() => { window.AudioContext = window.webkitAudioContext = undefined; });
    await run(game.page);
    assert.deepEqual(game.errors, [], 'No application JavaScript errors');
  } finally { await game.context.close(); }
}

test('classic starts and restarts leave reaction time across cats, mountains and difficulty', async () => {
  await withClassic(async page => {
    const failures = await page.evaluate(() => {
      const failures = [];
      const cats = ['black', 'tabby', 'calico', 'orange'];
      const themes = ['alps', 'rockies', 'himalayas'];
      const intensities = [0.8, 1, 1.7, 2.5, 4, 5];
      // These two seeds previously killed a classic run on its first frame.
      for (const initialSeed of [437, 684]) {
        for (const cat of cats) for (const theme of themes) for (const intensity of intensities) {
          document.querySelector(`[data-cat="${cat}"]`).click();
          document.querySelector(`[data-theme="${theme}"]`).click();
          const slider = document.getElementById('diff-slider');
          slider.value = String(Math.round(intensity * 100));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          for (const restart of [false, true]) {
            let seed = initialSeed;
            Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
            if (restart) document.getElementById('btn-restart').click();
            else window.__test.start();
            // Tucking is the fastest straight start; the player must still
            // get 1.5 seconds to see the slope and decide where to steer.
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
            for (let frame = 0; frame < 90; frame++) window.__test.update();
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown' }));
            const { state, player, stats, activeRunConfig } = window.__test.snapshot();
            if (state !== 'play' || player.lives !== 1 || player.invincT !== 0 ||
                Math.abs(stats.elapsed - 1.5) > 1e-9 || activeRunConfig.intensity !== intensity) {
              failures.push({ initialSeed, cat, theme, intensity, restart, state,
                lives: player.lives, elapsed: stats.elapsed });
            }
          }
        }
      }
      return failures;
    });
    assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 3)));
  });
});

test('the opening lane keeps nearby hazards and does not protect later terrain', async () => {
  await withClassic(async page => {
    const result = await page.evaluate(() => {
      const game = window.__test;
      game.start();
      const { player } = game.snapshot();
      game.stage({ objects: [] });

      // Deterministic natural generation: count=1, tree, center X, no Y offset.
      const generate = (y, density, xFraction) => {
        let call = 0;
        const draws = [0, 0, xFraction, 0];
        Math.random = () => draws[call++ % draws.length];
        game.spawn(y, density);
      };
      generate(player.screenY, 0.2, 0.5); // resetGame seed path
      generate(player.screenY, undefined, 0.5); // maintainWorld strip path
      const opening = game.snapshot().objects;
      generate(player.screenY, 0.2, 0); // a tree near the left edge
      const outside = game.snapshot().objects;
      game.stage({ player: { x: 10 } });
      game.update();
      const outsideHit = game.snapshot();

      game.start();
      game.stage({ objects: [] });
      generate(1200, undefined, 0.5);
      const later = game.snapshot().objects;
      for (let frame = 0; frame < 1200 && game.snapshot().state === 'play'; frame++) {
        game.update();
      }
      const laterHit = game.snapshot();
      return { opening, outside, outsideState: outsideHit.state,
        outsideCause: outsideHit.completedRun?.cause, later,
        laterState: laterHit.state, laterCause: laterHit.completedRun?.cause };
    });
    assert.equal(result.opening.length, 0, 'Both generation paths keep the starting point clear');
    assert.equal(result.outside.length, 1, 'A hazard outside the lane remains');
    assert.equal(result.outside[0].type, 'tree');
    assert.equal(result.outsideState, 'over', 'Leaving the lane retains normal collision behavior');
    assert.equal(result.outsideCause, 'tree');
    assert.equal(result.later.length, 1, 'The center of later terrain still generates hazards');
    assert.equal(result.later[0].x, 180);
    assert.equal(result.laterState, 'over', 'The corridor does not grant lasting immunity');
    assert.equal(result.laterCause, 'tree');
  });
});
