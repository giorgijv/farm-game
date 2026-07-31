const { test, expect } = require('@playwright/test');

const SAVE_KEY = 'farmLifeSave_v2';
const LEGACY_KEY = 'farmLifeSave_v1';
/** Pre-unlocking every award keeps reward payouts out of coin arithmetic. */
const ACHIEVEMENT_IDS = [
  'first_harvest', 'green_thumb', 'master_farmer', 'rancher', 'poultry_farmer',
  'shepherd', 'full_barn', 'full_house', 'wealthy_farmer', 'week_one', 'big_business',
];
const DAY_LENGTH_MS = 90_000;
const PLOT_COUNT = 16;

/** A complete, current-shape save. Muted so tests never open an AudioContext. */
function makeSave(overrides = {}) {
  return {
    coins: 100,
    day: 1,
    dayStartedAt: Date.now(),
    selectedSeed: null,
    unlockedPlots: 8,
    plots: Array.from({ length: PLOT_COUNT }, () => ({ crop: null, plantedAt: null })),
    cows: [],
    chickens: [],
    sheep: [],
    nextAnimalId: 1,
    inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    stats: { totalHarvested: 0, totalCoinsEarned: 0 },
    unlockedAchievements: [],
    upgrades: { sprinkler: 0, feed: 0, fertiliser: 0, contacts: 0 },
    muted: true,
    musicOn: false,
    volume: 0.7,
    onboarded: true,
    lastSeenAt: Date.now(),
    ...overrides,
  };
}

/**
 * Puts a save in place *before* any page script runs, then loads the game.
 *
 * Seeding after load and reloading does not work: the outgoing page commits
 * its own state on pagehide, overwriting whatever the test just wrote. The
 * nonce makes seeding happen once per load() call, so a later reload in the
 * same test keeps whatever the game itself saved.
 */
let seedCounter = 0;
async function load(page, save, key = SAVE_KEY) {
  if (save !== undefined) {
    const nonce = `__seeded_${(seedCounter += 1)}`;
    await page.addInitScript(([k, v, n]) => {
      if (sessionStorage.getItem(n)) return;
      localStorage.clear();
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      sessionStorage.setItem(n, '1');
    }, [key, save, nonce]);
  }
  await page.goto('/');
  await page.waitForSelector('#plotsGrid .plot');
}

/** Reads the persisted save, yielding null rather than throwing on garbage. */
const readSave = (page) =>
  page.evaluate((k) => {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  }, SAVE_KEY);

const coins = async (page) => (await readSave(page)).coins;
const inventory = async (page) => (await readSave(page)).inventory;

const secondsAgo = (s) => Date.now() / 1000 - s;

/* ------------------------------------------------------------------ */
/* Core loop                                                           */
/* ------------------------------------------------------------------ */

test.describe('core loop', () => {
  test('planting a seed costs coins and fills the plot', async ({ page }) => {
    await load(page, makeSave({ coins: 300 }));

    await page.locator('.seed-btn').first().click(); // wheat, 5 coins
    await page.locator('#plotsGrid .plot.empty').first().click();

    await expect.poll(() => coins(page)).toBe(295);
    await expect(page.locator('#plotsGrid > *').first().locator('.crop-sprite')).toHaveCount(1);
  });

  test('a ripe crop can be harvested and yields produce', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    const plot = page.locator('#plotsGrid > *').first();
    await expect(plot).toHaveClass(/ready/);
    await plot.click();

    await expect.poll(async () => (await inventory(page)).wheat).toBe(3);
  });

  test('harvesting spawns floating feedback', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await page.locator('#plotsGrid > *').first().click();
    await expect(page.locator('#fxLayer .float-text')).toHaveText(/^\+3/);
  });

  test('unlocking the next plot charges the escalating price', async ({ page }) => {
    await load(page, makeSave({ coins: 300, unlockedPlots: 8 }));

    await page.locator('#plotsGrid .plot.unlockable').click();

    await expect.poll(() => coins(page)).toBe(270); // base cost 30
    await expect.poll(async () => (await readSave(page)).unlockedPlots).toBe(9);
  });

  test('a plot cannot be unlocked without enough coins', async ({ page }) => {
    await load(page, makeSave({ coins: 5, unlockedPlots: 8 }));

    await page.locator('#plotsGrid .plot.unlockable').click();

    await expect(page.locator('#toast')).toHaveText(/not enough coins/i);
    await expect.poll(async () => (await readSave(page)).unlockedPlots).toBe(8);
  });
});

/* ------------------------------------------------------------------ */
/* Animals                                                             */
/* ------------------------------------------------------------------ */

test.describe('animals', () => {
  test('buy, feed, collect and sell a cow', async ({ page }) => {
    await load(page, makeSave({
      coins: 500,
      inventory: { wheat: 0, corn: 20, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#buyCowBtn').click();
    await expect.poll(() => coins(page)).toBe(400); // cow base cost 100
    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);

    await page.locator('#cowList .animal-btn').click(); // feed: 2 corn
    await expect.poll(async () => (await inventory(page)).corn).toBe(18);
    await expect(page.locator('#cowList .animal-state.producing')).toHaveCount(1);

    // Fast-forward past the production timer. Mutating the live state avoids
    // a reload, during which the outgoing page would save over the edit.
    await page.evaluate((t) => { state.cows[0].feedAt = t; }, secondsAgo(60));

    await expect(page.locator('#cowList .animal-state.ready')).toHaveCount(1);
    await page.locator('#cowList .animal-btn').click(); // collect
    await expect.poll(async () => (await inventory(page)).milk).toBe(2);

    const before = await coins(page);
    await page.locator('#cowList .animal-btn-sell').click();
    await expect.poll(() => coins(page)).toBe(before + 50); // half of base cost
    await expect(page.locator('#cowList p')).toHaveCount(1); // empty-state text
  });

  test('feeding is blocked without enough crops', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#cowList .animal-btn')).toBeDisabled();
  });

  test('the feed button names the food that animal eats', async ({ page }) => {
    await load(page, makeSave({
      chickens: [{ id: 1, state: 'hungry', feedAt: null }],
      cows: [{ id: 2, state: 'hungry', feedAt: null }],
      sheep: [{ id: 3, state: 'hungry', feedAt: null }],
      nextAnimalId: 4,
      inventory: { wheat: 5, corn: 5, carrot: 5, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#chickenList .animal-btn')).toHaveText('Feed (1 🌾)');
    await expect(page.locator('#cowList .animal-btn')).toHaveText('Feed (2 🌽)');
    await expect(page.locator('#sheepList .animal-btn')).toHaveText('Feed (2 🥕)');
  });

  test('an animal will not eat the wrong food', async ({ page }) => {
    // Plenty of wheat, but a cow eats corn.
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
      inventory: { wheat: 99, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#cowList .animal-btn')).toBeDisabled();
    await expect(page.locator('#cowList .animal-state.hungry')).toHaveCount(1);
  });
});

/* ------------------------------------------------------------------ */
/* Feed economics                                                      */
/* ------------------------------------------------------------------ */

test.describe('feed economics', () => {
  test('feeding costs more the more valuable the produce', async ({ page }) => {
    await load(page, makeSave());

    const economics = await page.evaluate(() =>
      ['chicken', 'cow', 'sheep'].map((kind) => {
        const def = ANIMALS[kind];
        return {
          kind,
          feedCost: def.feed.amount * GOODS[def.feed.good].sellPrice,
          produceValue: def.produceYield * GOODS[def.produceKey].sellPrice,
        };
      }));

    // Ordered by produce value, feed cost must rise in step...
    const byValue = [...economics].sort((a, b) => a.produceValue - b.produceValue);
    expect(byValue.map((e) => e.kind)).toEqual(['chicken', 'cow', 'sheep']);
    for (let i = 1; i < byValue.length; i += 1) {
      expect(byValue[i].feedCost,
        `${byValue[i].kind} should cost more to feed than ${byValue[i - 1].kind}`)
        .toBeGreaterThan(byValue[i - 1].feedCost);
    }
    // ...while every animal still turns a profit.
    economics.forEach((e) => {
      expect(e.produceValue, `${e.kind} should be worth keeping`).toBeGreaterThan(e.feedCost);
    });
  });

  test('every animal eats a different food', async ({ page }) => {
    await load(page, makeSave());

    const foods = await page.evaluate(() =>
      ANIMAL_ORDER.map((kind) => ANIMALS[kind].feed.good));

    expect(new Set(foods).size, 'each animal should have its own food').toBe(foods.length);
  });
});

/* ------------------------------------------------------------------ */
/* Guardians: dogs and cats                                            */
/* ------------------------------------------------------------------ */

test.describe('guardians', () => {
  const onDutyDog = (t = 0) => [{ id: 90, state: 'producing', feedAt: secondsAgo(t) }];
  const hungryDog = () => [{ id: 90, state: 'hungry', feedAt: null }];

  const wolfNow = (page) => page.evaluate(() => {
    state.nextWolfRaidAt = Date.now();
    updateRaids();
  });
  const pestNow = (page) => page.evaluate(() => {
    state.nextPestRaidAt = Date.now();
    updateRaids();
  });

  const herdSize = async (page) => {
    const s = await readSave(page);
    return s.cows.length + s.chickens.length + s.sheep.length;
  };

  test('a dog on duty turns a wolf away', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      sheep: [{ id: 2, state: 'hungry', feedAt: null }],
      dogs: onDutyDog(),
      nextAnimalId: 91,
    }));

    await wolfNow(page);

    await expect(page.locator('#toast')).toContainText('chased off a wolf');
    expect(await herdSize(page)).toBe(2);
  });

  test('without a dog a wolf takes an animal', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      sheep: [{ id: 2, state: 'hungry', feedAt: null }],
      nextAnimalId: 3,
    }));

    await wolfNow(page);

    await expect(page.locator('#toast')).toContainText('A wolf took');
    expect(await herdSize(page)).toBe(1);
  });

  test('a hungry dog is not guarding anything', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      dogs: hungryDog(),
      nextAnimalId: 91,
    }));

    await wolfNow(page);

    expect(await herdSize(page)).toBe(0);
  });

  test('a cat on duty keeps the crows off', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(3) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      cats: [{ id: 92, state: 'producing', feedAt: secondsAgo(0) }],
      nextAnimalId: 93,
    }));

    await pestNow(page);

    await expect(page.locator('#toast')).toContainText('saw off the crows');
    expect((await readSave(page)).plots[0].crop).toBe('wheat');
  });

  test('without a cat the crows eat a crop', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(3) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await pestNow(page);

    await expect(page.locator('#toast')).toContainText('Crows ate');
    expect((await readSave(page)).plots[0].crop).toBeNull();
  });

  test('a wolf finds nothing to take on an empty farm', async ({ page }) => {
    await load(page, makeSave());
    await wolfNow(page);
    expect(await herdSize(page)).toBe(0); // no crash, nothing lost
  });

  test('a guardian goes off duty when its meal runs out', async ({ page }) => {
    await load(page, makeSave({
      dogs: [{ id: 90, state: 'producing', feedAt: secondsAgo(1000) }],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#dogList .animal-state.hungry')).toHaveCount(1);
    expect((await readSave(page)).dogs[0].state).toBe('hungry');
  });

  test('a guardian has nothing to collect, only a shift to run down', async ({ page }) => {
    await load(page, makeSave({
      dogs: onDutyDog(),
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#dogList .animal-state.onduty')).toHaveCount(1);
    await expect(page.locator('#dogList .animal-btn')).toBeDisabled();
    await expect(page.locator('#dogList .animal-btn')).toHaveText('On duty');
  });

  test('guardians eat their own food', async ({ page }) => {
    await load(page, makeSave({
      dogs: hungryDog(),
      cats: [{ id: 91, state: 'hungry', feedAt: null }],
      nextAnimalId: 92,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 2, egg: 2, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#dogList .animal-btn')).toHaveText('Feed (1 🥚)');
    await expect(page.locator('#catList .animal-btn')).toHaveText('Feed (1 🥛)');

    await page.locator('#dogList .animal-btn').click();
    await expect.poll(async () => (await inventory(page)).egg).toBe(1);
    await expect(page.locator('#dogList .animal-state.onduty')).toHaveCount(1);
  });

  test('a raid that fell due while away is skipped, not resolved', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
    }));

    // Overdue by far more than the staleness window: the player was gone.
    await page.evaluate(() => {
      state.nextWolfRaidAt = Date.now() - 10 * 60 * 1000;
      updateRaids();
    });

    expect(await herdSize(page)).toBe(1);
    // ...and the clock is pushed out rather than firing again immediately.
    expect((await readSave(page)).nextWolfRaidAt).toBeGreaterThan(Date.now());
  });
});

/* ------------------------------------------------------------------ */
/* Spoilage                                                            */
/* ------------------------------------------------------------------ */

test.describe('spoilage', () => {
  const CROP_SPOIL_MS = 2 * DAY_LENGTH_MS;

  /** One ripe wheat plot, the rest empty. */
  const ripeField = (plot = {}) => ([
    { crop: 'wheat', plantedAt: secondsAgo(60), ...plot },
    ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
  ]);

  const firstPlot = (page) => page.locator('#plotsGrid > *').first();

  /** Moves plot 0's deadline to a chosen point and runs the spoilage pass. */
  const setDeadline = (page, at) => page.evaluate((t) => {
    state.plots[0].spoilsAt = t;
    updateSpoilage();
    render();
  }, at);

  test('a ripe crop starts a shelf-life countdown', async ({ page }) => {
    await load(page, makeSave({ plots: ripeField() }));

    // The growth bar becomes a freshness gauge once the crop is ripe.
    await expect(firstPlot(page).locator('.plot-progress-fill.freshness')).toHaveCount(1);

    await expect.poll(async () => (await readSave(page)).plots[0].spoilsAt)
      .toBeGreaterThan(Date.now());
    const { spoilsAt } = (await readSave(page)).plots[0];
    expect(spoilsAt).toBeLessThanOrEqual(Date.now() + CROP_SPOIL_MS);
  });

  test('the last stretch of shelf life is flagged as wilting', async ({ page }) => {
    await load(page, makeSave({ plots: ripeField() }));
    await expect(firstPlot(page)).toHaveClass(/ready/);

    // Comfortably inside the final 30% of the window, but not past it.
    await setDeadline(page, Date.now() + 0.15 * CROP_SPOIL_MS);

    await expect(firstPlot(page)).toHaveClass(/wilting/);
    await expect(firstPlot(page)).toHaveAttribute('aria-label', /going off soon/);
  });

  test('a crop left past its window rots and yields nothing', async ({ page }) => {
    await load(page, makeSave({ inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 }, plots: ripeField() }));
    await expect(firstPlot(page)).toHaveClass(/ready/);

    await setDeadline(page, Date.now() - 1);

    await expect(firstPlot(page)).toHaveClass(/rotten/);
    expect((await readSave(page)).plots[0].rotten).toBe(true);

    // Tapping it clears the plot rather than paying out a harvest.
    await firstPlot(page).click();
    const s = await readSave(page);
    expect(s.inventory.wheat).toBe(0);
    expect(s.stats.totalHarvested).toBe(0);
    expect(s.plots[0]).toEqual({ crop: null, plantedAt: null, spoilsAt: null, rotten: false });
    await expect(firstPlot(page)).toHaveClass(/empty/);
  });

  test('harvesting is refused once a crop has rotted', async ({ page }) => {
    await load(page, makeSave({ plots: ripeField() }));
    await setDeadline(page, Date.now() - 1);

    // Bypass the click handler: even called directly, harvest must not pay out.
    await page.evaluate(() => harvestPlot(0));
    const s = await readSave(page);
    expect(s.inventory.wheat).toBe(0);
    expect(s.plots[0].crop).toBe('wheat');
  });

  test('shelf life does not burn down while the game is closed', async ({ page }) => {
    const away = 20 * 60 * 1000;
    await load(page, makeSave({
      // Left the game with about half the window left; long gone since.
      plots: ripeField({ spoilsAt: Date.now() - away + 0.5 * CROP_SPOIL_MS }),
      lastSeenAt: Date.now() - away,
      dayStartedAt: Date.now() - away,
    }));

    await expect(firstPlot(page)).toHaveClass(/ready/);
    await expect(firstPlot(page)).not.toHaveClass(/rotten/);
    const { spoilsAt } = (await readSave(page)).plots[0];
    // The absence was handed back, so roughly half the window remains.
    expect(spoilsAt - Date.now()).toBeGreaterThan(0.4 * CROP_SPOIL_MS);
  });

  test('a save from before spoilage keeps its ripe crops', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'pumpkin', plantedAt: secondsAgo(600) }, // no spoilsAt field at all
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await expect(firstPlot(page)).toHaveClass(/ready/);
    await expect(firstPlot(page)).not.toHaveClass(/rotten/);
    // A fresh countdown starts from arrival rather than from planting.
    await expect.poll(async () => (await readSave(page)).plots[0].spoilsAt)
      .toBeGreaterThan(Date.now());
  });

  test('crows leave a rotten plot alone', async ({ page }) => {
    await load(page, makeSave({ plots: ripeField() }));
    await setDeadline(page, Date.now() - 1);

    await page.evaluate(() => {
      state.nextPestRaidAt = Date.now();
      updateRaids();
    });

    // Nothing left for them to take, so the plot survives untouched.
    expect((await readSave(page)).plots[0]).toMatchObject({ crop: 'wheat', rotten: true });
  });
});

/* ------------------------------------------------------------------ */
/* Market + achievements                                               */
/* ------------------------------------------------------------------ */

test.describe('market', () => {
  test('selling goods pays out and zeroes the stock', async ({ page }) => {
    await load(page, makeSave({
      coins: 0,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 2, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Market/ }).click();

    const milk = page.locator('#sellList .market-item').filter({ hasText: 'Milk' });
    await milk.getByRole('button').click();

    await expect.poll(() => coins(page)).toBe(18); // 2 x 9
    await expect(milk.locator('.market-have')).toHaveText('Have: 0');
    await expect(milk.getByRole('button')).toBeDisabled();
  });
});

test.describe('achievements', () => {
  test('a met condition unlocks and pays its reward once', async ({ page }) => {
    await load(page, makeSave({ coins: 0, stats: { totalHarvested: 1, totalCoinsEarned: 0 } }));
    await page.getByRole('button', { name: /Awards/ }).click();

    // "First Harvest" pays 10.
    await expect.poll(() => coins(page)).toBe(10);
    await expect(page.locator('.achievement-card.unlocked')).toHaveCount(1);
    await expect(page.locator('#achievementsProgress')).toHaveText('1 / 11 unlocked');

    // It must not pay again on subsequent ticks.
    await page.waitForTimeout(2200);
    expect(await coins(page)).toBe(10);
  });
});

/* ------------------------------------------------------------------ */
/* Rendering: elements persist so CSS animations are not restarted     */
/* ------------------------------------------------------------------ */

test.describe('incremental rendering', () => {
  test('a growing plot keeps its element while its progress advances', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'carrot', plantedAt: secondsAgo(1) }, // 50s grow time
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await page.evaluate(() => { window.__el = document.querySelector('#plotsGrid').children[0]; });
    const widthBefore = await page.locator('#plotsGrid > *').first()
      .locator('.plot-progress-fill').evaluate((el) => el.style.width);

    await page.waitForTimeout(2500);

    expect(await page.evaluate(
      () => window.__el === document.querySelector('#plotsGrid').children[0],
    )).toBe(true);

    const widthAfter = await page.locator('#plotsGrid > *').first()
      .locator('.plot-progress-fill').evaluate((el) => el.style.width);
    expect(parseFloat(widthAfter)).toBeGreaterThan(parseFloat(widthBefore));
  });

  test('a producing animal card keeps its element across ticks', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'producing', feedAt: secondsAgo(1) }],
      nextAnimalId: 2,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();
    await page.waitForSelector('#cowList .animal-card');

    await page.evaluate(() => { window.__c = document.querySelector('#cowList .animal-card'); });
    await page.waitForTimeout(2500);

    expect(await page.evaluate(
      () => window.__c === document.querySelector('#cowList .animal-card'),
    )).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Day cycle                                                           */
/* ------------------------------------------------------------------ */

test.describe('day cycle', () => {
  test('the calendar catches up on every day missed while away', async ({ page }) => {
    // One hour away is 40 whole in-game days.
    await load(page, makeSave({ day: 3, dayStartedAt: Date.now() - 40 * DAY_LENGTH_MS }));

    await expect.poll(async () => (await readSave(page)).day).toBe(43);
  });

  test('rollover carries the remainder instead of resetting the clock', async ({ page }) => {
    // Two-and-a-bit days away: the leftover part-day must survive.
    const remainder = 30_000;
    await load(page, makeSave({
      day: 1,
      dayStartedAt: Date.now() - (2 * DAY_LENGTH_MS + remainder),
    }));

    await expect.poll(async () => (await readSave(page)).day).toBe(3);

    const elapsed = await page.evaluate(
      (k) => Date.now() - JSON.parse(localStorage.getItem(k)).dayStartedAt,
      SAVE_KEY,
    );
    expect(elapsed).toBeGreaterThanOrEqual(remainder);
    expect(elapsed).toBeLessThan(DAY_LENGTH_MS);
  });

  test('the sun and moon stay on screen across the whole cycle', async ({ page }) => {
    await load(page, makeSave());

    for (const fraction of [0, 0.15, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
      await page.evaluate((offset) => {
        state.dayStartedAt = Date.now() - offset;
        updateDayNightVisuals();
      }, fraction * DAY_LENGTH_MS);
      await page.waitForTimeout(150);

      const box = await page.locator('#celestialBody').boundingBox();
      const viewport = page.viewportSize();
      expect(box.x + box.width).toBeGreaterThan(0);
      expect(box.x).toBeLessThan(viewport.width);
      expect(box.y).toBeGreaterThan(-box.height);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Save loading and migration                                          */
/* ------------------------------------------------------------------ */

test.describe('save migration', () => {
  test('a pre-expansion v1 save is upgraded rather than discarded', async ({ page }) => {
    // v1: 12 plots, no unlockedPlots, no sheep, no pumpkin/wool, no stats.
    const legacy = {
      coins: 275,
      day: 5,
      dayStartedAt: Date.now(),
      plots: Array.from({ length: 12 }, () => ({ crop: null, plantedAt: null })),
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      chickens: [],
      nextAnimalId: 2,
      inventory: { wheat: 4, corn: 2, carrot: 1, milk: 3, egg: 6 },
    };
    await load(page, legacy, LEGACY_KEY);

    const s = await readSave(page);
    expect(s.coins).toBe(275);
    expect(s.inventory.wheat).toBe(4);
    // Goods added after v1 must default to 0, never undefined.
    expect(s.inventory.pumpkin).toBe(0);
    expect(s.inventory.wool).toBe(0);
    expect(s.plots).toHaveLength(PLOT_COUNT);
    expect(s.unlockedPlots).toBe(8);
    expect(s.sheep).toEqual([]);
    expect(s.stats).toEqual({ totalHarvested: 0, totalCoinsEarned: 0 });
  });

  test('a migrated save keeps arithmetic numeric', async ({ page }) => {
    await load(page, {
      coins: 50,
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(30) },
        ...Array.from({ length: 11 }, () => ({ crop: null, plantedAt: null })),
      ],
      inventory: { wheat: 1 }, // every other good missing
    }, LEGACY_KEY);

    await page.locator('#plotsGrid > *').first().click(); // harvest

    const inv = await inventory(page);
    for (const [good, count] of Object.entries(inv)) {
      expect(Number.isFinite(count), `${good} should be a number, got ${count}`).toBe(true);
    }
    expect(inv.wheat).toBe(4); // 1 carried over + 3 harvested
  });

  test('content that no longer exists is dropped from the save', async ({ page }) => {
    await load(page, makeSave({
      selectedSeed: 'dragonfruit',
      plots: [
        { crop: 'dragonfruit', plantedAt: secondsAgo(5) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      unlockedAchievements: ['first_harvest', 'no_such_achievement'],
    }));

    const s = await readSave(page);
    expect(s.plots[0]).toEqual({ crop: null, plantedAt: null, spoilsAt: null, rotten: false });
    expect(s.selectedSeed).toBeNull();
    expect(s.unlockedAchievements).toEqual(['first_harvest']);
  });

  test('duplicate animal ids are re-issued uniquely', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 5, state: 'hungry', feedAt: null }, { id: 5, state: 'hungry', feedAt: null }],
      chickens: [{ id: 5, state: 'hungry', feedAt: null }],
      nextAnimalId: 6,
    }));

    const s = await readSave(page);
    const ids = [...s.cows, ...s.chickens, ...s.sheep].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(s.nextAnimalId).toBeGreaterThan(Math.max(...ids));
  });

  test('an animal stuck mid-production without a timer is reset to hungry', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'producing', feedAt: null }],
      nextAnimalId: 2,
    }));

    expect((await readSave(page)).cows[0].state).toBe('hungry');
  });

  test('a corrupt save falls back to a new farm instead of crashing', async ({ page }) => {
    await load(page, 'this is not json {{{');

    await expect(page.locator('#plotsGrid .plot')).toHaveCount(PLOT_COUNT);
    await expect.poll(() => coins(page)).toBe(50); // starting purse
  });

  test('a save from before guardians gains empty pens and a fresh raid clock', async ({ page }) => {
    // Exactly what an existing player's save looks like: no dogs, cats or
    // raid timers, and livestock that predate per-animal feed.
    const preGuardians = makeSave({
      coins: 640,
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      chickens: [{ id: 2, state: 'hungry', feedAt: null }],
    });
    delete preGuardians.dogs;
    delete preGuardians.cats;
    delete preGuardians.nextWolfRaidAt;
    delete preGuardians.nextPestRaidAt;

    await load(page, preGuardians);

    const s = await readSave(page);
    expect(s.coins).toBe(640);
    expect(s.cows).toHaveLength(1);
    expect(s.dogs).toEqual([]);
    expect(s.cats).toEqual([]);
    // No ambush the moment they open the game.
    expect(s.nextWolfRaidAt).toBeGreaterThan(Date.now());
    expect(s.nextPestRaidAt).toBeGreaterThan(Date.now());
  });

  test('out-of-range plot counts are clamped', async ({ page }) => {
    await load(page, makeSave({ unlockedPlots: 999 }));
    expect((await readSave(page)).unlockedPlots).toBe(PLOT_COUNT);
  });
});

/* ------------------------------------------------------------------ */
/* Persistence of preferences                                          */
/* ------------------------------------------------------------------ */

test.describe('preferences', () => {
  test('mute survives a reload', async ({ page }) => {
    await load(page, makeSave({ muted: false }));

    await page.locator('#muteBtn').click();
    await expect.poll(async () => (await readSave(page)).muted).toBe(true);

    await page.reload();
    await page.waitForSelector('#plotsGrid .plot');
    await expect(page.locator('#muteBtn')).toHaveText('🔇');
  });

  test('dismissing the intro banner sticks', async ({ page }) => {
    await load(page, makeSave({ onboarded: false }));

    await expect(page.locator('#onboardingBanner')).toBeVisible();
    await page.locator('#onboardingDismissBtn').click();
    await expect(page.locator('#onboardingBanner')).toBeHidden();

    await page.reload();
    await page.waitForSelector('#plotsGrid .plot');
    await expect(page.locator('#onboardingBanner')).toBeHidden();
  });
});

/* ------------------------------------------------------------------ */
/* Upgrades                                                            */
/* ------------------------------------------------------------------ */

test.describe('upgrades', () => {
  const upgradeCard = (page, name) =>
    page.locator('#upgradeList .upgrade-item').filter({ hasText: name });

  test('buying a level charges the cost and records it', async ({ page }) => {
    await load(page, makeSave({ coins: 500 }));
    await page.getByRole('button', { name: /Market/ }).click();

    const sprinkler = upgradeCard(page, 'Sprinkler');
    await expect(sprinkler.locator('.upgrade-level')).toHaveText('Level 0 / 3');
    await sprinkler.getByRole('button').click();

    await expect.poll(() => coins(page)).toBe(380); // base cost 120
    await expect(sprinkler.locator('.upgrade-level')).toHaveText('Level 1 / 3');
    await expect.poll(async () => (await readSave(page)).upgrades.sprinkler).toBe(1);
  });

  test('each level costs more than the last', async ({ page }) => {
    await load(page, makeSave({ coins: 10_000 }));
    await page.getByRole('button', { name: /Market/ }).click();

    const sprinkler = upgradeCard(page, 'Sprinkler');
    const costs = [];
    for (let i = 0; i < 3; i += 1) {
      const label = await sprinkler.getByRole('button').textContent();
      costs.push(Number(label.match(/(\d+)/)[1]));
      await sprinkler.getByRole('button').click();
      await expect(sprinkler.locator('.upgrade-level')).toHaveText(`Level ${i + 1} / 3`);
    }

    expect(costs).toEqual([120, 240, 480]);
    await expect(sprinkler.getByRole('button')).toBeDisabled();
    await expect(sprinkler.getByRole('button')).toHaveText('Maxed out');
  });

  test('a level cannot be bought without the coins', async ({ page }) => {
    await load(page, makeSave({ coins: 10 }));
    await page.getByRole('button', { name: /Market/ }).click();

    await expect(upgradeCard(page, 'Sprinkler').getByRole('button')).toBeDisabled();
    await expect.poll(async () => (await readSave(page)).upgrades.sprinkler).toBe(0);
  });

  test('the sprinkler actually shortens growing time', async ({ page }) => {
    // Wheat takes 15s; at level 3 that drops to 9.6s. A crop planted 12s ago
    // is therefore still growing at level 0 but ready at level 3.
    const plots = () => [
      { crop: 'wheat', plantedAt: secondsAgo(12) },
      ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
    ];

    await load(page, makeSave({ plots: plots() }));
    await expect(page.locator('#plotsGrid > *').first()).not.toHaveClass(/ready/);

    await load(page, makeSave({
      plots: plots(),
      upgrades: { sprinkler: 3, feed: 0, fertiliser: 0, contacts: 0 },
    }));
    await expect(page.locator('#plotsGrid > *').first()).toHaveClass(/ready/);
  });

  test('fertiliser adds to every harvest', async ({ page }) => {
    await load(page, makeSave({
      upgrades: { sprinkler: 0, feed: 0, fertiliser: 2, contacts: 0 },
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await page.locator('#plotsGrid > *').first().click();
    await expect.poll(async () => (await inventory(page)).wheat).toBe(5); // 3 base + 2
  });

  test('market contacts raise both the quoted and the paid price', async ({ page }) => {
    await load(page, makeSave({
      coins: 0,
      upgrades: { sprinkler: 0, feed: 0, fertiliser: 0, contacts: 3 },
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 2, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Market/ }).click();

    // Milk is 9 base; +30% rounds to 12.
    const milk = page.locator('#sellList .market-item').filter({ hasText: 'Milk' });
    await expect(milk.locator('.market-price')).toHaveText('12💰 each');

    await milk.getByRole('button').click();
    await expect.poll(() => coins(page)).toBe(24);
  });

  test('rich feed shortens animal production', async ({ page }) => {
    // Chickens take 15s; at level 3 that drops to 9.6s. A chicken fed 12s ago
    // is therefore still producing at level 0 but finished at level 3.
    const chickens = () => [{ id: 1, state: 'producing', feedAt: secondsAgo(12) }];

    await load(page, makeSave({ chickens: chickens(), nextAnimalId: 2 }));
    await page.getByRole('button', { name: /Animals/ }).click();
    await expect(page.locator('#chickenList .animal-state.producing')).toHaveCount(1);

    await load(page, makeSave({
      chickens: chickens(),
      nextAnimalId: 2,
      upgrades: { sprinkler: 0, feed: 3, fertiliser: 0, contacts: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();
    await expect(page.locator('#chickenList .animal-state.ready')).toHaveCount(1);
  });

  test('upgrade levels survive migration and are clamped', async ({ page }) => {
    await load(page, makeSave({
      upgrades: { sprinkler: 2, feed: 99, fertiliser: -4, nonsense: 7 },
    }));

    const saved = (await readSave(page)).upgrades;
    expect(saved.sprinkler).toBe(2);
    expect(saved.feed).toBe(3);       // clamped to maxLevel
    expect(saved.fertiliser).toBe(0); // clamped up from negative
    expect(saved.contacts).toBe(0);   // defaulted
    expect(saved.nonsense).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Sound settings                                                      */
/* ------------------------------------------------------------------ */

test.describe('sound settings', () => {
  test('music can be toggled and the choice persists', async ({ page }) => {
    await load(page, makeSave({ musicOn: true }));
    await page.getByRole('button', { name: /Market/ }).click();

    const music = page.locator('#musicToggleBtn');
    await expect(music).toHaveAttribute('aria-pressed', 'true');

    await music.click();
    await expect(music).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await readSave(page)).musicOn).toBe(false);

    await page.reload();
    await page.getByRole('button', { name: /Market/ }).click();
    await expect(page.locator('#musicToggleBtn')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the volume slider stores its value and unmutes', async ({ page }) => {
    await load(page, makeSave({ muted: true, volume: 0.7 }));
    await page.getByRole('button', { name: /Market/ }).click();

    // Muted reads as 0% regardless of the stored level.
    await expect(page.locator('#volumeReadout')).toHaveText('0%');

    await page.locator('#volumeSlider').fill('40');
    await expect(page.locator('#volumeReadout')).toHaveText('40%');

    const saved = await readSave(page);
    expect(saved.volume).toBeCloseTo(0.4, 5);
    expect(saved.muted).toBe(false);
  });

  test('the topbar mute button and the volume readout agree', async ({ page }) => {
    await load(page, makeSave({ muted: false, volume: 1 }));
    await page.getByRole('button', { name: /Market/ }).click();
    await expect(page.locator('#volumeReadout')).toHaveText('100%');

    await page.locator('#muteBtn').click();
    await expect(page.locator('#volumeReadout')).toHaveText('0%');
  });
});

/* ------------------------------------------------------------------ */
/* Welcome back                                                        */
/* ------------------------------------------------------------------ */

test.describe('welcome back', () => {
  const minutesAgo = (m) => Date.now() - m * 60_000;

  test('summarises what finished while the tab was closed', async ({ page }) => {
    await load(page, makeSave({
      lastSeenAt: minutesAgo(10),
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(300) }, // ripened during the gap
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      cows: [{ id: 1, state: 'producing', feedAt: secondsAgo(300) }],
      nextAnimalId: 2,
    }));

    const banner = page.locator('#welcomeBack');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('1 crop ripened');
    await expect(banner).toContainText('1 animal finished producing');

    await page.locator('#welcomeDismissBtn').click();
    await expect(banner).toBeHidden();
  });

  test('stays quiet after a short absence', async ({ page }) => {
    await load(page, makeSave({
      lastSeenAt: Date.now() - 30_000,
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await expect(page.locator('#welcomeBack')).toBeHidden();
  });

  test('stays quiet when nothing actually finished', async ({ page }) => {
    await load(page, makeSave({ lastSeenAt: minutesAgo(30) }));
    await expect(page.locator('#welcomeBack')).toBeHidden();
  });

  test('a crop that was already ripe before leaving is not counted again', async ({ page }) => {
    await load(page, makeSave({
      lastSeenAt: minutesAgo(10),
      plots: [
        // Ripened an hour ago, well before the player left.
        { crop: 'wheat', plantedAt: secondsAgo(3600) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await expect(page.locator('#welcomeBack')).toBeHidden();
  });
});

/* ------------------------------------------------------------------ */
/* Accessibility                                                       */
/* ------------------------------------------------------------------ */

test.describe('accessibility', () => {
  test('plots are real buttons with descriptive labels', async ({ page }) => {
    await load(page, makeSave({
      unlockedPlots: 8,
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) }, // ready
        { crop: 'carrot', plantedAt: secondsAgo(2) }, // growing
        ...Array.from({ length: PLOT_COUNT - 2 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    const cells = page.locator('#plotsGrid > *');
    expect(await cells.first().evaluate((el) => el.tagName)).toBe('BUTTON');

    await expect(cells.nth(0)).toHaveAttribute('aria-label', /Wheat ready to harvest/);
    await expect(cells.nth(1)).toHaveAttribute('aria-label', /Carrot growing/);
    await expect(cells.nth(2)).toHaveAttribute('aria-label', /empty/i);
    await expect(cells.nth(8)).toHaveAttribute('aria-label', /locked. Unlock for 30 coins/);
  });

  test('an unreachable locked plot is disabled rather than a dead button', async ({ page }) => {
    await load(page, makeSave({ unlockedPlots: 8 }));

    await expect(page.locator('#plotsGrid > *').nth(8)).toBeEnabled();  // next to unlock
    await expect(page.locator('#plotsGrid > *').nth(9)).toBeDisabled(); // not yet reachable
  });

  test('a crop can be planted using only the keyboard', async ({ page }) => {
    await load(page, makeSave({ coins: 300 }));

    // Focus the last seed, choose it with Enter, tab into the grid, plant.
    await page.locator('.seed-btn').last().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.seed-btn').last()).toHaveClass(/selected/);

    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.className)).toContain('plot');

    await page.keyboard.press('Enter');
    await expect.poll(() => coins(page)).toBe(265); // pumpkin seed costs 35
    await expect(page.locator('#plotsGrid > *').first().locator('.crop-sprite')).toHaveCount(1);
  });

  test('growth is exposed as a progress bar', async ({ page }) => {
    await load(page, makeSave({
      plots: [
        { crop: 'carrot', plantedAt: secondsAgo(25) }, // 50s grow time, ~50%
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    const bar = page.locator('#plotsGrid > *').first().locator('[role="progressbar"]');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');
    const now = Number(await bar.getAttribute('aria-valuenow'));
    expect(now).toBeGreaterThan(30);
    expect(now).toBeLessThan(70);
  });

  test('the toast is an announced live region', async ({ page }) => {
    await load(page, makeSave({ coins: 0 }));

    await expect(page.locator('#toast')).toHaveAttribute('role', 'status');
    await expect(page.locator('#toast')).toHaveAttribute('aria-live', 'polite');
  });

  test('the mute control reports its state', async ({ page }) => {
    await load(page, makeSave({ muted: false }));

    const mute = page.locator('#muteBtn');
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await expect(mute).toHaveAttribute('aria-label', 'Mute sound');

    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await expect(mute).toHaveAttribute('aria-label', 'Unmute sound');
  });
});

/* ------------------------------------------------------------------ */
/* Installability and offline play                                     */
/* ------------------------------------------------------------------ */

test.describe('progressive web app', () => {
  test('serves a valid manifest with reachable icons', async ({ page, request }) => {
    await load(page, makeSave());

    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('manifest.webmanifest');

    const res = await request.get(`/${href}`);
    expect(res.status()).toBe(200);

    const manifest = await res.json();
    expect(manifest.name).toBe('Farm Life');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const iconRes = await request.get(`/${icon.src}`);
      expect(iconRes.status(), `${icon.src} should be reachable`).toBe(200);
      expect(iconRes.headers()['content-type']).toContain('image/png');
    }
  });

  test('registers a service worker and still plays with the network down', async ({ page, context }) => {
    await load(page, makeSave({ coins: 300 }));

    // The very first page load is never controlled — the worker is still
    // installing while that navigation is in flight. Wait for it to become
    // active, then reload so this page is served through it.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
      if (controlled) break;
      await page.reload();
      await page.waitForSelector('#plotsGrid .plot');
    }
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await context.setOffline(true);
    await page.reload();

    // The shell came from the cache, and the game is still interactive.
    await expect(page.locator('#plotsGrid .plot')).toHaveCount(PLOT_COUNT);
    await page.locator('.seed-btn').first().click();
    await page.locator('#plotsGrid .plot.empty').first().click();
    await expect.poll(() => coins(page)).toBe(295);

    await context.setOffline(false);
  });
});

/* ------------------------------------------------------------------ */
/* Sustained-play performance                                          */
/* ------------------------------------------------------------------ */

test.describe('animation cost', () => {
  test('nothing that loops forever animates a property that repaints', async ({ page }) => {
    await load(page, makeSave());

    // A full field of ripe crops means a dozen-plus of these run at once, so
    // an expensive property here is what turns a long session into a stutter.
    const offenders = await page.evaluate(async () => {
      const css = await fetch('styles.css').then((r) => r.text());
      const composited = new Set(['transform', 'opacity']);
      const found = [];
      const blocks = css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g);
      const declarations = css.match(/animation:[^;]*;/g) || [];
      for (const [, name, body] of blocks) {
        const loopsForever = declarations.some(
          (d) => new RegExp(`\\b${name}\\b`).test(d) && d.includes('infinite'),
        );
        if (!loopsForever) continue;
        const props = [...new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))];
        const expensive = props.filter((p) => !composited.has(p));
        if (expensive.length) found.push(`${name} animates ${expensive.join(', ')}`);
      }
      return found;
    });

    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Progress durability                                                 */
/* ------------------------------------------------------------------ */

test.describe('progress is never lost', () => {
  test('coins and stock survive a reload', async ({ page }) => {
    await load(page, makeSave({
      coins: 500,
      unlockedAchievements: ACHIEVEMENT_IDS,
      plots: [
        { crop: 'wheat', plantedAt: secondsAgo(20) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
    }));

    await page.locator('#plotsGrid > *').first().click();          // +3 wheat
    await page.locator('.seed-btn').first().click();
    await page.locator('#plotsGrid .plot.empty').first().click();  // -5 coins
    await expect.poll(() => coins(page)).toBe(495);

    await page.reload();
    await page.waitForSelector('#plotsGrid .plot');

    expect(await coins(page)).toBe(495);
    expect((await inventory(page)).wheat).toBe(3);
    // The planted crop is still growing after the reload, not reset.
    await expect(page.locator('#plotsGrid > *').first().locator('.crop-sprite')).toHaveCount(1);
  });

  test('progress is committed as soon as the page is backgrounded', async ({ page }) => {
    await load(page, makeSave({ coins: 500, unlockedAchievements: ACHIEVEMENT_IDS }));

    await page.evaluate(() => {
      // Bank coins without going through an action that saves, then background
      // the page — the handler must flush it.
      state.coins = 4242;
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(await coins(page)).toBe(4242);
  });

  test('a backgrounded page stops writing over a newer save', async ({ page }) => {
    await load(page, makeSave({ coins: 500, unlockedAchievements: ACHIEVEMENT_IDS }));

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Stand in for a second tab, or the installed app, saving newer progress.
    await page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k));
      s.coins = 9999;
      s.lastSeenAt = Date.now() + 5000;
      localStorage.setItem(k, JSON.stringify(s));
    }, SAVE_KEY);

    // Several ticks pass while hidden; none of them may clobber that.
    await page.waitForTimeout(2500);
    expect(await coins(page)).toBe(9999);
  });

  test('returning to the page picks up the newer save', async ({ page }) => {
    await load(page, makeSave({ coins: 500, unlockedAchievements: ACHIEVEMENT_IDS }));

    await page.evaluate((k) => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const s = JSON.parse(localStorage.getItem(k));
      s.coins = 8888;
      s.lastSeenAt = Date.now() + 5000;
      localStorage.setItem(k, JSON.stringify(s));
    }, SAVE_KEY);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(page.locator('#coinsLabel')).toContainText('8888');
    await expect.poll(() => coins(page)).toBe(8888);
  });

  test('an unreadable save is kept as a backup rather than thrown away', async ({ page }) => {
    await load(page, 'not valid json at all {{{');

    const backup = await page.evaluate(
      (k) => localStorage.getItem(`${k}_backup`), SAVE_KEY,
    );
    expect(backup).toBe('not valid json at all {{{');
    // The player still gets a working farm.
    await expect(page.locator('#plotsGrid .plot')).toHaveCount(PLOT_COUNT);
  });
});

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

test.describe('footer', () => {
  test('credits the author and points at the other playable games', async ({ page }) => {
    await load(page, makeSave());

    const footer = page.locator('.site-footer');
    await expect(footer).toContainText('made by Giorgi Jvarsheishvili');
    await expect(footer).toContainText('Other games by Giorgi Jvarsheishvili');

    const links = footer.getByRole('link');
    await expect(links).toHaveCount(2);

    // Each must be the hosted game, not the source repository: a github.com
    // link drops the player on a code page rather than into the game.
    const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(hrefs).toEqual([
      'https://giorgijv.github.io/juice-sort/',
      'https://giorgijv.github.io/soviet-racer-giorgi/',
    ]);
    hrefs.forEach((href) => expect(href).not.toContain('github.com'));
  });
});

/* ------------------------------------------------------------------ */
/* Smoke                                                               */
/* ------------------------------------------------------------------ */

test('the page loads with no console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await load(page, makeSave());
  for (const tab of [/Animals/, /Market/, /Awards/, /Farm/]) {
    await page.getByRole('button', { name: tab }).click();
  }
  await page.waitForTimeout(1200);

  expect(errors).toEqual([]);
});
