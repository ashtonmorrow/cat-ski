const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { createHarness } = require('./browser-helpers.cjs');

let harness;
before(async () => { harness = await createHarness(); });
after(async () => { if (harness) await harness.close(); });

async function withGame(options, run) {
  const game = await harness.openGame(options);
  try {
    await run(game.page);
    assert.deepEqual(game.errors, [], 'No application JavaScript errors');
  } finally { await game.context.close(); }
}

async function snapshot(page) { return page.evaluate(() => window.__test.snapshot()); }
async function waitState(page, state) {
  await page.waitForFunction(expected => window.__test.snapshot().state === expected, state);
}

test('mouse game commands preserve steering/shortcuts while native controls keep their keys', async () => {
  await withGame({ viewport: { width: 1280, height: 900 } }, async page => {
    await page.locator('[data-cat="tabby"]').focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(40);
    assert.equal((await snapshot(page)).state, 'title', 'Space activates a focused setting without starting');
    assert.equal(await page.locator('[data-cat="tabby"]').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Space');
    await waitState(page, 'play');
    await page.locator('#btn-pause').click();
    await waitState(page, 'paused');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-pause');
    await page.keyboard.press('p');
    await waitState(page, 'play');
    await page.locator('#btn-pause').click();
    await page.locator('#btn-pause').click();
    await waitState(page, 'play');
    await page.keyboard.down('ArrowLeft');
    assert.equal((await snapshot(page)).keys.left, true, 'Arrow steering works immediately after mouse Resume');
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.press('Escape');
    await waitState(page, 'paused');
    await page.locator('#btn-pause').press('Space');
    await waitState(page, 'play');
    await page.keyboard.press('r');
    await waitState(page, 'play');
    assert.ok((await snapshot(page)).stats.elapsed < 0.3, 'R restarts despite a focused command button');
    await page.locator('#diff-slider').focus();
    const previous = Number(await page.locator('#diff-slider').inputValue());
    await page.keyboard.press('ArrowRight');
    assert.equal(Number(await page.locator('#diff-slider').inputValue()), previous + 10);
    assert.equal((await snapshot(page)).keys.right, false, 'Range arrow edits do not steer');
  });
});

test('touch trick controls expose native disabled state and keyboard activation through pause/resume', async () => {
  await withGame({ viewport: { width: 360, height: 800 }, mobile: true }, async page => {
    const group = page.getByRole('group', { name: 'Air tricks' });
    assert.equal(await group.count(), 1);
    assert.equal(await group.getByRole('button').count(), 3);
    assert.equal(await page.locator('.trick-btn:disabled').count(), 3);
    await page.locator('#overlay-start h1').tap();
    await waitState(page, 'play');
    assert.equal(await page.locator('.trick-btn:disabled').count(), 3);
    await page.evaluate(() => window.__test.setAir(180));
    assert.equal(await page.locator('.trick-btn:enabled').count(), 3);
    await group.getByRole('button', { name: 'ROLL', exact: true }).focus();
    await page.keyboard.press('p');
    await waitState(page, 'paused');
    assert.equal(await page.locator('.trick-btn:disabled').count(), 3);
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('airborne')), false);
    await page.keyboard.press('p');
    await waitState(page, 'play');
    assert.equal(await page.locator('.trick-btn:enabled').count(), 3);
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('airborne')), true);
    await group.getByRole('button', { name: 'ROLL', exact: true }).press('Space');
    assert.equal((await snapshot(page)).player.trick, 'roll');
    assert.equal(await page.locator('.trick-btn:disabled').count(), 3, 'A running trick cannot be started again');
    await page.waitForFunction(() => !window.__test.snapshot().player.trick);
    await group.getByRole('button', { name: 'TWIST', exact: true }).press('Enter');
    assert.equal((await snapshot(page)).player.trick, 'twist');
  });
});

test('an immediate pointer trick does not fire again when a held pointer is released', async () => {
  await withGame({ viewport: { width: 360, height: 800 }, mobile: true }, async page => {
    await page.locator('#overlay-start h1').tap();
    await waitState(page, 'play');
    await page.evaluate(() => window.__test.setAir(180));
    const rect = await page.locator('[data-trick="roll"]').boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    assert.equal((await snapshot(page)).player.trick, 'roll', 'Pointerdown activates without waiting for release');
    await page.waitForFunction(() => !window.__test.snapshot().player.trick);
    assert.equal((await snapshot(page)).player.trickChain.length, 1);
    await page.mouse.up();
    await page.waitForTimeout(40);
    assert.equal((await snapshot(page)).player.trickChain.length, 1, 'Release click is deduplicated even after the first trick finishes');
  });
});

test('landscape game and normal/swapped controls fit without covering the canvas', async () => {
  const saved = JSON.stringify({
    lives9: [{ name: 'MIKE', score: 1000 }, { name: 'CAT', score: 800 }, { name: 'SKI', score: 500 }],
    lives1: [],
  });
  for (const [width, height] of [[844, 390], [667, 375]]) {
    for (const board of [false, true]) {
      await withGame({ viewport: { width, height }, mobile: true,
        storage: board ? { skior_leaderboard_v3: saved } : {} }, async page => {
        await page.locator('#overlay-start h1').tap();
        await waitState(page, 'play');
        for (const swapped of [false, true]) {
          if (swapped) await page.locator('#btn-swap').tap();
          await page.evaluate(() => document.fonts.ready);
          const layout = await page.evaluate(() => {
            const rect = selector => {
              const r = document.querySelector(selector).getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
            };
            const screen = rect('#screen');
            const controls = ['#btn-touch-pause', '#btn-swap', '#stick', '#trick-pad'].map(selector => ({ selector, ...rect(selector) }));
            return { screen, controls, actions: rect('.mobile-actions'), width: innerWidth, height: innerHeight };
          });
          assert.ok(layout.screen.width >= 340 && layout.screen.height >= 250, 'Landscape field retains useful size');
          assert.ok(layout.screen.y >= 0 && layout.screen.bottom <= height + 1, 'Entire playing field fits');
          assert.ok(layout.actions.bottom <= height + 1, 'Settings row fits beneath the game');
          for (const rect of layout.controls) {
            assert.ok(rect.x >= 0 && rect.y >= 0 && rect.right <= width + 1 && rect.bottom <= height + 1, `${rect.selector} stays in viewport`);
            const overlap = Math.min(rect.right, layout.screen.right) > Math.max(rect.x, layout.screen.x) &&
              Math.min(rect.bottom, layout.screen.bottom) > Math.max(rect.y, layout.screen.y);
            assert.equal(overlap, false, `${rect.selector} avoids canvas at ${width}×${height}, saved=${board}, swapped=${swapped}`);
          }
          assert.equal(await page.locator('#btn-touch-pause').isVisible(), true);
          await page.locator('#btn-touch-pause').tap();
          await waitState(page, 'paused');
          await page.locator('#btn-touch-pause').tap();
          await waitState(page, 'play');
        }
      });
    }
  }
});
