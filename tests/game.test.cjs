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
    await run(game.page, game.context);
    assert.deepEqual(game.errors, [], 'No application JavaScript errors');
  } finally { await game.context.close(); }
}

test('30/60/120/144 Hz rendering advances the same ten seconds of gameplay', async () => {
  const outcomes = [];
  for (const hz of [30, 60, 120, 144]) {
    await withGame({}, async page => {
      outcomes.push(await page.evaluate(hz => {
        const game = window.__test;
        game.start();
        game.stage({ player: { invincT: 999999 }, objects: [] });
        game.frame(0);
        for (let frame = 1; frame <= hz * 10; frame++) {
          game.stage({ objects: [] });
          game.frame(frame * 1000 / hz);
        }
        const { stats, worldY, state } = game.snapshot();
        return { elapsed: stats.elapsed, distance: stats.distance, worldY, state };
      }, hz));
    });
  }
  assert.equal(outcomes[0].state, 'play');
  assert.ok(Math.abs(outcomes[0].elapsed - 10) < 1e-9);
  for (const outcome of outcomes.slice(1)) assert.deepEqual(outcome, outcomes[0]);
});

test('a stalled frame is bounded and resuming does not catch up paused time', async () => {
  await withGame({}, async page => {
    const result = await page.evaluate(() => {
      const game = window.__test;
      game.start(); game.frame(0); game.frame(10000);
      const afterStall = game.snapshot().stats.elapsed;
      game.pause(); game.frame(20000); game.resume(); game.frame(30000);
      const afterResume = game.snapshot().stats.elapsed;
      game.frame(30000 + 1000 / 60);
      return { afterStall, afterResume, afterStep: game.snapshot().stats.elapsed };
    });
    assert.ok(Math.abs(result.afterStall - 0.1) < 1e-9);
    assert.equal(result.afterResume, result.afterStall);
    assert.ok(Math.abs(result.afterStep - result.afterResume - 1 / 60) < 1e-9);
  });
});

test('settings changes apply to the next run while result, best, board and share retain the original setup', async () => {
  await withGame({ storage: { skior_cookies: 'accepted', skior_cat: 'black', skior_intensity: '1', skior_dogs: '2' } }, async page => {
    await page.evaluate(() => window.__test.start());
    const original = await page.evaluate(() => window.__test.snapshot().activeRunConfig);
    await page.locator('#btn-lives').click();
    await page.locator('[data-preset="hard"]').click();
    await page.locator('[data-cat="orange"]').click();
    await page.locator('[data-theme="himalayas"]').click();
    assert.equal(await page.locator('#settings-next-run').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => window.__test.snapshot().activeRunConfig), original);
    await page.evaluate(() => window.__test.crash('tree'));
    assert.equal(await page.evaluate(() => window.__test.snapshot().player.lives), 8, 'The active casual run retains its lives');
    await page.evaluate(() => window.__test.finish(4321));
    const result = await page.evaluate(() => window.__test.snapshot().completedRun);
    assert.deepEqual(result.config, original);
    assert.equal(result.score, 4321);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('skior_bests'))?.['1.0_2_9'] === 4321, null, { polling: 20 });
    await page.locator('#lb-name-input').fill('MIKE');
    await page.locator('#lb-submit').click();
    await page.waitForFunction(() => window.__test.boards().lives9.some(row => row.name === 'MIKE'), null, { polling: 20 });
    const board = await page.evaluate(() => window.__test.boards());
    assert.equal(board.lives9[0].score, 4321);
    assert.equal(board.lives1.length, 0);
    const share = await page.evaluate(async () => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => { window.__shared = payload; } });
      const pending = window.__test.share();
      window.__test.start();
      await pending;
      return { payload: window.__shared, current: window.__test.snapshot(), events: window.__analyticsEvents };
    });
    assert.match(share.payload.text, /4321/);
    assert.equal(share.current.activeRunConfig.livesMode, false);
    assert.equal(share.current.activeRunConfig.catColor, 'orange');
    assert.equal(share.current.player.lives, 1);
    const completed = share.events.filter(event => event.name === 'run_completed');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].properties.intensity, 1);
    assert.equal(completed[0].properties.lives_mode, true);
    assert.equal(share.events.find(event => event.name === 'run_shared').properties.score, 4321);
  });
});

test('landing and flag bonuses survive a fatal frame and an overlapping dog cannot finish the run twice', async () => {
  await withGame({ storage: { skior_lives: '0', skior_cookies: 'accepted' } }, async page => {
    const result = await page.evaluate(() => {
      const game = window.__test;
      game.start();
      const { player, worldY } = game.snapshot();
      const obstacle = type => ({ type, x: player.x, y: worldY + player.screenY, w: 30, h: 30, hit: false });
      game.stage({
        player: { air: 1, airMax: 30, trickChain: ['roll', 'twist'] },
        objects: [obstacle('flag'), obstacle('tree')],
        yeti: { x: player.x, y: worldY + player.screenY, rage: 0, vxMax: 1.4, vySpeed: 0.5, state: 'chase' },
      });
      game.update();
      const first = game.snapshot();
      game.finish(99999);
      game.update();
      return { first, after: game.snapshot(), events: window.__analyticsEvents };
    });
    assert.equal(result.first.state, 'over');
    assert.equal(result.first.completedRun.trickScore, 30);
    assert.equal(result.first.completedRun.flags, 1);
    assert.equal(result.first.completedRun.score, result.first.completedRun.distance + 130);
    assert.equal(result.first.completedRun.cause, 'tree');
    assert.equal(result.first.player.grabbed, false);
    assert.deepEqual(result.after.completedRun, result.first.completedRun);
    assert.equal(result.events.filter(event => event.name === 'run_completed').length, 1);
  });
});

test('blocked/full storage and malformed saved bests do not stop boot, settings or score saving', async () => {
  for (const options of [
    { storageFailure: 'read' }, { storageFailure: 'write' },
    ...['null', '[]', '"wrong"', '{"1.0_2_9":"NaN","bad":-1}', '{invalid'].map(value => ({ storage: { skior_bests: value } })),
  ]) {
    await withGame(options, async page => {
      await page.evaluate(() => window.CatSkiConsent.choose('declined'));
      await page.locator('[data-cat="black"]').click();
      await page.evaluate(() => { window.__test.start(); window.__test.finish(987); });
      assert.equal(await page.locator('#over-score').textContent(), '987');
      assert.equal(await page.evaluate(() => window.__test.snapshot().completedRun.best), 987);
      await page.evaluate(() => window.__test.save('SAFE', 987, true));
      assert.equal(await page.evaluate(() => window.__test.boards().lives9[0].name), 'SAFE');
    });
  }
});

test('stale and simultaneous tabs retain the highest entries in both modes', async () => {
  await withGame({}, async (first, context) => {
    const { page: second, errors } = await harness.openGame({ context });
    await first.evaluate(() => window.__test.save('FIRST', 1000, true));
    await second.evaluate(() => window.__test.save('LAST', 100, true));
    await Promise.all([
      first.evaluate(() => window.__test.save('HIGH', 3000, true)),
      second.evaluate(() => window.__test.save('NEXT', 2000, true)),
    ]);
    await second.evaluate(() => window.__test.save('CLASS', 500, false));
    const saved = await first.evaluate(() => JSON.parse(localStorage.getItem('skior_leaderboard_v3')));
    assert.deepEqual(saved.lives9.map(row => row.score), [3000, 2000, 1000]);
    assert.deepEqual(saved.lives1.map(row => row.score), [500]);
    assert.deepEqual(errors, []);
  });
});

test('consent changes synchronize game and guide tabs, override prior SDK consent and gate sends immediately', async () => {
  await withGame({ storage: { skior_cookies: null } }, async (game, context) => {
    const guide = await context.newPage();
    await guide.goto(harness.origin + '/readme.html');
    await guide.locator('#cookie-accept').click();
    await game.waitForFunction(() => window.mixpanel.optedIn === true, null, { polling: 20 });
    assert.equal(await game.locator('#cookie-banner').isVisible(), false);
    await game.evaluate(() => window.__test.start());
    assert.equal(await game.evaluate(() => window.__analyticsEvents.length), 1);
    await guide.evaluate(() => window.CatSkiConsent.choose('declined'));
    await game.waitForFunction(() => window.mixpanel.optedIn === false, null, { polling: 20 });
    const afterDecline = await game.evaluate(() => {
      // The send-time site gate must still stop sends if SDK state drifts.
      window.mixpanel.optedIn = true;
      window.__test.start();
      return { count: window.__analyticsEvents.length,
        consent: [...window.dataLayer].filter(row => row[0] === 'consent').map(row => row[2].analytics_storage) };
    });
    assert.equal(afterDecline.count, 1);
    assert.equal(afterDecline.consent.at(-1), 'denied');
    await game.reload();
    await game.waitForFunction(() => !!window.__test);
    assert.equal(await game.evaluate(() => window.mixpanel.optedIn), false);
    await game.evaluate(() => window.CatSkiConsent.choose('accepted'));
    await guide.waitForFunction(() => [...window.dataLayer].filter(row => row[0] === 'consent').at(-1)?.[2].analytics_storage === 'granted', null, { polling: 20 });
  });
});
