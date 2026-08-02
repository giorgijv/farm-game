/* Autonomous play-tester. Drives the real UI (clicks, not function calls) on
 * every difficulty, and checks a set of invariants after every action. Run:
 *   node tools/playtest.js [secondsPerRun] [runsPerTier]
 */
const { chromium } = require('@playwright/test');

const PORT = process.env.PORT || 4321;
const SECS = Number(process.argv[2] || 60);
const RUNS = Number(process.argv[3] || 2);
const TIERS = ['relaxed', 'farmer', 'hard'];
const DOG_PREY_SHIFTS = { chicken: 90, sheep: 200, cow: 320 };

const problems = [];
const note = (tier, run, msg) => {
  const line = `[${tier} #${run}] ${msg}`;
  if (!problems.includes(line)) problems.push(line);
};

/** Everything that must be true of the save at all times. */
const INVARIANTS = `() => {
  const bad = [];
  const s = state;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const nonNeg = (v) => num(v) && v >= 0;

  if (!nonNeg(s.coins)) bad.push('coins not a non-negative number: ' + s.coins);
  if (!Number.isInteger(s.coins)) bad.push('coins not an integer: ' + s.coins);
  if (!num(s.day) || s.day < 1) bad.push('day invalid: ' + s.day);
  if (!nonNeg(s.dayElapsedMs) || s.dayElapsedMs >= DAY_LENGTH_MS) bad.push('dayElapsedMs out of range: ' + s.dayElapsedMs);
  if (!DIFFICULTIES[s.difficulty]) bad.push('difficulty invalid: ' + s.difficulty);
  if (s.dreamHome !== null && !DREAM_HOMES[s.dreamHome]) bad.push('dreamHome invalid: ' + s.dreamHome);
  if (s.farmer !== null && !FARMERS[s.farmer]) bad.push('farmer invalid: ' + s.farmer);

  Object.entries(s.inventory).forEach(([k, v]) => {
    if (!nonNeg(v) || !Number.isInteger(v)) bad.push('inventory.' + k + ' = ' + v);
  });
  if (!nonNeg(s.stats.totalHarvested)) bad.push('totalHarvested = ' + s.stats.totalHarvested);
  if (!nonNeg(s.stats.totalCoinsEarned)) bad.push('totalCoinsEarned = ' + s.stats.totalCoinsEarned);
  if (!nonNeg(s.subsidiesPaid)) bad.push('subsidiesPaid = ' + s.subsidiesPaid);
  if (s.subsidiesPaid > Math.floor((s.day - 1) / WEEK_LENGTH_DAYS)) {
    bad.push('paid more weeks (' + s.subsidiesPaid + ') than survived at day ' + s.day);
  }

  if (s.plots.length !== PLOT_COUNT) bad.push('plot count = ' + s.plots.length);
  s.plots.forEach((p, i) => {
    if (p.crop !== null && !CROPS[p.crop]) bad.push('plot ' + i + ' unknown crop ' + p.crop);
    if (p.crop && !num(p.plantedAt)) bad.push('plot ' + i + ' planted with no time');
    if (!p.crop && p.rotten) bad.push('plot ' + i + ' rotten but empty');
    if (!p.crop && p.spoilsAt !== null) bad.push('plot ' + i + ' empty but has spoilsAt');
    if (p.spoilsAt !== null && !num(p.spoilsAt)) bad.push('plot ' + i + ' spoilsAt = ' + p.spoilsAt);
  });
  if (s.unlockedPlots < 1 || s.unlockedPlots > PLOT_COUNT) bad.push('unlockedPlots = ' + s.unlockedPlots);

  const ids = [];
  ANIMAL_ORDER.forEach((kind) => {
    const def = ANIMALS[kind];
    (s[def.stateKey] || []).forEach((a, i) => {
      ids.push(a.id);
      if (a.state !== 'hungry' && a.state !== 'producing') bad.push(kind + ' ' + i + ' state ' + a.state);
      if (a.state === 'producing' && !num(a.feedAt)) bad.push(kind + ' ' + i + ' producing with no feedAt');
      if (a.state === 'hungry' && a.feedAt !== null) bad.push(kind + ' ' + i + ' hungry but has feedAt');
      if (a.starvesAt !== null && !num(a.starvesAt)) bad.push(kind + ' ' + i + ' starvesAt ' + a.starvesAt);
      if (!num(a.id)) bad.push(kind + ' ' + i + ' id ' + a.id);
    });
  });
  if (new Set(ids).size !== ids.length) bad.push('duplicate animal ids: ' + ids.join(','));

  if (s.farmer && s.farmerFedUntil !== null && !num(s.farmerFedUntil)) {
    bad.push('farmerFedUntil = ' + s.farmerFedUntil);
  }
  UPGRADE_ORDER.forEach((k) => {
    const l = s.upgrades[k];
    if (!Number.isInteger(l) || l < 0 || l > UPGRADES[k].maxLevel) bad.push('upgrade ' + k + ' = ' + l);
  });

  // The save on disk must be readable and match the live day.
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!raw) bad.push('no save written');
    else if (raw.day !== s.day) bad.push('saved day ' + raw.day + ' != live day ' + s.day);
  } catch (e) { bad.push('save unparseable: ' + e.message); }

  return bad;
}`;

async function playOnce(browser, tier, run) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') note(tier, run, 'console error: ' + m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => note(tier, run, 'PAGE ERROR: ' + e.message.slice(0, 200)));
  page.on('dialog', (d) => d.accept());

  await page.addInitScript(() => localStorage.clear());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#farmerPicker:not(.hidden)', { timeout: 10000 });

  // Choose the tier, then a farmer, from the opening screen.
  const idx = TIERS.indexOf(tier);
  await page.locator('#pickerDifficulty .difficulty-btn').nth(idx).click();
  await page.locator('.farmer-option').nth(run % 2).click();
  await page.waitForSelector('#farmerPicker.hidden', { state: 'attached' });

  const check = async (where) => {
    let bad = [];
    try { bad = await page.evaluate(`(${INVARIANTS})()`); }
    catch (e) { note(tier, run, `invariant eval failed after ${where}: ${e.message.slice(0, 120)}`); return; }
    bad.forEach((b) => note(tier, run, `after ${where}: ${b}`));
  };

  const tap = async (sel, where) => {
    const el = page.locator(sel).first();
    if (await el.count() === 0) return false;
    if (!(await el.isVisible().catch(() => false))) return false;
    if (await el.isDisabled().catch(() => true)) return false;
    await el.click({ timeout: 2500 }).catch(() => {});
    await check(where);
    return true;
  };

  const deadline = Date.now() + SECS * 1000;
  const seeds = ['wheat', 'corn', 'carrot', 'pumpkin'];
  let n = 0;

  while (Date.now() < deadline) {
    n += 1;
    // FARM: eat if offered, harvest everything ripe, clear rot, plant, unlock.
    await page.locator('button[data-tab="farm"]').click().catch(() => {});
    await tap('#farmerFeedBtn:not([disabled])', 'farmer eats');
    for (const p of await page.locator('#plotsGrid .plot.ready').all()) {
      await p.click({ timeout: 2000 }).catch(() => {});
    }
    await check('harvest sweep');
    for (const p of await page.locator('#plotsGrid .plot.rotten').all()) {
      await p.click({ timeout: 2000 }).catch(() => {});
    }
    await check('clear rot');
    // Rotate which seed, so every crop gets exercised.
    await tap(`.seed-btn:nth-child(${(n % 4) + 1}):not([disabled])`, "pick seed");
    for (const p of await page.locator('#plotsGrid .plot.empty').all()) {
      await p.click({ timeout: 2000 }).catch(() => {});
    }
    await check('plant sweep');
    await tap('#plotsGrid .plot.locked.unlockable', 'unlock plot');

    // ANIMALS: buy, feed, collect, feed guardians, occasionally sell.
    await page.locator('button[data-tab="animals"]').click().catch(() => {});
    for (const kind of ['Cow', 'Chicken', 'Sheep', 'Dog', 'Cat']) {
      await tap(`#buy${kind}Btn:not([disabled])`, `buy ${kind}`);
    }
    for (const kind of ['cow', 'chicken', 'sheep', 'cat']) {
      for (const b of await page.locator(`#${kind}List .animal-btn:not([disabled])`).all()) {
        await b.click({ timeout: 2000 }).catch(() => {});
      }
      await check(`work ${kind}`);
    }
    for (const b of await page.locator('#dogList .prey-btn:not([disabled])').all()) {
      await b.click({ timeout: 2000 }).catch(() => {});
      break; // one meal is enough
    }
    await check('feed dog');
    if (n % 5 === 0) await tap('#chickenList .animal-btn-sell', 'sell animal');

    // MARKET: sell everything, buy every upgrade we can.
    await page.locator('button[data-tab="market"]').click().catch(() => {});
    for (const b of await page.locator('#sellList .market-item button:not([disabled])').all()) {
      await b.click({ timeout: 2000 }).catch(() => {});
    }
    await check('sell all');
    for (const b of await page.locator('#upgradeList button:not([disabled])').all()) {
      await b.click({ timeout: 2000 }).catch(() => {});
    }
    await check('buy upgrades');

    // DREAM: buy a home the moment it is affordable.
    await page.locator('button[data-tab="dream"]').click().catch(() => {});
    if (await tap('#dreamList .dream-card.ready .dream-btn', 'buy dream home')) {
      await page.locator('#endingCloseBtn').click({ timeout: 3000 }).catch(() => {});
      await check('close ending');
    }

    if (await page.locator('#gameOverOverlay:not(.hidden)').count()) {
      note(tier, run, `farmer collapsed after ${n} loops (informational)`);
      await check('game over');
      break;
    }
  }

  const final = await page.evaluate(() => ({
    day: state.day, coins: state.coins, harvested: state.stats.totalHarvested,
    earned: state.stats.totalCoinsEarned, plots: state.unlockedPlots,
    animals: ANIMAL_ORDER.reduce((t, k) => t + state[ANIMALS[k].stateKey].length, 0),
    home: state.dreamHome, subsidies: state.subsidiesPaid, over: state.gameOver,
  }));
  await ctx.close();
  return final;
}


/* Phase two: the events a real-time run cannot reach in a minute — the weekly
 * subsidy, spoilage, starvation, the farmer's collapse, raids both guarded and
 * not, the ending, a mid-game tier switch, and a reload on top of each. */
async function stressOnce(browser, tier) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') note(tier, 'stress', 'console error: ' + m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => note(tier, 'stress', 'PAGE ERROR: ' + e.message.slice(0, 200)));
  page.on('dialog', (d) => d.accept());

  await page.addInitScript(() => localStorage.clear());
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#farmerPicker:not(.hidden)', { timeout: 10000 });
  await page.locator('#pickerDifficulty .difficulty-btn').nth(TIERS.indexOf(tier)).click();
  await page.locator('.farmer-option').first().click();
  await page.waitForSelector('#farmerPicker.hidden', { state: 'attached' });

  const check = async (where) => {
    let bad = [];
    try { bad = await page.evaluate(`(${INVARIANTS})()`); }
    catch (e) { note(tier, 'stress', `invariant eval failed at ${where}: ${e.message.slice(0, 120)}`); return; }
    bad.forEach((b) => note(tier, 'stress', `at ${where}: ${b}`));
  };

  /* Awards pay coins the moment their condition is met, which is a real source
     the scenarios below are not measuring. Bank them all up front so a jump in
     coins can only have come from the thing under test. */
  await page.evaluate(() => {
    state.unlockedAchievements = ACHIEVEMENTS.map((a) => a.id);
    saveState();
  });

  /* Each scenario runs in the page and returns what it observed. The harness
   * then checks that the event actually did what it is supposed to do — a
   * structural invariant alone would let a silent no-op through. */
  const scenarios = [
    ['weekly subsidy pays once', `
      state.day = 8; state.subsidiesPaid = 0; state.coins = 0;
      updateSubsidy(); const first = { coins: state.coins, paid: state.subsidiesPaid };
      updateSubsidy(); render();
      return { first, second: { coins: state.coins, paid: state.subsidiesPaid },
               expected: subsidyAmount() };`,
      (r) => [
        r.first.coins !== r.expected && `paid ${r.first.coins}, expected ${r.expected}`,
        r.first.paid !== 1 && `subsidiesPaid = ${r.first.paid}, expected 1`,
        r.second.coins !== r.first.coins && 'paid twice for the same week',
        r.second.paid !== 1 && `subsidiesPaid drifted to ${r.second.paid}`,
      ]],

    ['many weeks settle in one payment', `
      state.day = 50; state.subsidiesPaid = 0; state.coins = 0;
      updateSubsidy(); render();
      return { coins: state.coins, paid: state.subsidiesPaid, unit: subsidyAmount() };`,
      (r) => [
        r.paid !== 7 && `settled ${r.paid} weeks at day 50, expected 7`,
        r.coins !== 7 * r.unit && `paid ${r.coins}, expected ${7 * r.unit}`,
      ]],

    ['crops rot when the window passes', `
      state.coins = 9999;
      state.plots = state.plots.map((p, i) => (i < 4
        ? { crop: 'wheat', plantedAt: Date.now()/1000 - 900, spoilsAt: Date.now() - 1, rotten: false } : p));
      updateSpoilage(); render();
      return { rotten: state.plots.filter((p) => p.rotten).length };`,
      (r) => [r.rotten !== 4 && `${r.rotten} of 4 ripe-and-expired plots rotted`]],

    ['a rotten crop pays nothing', `
      const before = { ...state.inventory }; const h = state.stats.totalHarvested;
      state.plots.forEach((p, i) => p.rotten && harvestPlot(i)); render();
      return { same: JSON.stringify(before) === JSON.stringify(state.inventory),
               harvested: state.stats.totalHarvested === h,
               stillRotten: state.plots.filter((p) => p.rotten).length };`,
      (r) => [
        !r.same && 'harvesting a rotten plot produced goods',
        !r.harvested && 'harvesting a rotten plot counted as a harvest',
        r.stillRotten === 0 && 'rotten plots vanished instead of needing clearing',
      ]],

    ['clearing a rotten plot empties it', `
      state.plots.forEach((p, i) => p.rotten && clearRottenPlot(i)); render();
      return { rotten: state.plots.filter((p) => p.rotten).length,
               stray: state.plots.filter((p) => !p.crop && p.spoilsAt !== null).length };`,
      (r) => [
        r.rotten !== 0 && `${r.rotten} plots still rotten after clearing`,
        r.stray !== 0 && `${r.stray} cleared plots kept a spoil deadline`,
      ]],

    ['animals starve when their clock runs out', `
      state.cows = [1,2].map((id) => ({ id, state:'hungry', feedAt:null, starvesAt: Date.now()-1, starvingWarned:false }));
      state.chickens = [{ id:3, state:'hungry', feedAt:null, starvesAt: Date.now()-1, starvingWarned:false }];
      state.nextAnimalId = 9; updateStarvation(); render();
      return { left: state.cows.length + state.chickens.length };`,
      (r) => [r.left !== 0 && `${r.left} animals survived past their deadline`]],

    ['a wolf with no dog takes one', `
      state.dogs = []; state.cats = [];
      state.cows = [10,11,12].map((id) => ({ id, state:'hungry', feedAt:null, starvesAt:null, starvingWarned:false }));
      state.nextWolfRaidAt = Date.now(); updateRaids(); render();
      return { left: state.cows.length };`,
      (r) => [r.left !== 2 && `herd went 3 -> ${r.left}, expected 2`]],

    ['a fed dog turns the wolf away', `
      state.cows = [20,21,22].map((id) => ({ id, state:'hungry', feedAt:null, starvesAt:null, starvingWarned:false }));
      state.dogs = [{ id:23, state:'producing', feedAt: Date.now()/1000, starvesAt:null, shiftTime:200 }];
      state.nextWolfRaidAt = Date.now(); updateRaids(); render();
      return { left: state.cows.length, coverage: guardCoverage('dog') };`,
      (r) => [
        r.coverage < 1 && `coverage ${r.coverage} for 3 animals and 1 dog`,
        r.left !== 3 && `full cover still lost an animal (${r.left} of 3 left)`,
      ]],

    ['crows with no cat eat a crop', `
      state.cats = [];
      state.plots = state.plots.map((p, i) => (i < 3
        ? { crop:'corn', plantedAt: Date.now()/1000, spoilsAt:null, rotten:false } : p));
      state.nextPestRaidAt = Date.now(); updateRaids(); render();
      return { planted: state.plots.filter((p) => p.crop).length };`,
      (r) => [r.planted !== 2 && `field went 3 -> ${r.planted}, expected 2`]],

    ['a fed cat keeps them off', `
      state.plots = state.plots.map((p, i) => (i < 3
        ? { crop:'corn', plantedAt: Date.now()/1000, spoilsAt:null, rotten:false } : p));
      state.cats = [{ id:30, state:'producing', feedAt: Date.now()/1000, starvesAt:null }];
      state.nextPestRaidAt = Date.now(); updateRaids(); render();
      return { planted: state.plots.filter((p) => p.crop).length };`,
      (r) => [r.planted !== 3 && `full cover still lost a crop (${r.planted} of 3 left)`]],

    ['a raid on an empty farm does nothing', `
      state.cows = []; state.chickens = []; state.sheep = [];
      state.plots = state.plots.map(() => emptyPlot());
      const c = state.coins;
      state.nextWolfRaidAt = Date.now(); state.nextPestRaidAt = Date.now();
      updateRaids(); render();
      return { coins: state.coins === c, next: state.nextWolfRaidAt > Date.now() };`,
      (r) => [!r.next && 'raid clock was not pushed forward on an empty farm']],

    ['a dog eats each animal for its own shift', `
      const out = [];
      for (const prey of DOG_PREY_ORDER) {
        state.cows = [{ id:40, state:'hungry', feedAt:null, starvesAt:null }];
        state.sheep = [{ id:41, state:'hungry', feedAt:null, starvesAt:null }];
        state.chickens = [{ id:42, state:'hungry', feedAt:null, starvesAt:null }];
        state.dogs = [{ id:43, state:'hungry', feedAt:null, starvesAt:null, shiftTime:null }];
        state.nextAnimalId = 50;
        const before = state.cows.length + state.sheep.length + state.chickens.length;
        feedDog(43, prey);
        out.push({ prey, shift: state.dogs[0].shiftTime, st: state.dogs[0].state,
                   eaten: before - (state.cows.length + state.sheep.length + state.chickens.length) });
      }
      render(); return out;`,
      (r) => r.flatMap((x) => [
        x.eaten !== 1 && `feeding a dog a ${x.prey} removed ${x.eaten} animals`,
        x.st !== 'producing' && `dog not on duty after eating a ${x.prey}`,
        x.shift !== DOG_PREY_SHIFTS[x.prey] && `${x.prey} gave a ${x.shift}s shift`,
      ])],

    ['exhaustion halves the harvest', `
      state.farmerFedUntil = Date.now() + 99e6;
      state.inventory.pumpkin = 0;
      state.plots[0] = { crop:'pumpkin', plantedAt: Date.now()/1000 - 900, spoilsAt:null, rotten:false };
      harvestPlot(0); const fed = state.inventory.pumpkin;
      state.farmerFedUntil = Date.now() - 1; updateFarmerHealth();
      state.inventory.pumpkin = 0;
      state.plots[0] = { crop:'pumpkin', plantedAt: Date.now()/1000 - 900, spoilsAt:null, rotten:false };
      harvestPlot(0); render();
      return { fed, tired: state.inventory.pumpkin };`,
      (r) => [
        r.tired >= r.fed && `tired harvest ${r.tired} not less than fed harvest ${r.fed}`,
        r.tired < 1 && 'tired harvest yielded nothing, leaving no way to recover',
      ]],

    ['a tier change moves prices and clocks', `
      const other = DIFFICULTY_ORDER.find((k) => k !== state.difficulty);
      const was = { price: goodPrice('milk'), spoil: cropSpoilMs(), sub: subsidyAmount() };
      setDifficulty(other);
      const now = { price: goodPrice('milk'), spoil: cropSpoilMs(), sub: subsidyAmount() };
      return { was, now, tier: state.difficulty, other };`,
      (r) => [
        r.tier !== r.other && `tier did not change (still ${r.tier})`,
        r.was.spoil === r.now.spoil && 'spoil window unchanged across tiers',
      ]],

    ['buying a home, once and only once', `
      setDifficulty(TIER_UNDER_TEST);
      state.dreamHome = null; state.coins = 999999;
      const before = state.coins; buyDreamHome('house');
      const afterHouse = { coins: state.coins, home: state.dreamHome };
      buyDreamHome('villa'); render();
      return { spent: before - afterHouse.coins, home: afterHouse.home, after: state.dreamHome };`,
      (r) => [
        r.spent !== 20000 && `house cost ${r.spent}, expected 20000`,
        r.home !== 'house' && `home recorded as ${r.home}`,
        r.after !== 'house' && `a second home was bought (${r.after})`,
      ]],

    ['the farmer collapses and the run ends', `
      state.farmerFedUntil = Date.now() - 99e6; updateFarmerHealth();
      return { over: state.gameOver,
               shown: !document.getElementById('gameOverOverlay').classList.contains('hidden') };`,
      (r) => [
        !r.over && 'a farmer past the collapse deadline did not end the run',
        !r.shown && 'game over was recorded but never shown',
      ]],
  ];

  for (const [name, body, expect] of scenarios) {
    let result;
    try {
      result = await page.evaluate(
        `(() => { const TIER_UNDER_TEST = ${JSON.stringify(tier)};
                  ${body} })()`);
    } catch (e) {
      note(tier, 'stress', `${name} threw: ${e.message.slice(0, 160)}`);
      continue;
    }
    (expect(result) || []).filter(Boolean).forEach((m) => note(tier, 'stress', `${name}: ${m}`));
    await page.waitForTimeout(90);
    await check(name);
  }

  // Everything above, then a reload: the save must come back intact.
  await page.reload();
  await page.waitForSelector('#plotsGrid .plot');
  await page.waitForTimeout(400);
  await check('reload after stress');

  // And a restart from the game-over screen must leave a clean farm.
  if (await page.locator('#gameOverOverlay:not(.hidden)').count()) {
    await page.locator('#restartBtn').click().catch(() => {});
    await page.waitForTimeout(300);
    await check('restart after collapse');
    const fresh = await page.evaluate(() => ({ day: state.day, over: state.gameOver, farmer: state.farmer }));
    if (fresh.day !== 1 || fresh.over || fresh.farmer !== null) {
      note(tier, 'stress', `restart left day=${fresh.day} over=${fresh.over} farmer=${fresh.farmer}`);
    }
  }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  console.log(`playing ${SECS}s x ${RUNS} runs x ${TIERS.length} tiers\n`);
  for (const tier of TIERS) {
    for (let r = 1; r <= RUNS; r += 1) {
      const f = await playOnce(browser, tier, r);
      console.log(`${tier.padEnd(8)} #${r}  day ${String(f.day).padStart(3)}  `
        + `coins ${String(f.coins).padStart(6)}  earned ${String(f.earned).padStart(6)}  `
        + `harvested ${String(f.harvested).padStart(4)}  plots ${f.plots}  animals ${f.animals}  `
        + `subsidies ${f.subsidies}  home ${f.home || '-'}${f.over ? '  GAME OVER' : ''}`);
    }
  }
  console.log('\nstress phase (forced long-horizon events)');
  for (const tier of TIERS) {
    await stressOnce(browser, tier);
    console.log(`  ${tier} stressed`);
  }
  await browser.close();
  console.log('\n' + '='.repeat(70));
  if (problems.length === 0) console.log('NO PROBLEMS FOUND');
  else { console.log(`${problems.length} PROBLEM(S):`); problems.forEach((p) => console.log('  - ' + p)); }
})();
