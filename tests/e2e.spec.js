const { test, expect } = require('@playwright/test');

// Deterministic setup: fresh server world, a saved account so the intro
// shows "welcome back", crate drops forced if requested.
// (The test server runs with SPREAD_DISABLED=1, so the plague never ticks.)
async function freshGame(page, opts = {}) {
  await page.request.post('/debug/reset');
  await page.addInitScript((o) => {
    if (o.account !== false) {
      localStorage.setItem('replant_account_v1', JSON.stringify({ name: o.name || 'Tester', avatar: 3 }));
    } else {
      localStorage.removeItem('replant_account_v1');
    }
    if (o.forceStage) window.__TEST_FORCE_SPAWN_STAGE = o.forceStage;
  }, opts);
  await page.goto('/');
  await expect(page.locator('.patch')).toHaveCount(96); // map arrived over the socket
}

async function enterMap(page) {
  await page.click('#resume-btn');
  await expect(page.locator('#world-map')).toBeVisible();
}

// Win one challenge tree fast: force stage-4 drops, spawn two, merge them.
// (Waits out the previous tree's celebration — the board must be fresh.)
async function winChallengeTree(page) {
  await expect(page.locator('#puzzle-board .cell.filled')).toHaveCount(0, { timeout: 8000 });
  await page.click('#crate-btn');
  await page.click('#crate-btn');
  const cells = page.locator('#puzzle-board .cell.stage-4');
  await cells.nth(0).click();
  await cells.nth(1).click();
}

// Runs end on the goal or when the clock expires — shorten the clock so tests finish fast
async function shortClock(page, ms) {
  await page.evaluate(t => { CONFIG.CHALLENGE.TIME_MS = t; }, ms);
}

test('a new player creates an anon account with an avatar', async ({ page }) => {
  await freshGame(page, { account: false });
  await expect(page.locator('#account-entry')).toBeVisible();
  await expect(page.locator('#avatar-preview')).toBeVisible();
  await page.click('#avatar-reroll'); // reroll works
  await page.fill('#player-name', 'Agnya');
  await page.click('#start-btn');
  await expect(page.locator('#world-map')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('replant_account_v1')));
  expect(saved.name).toBe('Agnya');
});

test('a returning player is welcomed back and can switch accounts', async ({ page }) => {
  await freshGame(page);
  await expect(page.locator('#welcome-msg')).toContainText('Welcome back, Tester');
  await page.click('#switch-btn');
  await expect(page.locator('#account-entry')).toBeVisible();
});

test('tapping a dead tree starts a timed run; living forest is scenery', async ({ page }) => {
  await freshGame(page);
  await enterMap(page);
  const green = await page.locator('.patch.green').count();
  expect(green).toBeGreaterThan(25);
  expect(green).toBeLessThan(71);
  // Living trees and wild groves do nothing
  await page.locator('.patch.green').first().click({ force: true });
  await expect(page.locator('#world-map')).toBeVisible();
  await page.evaluate(() => { const g = document.querySelector('.scene-cell.grove'); if (g) g.click(); });
  await expect(page.locator('#world-map')).toBeVisible();
  // A grey dead tree starts the run
  await page.locator('.patch.barren').first().click();
  await expect(page.locator('#puzzle-board')).toBeVisible();
  await expect(page.locator('#puzzle-goal')).toContainText('Grow Mature');
  await expect(page.locator('#school-hud')).toBeVisible();
  await expect(page.locator('#school-timer')).toHaveText('1:00'); // clock waits for first crate
  await expect(page.locator('#school-trees')).toHaveText('🌳 0/4');
  await expect(page.locator('#crate-count')).toBeHidden();        // no crate budget anywhere
});

test('staged tutorial guides crate → merge → goal, and the recipe book opens', async ({ page }) => {
  await freshGame(page, { forceStage: 1 });
  await enterMap(page);
  await page.locator('.patch.barren').first().click();
  // Step 1 arrives as a toast: open the crate
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Open Crate');
  await page.click('#crate-btn');
  await page.click('#crate-btn');
  // Step 2: merge (appears because a matching pair now exists)
  await expect(page.locator('#toast')).toContainText('matching pair');
  const seeds = page.locator('#puzzle-board .cell.stage-1');
  await seeds.nth(0).click();
  await seeds.nth(1).click();
  // Step 3: the goal
  await expect(page.locator('#toast')).toContainText('Mature');
  // Recipe book: full chain + all four collectible trees
  await page.click('#recipe-btn');
  await expect(page.locator('#recipe-overlay.show')).toBeVisible();
  await expect(page.locator('#recipe-chain .recipe-step')).toHaveCount(5);
  await expect(page.locator('#recipe-trees .recipe-step')).toHaveCount(4);
  await expect(page.locator('#recipe-trees')).toContainText('Lemon');
  await expect(page.locator('#recipe-trees')).toContainText('Avocado');
  await page.click('#recipe-close');
  await expect(page.locator('#recipe-overlay.show')).toBeHidden();
  // The tutorial is done for this account — it never shows again
  const acc = await page.evaluate(() => JSON.parse(localStorage.getItem('replant_account_v1')));
  expect(acc.tutorDone).toBe(true);
  await page.click('#puzzle-quit');
  await page.click('#overlay-btn2'); // confirm quitting the live run
  await page.locator('.patch.barren').first().click();
  await expect(page.locator('#puzzle-board')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.locator('#toast')).not.toContainText('Open Crate'); // no repeat coaching
});

test('rare crate drops show Lucky floating text', async ({ page }) => {
  await freshGame(page, { forceStage: 3 });
  await enterMap(page);
  await page.locator('.patch.barren').first().click();
  await page.click('#crate-btn');
  await expect(page.locator('.lucky-vfx')).toHaveText('Lucky!');
  await page.evaluate(() => { window.__TEST_FORCE_SPAWN_STAGE = 4; });
  await page.click('#crate-btn');
  await expect(page.locator('.lucky-vfx').last()).toHaveText('Super Lucky!');
  // Ambient leaves drift over the plot while playing
  await expect(page.locator('#ambient-puzzle .leaf').first()).toBeAttached({ timeout: 6000 });
});

test('the world reset button only appears for the admin account', async ({ page }) => {
  await freshGame(page);
  await enterMap(page);
  await expect(page.locator('#reset-btn')).toBeHidden();
  await page.addInitScript(() => {
    localStorage.setItem('replant_account_v1', JSON.stringify({ name: 'Admin', avatar: 0 }));
  });
  await page.reload();
  await expect(page.locator('.patch')).toHaveCount(96);
  await enterMap(page);
  await expect(page.locator('#reset-btn')).toBeVisible();
});

test('a qualifying run restores the tapped patch with your avatar', async ({ page }) => {
  await freshGame(page, { forceStage: 4, name: 'Planter' });
  await enterMap(page);
  await shortClock(page, 3500);
  const target = await page.locator('.patch.barren').first().getAttribute('data-map-idx');
  await page.locator('.patch.barren').first().click();
  await page.evaluate(() => { CONFIG.CHALLENGE.GOAL_TREES = 1; }); // qualify with one tree
  await winChallengeTree(page);
  await expect(page.locator('.confetti span').first()).toBeAttached(); // burst at the winning cell
  await expect(page.locator('#school-trees')).toHaveText('🌳 1/1', { timeout: 5000 });
  await expect(page.locator('#result-overlay.show')).toBeVisible({ timeout: 10000 });
  // The juicy success modal announces the restoration; no Play again button
  await expect(page.locator('#overlay-title')).toContainText('Patch restored, Planter');
  await expect(page.locator('.overlay-card.celebrate')).toBeVisible();
  await expect(page.locator('#overlay-btn2')).toBeHidden();
  await page.click('#overlay-btn'); // back to map
  // The tapped dead tree is now alive and wears the planter's portrait
  const tapped = page.locator(`.patch[data-map-idx="${target}"]`);
  await expect(tapped).toHaveClass(/green/);
  await expect(tapped).toHaveAttribute('title', /Restored by Planter/);
  // Returning from a run opens the leaderboard on Today's race
  await expect(page.locator('#leaderboard')).toHaveClass(/open/);
  await expect(page.locator('#tab-runs')).toHaveClass(/active/);
  await expect(page.locator('#board-rows .board-row').first()).toContainText('Planter');
  await expect(page.locator('#board-rows .board-row').first()).toContainText('⏱️');
  // …and the All-time tab counts the grown tree
  await page.click('#tab-trees');
  await expect(page.locator('#board-rows .board-row').first()).toContainText('🌳 1');
});

test('quitting or falling short restores nothing on the map', async ({ page }) => {
  await freshGame(page, { forceStage: 4 });
  await enterMap(page);
  const greenBefore = await page.locator('.patch.green').count();
  // Quit mid-run: a warning first ("keep playing" resumes), then no restoration
  await page.locator('.patch.barren').first().click();
  await winChallengeTree(page);
  await expect(page.locator('#school-trees')).toHaveText('🌳 1/4', { timeout: 5000 });
  await page.click('#puzzle-quit');
  await expect(page.locator('#overlay-title')).toContainText('Leave the run');
  await page.click('#overlay-btn'); // keep playing — still in the run
  await expect(page.locator('#puzzle-board')).toBeVisible();
  await page.click('#puzzle-quit');
  await page.click('#overlay-btn2'); // really quit
  await expect(page.locator('#world-map')).toBeVisible();
  await expect(page.locator('.patch.green')).toHaveCount(greenBefore);
  // Timing out below the goal: progress shown, still no restoration
  await shortClock(page, 3000);
  await page.locator('.patch.barren').first().click();
  await winChallengeTree(page);
  await expect(page.locator('#result-overlay.show')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#overlay-body')).toContainText('Planted: 1');
  await expect(page.locator('#overlay-btn2')).toBeHidden(); // no Play again
  await page.click('#overlay-btn');
  await expect(page.locator('.patch.green')).toHaveCount(greenBefore);
});

test('reaching the goal ends the run, and leftover items carry into the next board', async ({ page }) => {
  await freshGame(page, { forceStage: 4, name: 'Champ' });
  await enterMap(page);
  // Room for two trees, each followed by the ~3.2s toast-then-flight celebration
  await shortClock(page, 12000);
  await page.evaluate(() => { CONFIG.CHALLENGE.GOAL_TREES = 2; });
  await page.locator('.patch.barren').first().click();
  const goalBefore = await page.textContent('#puzzle-goal');
  // Tree 1 with a spare: three spawns, merge two, one stage-4 left over
  await page.click('#crate-btn');
  await page.click('#crate-btn');
  await page.click('#crate-btn');
  const cells = page.locator('#puzzle-board .cell.stage-4');
  await cells.nth(0).click();
  await cells.nth(1).click();
  await expect(page.locator('#school-trees')).toHaveText('🌳 1/2', { timeout: 5000 });
  // One short of the goal: the run keeps going, no overlay yet
  await expect(page.locator('#result-overlay.show')).toBeHidden();
  // After the celebration the tree is gone but the spare item survived,
  // and the species (goal text) stayed the same
  await expect(page.locator('#puzzle-board .cell.stage-5')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('#puzzle-board .cell.stage-4')).toHaveCount(1);
  expect(await page.textContent('#puzzle-goal')).toBe(goalBefore);
  // Tree 2 needs only one more spawn thanks to the leftover
  await page.click('#crate-btn');
  const pair = page.locator('#puzzle-board .cell.stage-4');
  await pair.nth(0).click();
  await pair.nth(1).click();
  await expect(page.locator('#school-trees')).toHaveText('🌳 2/2', { timeout: 5000 });
  // Goal reached: the run ends right after the celebration, well before the clock
  const clockBefore = await page.textContent('#school-timer');
  await expect(page.locator('#result-overlay.show')).toBeVisible({ timeout: 6000 });
  expect(clockBefore).not.toBe('0:00');
  await expect(page.locator('#overlay-title')).toContainText('Patch restored, Champ');
  await expect(page.locator('#overlay-body')).toContainText('back to life');
  await expect(page.locator('#overlay-body')).toContainText('Your 2 trees');
  // Today's race ranks the goal-reacher by time
  await page.click('#overlay-btn'); // back to map
  await page.click('#tab-runs');
  await expect(page.locator('#board-rows .board-row').first()).toContainText('Champ');
  await expect(page.locator('#board-rows .board-row').first()).toContainText('⏱️');
});

test('dragging an item onto its match merges them', async ({ page }) => {
  await freshGame(page, { forceStage: 1 });
  await enterMap(page);
  await page.locator('.patch.barren').first().click();
  await page.click('#crate-btn');
  await page.click('#crate-btn');
  const seeds = page.locator('#puzzle-board .cell.stage-1');
  await expect(seeds).toHaveCount(2);
  const from = await seeds.nth(0).boundingBox();
  const to = await seeds.nth(1).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#puzzle-board .cell.stage-1')).toHaveCount(0);
  await expect(page.locator('#puzzle-board .cell.stage-2')).toHaveCount(1);
});

test('a bulldozer drives in to destroy a patch when the plague spreads', async ({ page }) => {
  await freshGame(page);
  await enterMap(page);
  await expect(page.locator('.dozer')).toHaveCount(2);   // dozers roam the map
  await expect(page.locator('.critter')).toHaveCount(3); // so do the beetles
  const greenBefore = await page.locator('.patch.green').count();
  await page.request.post('/debug/spread');
  // The destruction is staged: dozer drives over, dust bursts, then the flip
  await expect(page.locator('.dust')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.patch.green')).toHaveCount(greenBefore - 1, { timeout: 5000 });
  await expect(page.locator('#toast')).toContainText('Deforestation spread');
});

test('the Why-it-matters page shows the research, and run results teach a solution', async ({ page }) => {
  await freshGame(page, { forceStage: 4 });
  await enterMap(page);
  await page.click('#info-btn');
  await expect(page.locator('#info-overlay.show')).toBeVisible();
  await expect(page.locator('.info-list li')).toHaveCount(14); // 8 impacts + 6 solutions
  await expect(page.locator('#info-overlay')).toContainText('biodiversity');
  await expect(page.locator('#info-overlay')).toContainText('indigenous land rights');
  // On a short phone screen the close button must stay pinned in view
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(page.locator('#info-close')).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.click('#info-close');
  await expect(page.locator('#info-overlay.show')).toBeHidden();
  // Run results carry a real-world action
  await shortClock(page, 3000);
  await page.locator('.patch.barren').first().click();
  await winChallengeTree(page);
  await expect(page.locator('#result-overlay.show')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#overlay-body')).toContainText('In real life:');
});

test('at 0% green the whole world goes dark, and replanting revives it', async ({ page }) => {
  await freshGame(page);
  await enterMap(page);
  await expect(page.locator('.scene-cell.grove').first()).toBeVisible(); // living wild forest
  await page.request.post('/debug/kill');
  await expect(page.locator('#green-pct')).toHaveText('0%');
  await expect(page.locator('#map-screen')).toHaveClass(/world-dead/);
  await expect(page.locator('.scene-cell.grove')).toHaveCount(0); // groves burnt, no sway
  await expect(page.locator('.critter').first()).toBeHidden();    // the beetles are gone too
  await expect(page.locator('#map-status')).toContainText('forest is gone');
  // One replanted patch brings the world back to life
  await page.evaluate(() => {
    window.__socket.emit('restore', { idx: 0, name: 'Hope', avatar: 1 });
  });
  await expect(page.locator('#map-screen')).not.toHaveClass(/world-dead/);
  await expect(page.locator('.scene-cell.grove').first()).toBeVisible();
});

test('world state survives a page reload (lives on the server)', async ({ page }) => {
  await freshGame(page);
  await enterMap(page);
  const gridBefore = await page.evaluate(() => worldMap.grid.join(''));
  await page.reload();
  await expect(page.locator('.patch')).toHaveCount(96);
  const gridAfter = await page.evaluate(() => worldMap.grid.join(''));
  expect(gridAfter).toBe(gridBefore);
});

test('leaderboard ranks by total trees grown and updates live', async ({ page }) => {
  await freshGame(page);
  await enterMap(page);
  await page.evaluate(async () => {
    const post = (b) => fetch('/api/challenge/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b)
    });
    await post({ name: 'One', avatar: 1, trees: 1, reached: false, timeMs: 120000 });
    await post({ name: 'Two', avatar: 2, trees: 3, reached: false, timeMs: 120000 });
  });
  await expect(page.locator('#board-rows .board-row')).toHaveCount(2);
  await expect(page.locator('#board-rows .board-row').nth(0)).toContainText('Two');
  await expect(page.locator('#board-rows .board-row').nth(1)).toContainText('One');
});

test('leaderboard is pinned on desktop and a drawer on small screens', async ({ page }) => {
  await freshGame(page);
  await enterMap(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#leaderboard')).toBeInViewport();
  await expect(page.locator('#board-toggle')).toBeHidden();
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator('#leaderboard')).not.toBeInViewport();
  await expect(page.locator('#board-toggle')).toBeVisible();
  await page.click('#board-toggle');
  await expect(page.locator('#leaderboard')).toBeInViewport();
  // The open drawer covers at least half the viewport
  const half = await page.evaluate(() => {
    const r = document.getElementById('leaderboard').getBoundingClientRect();
    return r.height >= window.innerHeight * 0.5;
  });
  expect(half).toBe(true);
  // Tapping outside the drawer dismisses it
  await page.mouse.click(40, 150);
  await expect(page.locator('#leaderboard')).not.toBeInViewport();
});

test('two players share one world: a restore by one appears for the other', async ({ browser }) => {
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await freshGame(pageA, { forceStage: 4, name: 'Alpha' });
  await pageB.addInitScript(() => {
    localStorage.setItem('replant_account_v1', JSON.stringify({ name: 'Beta', avatar: 5 }));
  });
  await pageB.goto('/');
  await expect(pageB.locator('.patch')).toHaveCount(96);
  await enterMap(pageA);
  await enterMap(pageB);

  const greenOnB = await pageB.locator('.patch.green').count();
  await pageA.locator('.patch.barren').first().click();
  await pageA.evaluate(() => { CONFIG.CHALLENGE.GOAL_TREES = 1; }); // qualify with one tree
  await winChallengeTree(pageA);

  // Player B sees the patch Alpha restored — with Alpha's badge — live
  await expect(pageB.locator('.patch.green')).toHaveCount(greenOnB + 1);
  await expect(pageB.locator('.patch[title="Restored by Alpha"]')).toHaveCount(1);
  await expect(pageB.locator('#board-rows .board-row').first()).toContainText('Alpha');
});
