'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHarness } = require('./browser-helpers.cjs');

test('normal skiing reaches both dog waves, scheduled snowman, all nine lives, and saved result', { timeout: 60000 }, async () => {
  const harness = await createHarness();
  try {
    // A fixed seed and ordinary saved settings make this long route repeatable.
    // Holding left/up carves along the edge; all terrain, chasers, collisions,
    // elapsed time and life losses still come from the production simulation.
    const { page, errors } = await harness.openGame({ manualClock: true, storage: {
      skior_intensity: '0.8', skior_dogs: '2', skior_lives: '1',
    } });
    await page.evaluate(() => window.__resetRandom());
    await page.locator('#overlay-start h1').click();
    await page.evaluate(() => window.__test.frame(0));
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowLeft');
    const run = await page.evaluate(() => {
      const events = { dogs: [], clearances: [], losses: [], schedules: [], snowman: [] };
      let previous = window.__test.snapshot();
      const initialLives = previous.player.lives;
      // Advance real fixed simulation steps; render-rate behavior has separate
      // coverage. No stage(), setAir(), crash(), finish() or counter writes.
      for (let step = 0; step < 18000 && previous.state === 'play'; step++) {
        window.__test.update();
        const current = window.__test.snapshot();
        if (current.stats.dogsSpawned !== previous.stats.dogsSpawned) {
          events.dogs.push({ time: current.stats.elapsed, count: current.stats.dogsSpawned,
            variant: current.yeti?.variant, warned: current.stats.dogsWarned[current.stats.dogsSpawned] });
        }
        if (previous.yeti && !current.yeti) {
          events.clearances.push({ time: current.stats.elapsed, recorded: current.stats.dogClearedAt,
            count: current.stats.dogsSpawned });
        }
        if (current.player.lives !== previous.player.lives) {
          events.losses.push({ time: current.stats.elapsed, from: previous.player.lives, to: current.player.lives,
            state: current.state, immunity: current.player.invincT });
        }
        if (current.stats.snowmanScheduledAt !== previous.stats.snowmanScheduledAt) {
          events.schedules.push({ at: current.stats.snowmanScheduledAt, lastDog: current.stats.dogClearedAt,
            dogs: current.stats.dogsSpawned, dogActive: !!current.yeti });
        }
        if (!previous.snowman && current.snowman) {
          events.snowman.push({ time: current.stats.elapsed, scheduled: current.stats.snowmanScheduledAt });
        }
        previous = current;
      }
      return { initialLives, events, final: previous };
    });
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowUp');

    assert.equal(run.initialLives, 9);
    assert.deepEqual(run.events.dogs.map(dog => dog.count), [1, 2]);
    assert.deepEqual(run.events.dogs.map(dog => dog.variant), [1, 2]);
    assert.ok(run.events.dogs.every(dog => dog.warned));
    assert.ok(run.events.dogs[0].time >= 75 && run.events.dogs[0].time < 75.1);
    assert.deepEqual(run.events.clearances.map(clearance => clearance.count), [1, 2]);
    assert.ok(run.events.clearances.every(clearance => Math.abs(clearance.time - clearance.recorded) < 1e-6));
    assert.ok(run.events.dogs[1].time >= run.events.clearances[0].time + 25);
    assert.equal(run.events.schedules.length, 1, 'The terminal chaser delay is rolled once');
    const schedule = run.events.schedules[0];
    assert.equal(schedule.dogs, 2);
    assert.equal(schedule.dogActive, false);
    assert.ok(schedule.at - schedule.lastDog >= 20 && schedule.at - schedule.lastDog <= 40);
    assert.equal(run.events.snowman.length, 1);
    assert.ok(run.events.snowman[0].time >= schedule.at && run.events.snowman[0].time < schedule.at + 0.1);
    assert.deepEqual(run.events.losses.map(loss => loss.to), [8, 7, 6, 5, 4, 3, 2, 1]);
    assert.ok(run.events.losses.every(loss => loss.from - loss.to === 1 && loss.state === 'play' && loss.immunity > 0));
    for (let i = 1; i < run.events.losses.length; i++) {
      assert.ok(run.events.losses[i].time - run.events.losses[i - 1].time >= 0.98, 'Post-hit immunity prevents rapid extra losses');
    }
    assert.equal(run.final.state, 'over', 'The ninth hit ends the real run');
    assert.equal(run.final.player.lives, 1, 'The final remaining life is consumed by the terminal catch');
    assert.equal(run.final.player.grabbed, true);
    assert.equal(run.final.completedRun.cause, 'snowman');
    assert.ok(run.final.completedRun.elapsed > run.events.snowman[0].time);
    assert.ok(run.final.completedRun.score > 0);
    assert.equal(run.final.completedRun.elapsed, run.final.stats.elapsed);
    assert.equal(run.final.completedRun.distance, run.final.stats.distance);
    assert.equal(await page.locator('#overlay-over').isVisible(), true);
    assert.equal(await page.locator('#over-score').textContent(), String(run.final.completedRun.score));
    await page.locator('#lb-name-input').fill('SKI');
    await page.locator('#lb-submit').click();
    await page.waitForFunction(score => {
      const saved = JSON.parse(localStorage.getItem('skior_leaderboard_v3'));
      return saved?.lives9?.some(row => row.name === 'SKI' && row.score === score);
    }, run.final.completedRun.score, { polling: 20 });
    assert.deepEqual(errors, []);
  } finally { await harness.close(); }
});
