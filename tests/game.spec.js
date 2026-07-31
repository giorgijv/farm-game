const { test, expect } = require('@playwright/test');

const SAVE_KEY = 'farmLifeSave_v2';
const LEGACY_KEY = 'farmLifeSave_v1';
/** Pre-unlocking every award keeps reward payouts out of coin arithmetic. */
const ACHIEVEMENT_IDS = [
  'first_harvest', 'green_thumb', 'master_farmer', 'rancher', 'poultry_farmer',
  'shepherd', 'full_barn', 'full_house', 'wealthy_farmer', 'week_one', 'big_business',
];
const DAY_LENGTH_MS = 90_000;
const FARMER_MEAL_MS = 3 * DAY_LENGTH_MS;
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
    // A farmer must be chosen before anything else is reachable, so every
    // fixture starts with one picked and fed.
    farmer: 'female',
    farmerFedUntil: Date.now() + FARMER_MEAL_MS,
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

/* ------------------------------------------------------------------ */
/* The farmer                                                          */
/* ------------------------------------------------------------------ */

test.describe('the farmer', () => {
  const ripeWheat = () => [
    { crop: 'wheat', plantedAt: secondsAgo(60) },
    ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
  ];

  test('a new game asks who is running the farm', async ({ page }) => {
    await load(page, makeSave({ farmer: null, farmerFedUntil: null }));

    const picker = page.locator('#farmerPicker');
    await expect(picker).toBeVisible();
    await expect(page.locator('.farmer-option')).toHaveCount(2);
    await expect(page.locator('.farmer-option').nth(0)).toHaveAttribute('aria-label', 'Female farmer');
    await expect(page.locator('.farmer-option').nth(1)).toHaveAttribute('aria-label', 'Male farmer');
  });

  test('picking a farmer starts the game with them fed', async ({ page }) => {
    await load(page, makeSave({ farmer: null, farmerFedUntil: null }));

    await page.locator('.farmer-option').nth(1).click(); // male

    await expect(page.locator('#farmerPicker')).toBeHidden();
    const s = await readSave(page);
    expect(s.farmer).toBe('male');
    expect(s.farmerFedUntil).toBeGreaterThan(Date.now());
    await expect(page.locator('#farmerAvatar')).toHaveText('👨‍🌾');
  });

  test('the choice is remembered and shown in the top bar', async ({ page }) => {
    await load(page, makeSave({ farmer: 'male' }));

    await expect(page.locator('#farmerPicker')).toBeHidden();
    await expect(page.locator('#dayLabel')).toContainText('👨‍🌾');
    await expect(page.locator('#farmerAvatar')).toHaveText('👨‍🌾');
  });

  test('a save from before the farmer asks on the next load', async ({ page }) => {
    // The field is intact — only the farmer is missing.
    await load(page, makeSave({ farmer: undefined, farmerFedUntil: undefined, coins: 777 }));

    await expect(page.locator('#farmerPicker')).toBeVisible();
    await page.locator('.farmer-option').first().click();
    expect((await readSave(page)).coins).toBe(777);
  });

  test('the farmer can be swapped later from the market', async ({ page }) => {
    await load(page, makeSave({ farmer: 'female' }));
    await page.getByRole('button', { name: /Market/ }).click();

    await expect(page.locator('.farmer-swap').first()).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.farmer-swap').nth(1).click();

    expect((await readSave(page)).farmer).toBe('male');
    await expect(page.locator('.farmer-swap').nth(1)).toHaveAttribute('aria-pressed', 'true');
  });

  test('the farmer eats pumpkins', async ({ page }) => {
    await load(page, makeSave({
      // Nearly out of energy, so the meal is worth taking.
      farmerFedUntil: Date.now() + 1000,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 3, milk: 0, egg: 0, wool: 0 },
    }));

    await expect(page.locator('#farmerFeedBtn')).toHaveText('Eat (2 🎃)');
    await page.locator('#farmerFeedBtn').click();

    const s = await readSave(page);
    expect(s.inventory.pumpkin).toBe(1); // 3 - 2
    expect(s.farmerFedUntil).toBeGreaterThan(Date.now() + FARMER_MEAL_MS - 5000);
    await expect(page.locator('#farmerState')).toContainText('Well fed');
  });

  test('with no pumpkins the farmer cannot eat', async ({ page }) => {
    await load(page, makeSave({
      farmerFedUntil: Date.now() + 1000,
      inventory: { wheat: 9, corn: 9, carrot: 9, pumpkin: 1, milk: 9, egg: 9, wool: 9 },
    }));

    // One pumpkin is not a meal.
    await expect(page.locator('#farmerFeedBtn')).toBeDisabled();
  });

  test('a well-fed farmer has nothing to gain from another meal', async ({ page }) => {
    await load(page, makeSave({
      farmerFedUntil: Date.now() + FARMER_MEAL_MS,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 9, milk: 0, egg: 0, wool: 0 },
    }));

    await expect(page.locator('#farmerFeedBtn')).toHaveText('Well fed');
    await expect(page.locator('#farmerFeedBtn')).toBeDisabled();
  });

  test('an exhausted farmer harvests half as much', async ({ page }) => {
    await load(page, makeSave({
      plots: ripeWheat(),
      farmerFedUntil: Date.now() - 1, // out of energy
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
      unlockedAchievements: [...ACHIEVEMENT_IDS],
    }));

    await expect(page.locator('#farmerStrip')).toHaveClass(/tired/);
    await expect(page.locator('#farmerState')).toContainText('Exhausted');

    // Wheat yields 3; exhausted, that halves to 1.
    await page.locator('#plotsGrid > *').first().click();
    expect((await readSave(page)).inventory.wheat).toBe(1);
  });

  test('a rested farmer gets the full harvest', async ({ page }) => {
    await load(page, makeSave({
      plots: ripeWheat(),
      farmerFedUntil: Date.now() + FARMER_MEAL_MS,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
      unlockedAchievements: [...ACHIEVEMENT_IDS],
    }));

    await page.locator('#plotsGrid > *').first().click();
    expect((await readSave(page)).inventory.wheat).toBe(3);
  });

  test('a tired farmer never harvests nothing, so recovery is always possible', async ({ page }) => {
    await load(page, makeSave({
      // A single pumpkin plot, ripe, with an exhausted farmer and no stock.
      plots: [
        { crop: 'pumpkin', plantedAt: secondsAgo(600) },
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      farmerFedUntil: Date.now() - 1,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
      unlockedAchievements: [...ACHIEVEMENT_IDS],
    }));

    await page.locator('#plotsGrid > *').first().click();
    expect((await readSave(page)).inventory.pumpkin).toBeGreaterThanOrEqual(1);
  });

  test('the meal clock does not run down while the game is closed', async ({ page }) => {
    const away = 30 * 60 * 1000;
    await load(page, makeSave({
      farmerFedUntil: Date.now() - away + 0.5 * FARMER_MEAL_MS,
      lastSeenAt: Date.now() - away,
      dayStartedAt: Date.now() - away,
    }));

    await expect(page.locator('#farmerStrip')).not.toHaveClass(/tired/);
    const { farmerFedUntil } = await readSave(page);
    expect(farmerFedUntil - Date.now()).toBeGreaterThan(0.4 * FARMER_MEAL_MS);
  });
});

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

  test('every animal that eats produce has its own food', async ({ page }) => {
    await load(page, makeSave());

    const foods = await page.evaluate(() => ANIMAL_ORDER
      .filter((kind) => !ANIMALS[kind].eatsLivestock)
      .map((kind) => ANIMALS[kind].feed.good));

    expect(new Set(foods).size, 'each animal should have its own food').toBe(foods.length);
    // The dog is the exception: it is fed livestock, not produce.
    expect(await page.evaluate(() => ANIMALS.dog.feed)).toBeNull();
    expect(await page.evaluate(() => ANIMALS.dog.eatsLivestock)).toBe(true);
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

  test('a cat is fed on produce, a dog on livestock', async ({ page }) => {
    await load(page, makeSave({
      dogs: hungryDog(),
      cats: [{ id: 91, state: 'hungry', feedAt: null }],
      chickens: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 92,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 2, egg: 2, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#catList .animal-btn')).toHaveText('Feed (1 🥛)');
    // The dog gets one button per animal it could be given, not a food cost.
    await expect(page.locator('#dogList .prey-btn')).toHaveCount(3);
    await expect(page.locator('#dogList .prey-btn').first()).toHaveText('🐔 90s');

    await page.locator('#catList .animal-btn').click();
    await expect.poll(async () => (await inventory(page)).milk).toBe(1);
    await expect(page.locator('#catList .animal-state.onduty')).toHaveCount(1);

    // Eggs are no longer dog food; the chicken itself is.
    await page.locator('#dogList .prey-btn').first().click();
    await expect(page.locator('#dogList .animal-state.onduty')).toHaveCount(1);
    const s = await readSave(page);
    expect(s.chickens).toEqual([]);
    expect(s.inventory.egg).toBe(2);
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

  /* ---------------------------------------------------------------- */
  /* Guard coverage: one guardian only covers so much                  */
  /* ---------------------------------------------------------------- */

  const GUARD_CAPACITY = 4;

  /** Pins the raid roll so partial coverage becomes a deterministic outcome. */
  const pinRandom = (page, value) =>
    page.evaluate((v) => { Math.random = () => v; }, value);

  const onDutyDogs = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: 90 + i, state: 'producing', feedAt: secondsAgo(0) }));
  const onDutyCats = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: 70 + i, state: 'producing', feedAt: secondsAgo(0) }));
  /** A herd of `n` chickens, which are livestock and so wolf bait. */
  const flock = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, state: 'hungry', feedAt: null }));
  const plantedPlots = (n) => [
    ...Array.from({ length: n }, () => ({ crop: 'wheat', plantedAt: secondsAgo(3) })),
    ...Array.from({ length: PLOT_COUNT - n }, () => ({ crop: null, plantedAt: null })),
  ];
  const plantedCount = async (page) =>
    (await readSave(page)).plots.filter((p) => p.crop).length;

  test('one dog cannot cover a herd of twelve', async ({ page }) => {
    await load(page, makeSave({ chickens: flock(12), dogs: onDutyDogs(1), nextAnimalId: 100 }));
    // Coverage is 4/12, so a roll above that gets through.
    await pinRandom(page, 0.99);
    await wolfNow(page);

    await expect(page.locator('#toast')).toContainText('spread too thin');
    expect(await herdSize(page)).toBe(11);
  });

  test('three dogs do cover a herd of twelve', async ({ page }) => {
    await load(page, makeSave({ chickens: flock(12), dogs: onDutyDogs(3), nextAnimalId: 100 }));
    // 3 x 4 = 12: full cover, so even the worst roll is turned away.
    await pinRandom(page, 0.99);
    await wolfNow(page);

    await expect(page.locator('#toast')).toContainText('chased off a wolf');
    expect(await herdSize(page)).toBe(12);
  });

  test('a herd that outgrows its dog starts losing animals again', async ({ page }) => {
    // Exactly at capacity: covered.
    await load(page, makeSave({
      chickens: flock(GUARD_CAPACITY),
      dogs: onDutyDogs(1),
      nextAnimalId: 100,
    }));
    await pinRandom(page, 0.99);
    await wolfNow(page);
    expect(await herdSize(page)).toBe(GUARD_CAPACITY);

    // Buy one more than the dog can watch and the cover is no longer total.
    await page.evaluate(() => {
      state.chickens.push({ id: 500, state: 'hungry', feedAt: null, starvesAt: null });
    });
    await wolfNow(page);
    expect(await herdSize(page)).toBe(GUARD_CAPACITY); // 5 - 1 lost
  });

  test('one cat cannot cover a full field', async ({ page }) => {
    await load(page, makeSave({ plots: plantedPlots(12), cats: onDutyCats(1), nextAnimalId: 100 }));
    await pinRandom(page, 0.99);
    await pestNow(page);

    await expect(page.locator('#toast')).toContainText('spread too thin');
    expect(await plantedCount(page)).toBe(11);
  });

  test('three cats do cover twelve planted plots', async ({ page }) => {
    await load(page, makeSave({ plots: plantedPlots(12), cats: onDutyCats(3), nextAnimalId: 100 }));
    await pinRandom(page, 0.99);
    await pestNow(page);

    await expect(page.locator('#toast')).toContainText('saw off the crows');
    expect(await plantedCount(page)).toBe(12);
  });

  test('a hungry guardian contributes no cover', async ({ page }) => {
    await load(page, makeSave({
      chickens: flock(4),
      // Two dogs, but only one has been fed.
      dogs: [
        { id: 90, state: 'producing', feedAt: secondsAgo(0) },
        { id: 91, state: 'hungry', feedAt: null },
      ],
      nextAnimalId: 100,
    }));

    expect(await page.evaluate(() => guardCapacity('dog'))).toBe(GUARD_CAPACITY);
  });

  test('the animals tab reports how much of the farm is covered', async ({ page }) => {
    await load(page, makeSave({ chickens: flock(9), dogs: onDutyDogs(1), nextAnimalId: 100 }));
    await page.getByRole('button', { name: /Animals/ }).click();

    const status = page.locator('#dogGuardStatus');
    await expect(status).toContainText('covering 4 of 9 animals');
    await expect(status).toContainText('buy 2 more');
    await expect(status).toHaveClass(/short/);

    // Feed enough dogs to close the gap and the warning clears.
    await page.evaluate(() => {
      state.dogs.push(
        { id: 91, state: 'producing', feedAt: Date.now() / 1000 },
        { id: 92, state: 'producing', feedAt: Date.now() / 1000 },
      );
      render();
    });
    await expect(status).toContainText('all 9 animals covered');
    await expect(status).not.toHaveClass(/short/);
  });

  test('an unguarded farm says so plainly', async ({ page }) => {
    await load(page, makeSave({ chickens: flock(3), nextAnimalId: 100 }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#dogGuardStatus')).toContainText('all 3 animals unguarded');
    await expect(page.locator('#catGuardStatus')).toContainText('Nothing planted');
  });

  /* ---------------------------------------------------------------- */
  /* Dogs eat livestock                                                */
  /* ---------------------------------------------------------------- */

  const preyBtn = (page, i) => page.locator('#dogList .prey-btn').nth(i);
  const acceptConfirms = (page) => page.on('dialog', (d) => d.accept());

  test('a bigger animal buys a longer watch', async ({ page }) => {
    await load(page, makeSave({ dogs: hungryDog(), nextAnimalId: 91 }));

    const shifts = await page.evaluate(() =>
      DOG_PREY_ORDER.map((k) => DOG_PREY[k].shiftTime));

    // chicken < sheep < cow, strictly increasing with the size of the animal.
    expect(shifts).toEqual([...shifts].sort((a, b) => a - b));
    expect(new Set(shifts).size).toBe(shifts.length);
  });

  test('feeding a dog a chicken costs the chicken', async ({ page }) => {
    await load(page, makeSave({
      dogs: hungryDog(),
      chickens: [{ id: 1, state: 'hungry', feedAt: null }, { id: 2, state: 'hungry', feedAt: null }],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await preyBtn(page, 0).click(); // chicken, no confirmation

    await expect(page.locator('#toast')).toContainText('Slaughtered a Chicken');
    const s = await readSave(page);
    expect(s.chickens).toHaveLength(1);
    expect(s.dogs[0].state).toBe('producing');
    expect(s.dogs[0].shiftTime).toBe(90);
  });

  test('a cow keeps the dog on duty far longer than a chicken', async ({ page }) => {
    acceptConfirms(page);
    await load(page, makeSave({
      dogs: hungryDog(),
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await preyBtn(page, 2).click(); // cow

    const s = await readSave(page);
    expect(s.cows).toEqual([]);
    expect(s.dogs[0].shiftTime).toBe(320);
    // The shift really is longer: a dog 200s in is still working.
    await page.evaluate(() => { state.dogs[0].feedAt = Date.now() / 1000 - 200; });
    await expect(page.locator('#dogList .animal-state.onduty')).toHaveCount(1);
  });

  test('giving up a cow asks first', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await load(page, makeSave({
      dogs: hungryDog(),
      cows: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await preyBtn(page, 2).click();
    await page.waitForTimeout(300);

    const s = await readSave(page);
    expect(s.cows).toHaveLength(1); // declined, so nothing was lost
    expect(s.dogs[0].state).toBe('hungry');
  });

  test('with empty pens there is nothing to feed the dog', async ({ page }) => {
    await load(page, makeSave({ dogs: hungryDog(), nextAnimalId: 91 }));
    await page.getByRole('button', { name: /Animals/ }).click();

    for (let i = 0; i < 3; i += 1) await expect(preyBtn(page, i)).toBeDisabled();
    // Buying an animal is what puts a meal back on the table.
    await page.evaluate(() => {
      state.chickens.push({ id: 5, state: 'hungry', feedAt: null, starvesAt: null });
      render();
    });
    await expect(preyBtn(page, 0)).toBeEnabled();
  });

  test('a producing animal is spared while an idle one is available', async ({ page }) => {
    await load(page, makeSave({
      dogs: hungryDog(),
      chickens: [
        { id: 1, state: 'producing', feedAt: secondsAgo(2) },
        { id: 2, state: 'hungry', feedAt: null },
      ],
      nextAnimalId: 91,
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await preyBtn(page, 0).click();

    // The one mid-cycle is left alone; the idle one goes.
    const s = await readSave(page);
    expect(s.chickens).toHaveLength(1);
    expect(s.chickens[0].state).toBe('producing');
  });

  test('eggs no longer feed a dog', async ({ page }) => {
    await load(page, makeSave({
      dogs: hungryDog(),
      nextAnimalId: 91,
      inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 9, wool: 0 },
    }));

    // A barn full of eggs and no livestock leaves the dog hungry.
    await page.evaluate(() => feedAnimal('dog', 90));
    const s = await readSave(page);
    expect(s.dogs[0].state).toBe('hungry');
    expect(s.inventory.egg).toBe(9);
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
/* Starvation                                                          */
/* ------------------------------------------------------------------ */

test.describe('starvation', () => {
  const ANIMAL_STARVE_MS = 4 * DAY_LENGTH_MS;

  const hungryCow = (extra = {}) => [{ id: 1, state: 'hungry', feedAt: null, ...extra }];

  /** Moves the cow's deadline to a chosen point and runs the starvation pass. */
  const setDeadline = (page, at) => page.evaluate((t) => {
    state.cows[0].starvesAt = t;
    updateStarvation();
    render();
  }, at);

  const openAnimals = (page) => page.getByRole('button', { name: /Animals/ }).click();

  test('a hungry animal starts a starvation countdown', async ({ page }) => {
    await load(page, makeSave({ cows: hungryCow(), nextAnimalId: 2 }));
    await openAnimals(page);

    // The production bar doubles as the hunger gauge while the animal waits.
    await expect(page.locator('#cowList .animal-progress-fill.hunger')).toHaveCount(1);

    await expect.poll(async () => (await readSave(page)).cows[0].starvesAt)
      .toBeGreaterThan(Date.now());
    const { starvesAt } = (await readSave(page)).cows[0];
    expect(starvesAt).toBeLessThanOrEqual(Date.now() + ANIMAL_STARVE_MS);
  });

  test('the last stretch before death is flagged as starving', async ({ page }) => {
    await load(page, makeSave({ cows: hungryCow(), nextAnimalId: 2 }));
    await openAnimals(page);
    await expect(page.locator('#cowList .animal-state.hungry')).toHaveCount(1);

    // Well inside the final quarter of the window, but not past it.
    await setDeadline(page, Date.now() + 0.1 * ANIMAL_STARVE_MS);

    await expect(page.locator('#cowList .animal-state.starving')).toHaveCount(1);
    await expect(page.locator('#toast')).toContainText('is starving');
    expect((await readSave(page)).cows[0].starvingWarned).toBe(true);
  });

  test('an animal left hungry too long dies', async ({ page }) => {
    await load(page, makeSave({ cows: hungryCow(), nextAnimalId: 2 }));
    await openAnimals(page);
    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);

    await setDeadline(page, Date.now() - 1);

    await expect(page.locator('#toast')).toContainText('starved to death');
    expect((await readSave(page)).cows).toEqual([]);
    await expect(page.locator('#cowList p')).toHaveCount(1); // empty-state text
  });

  test('feeding resets the clock', async ({ page }) => {
    await load(page, makeSave({
      cows: hungryCow(),
      nextAnimalId: 2,
      inventory: { wheat: 0, corn: 4, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await openAnimals(page);

    // On the brink, then fed with a moment to spare.
    await setDeadline(page, Date.now() + 0.05 * ANIMAL_STARVE_MS);
    await expect(page.locator('#cowList .animal-state.starving')).toHaveCount(1);
    await page.locator('#cowList .animal-btn').click();

    const s = await readSave(page);
    expect(s.cows[0].state).toBe('producing');
    expect(s.cows[0].starvesAt).toBeNull();
    expect(s.cows[0].starvingWarned).toBe(false);

    // ...and once the milk is collected it gets a full window again.
    await page.evaluate((t) => { state.cows[0].feedAt = t; }, secondsAgo(60));
    await page.locator('#cowList .animal-btn').click(); // collect
    await expect.poll(async () => (await readSave(page)).cows[0].starvesAt)
      .toBeGreaterThan(Date.now() + 0.9 * ANIMAL_STARVE_MS);
  });

  test('hunger does not burn down while the game is closed', async ({ page }) => {
    const away = 30 * 60 * 1000;
    await load(page, makeSave({
      // Walked away with about half the window left; long gone since.
      cows: hungryCow({ starvesAt: Date.now() - away + 0.5 * ANIMAL_STARVE_MS }),
      nextAnimalId: 2,
      lastSeenAt: Date.now() - away,
      dayStartedAt: Date.now() - away,
    }));
    await openAnimals(page);

    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);
    await expect(page.locator('#cowList .animal-state.starving')).toHaveCount(0);
    const { starvesAt } = (await readSave(page)).cows[0];
    expect(starvesAt - Date.now()).toBeGreaterThan(0.4 * ANIMAL_STARVE_MS);
  });

  test('a save from before starvation keeps its animals', async ({ page }) => {
    await load(page, makeSave({
      cows: [{ id: 1, state: 'hungry', feedAt: null }], // no starvesAt field at all
      nextAnimalId: 2,
    }));
    await openAnimals(page);

    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);
    // A fresh window starts from arrival rather than from whenever it was fed.
    await expect.poll(async () => (await readSave(page)).cows[0].starvesAt)
      .toBeGreaterThan(Date.now());
  });

  test('guardians starve too', async ({ page }) => {
    await load(page, makeSave({
      dogs: [{ id: 90, state: 'hungry', feedAt: null }],
      nextAnimalId: 91,
    }));
    await openAnimals(page);

    await expect(page.locator('#dogList .animal-progress-fill.hunger')).toHaveCount(1);
    await page.evaluate(() => {
      state.dogs[0].starvesAt = Date.now() - 1;
      updateStarvation();
      render();
    });

    await expect(page.locator('#toast')).toContainText('starved to death');
    expect((await readSave(page)).dogs).toEqual([]);
  });

  test('a starving animal can still be sold rather than lost', async ({ page }) => {
    await load(page, makeSave({ coins: 0, cows: hungryCow(), nextAnimalId: 2 }));
    await openAnimals(page);

    await setDeadline(page, Date.now() + 0.05 * ANIMAL_STARVE_MS);
    await expect(page.locator('#cowList .animal-state.starving')).toHaveCount(1);

    await page.locator('#cowList .animal-btn-sell').click();
    await expect.poll(() => coins(page)).toBe(50); // half the 100-coin base cost
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

    // A save this old predates the farmer, so the picker is in the way.
    await page.locator('.farmer-option').first().click();
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
/* Dream homes — the two grand goals                                   */
/* ------------------------------------------------------------------ */

test.describe('dream homes', () => {
  const HOUSE_COST = 20000;
  const VILLA_COST = 40000;

  /** Awards pre-unlocked so their coin rewards stay out of the arithmetic. */
  const dreamSave = (o = {}) => makeSave({ unlockedAchievements: [...ACHIEVEMENT_IDS], ...o });

  const openDream = (page) => page.getByRole('button', { name: /Dream/ }).click();
  const card = (page, i) => page.locator('#dreamList > *').nth(i);
  const houseBtn = (page) => card(page, 0).locator('.dream-btn');
  const villaBtn = (page) => card(page, 1).locator('.dream-btn');

  /** window.confirm defaults to dismissed under Playwright. */
  const acceptConfirms = (page) => page.on('dialog', (d) => d.accept());

  test('both goals are listed with their prices', async ({ page }) => {
    await load(page, dreamSave({ coins: 0 }));
    await openDream(page);

    await expect(page.locator('#dreamList > *')).toHaveCount(2);
    await expect(card(page, 0)).toContainText('Country House');
    await expect(card(page, 0)).toContainText('20,000💰');
    await expect(card(page, 1)).toContainText('Grand Villa');
    await expect(card(page, 1)).toContainText('40,000💰');
  });

  test('neither can be bought without the coins', async ({ page }) => {
    await load(page, dreamSave({ coins: HOUSE_COST - 1 }));
    await openDream(page);

    await expect(houseBtn(page)).toBeDisabled();
    await expect(villaBtn(page)).toBeDisabled();
    expect((await readSave(page)).dreamHome).toBeNull();
  });

  test('savings progress is shown against each goal', async ({ page }) => {
    await load(page, dreamSave({ coins: 10000 }));
    await openDream(page);

    // Halfway to the house, a quarter of the way to the villa.
    await expect(card(page, 0).locator('.dream-progress')).toHaveAttribute('aria-valuenow', '50');
    await expect(card(page, 1).locator('.dream-progress')).toHaveAttribute('aria-valuenow', '25');
  });

  test('buying the house ends the run and takes the villa off the market', async ({ page }) => {
    acceptConfirms(page);
    await load(page, dreamSave({ coins: HOUSE_COST + 500 }));
    await openDream(page);

    await expect(houseBtn(page)).toBeEnabled();
    await houseBtn(page).click();

    await expect(page.locator('#toast')).toContainText('You bought the Country House');
    const s = await readSave(page);
    expect(s.dreamHome).toBe('house');
    expect(s.coins).toBe(500);

    await expect(card(page, 0)).toHaveClass(/owned/);
    await expect(houseBtn(page)).toHaveText('🎉 Yours!');
    await expect(card(page, 1)).toHaveClass(/forfeited/);
    await expect(villaBtn(page)).toBeDisabled();
    await expect(villaBtn(page)).toHaveText('No longer available');
  });

  test('the villa is the other way to finish', async ({ page }) => {
    acceptConfirms(page);
    await load(page, dreamSave({ coins: VILLA_COST }));
    await openDream(page);

    // With villa money in hand, both are affordable — it is a real choice.
    await expect(houseBtn(page)).toBeEnabled();
    await villaBtn(page).click();

    const s = await readSave(page);
    expect(s.dreamHome).toBe('villa');
    expect(s.coins).toBe(0);
    await expect(card(page, 1)).toHaveClass(/owned/);
    await expect(card(page, 0)).toHaveClass(/forfeited/);
  });

  test('declining the confirmation leaves the coins alone', async ({ page }) => {
    page.on('dialog', (d) => d.dismiss());
    await load(page, dreamSave({ coins: HOUSE_COST }));
    await openDream(page);

    await houseBtn(page).click();
    await page.waitForTimeout(300);

    const s = await readSave(page);
    expect(s.dreamHome).toBeNull();
    expect(s.coins).toBe(HOUSE_COST);
  });

  test('a second home cannot be bought after the first', async ({ page }) => {
    acceptConfirms(page);
    await load(page, dreamSave({ coins: VILLA_COST + HOUSE_COST, dreamHome: 'house' }));
    await openDream(page);

    // Even called directly, with the coins in hand, the goal stays settled.
    await page.evaluate(() => buyDreamHome('villa'));
    const s = await readSave(page);
    expect(s.dreamHome).toBe('house');
    expect(s.coins).toBe(VILLA_COST + HOUSE_COST);
  });

  test('the choice survives a reload, and a bogus one is discarded', async ({ page }) => {
    await load(page, dreamSave({ coins: 10, dreamHome: 'villa' }));
    await openDream(page);
    await expect(card(page, 1)).toHaveClass(/owned/);
    expect((await readSave(page)).dreamHome).toBe('villa');

    await load(page, dreamSave({ coins: 10, dreamHome: 'mansion' }));
    expect((await readSave(page)).dreamHome).toBeNull();
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
