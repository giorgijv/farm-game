const { test, expect, devices } = require('@playwright/test');

const SAVE_KEY = 'farmLifeSave_v2';
const PLOT_COUNT = 16;

/** Android-ish profiles: a small phone, a common phone, and landscape. */
const PHONE = { viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true };
const SMALL = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const LANDSCAPE = { viewport: { width: 851, height: 393 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true };

function makeSave(overrides = {}) {
  return {
    coins: 900,
    day: 3,
    dayStartedAt: Date.now(),
    selectedSeed: null,
    unlockedPlots: 9,
    plots: Array.from({ length: PLOT_COUNT }, () => ({ crop: null, plantedAt: null })),
    cows: [{ id: 1, state: 'hungry', feedAt: null }],
    chickens: [],
    sheep: [],
    nextAnimalId: 2,
    inventory: { wheat: 9, corn: 2, carrot: 1, pumpkin: 0, milk: 2, egg: 3, wool: 0 },
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

let seedCounter = 0;
async function load(page, save = makeSave()) {
  // Seed before page scripts run; see the note in game.spec.js.
  const nonce = `__seeded_${(seedCounter += 1)}`;
  await page.addInitScript(([k, v, n]) => {
    if (sessionStorage.getItem(n)) return;
    localStorage.clear();
    localStorage.setItem(k, JSON.stringify(v));
    sessionStorage.setItem(n, '1');
  }, ['farmLifeSave_v2', save, nonce]);
  await page.goto('/');
  await page.waitForSelector('#plotsGrid .plot');
}

const readSave = (page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SAVE_KEY);

const TABS = ['farm', 'animals', 'market', 'achievements', 'dream'];

/** Every visible, enabled control smaller than the 44px accessibility floor. */
async function undersizedControls(page) {
  const found = [];
  for (const tab of TABS) {
    await page.locator(`button[data-tab="${tab}"]`).tap();
    await page.waitForTimeout(200);
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button:not([disabled]), input[type="range"], a').forEach((el) => {
        if (el.offsetParent === null) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.height < 44 || r.width < 44) {
          out.push({
            label: (el.textContent || el.id || el.className).toString().trim().slice(0, 30),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      });
      return out;
    });
    small.forEach((s) => found.push({ tab, ...s }));
  }
  return found;
}

const horizontalOverflow = (page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

/* ------------------------------------------------------------------ */

test.describe('phone portrait', () => {
  test.use(PHONE);

  test('the page never scrolls sideways', async ({ page }) => {
    await load(page);
    for (const tab of TABS) {
      await page.locator(`button[data-tab="${tab}"]`).tap();
      await page.waitForTimeout(200);
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth, `${tab} tab overflows horizontally`).toBeLessThanOrEqual(clientWidth + 1);
    }
  });

  test('every control meets the 44px touch target floor', async ({ page }) => {
    await load(page);
    expect(await undersizedControls(page)).toEqual([]);
  });

  test('the whole loop is playable by tapping', async ({ page }) => {
    await load(page, makeSave({
      coins: 900,
      plots: [
        { crop: 'wheat', plantedAt: Date.now() / 1000 - 20 }, // ripe
        ...Array.from({ length: PLOT_COUNT - 1 }, () => ({ crop: null, plantedAt: null })),
      ],
      inventory: { wheat: 5, corn: 4, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
      unlockedAchievements: ['first_harvest'], // keep the coin maths clean
    }));

    // Harvest by tap: 5 + 3 = 8 wheat.
    await page.locator('#plotsGrid > *').first().tap();
    await expect.poll(async () => (await readSave(page)).inventory.wheat).toBe(8);

    // Pick a seed and plant by tap: wheat seed costs 5.
    await page.locator('.seed-btn').first().tap();
    await page.locator('#plotsGrid .plot.empty').first().tap();
    await expect.poll(async () => (await readSave(page)).coins).toBe(895);

    // Feed the cow by tap: eats 2 corn, leaving 2.
    await page.locator('button[data-tab="animals"]').tap();
    await page.locator('#cowList .animal-btn').tap();
    await expect(page.locator('#cowList .animal-state.producing')).toHaveCount(1);
    await expect.poll(async () => (await readSave(page)).inventory.corn).toBe(2);

    // Sell the wheat by tap: 8 x 3 coins.
    await page.locator('button[data-tab="market"]').tap();
    const wheat = page.locator('#sellList .market-item').filter({ hasText: 'Wheat' });
    await wheat.getByRole('button').tap();
    await expect(wheat.locator('.market-have')).toHaveText('Have: 0');
    await expect.poll(async () => (await readSave(page)).coins).toBe(919);
  });

  test('all four seeds fit on one row', async ({ page }) => {
    await load(page);
    const tops = await page.locator('.seed-btn').evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size, 'seed bar should not wrap').toBe(1);
  });

  test('hover lift is not applied on a touch screen', async ({ page }) => {
    await load(page);
    // (hover: hover) must not match, so the lift rule is inert here.
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  });
});

test.describe('small phone', () => {
  test.use(SMALL);

  test('no sideways scroll at 360px', async ({ page }) => {
    await load(page);
    for (const tab of TABS) {
      await page.locator(`button[data-tab="${tab}"]`).tap();
      await page.waitForTimeout(200);
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth, `${tab} tab overflows at 360px`).toBeLessThanOrEqual(clientWidth + 1);
    }
  });

  test('touch targets hold up at 360px', async ({ page }) => {
    await load(page);
    expect(await undersizedControls(page)).toEqual([]);
  });
});

test.describe('landscape', () => {
  test.use(LANDSCAPE);

  test('no sideways scroll when the phone is rotated', async ({ page }) => {
    await load(page);
    for (const tab of TABS) {
      await page.locator(`button[data-tab="${tab}"]`).tap();
      await page.waitForTimeout(200);
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth, `${tab} tab overflows in landscape`).toBeLessThanOrEqual(clientWidth + 1);
    }
  });

  test('the plot grid widens instead of running off the bottom', async ({ page }) => {
    await load(page);
    const tops = await page.locator('#plotsGrid > *').evaluateAll((els) =>
      els.slice(0, 6).map((el) => Math.round(el.getBoundingClientRect().top)));
    // Six plots share the first row in landscape.
    expect(new Set(tops).size).toBe(1);
  });
});

test.describe('installed app framing', () => {
  test.use(PHONE);

  test('the viewport opts into the display cutout', async ({ page }) => {
    await load(page);
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content).toContain('viewport-fit=cover');
  });

  test('layout padding reserves room for system insets', async ({ page }) => {
    await load(page);
    // env() resolves to 0 in the emulator, but the declaration must be present
    // so a notched device actually gets the inset.
    const usesInsets = await page.evaluate(async () => {
      const css = await fetch('styles.css').then((r) => r.text());
      return {
        app: /#app\s*{[^}]*env\(safe-area-inset-bottom\)/s.test(css),
        toast: /\.toast\s*{[^}]*env\(safe-area-inset-bottom\)/s.test(css),
      };
    });
    expect(usesInsets.app).toBe(true);
    expect(usesInsets.toast).toBe(true);
  });
});
