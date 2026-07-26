const { test, expect } = require('@playwright/test');

const SAVE_KEY = 'farmLifeSave_v2';
const LEGACY_KEY = 'farmLifeSave_v1';
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
    muted: true,
    onboarded: true,
    ...overrides,
  };
}

/** Writes a save under `key`, then loads the game with it in place. */
async function load(page, save, key = SAVE_KEY) {
  await page.goto('/');
  if (save !== undefined) {
    await page.evaluate(([k, v]) => {
      localStorage.clear();
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }, [key, save]);
    await page.reload();
  }
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
      inventory: { wheat: 20, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await page.locator('#buyCowBtn').click();
    await expect.poll(() => coins(page)).toBe(400); // cow base cost 100
    await expect(page.locator('#cowList .animal-card')).toHaveCount(1);

    await page.locator('#cowList .animal-btn').click(); // feed: 3 crops
    await expect.poll(async () => (await inventory(page)).wheat).toBe(17);
    await expect(page.locator('#cowList .animal-state.producing')).toHaveCount(1);

    // Fast-forward past the production timer.
    await page.evaluate(([k, t]) => {
      const s = JSON.parse(localStorage.getItem(k));
      s.cows[0].feedAt = t;
      localStorage.setItem(k, JSON.stringify(s));
    }, [SAVE_KEY, secondsAgo(60)]);
    await page.reload();
    await page.getByRole('button', { name: /Animals/ }).click();

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

  test('feed button is singular for a one-crop animal', async ({ page }) => {
    await load(page, makeSave({
      chickens: [{ id: 1, state: 'hungry', feedAt: null }],
      nextAnimalId: 2,
      inventory: { wheat: 5, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    }));
    await page.getByRole('button', { name: /Animals/ }).click();

    await expect(page.locator('#chickenList .animal-btn')).toHaveText('Feed (1 crop)');
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
      await page.evaluate(([k, offset]) => {
        const s = JSON.parse(localStorage.getItem(k));
        s.dayStartedAt = Date.now() - offset;
        localStorage.setItem(k, JSON.stringify(s));
      }, [SAVE_KEY, fraction * DAY_LENGTH_MS]);
      await page.reload();
      await page.waitForSelector('#celestialBody');

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
    expect(s.plots[0]).toEqual({ crop: null, plantedAt: null });
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
