'use strict';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const PLOT_COUNT = 16;
const INITIAL_UNLOCKED_PLOTS = 8;
const PLOT_UNLOCK_BASE_COST = 30;
const PLOT_UNLOCK_INCREMENT = 25;
const DAY_LENGTH_MS = 90 * 1000; // one in-game day
const SAVE_KEY = 'farmLifeSave_v2';

const CROPS = {
  wheat: { name: 'Wheat', emoji: '🌾', seedCost: 5, growTime: 15, yield: 3, sellPrice: 3 },
  corn: { name: 'Corn', emoji: '🌽', seedCost: 12, growTime: 30, yield: 3, sellPrice: 6 },
  carrot: { name: 'Carrot', emoji: '🥕', seedCost: 20, growTime: 50, yield: 3, sellPrice: 10 },
  pumpkin: { name: 'Pumpkin', emoji: '🎃', seedCost: 35, growTime: 70, yield: 3, sellPrice: 16 },
};

const CROP_ORDER = ['wheat', 'corn', 'carrot', 'pumpkin'];

// Livestock turn feed into goods; guardians turn feed into protection.
//
// Each animal eats one specific crop or good, and the bill scales with what it
// produces: a chicken cycle costs 3 coins of wheat and returns 5, a cow costs
// 12 of corn and returns 18, a sheep costs 20 of carrot and returns 28. Richer
// produce is always the more expensive animal to keep, but never a loss.
const ANIMALS = {
  cow: {
    name: 'Cow', emoji: '🐄', stateKey: 'cows', buyBaseCost: 100, costIncrement: 70,
    feed: { good: 'corn', amount: 2 },        // 12 coins
    produceTime: 25, produceYield: 2,
    produceKey: 'milk', produceEmoji: '🥛',   // 18 coins
  },
  chicken: {
    name: 'Chicken', emoji: '🐔', stateKey: 'chickens', buyBaseCost: 40, costIncrement: 25,
    feed: { good: 'wheat', amount: 1 },       // 3 coins
    produceTime: 15, produceYield: 1,
    produceKey: 'egg', produceEmoji: '🥚',    // 5 coins
  },
  sheep: {
    name: 'Sheep', pluralName: 'sheep', emoji: '🐑', stateKey: 'sheep',
    buyBaseCost: 150, costIncrement: 90,
    feed: { good: 'carrot', amount: 2 },      // 20 coins
    produceTime: 35, produceYield: 2,
    produceKey: 'wool', produceEmoji: '🧶',   // 28 coins
  },
  dog: {
    name: 'Dog', emoji: '🐕', stateKey: 'dogs', buyBaseCost: 180, costIncrement: 120,
    // Fed on livestock, not produce — see DOG_PREY. The shift length comes
    // from whatever was slaughtered, so it lives on the animal, not here.
    feed: null, eatsLivestock: true,
    produceTime: 150, produceYield: 0, produceKey: null,
    guards: 'wolves',
    role: 'Keeps wolves away from your livestock',
  },
  cat: {
    name: 'Cat', emoji: '🐈', stateKey: 'cats', buyBaseCost: 160, costIncrement: 110,
    feed: { good: 'milk', amount: 1 },
    produceTime: 150, produceYield: 0, produceKey: null,
    guards: 'pests',
    role: 'Keeps crows off your crops',
  },
};

const LIVESTOCK_ORDER = ['cow', 'chicken', 'sheep'];
const GUARDIAN_ORDER = ['dog', 'cat'];
const ANIMAL_ORDER = [...LIVESTOCK_ORDER, ...GUARDIAN_ORDER];
const ANIMAL_SELL_REFUND_RATE = 0.5;

/* A dog will not touch crops or eggs — it is fed by slaughtering livestock,
   and the bigger the animal the longer it keeps the dog on duty. A chicken
   is the cheap staple; a cow is a serious thing to give up but buys nearly
   four times the watch. */
const DOG_PREY = {
  chicken: { shiftTime: 90 },
  sheep: { shiftTime: 200 },
  cow: { shiftTime: 320 },
};

const DOG_PREY_ORDER = ['chicken', 'sheep', 'cow'];

// Giving up a cow or a sheep is worth a second thought; a chicken is not.
const SLAUGHTER_CONFIRM = ['cow', 'sheep'];

/* The farmer. One person does every job here — planting, harvesting, feeding,
   milking — and has to eat like everything else on the farm. Pumpkins are the
   richest crop, so they are what a stretch of work costs. */
const FARMERS = {
  female: { emoji: '👩‍🌾', label: 'Female farmer' },
  male: { emoji: '👨‍🌾', label: 'Male farmer' },
};

const FARMER_ORDER = ['female', 'male'];
const FARMER_MEAL = { good: 'pumpkin', amount: 2 };
const FARMER_MEAL_DAYS = 3;
const FARMER_MEAL_MS = FARMER_MEAL_DAYS * DAY_LENGTH_MS;
/* Going hungry costs the farmer half of every harvest rather than stopping
   work outright: a farmer who could not harvest could never grow the pumpkins
   needed to eat again, which would be a dead end rather than a setback. */
const TIRED_YIELD_FACTOR = 0.5;
// Above this there is nothing to gain from another meal, so the button rests.
const FARMER_FULL_FRACTION = 0.8;

/* Raids. Intervals are deliberately long and jittered so a farm is not under
   constant siege, and anything that fell due while the tab was closed is
   skipped rather than resolved — nobody should return to a wiped-out farm. */
const WOLF_RAID_MIN_MS = 150_000;
const WOLF_RAID_MAX_MS = 260_000;
const PEST_RAID_MIN_MS = 120_000;
const PEST_RAID_MAX_MS = 220_000;
const RAID_STALE_MS = 60_000;

/* Spoilage. A ripe crop keeps for two in-game days (three real minutes) before
   it rots. That is long enough that ordinary play — feeding animals, selling,
   browsing upgrades — never costs a harvest by accident, and short enough that
   planting the whole field and wandering off does.
   Crucially the clock only runs while the game is open: crops ripen on
   absolute timestamps whether or not you are watching, so a real-time spoil
   timer would rot the entire farm of anyone who closed the tab overnight. */
const CROP_SPOIL_DAYS = 2;
const CROP_SPOIL_MS = CROP_SPOIL_DAYS * DAY_LENGTH_MS;
const CROP_WILT_FRACTION = 0.3; // last 30% of the window shows a warning

/* Starvation. An animal left hungry for four in-game days dies. That is a
   longer fuse than a crop gets, deliberately: production cycles run 15-35
   seconds and a guardian's shift 150, so four days is many cycles' worth of
   grace, and losing an animal costs its purchase price plus the higher price
   of the replacement — far more than a spoiled crop. Long enough that anyone
   tending the barn at all never loses one; short enough that walking away
   from a full barn does. Same play-time clock as spoilage. */
const ANIMAL_STARVE_DAYS = 4;
const ANIMAL_STARVE_MS = ANIMAL_STARVE_DAYS * DAY_LENGTH_MS;
const ANIMAL_STARVING_FRACTION = 0.25; // last in-game day is the warning

const GOODS = {
  wheat: { emoji: '🌾', name: 'Wheat', sellPrice: CROPS.wheat.sellPrice },
  corn: { emoji: '🌽', name: 'Corn', sellPrice: CROPS.corn.sellPrice },
  carrot: { emoji: '🥕', name: 'Carrot', sellPrice: CROPS.carrot.sellPrice },
  pumpkin: { emoji: '🎃', name: 'Pumpkin', sellPrice: CROPS.pumpkin.sellPrice },
  milk: { emoji: '🥛', name: 'Milk', sellPrice: 9 },
  egg: { emoji: '🥚', name: 'Egg', sellPrice: 5 },
  wool: { emoji: '🧶', name: 'Wool', sellPrice: 14 },
};

// Permanent purchases that give late-game coins somewhere to go once every
// plot is unlocked. Each level multiplies its cost, so they stay meaningful
// rather than becoming trivially affordable.
const UPGRADES = {
  sprinkler: {
    name: 'Sprinkler', emoji: '💧', maxLevel: 3, baseCost: 120, costGrowth: 2,
    describe: (lvl) => `Crops grow ${Math.round(lvl * 12)}% faster`,
  },
  feed: {
    name: 'Rich Feed', emoji: '🌰', maxLevel: 3, baseCost: 150, costGrowth: 2,
    describe: (lvl) => `Animals produce ${Math.round(lvl * 12)}% faster`,
  },
  fertiliser: {
    name: 'Fertiliser', emoji: '🧪', maxLevel: 3, baseCost: 200, costGrowth: 2.2,
    describe: (lvl) => `+${lvl} extra crop per harvest`,
  },
  contacts: {
    name: 'Market Contacts', emoji: '🤝', maxLevel: 3, baseCost: 250, costGrowth: 2.2,
    describe: (lvl) => `Goods sell for ${Math.round(lvl * 10)}% more`,
  },
};

const UPGRADE_ORDER = ['sprinkler', 'feed', 'fertiliser', 'contacts'];

/* The two grand goals the whole farm builds towards. They are deliberately
   either/or: buying one takes the other off the market for good, so the run
   ends on a choice — cash out early into the cottage, or keep farming for the
   villa. Everything else in the game is a step towards affording one. */
const DREAM_HOMES = {
  house: {
    name: 'Country House', emoji: '🏡', cost: 20000,
    tagline: 'A warm stone cottage at the top of the meadow.',
    describe: 'The sensible dream. Reachable in one good farming run, with a '
      + 'porch that looks out over every plot you ever unlocked.',
  },
  villa: {
    name: 'Grand Villa', emoji: '🏰', cost: 40000,
    tagline: 'Cypress avenue, fountain, the lot.',
    describe: 'Twice the price and twice the bragging rights. Holding out for '
      + 'this one means a much longer haul — and passing up the cottage.',
  },
};

const DREAM_ORDER = ['house', 'villa'];

const ACHIEVEMENTS = [
  {
    id: 'first_harvest', emoji: '🌱', name: 'First Harvest', reward: 10,
    description: 'Harvest a crop for the first time.',
    check: (s) => s.stats.totalHarvested >= 1,
  },
  {
    id: 'green_thumb', emoji: '🌾', name: 'Green Thumb', reward: 50,
    description: 'Harvest 50 crops in total.',
    check: (s) => s.stats.totalHarvested >= 50,
  },
  {
    id: 'master_farmer', emoji: '🚜', name: 'Master Farmer', reward: 150,
    description: 'Harvest 200 crops in total.',
    check: (s) => s.stats.totalHarvested >= 200,
  },
  {
    id: 'rancher', emoji: '🐄', name: 'Rancher', reward: 60,
    description: 'Own 3 cows.',
    check: (s) => s.cows.length >= 3,
  },
  {
    id: 'poultry_farmer', emoji: '🐔', name: 'Poultry Farmer', reward: 60,
    description: 'Own 5 chickens.',
    check: (s) => s.chickens.length >= 5,
  },
  {
    id: 'shepherd', emoji: '🐑', name: 'Shepherd', reward: 60,
    description: 'Own 3 sheep.',
    check: (s) => s.sheep.length >= 3,
  },
  {
    id: 'full_barn', emoji: '🧺', name: 'Full Barn', reward: 40,
    description: 'Own at least one cow, chicken, and sheep.',
    check: (s) => LIVESTOCK_ORDER.every((kind) => s[ANIMALS[kind].stateKey].length >= 1),
  },
  {
    id: 'full_house', emoji: '🔓', name: 'Full House', reward: 100,
    description: 'Unlock every plot.',
    check: (s) => s.unlockedPlots >= PLOT_COUNT,
  },
  {
    id: 'wealthy_farmer', emoji: '💰', name: 'Wealthy Farmer', reward: 100,
    description: 'Hold 1000 coins at once.',
    check: (s) => s.coins >= 1000,
  },
  {
    id: 'week_one', emoji: '📅', name: 'Week One', reward: 80,
    description: 'Survive to Day 7.',
    check: (s) => s.day >= 7,
  },
  {
    id: 'big_business', emoji: '🛒', name: 'Big Business', reward: 70,
    description: 'Earn 500 coins from selling goods.',
    check: (s) => s.stats.totalCoinsEarned >= 500,
  },
];

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

function freshState() {
  return {
    coins: 50,
    day: 1,
    dayStartedAt: Date.now(),
    selectedSeed: null,
    unlockedPlots: INITIAL_UNLOCKED_PLOTS,
    plots: Array.from({ length: PLOT_COUNT }, emptyPlot),
    cows: [],
    chickens: [],
    sheep: [],
    dogs: [],
    cats: [],
    nextAnimalId: 1,
    nextWolfRaidAt: Date.now() + WOLF_RAID_MIN_MS,
    nextPestRaidAt: Date.now() + PEST_RAID_MIN_MS,
    inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    stats: { totalHarvested: 0, totalCoinsEarned: 0 },
    unlockedAchievements: [],
    upgrades: { sprinkler: 0, feed: 0, fertiliser: 0, contacts: 0 },
    dreamHome: null,
    farmer: null,          // chosen on the first run
    farmerFedUntil: null,
    muted: false,
    musicOn: true,
    volume: 0.7,
    onboarded: false,
    lastSeenAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* Derived stats — everything upgrades affect flows through here        */
/* ------------------------------------------------------------------ */

function upgradeLevel(key) {
  const level = state.upgrades?.[key];
  return Number.isFinite(level) ? level : 0;
}

function upgradeCost(key) {
  const def = UPGRADES[key];
  return Math.round(def.baseCost * def.costGrowth ** upgradeLevel(key));
}

function cropGrowTime(crop) {
  return crop.growTime * (1 - 0.12 * upgradeLevel('sprinkler'));
}

/* A dog's watch is as long as whatever it ate, so the time is carried on the
   animal; everything else runs on its species' fixed timer. */
function animalProduceTime(def, animal) {
  const base = (def.eatsLivestock && animal && Number.isFinite(animal.shiftTime))
    ? animal.shiftTime
    : def.produceTime;
  return base * (1 - 0.12 * upgradeLevel('feed'));
}

function cropYield(crop) {
  const yielded = crop.yield + upgradeLevel('fertiliser');
  // Never below one, so a hungry farmer can always harvest their way back.
  return isFarmerTired() ? Math.max(1, Math.floor(yielded * TIRED_YIELD_FACTOR)) : yielded;
}

/* The farmer's own meal clock. Like shelf life and animal hunger it runs on
   play time only, so nobody comes back from a break to a starving farmer. */
function farmerEnergy() {
  if (!Number.isFinite(state.farmerFedUntil)) return 0;
  return clamp01((state.farmerFedUntil - Date.now()) / FARMER_MEAL_MS);
}

function isFarmerTired() {
  return farmerEnergy() <= 0;
}

function canFeedFarmer() {
  return (state.inventory[FARMER_MEAL.good] || 0) >= FARMER_MEAL.amount;
}

function emptyPlot() {
  return { crop: null, plantedAt: null, spoilsAt: null, rotten: false };
}

// How far along a plot is, 0 to 1. Every caller needs this and each was
// re-deriving it, which meant the upgrade multiplier had to be remembered in
// several places at once.
function plotProgress(plot) {
  const crop = plot && CROPS[plot.crop];
  if (!crop || !Number.isFinite(plot.plantedAt)) return 0;
  return clamp01((nowSec() - plot.plantedAt) / cropGrowTime(crop));
}

/* How much of a ripe crop's shelf life is left, 1 down to 0. The clock is
   started by the first tick that sees the crop ripe, and ticks only run while
   the page is visible — so shelf life is measured in play time, not wall time. */
function freshness(plot) {
  if (!plot.crop || plot.rotten) return 0;
  if (!Number.isFinite(plot.spoilsAt)) return 1;
  return clamp01((plot.spoilsAt - Date.now()) / CROP_SPOIL_MS);
}

function isWilting(plot) {
  return Number.isFinite(plot.spoilsAt) && freshness(plot) <= CROP_WILT_FRACTION;
}

/* How much of a hungry animal's grace period is left, 1 down to 0. Same
   play-time clock as shelf life: started by the first tick that sees the
   animal hungry, and ticks only run while the page is visible. */
function fedness(animal) {
  if (animal.state !== 'hungry') return 1;
  if (!Number.isFinite(animal.starvesAt)) return 1;
  return clamp01((animal.starvesAt - Date.now()) / ANIMAL_STARVE_MS);
}

function isStarving(animal) {
  return animal.state === 'hungry'
    && Number.isFinite(animal.starvesAt)
    && fedness(animal) <= ANIMAL_STARVING_FRACTION;
}

/* Everything that leaves an animal wanting food goes through here: a fresh
   purchase, produce collected, a guardian's shift ending. The deadline is left
   null for the next tick to set, so the clock never starts while nobody is
   watching. */
function becomeHungry(animal) {
  animal.state = 'hungry';
  animal.feedAt = null;
  animal.starvesAt = null;
  animal.starvingWarned = false;
  return animal;
}

// Shifts every shelf-life and starvation deadline later by an absence, so time
// spent with the game closed never costs a harvest or an animal. Takes a whole
// save rather than one list, since both clocks pause for the same reason.
function shiftPlayClocks(save, byMs) {
  if (!Number.isFinite(byMs) || byMs <= 0) return;
  save.plots.forEach((plot) => {
    if (Number.isFinite(plot.spoilsAt)) plot.spoilsAt += byMs;
  });
  ANIMAL_ORDER.forEach((kind) => {
    (save[ANIMALS[kind].stateKey] || []).forEach((animal) => {
      if (Number.isFinite(animal.starvesAt)) animal.starvesAt += byMs;
    });
  });
  if (Number.isFinite(save.farmerFedUntil)) save.farmerFedUntil += byMs;
}

function updateSpoilage() {
  const now = Date.now();
  let changed = false;
  state.plots.forEach((plot) => {
    if (!plot.crop || plot.rotten) return;
    if (plotProgress(plot) < 1) return;
    if (!Number.isFinite(plot.spoilsAt)) {
      // First tick that sees it ripe starts the countdown.
      plot.spoilsAt = now + CROP_SPOIL_MS;
      changed = true;
    } else if (now >= plot.spoilsAt) {
      plot.rotten = true;
      changed = true;
    }
  });
  if (changed) saveState();
}

function updateStarvation() {
  const now = Date.now();
  const lost = [];
  const nowStarving = [];
  let changed = false;

  ANIMAL_ORDER.forEach((kind) => {
    const def = ANIMALS[kind];
    state[def.stateKey] = state[def.stateKey].filter((animal) => {
      if (animal.state !== 'hungry') return true;
      if (!Number.isFinite(animal.starvesAt)) {
        // First tick that sees it hungry starts the countdown.
        animal.starvesAt = now + ANIMAL_STARVE_MS;
        changed = true;
        return true;
      }
      if (now >= animal.starvesAt) {
        lost.push(def);
        changed = true;
        return false;
      }
      // One warning per animal, so a neglected barn nags rather than spams.
      if (isStarving(animal) && !animal.starvingWarned) {
        animal.starvingWarned = true;
        nowStarving.push(def);
        changed = true;
      }
      return true;
    });
  });

  if (nowStarving.length > 0) {
    const def = nowStarving[0];
    const rest = nowStarving.length - 1;
    SFX.error();
    showToast(
      `${def.emoji} A ${def.name} is starving — feed it!`
      + (rest > 0 ? ` (and ${rest} more)` : ''),
    );
  }
  if (lost.length > 0) {
    const def = lost[0];
    const rest = lost.length - 1;
    SFX.error();
    showToast(
      `💀 A ${def.name} starved to death!${rest > 0 ? ` (and ${rest} more)` : ''}`
      + ' Feed animals before their bar empties.',
    );
  }
  if (changed) saveState();
}

function animalProgress(animal, def) {
  if (animal.state !== 'producing' || !Number.isFinite(animal.feedAt)) return 0;
  return clamp01((nowSec() - animal.feedAt) / animalProduceTime(def, animal));
}

function goodPrice(key) {
  return Math.round(GOODS[key].sellPrice * (1 + 0.10 * upgradeLevel('contacts')));
}

// Older save slots, newest first. Kept so bumping SAVE_KEY upgrades a player's
// farm instead of silently starting them over.
const LEGACY_SAVE_KEYS = ['farmLifeSave_v1'];

// Folds an arbitrary parsed save onto the current shape. A plain
// Object.assign is not enough: it replaces whole sub-objects, so a save
// written before pumpkins or wool existed would leave those counts undefined
// and turn every later addition into NaN.
function migrateSave(parsed) {
  if (!parsed || typeof parsed !== 'object') return freshState();
  const merged = Object.assign(freshState(), parsed);

  merged.inventory = Object.assign(freshState().inventory, parsed.inventory || {});
  merged.stats = Object.assign(freshState().stats, parsed.stats || {});
  Object.keys(merged.inventory).forEach((k) => {
    if (!Number.isFinite(merged.inventory[k])) merged.inventory[k] = 0;
  });
  Object.keys(merged.stats).forEach((k) => {
    if (!Number.isFinite(merged.stats[k])) merged.stats[k] = 0;
  });

  if (!Number.isFinite(merged.coins)) merged.coins = 0;
  if (!Number.isFinite(merged.day) || merged.day < 1) merged.day = 1;
  if (!Number.isFinite(merged.dayStartedAt)) merged.dayStartedAt = Date.now();

  // Saves from before plot unlocking have no unlockedPlots and a shorter grid.
  if (!Number.isFinite(merged.unlockedPlots)) merged.unlockedPlots = INITIAL_UNLOCKED_PLOTS;
  merged.unlockedPlots = Math.min(Math.max(Math.floor(merged.unlockedPlots), 1), PLOT_COUNT);

  const plots = Array.isArray(parsed.plots) ? parsed.plots.slice(0, PLOT_COUNT) : [];
  while (plots.length < PLOT_COUNT) plots.push(emptyPlot());
  merged.plots = plots.map((p) => {
    if (!p || typeof p !== 'object') return emptyPlot();
    // Drop anything planted with a crop this build no longer defines.
    if (p.crop && !CROPS[p.crop]) return emptyPlot();
    if (p.crop && !Number.isFinite(p.plantedAt)) return emptyPlot();
    return {
      crop: p.crop ?? null,
      plantedAt: p.plantedAt ?? null,
      spoilsAt: Number.isFinite(p.spoilsAt) ? p.spoilsAt : null,
      rotten: Boolean(p.rotten),
    };
  });

  ANIMAL_ORDER.forEach((kind) => {
    const key = ANIMALS[kind].stateKey;
    const list = Array.isArray(merged[key]) ? merged[key] : [];
    merged[key] = list
      .filter((a) => a && typeof a === 'object')
      .map((a) => ({
        id: Number.isFinite(a.id) ? a.id : 0,
        state: a.state === 'producing' ? 'producing' : 'hungry',
        feedAt: Number.isFinite(a.feedAt) ? a.feedAt : null,
        starvesAt: Number.isFinite(a.starvesAt) ? a.starvesAt : null,
        starvingWarned: Boolean(a.starvingWarned),
        // Dogs only: how long the last kill keeps them on duty.
        shiftTime: Number.isFinite(a.shiftTime) ? a.shiftTime : null,
      }))
      // A producing animal with no feed time would never finish.
      .map((a) => (a.state === 'producing' && a.feedAt === null ? becomeHungry(a) : a));
  });

  // Re-issue ids so a save with missing or duplicated ones can't collide.
  let nextId = 1;
  ANIMAL_ORDER.forEach((kind) => {
    merged[ANIMALS[kind].stateKey].forEach((a) => { a.id = nextId++; });
  });
  merged.nextAnimalId = nextId;

  const knownAchievements = new Set(ACHIEVEMENTS.map((a) => a.id));
  merged.unlockedAchievements = Array.isArray(parsed.unlockedAchievements)
    ? [...new Set(parsed.unlockedAchievements.filter((id) => knownAchievements.has(id)))]
    : [];

  // Upgrade levels: default anything missing, clamp anything out of range,
  // and drop keys for upgrades this build no longer offers.
  const upgrades = {};
  UPGRADE_ORDER.forEach((key) => {
    const raw = (parsed.upgrades || {})[key];
    const level = Number.isFinite(raw) ? Math.floor(raw) : 0;
    upgrades[key] = Math.min(Math.max(level, 0), UPGRADES[key].maxLevel);
  });
  merged.upgrades = upgrades;

  if (merged.selectedSeed && !CROPS[merged.selectedSeed]) merged.selectedSeed = null;
  // An unknown dream home would leave the goal permanently unclaimable.
  if (!DREAM_HOMES[merged.dreamHome]) merged.dreamHome = null;
  // Saves from before the farmer get the picker on their next load.
  if (!FARMERS[merged.farmer]) merged.farmer = null;
  if (!Number.isFinite(merged.farmerFedUntil)) merged.farmerFedUntil = null;
  merged.musicOn = merged.musicOn !== false;
  merged.volume = Number.isFinite(merged.volume) ? Math.min(Math.max(merged.volume, 0), 1) : 0.7;
  merged.muted = Boolean(merged.muted);
  merged.onboarded = Boolean(merged.onboarded);
  // Saves predating raids get a fresh clock rather than an immediate ambush.
  if (!Number.isFinite(merged.nextWolfRaidAt) || merged.nextWolfRaidAt < Date.now()) {
    merged.nextWolfRaidAt = Date.now() + WOLF_RAID_MIN_MS;
  }
  if (!Number.isFinite(merged.nextPestRaidAt) || merged.nextPestRaidAt < Date.now()) {
    merged.nextPestRaidAt = Date.now() + PEST_RAID_MIN_MS;
  }

  // Saves from before the welcome-back summary have no lastSeenAt; treat those
  // players as having just arrived rather than reporting a bogus absence.
  if (!Number.isFinite(merged.lastSeenAt)) merged.lastSeenAt = Date.now();

  // Shelf life and hunger are measured in play time, so hand back every
  // millisecond this save spent closed. Without it, loading a save written
  // last night — or importing one from another device — would rot the whole
  // field and starve the barn on arrival.
  shiftPlayClocks(merged, Date.now() - merged.lastSeenAt);

  return merged;
}

const BACKUP_SAVE_KEY = `${SAVE_KEY}_backup`;

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      for (const key of LEGACY_SAVE_KEYS) {
        const legacy = localStorage.getItem(key);
        if (legacy) { raw = legacy; break; }
      }
    }
    if (!raw) return freshState();
    return migrateSave(JSON.parse(raw));
  } catch (e) {
    // A farm is about to be replaced by an empty one, and init() will write
    // that over the top. Keep the original bytes so the progress is still
    // recoverable rather than gone for good.
    if (raw) {
      try {
        localStorage.setItem(BACKUP_SAVE_KEY, raw);
      } catch (ignored) { /* storage full or blocked; nothing more we can do */ }
    }
    return freshState();
  }
}

let state = loadState();

function saveState() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    // Private-browsing modes and full quotas both reject writes. Losing a
    // save silently is worse than saying so.
    showToast('Could not save progress — storage is unavailable.');
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function nowSec() {
  return Date.now() / 1000;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

let toastTimer = null;
/* Toasts explain what just happened, so they have to stay up long enough to
   actually be read. Time scales with the length of the message — a short
   confirmation clears quickly, an explanation of why an animal was lost
   lingers — and a tap dismisses one early. */
const TOAST_BASE_MS = 2200;
const TOAST_PER_CHAR_MS = 55;
const TOAST_MAX_MS = 8000;

function toastDuration(msg) {
  return Math.min(TOAST_MAX_MS, TOAST_BASE_MS + msg.length * TOAST_PER_CHAR_MS);
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), toastDuration(msg));
}

// "+3 🌾" numbers that drift up from whatever the player just tapped.
function spawnFloatText(text, anchorEl, variant) {
  const layer = document.getElementById('fxLayer');
  if (!layer || !anchorEl || !anchorEl.getBoundingClientRect) return;
  const rect = anchorEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const el = document.createElement('div');
  el.className = 'float-text' + (variant ? ` ${variant}` : '');
  el.textContent = text;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height * 0.4}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1250);
}

/* Feeding is per-animal now: each one eats a specific good. */

function canFeed(def) {
  // A dog eats livestock, so "can feed" means having something to slaughter.
  if (def.eatsLivestock) return DOG_PREY_ORDER.some((k) => state[ANIMALS[k].stateKey].length > 0);
  return (state.inventory[def.feed.good] || 0) >= def.feed.amount;
}

function feedLabel(def) {
  return `Feed (${def.feed.amount} ${GOODS[def.feed.good].emoji})`;
}

/* ------------------------------------------------------------------ */
/* Sound effects (synthesized, no audio files)                          */
/* ------------------------------------------------------------------ */

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function masterVolume() {
  if (state.muted) return 0;
  return Number.isFinite(state.volume) ? clamp01(state.volume) : 0.7;
}

function playTone(freq, duration, type, volume, delay) {
  const level = volume * masterVolume();
  if (level <= 0.0002) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const startAt = ctx.currentTime + (delay || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(level, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

const SFX = {
  plant: () => playTone(440, 0.08, 'sine', 0.08),
  harvest: () => {
    playTone(660, 0.07, 'sine', 0.1);
    playTone(880, 0.09, 'sine', 0.09, 0.06);
  },
  feed: () => playTone(300, 0.1, 'triangle', 0.08),
  collect: () => {
    playTone(523.25, 0.07, 'sine', 0.1);
    playTone(659.25, 0.07, 'sine', 0.1, 0.07);
    playTone(783.99, 0.1, 'sine', 0.1, 0.14);
  },
  buy: () => playTone(220, 0.12, 'sawtooth', 0.06),
  sell: () => {
    playTone(784, 0.06, 'sine', 0.09);
    playTone(988, 0.09, 'sine', 0.09, 0.05);
  },
  unlockPlot: () => {
    playTone(392, 0.08, 'square', 0.07);
    playTone(523.25, 0.1, 'square', 0.07, 0.08);
  },
  error: () => playTone(140, 0.15, 'sawtooth', 0.07),
  achievement: () => {
    playTone(523.25, 0.1, 'sine', 0.12, 0);
    playTone(659.25, 0.1, 'sine', 0.12, 0.1);
    playTone(783.99, 0.1, 'sine', 0.12, 0.2);
    playTone(1046.5, 0.22, 'sine', 0.14, 0.3);
  },
  click: () => playTone(600, 0.04, 'square', 0.04),
};

/* ------------------------------------------------------------------ */
/* Background music                                                      */
/* ------------------------------------------------------------------ */

// A slow I-V-vi-IV progression in C. Each entry is [bass, and the triad
// above it], arpeggiated gently — pastoral, and cheap to synthesise.
const MUSIC_CHORDS = [
  [130.81, [261.63, 329.63, 392.00]], // C
  [196.00, [293.66, 392.00, 493.88]], // G
  [220.00, [329.63, 440.00, 523.25]], // Am
  [174.61, [261.63, 349.23, 440.00]], // F
];

const CHORD_MS = 3400;
let musicTimer = null;
let musicStep = 0;

function playChord() {
  if (!state.musicOn || masterVolume() <= 0) return;
  const ctx = getAudioCtx();
  if (!ctx) return;

  const [bass, triad] = MUSIC_CHORDS[musicStep % MUSIC_CHORDS.length];
  musicStep += 1;

  // Music sits well under the effects so it never competes with feedback.
  const level = 0.05;
  playTone(bass, 2.6, 'sine', level * 0.8, 0);
  triad.forEach((freq, i) => playTone(freq, 2.0, 'triangle', level * 0.55, 0.18 * (i + 1)));
}

function startMusic() {
  if (musicTimer !== null) return;
  playChord();
  musicTimer = setInterval(playChord, CHORD_MS);
}

function stopMusic() {
  if (musicTimer === null) return;
  clearInterval(musicTimer);
  musicTimer = null;
}

function syncMusic() {
  if (state.musicOn && !state.muted && masterVolume() > 0) startMusic();
  else stopMusic();
}

// Browsers refuse to start audio before the player interacts with the page,
// so the loop waits for the first real gesture.
function armMusicOnFirstGesture() {
  const start = () => {
    syncMusic();
    window.removeEventListener('pointerdown', start);
    window.removeEventListener('keydown', start);
  };
  window.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                 */
/* ------------------------------------------------------------------ */

let activeTab = 'farm';

function setActiveTab(tab) {
  activeTab = tab;
  SFX.click();
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('farmTab').classList.toggle('hidden', tab !== 'farm');
  document.getElementById('animalsTab').classList.toggle('hidden', tab !== 'animals');
  document.getElementById('marketTab').classList.toggle('hidden', tab !== 'market');
  document.getElementById('achievementsTab').classList.toggle('hidden', tab !== 'achievements');
  document.getElementById('dreamTab').classList.toggle('hidden', tab !== 'dream');
  render();
}

/* ------------------------------------------------------------------ */
/* How to play                                                          */
/* ------------------------------------------------------------------ */

/* Built from the same constants the game runs on, so the rules on screen can
   never drift away from the rules being enforced. */
function helpSections() {
  const seconds = (ms) => `${Math.round(ms / 1000)}s`;
  const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const dayLen = seconds(DAY_LENGTH_MS);
  const mealGood = GOODS[FARMER_MEAL.good];
  const meal = `${FARMER_MEAL.amount} ${mealGood.emoji} `
    + `${mealGood.name.toLowerCase()}${FARMER_MEAL.amount === 1 ? '' : 's'}`;

  return [
    {
      emoji: '🎯', title: 'The point of it all',
      lines: [
        'Grow crops, sell what you produce, and build the farm up until you can '
        + 'afford a dream home. That is the finish line — everything else feeds into it.',
        `The two goals live in the Dream tab: a ${DREAM_HOMES.house.name} for `
        + `${DREAM_HOMES.house.cost.toLocaleString('en-GB')}💰 or a `
        + `${DREAM_HOMES.villa.name} for ${DREAM_HOMES.villa.cost.toLocaleString('en-GB')}💰. `
        + 'Buying one puts the other out of reach for good, so it is one or the other.',
      ],
    },
    {
      emoji: FARMERS[state.farmer]?.emoji || '👩‍🌾', title: 'You, the farmer',
      lines: [
        'You do every job here: planting, harvesting, feeding, milking. And you eat.',
        `A meal of ${meal} keeps you working for ${days(FARMER_MEAL_DAYS)}. `
        + 'Let the energy bar empty and you are exhausted — every harvest is halved '
        + 'until you eat again. It never drops to nothing, so you can always harvest '
        + 'your way back to a meal.',
        'Your choice of farmer can be changed any time under Market → Farmer.',
      ],
    },
    {
      emoji: '🌾', title: 'Crops',
      lines: [
        'Pick a seed, then tap an empty plot to plant it. Seeds cost coins up front '
        + 'and the crop sells for more than it cost, so every cycle is a profit.',
        'The four crops trade speed for value: wheat is quick and cheap, pumpkin is '
        + 'slow and worth the most. The bar on each plot shows how far along it is.',
        `Eight of the ${PLOT_COUNT} plots start locked. Unlock the rest one at a time `
        + 'with coins, each a little dearer than the last.',
      ],
    },
    {
      emoji: '🥀', title: 'Crops go off',
      lines: [
        `Once a crop is ripe you have ${days(CROP_SPOIL_DAYS)} to harvest it. The plot's `
        + 'bar switches from growth to freshness and drains; in the last stretch it '
        + 'turns red with an ⏳.',
        'Leave it too long and it rots. A rotten plot yields nothing and has to be '
        + 'tapped to clear before you can plant again.',
        'The spoilage clock only runs while the game is open, so closing the tab '
        + 'never costs you a harvest.',
      ],
    },
    {
      emoji: '🐄', title: 'Animals and produce',
      lines: [
        'Buy cows, chickens and sheep from the Animals tab. Each eats its own crop, '
        + 'and the better the produce the dearer the feed — a chicken eats wheat and '
        + 'lays eggs, a cow eats corn and gives milk, a sheep eats carrots and gives wool.',
        'Feed one to start it producing, then collect when the timer fills. Every '
        + 'cycle returns more than the feed cost.',
        'An animal you no longer want can be sold back for half its base price. '
        + 'Selling asks first, since buying a replacement costs more than the refund.',
      ],
    },
    {
      emoji: '💀', title: 'Animals get hungry',
      lines: [
        `An animal left hungry for ${days(ANIMAL_STARVE_DAYS)} starves and is gone. `
        + 'Its bar counts down to that, and the card turns red with a pulsing '
        + '"Starving!" for the last stretch.',
        'A starving animal can still be sold, so it is never a total loss. Like crop '
        + 'spoilage, the clock is paused while the game is closed.',
      ],
    },
    {
      emoji: '🐕', title: 'Guardians',
      lines: [
        'Wolves take livestock and crows eat planted crops. A fed dog turns wolves '
        + 'away; a fed cat keeps the crows off.',
        `Each guardian on duty covers ${GUARD_CAPACITY} of its charges — animals for a `
        + `dog, planted plots for a cat — so the guard has to grow with the farm. Cover `
        + 'only part of it and you turn away only that share of raids.',
        'A cat eats milk. A dog eats meat: feeding one means slaughtering an animal, '
        + `and the bigger the animal the longer the watch (${DOG_PREY_ORDER
          .map((k) => `${ANIMALS[k].emoji} ${DOG_PREY[k].shiftTime}s`).join(', ')}).`,
        'The Animals tab tells you how much of the farm is currently covered.',
      ],
    },
    {
      emoji: '🛒', title: 'Market',
      lines: [
        'Sell produce for coins, and check what you are holding. Prices are fixed '
        + 'unless you buy Market Contacts.',
        'Four permanent upgrades give late-game coins somewhere to go: faster crops, '
        + 'faster animals, bigger harvests and better prices, each with three levels.',
      ],
    },
    {
      emoji: '🏆', title: 'Awards',
      lines: [
        `${ACHIEVEMENTS.length} achievements covering harvesting, livestock, expansion `
        + 'and wealth. Each pays a one-off coin bonus the moment you earn it.',
      ],
    },
    {
      emoji: '🌗', title: 'Time, and being away',
      lines: [
        `A full day passes every ${dayLen}, taking the sky from daylight through dusk `
        + 'to a starlit night.',
        'Crops and animals run on real timestamps, so they keep progressing while the '
        + 'tab is closed — come back and a summary tells you what finished. Hunger, '
        + 'spoilage and raids are all paused while you are away, so nothing is ever '
        + 'lost overnight.',
      ],
    },
    {
      emoji: '💾', title: 'Saving',
      lines: [
        'Progress saves automatically to this browser. Because that is per-browser, '
        + 'Market → Save Data can download a save file and load it back — useful for '
        + 'moving between devices or keeping a backup.',
      ],
    },
  ];
}

function renderHelp() {
  const body = document.getElementById('helpBody');
  body.innerHTML = '';
  helpSections().forEach((section) => {
    const wrap = document.createElement('section');
    wrap.className = 'help-section';

    const heading = document.createElement('h3');
    heading.innerHTML = `<span aria-hidden="true">${section.emoji}</span> `;
    heading.appendChild(document.createTextNode(section.title));
    wrap.appendChild(heading);

    section.lines.forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      wrap.appendChild(p);
    });
    body.appendChild(wrap);
  });
}

function openHelp() {
  renderHelp();
  document.getElementById('helpPanel').classList.remove('hidden');
  document.getElementById('helpCloseBtn').focus();
  SFX.click();
}

function closeHelp() {
  document.getElementById('helpPanel').classList.add('hidden');
  document.getElementById('helpBtn').focus();
}

/* ------------------------------------------------------------------ */
/* The farmer                                                           */
/* ------------------------------------------------------------------ */

/* Shown over everything on the very first run — the farm has to belong to
   somebody before any of it means anything. */
function renderFarmerPicker() {
  const picker = document.getElementById('farmerPicker');
  const needed = !state.farmer;
  picker.classList.toggle('hidden', !needed);
  if (!needed) return;

  const options = document.getElementById('farmerPickerOptions');
  if (options.children.length === FARMER_ORDER.length) return;

  options.innerHTML = '';
  FARMER_ORDER.forEach((key) => {
    const farmer = FARMERS[key];
    const btn = document.createElement('button');
    btn.className = 'farmer-option';
    btn.setAttribute('aria-label', farmer.label);
    btn.innerHTML = `<span class="farmer-option-emoji" aria-hidden="true">${farmer.emoji}</span>`;
    const label = document.createElement('span');
    label.className = 'farmer-option-label';
    label.textContent = farmer.label;
    btn.appendChild(label);
    btn.onclick = () => chooseFarmer(key);
    options.appendChild(btn);
  });
}

function chooseFarmer(key) {
  if (!FARMERS[key]) return;
  const first = !state.farmer;
  state.farmer = key;
  // Nobody starts a day's work on an empty stomach.
  if (first) state.farmerFedUntil = Date.now() + FARMER_MEAL_MS;
  SFX.buy();
  showToast(`${FARMERS[key].emoji} ${first ? 'Welcome to the farm!' : 'Farmer changed.'}`);
  saveState();
  render();
}

function renderFarmer() {
  const farmer = FARMERS[state.farmer];
  if (!farmer) return;

  document.getElementById('farmerAvatar').textContent = farmer.emoji;

  const energy = farmerEnergy();
  const tired = isFarmerTired();
  const strip = document.getElementById('farmerStrip');
  strip.classList.toggle('tired', tired);

  const stateEl = document.getElementById('farmerState');
  stateEl.textContent = tired
    ? '😩 Exhausted — harvests are halved'
    : energy <= 0.25 ? '🥱 Getting hungry' : '💪 Well fed';

  const percent = Math.round(energy * 100);
  const fill = document.getElementById('farmerEnergyFill');
  fill.style.width = `${percent}%`;
  document.getElementById('farmerEnergy').setAttribute('aria-valuenow', String(percent));

  const btn = document.getElementById('farmerFeedBtn');
  const full = energy >= FARMER_FULL_FRACTION;
  btn.textContent = full
    ? 'Well fed'
    : `Eat (${FARMER_MEAL.amount} ${GOODS[FARMER_MEAL.good].emoji})`;
  btn.disabled = full || !canFeedFarmer();
  btn.setAttribute(
    'aria-label',
    `Feed the farmer ${FARMER_MEAL.amount} ${GOODS[FARMER_MEAL.good].name}`,
  );
  btn.onclick = feedFarmer;
}

function feedFarmer() {
  if (farmerEnergy() >= FARMER_FULL_FRACTION) return;
  if (!canFeedFarmer()) {
    SFX.error();
    const good = GOODS[FARMER_MEAL.good];
    showToast(`The farmer needs ${FARMER_MEAL.amount} ${good.name} to keep going!`);
    return;
  }
  state.inventory[FARMER_MEAL.good] -= FARMER_MEAL.amount;
  state.farmerFedUntil = Date.now() + FARMER_MEAL_MS;
  SFX.feed();
  showToast(`${FARMERS[state.farmer].emoji} Back to full strength!`);
  saveState();
  render();
}

// Lets a mis-tap on the first screen be undone, from Market -> Farmer.
function renderFarmerChoice() {
  const wrap = document.getElementById('farmerChoice');
  if (wrap.children.length !== FARMER_ORDER.length) {
    wrap.innerHTML = '';
    FARMER_ORDER.forEach(() => wrap.appendChild(document.createElement('button')));
  }
  FARMER_ORDER.forEach((key, i) => {
    const farmer = FARMERS[key];
    const btn = wrap.children[i];
    const active = state.farmer === key;
    btn.className = `farmer-swap${active ? ' active' : ''}`;
    btn.textContent = `${farmer.emoji} ${farmer.label}`;
    btn.setAttribute('aria-pressed', String(active));
    btn.onclick = () => chooseFarmer(key);
  });
}

/* ------------------------------------------------------------------ */
/* Farm tab                                                             */
/* ------------------------------------------------------------------ */

function renderSeedBar() {
  const bar = document.getElementById('seedBar');

  // Build the buttons once; afterwards only toggle selection/affordability so
  // we never tear down elements mid-animation.
  if (bar.children.length !== CROP_ORDER.length) {
    bar.innerHTML = '';
    CROP_ORDER.forEach((key) => {
      const crop = CROPS[key];
      const btn = document.createElement('button');
      btn.className = 'seed-btn';
      btn.innerHTML = `<span class="seed-emoji">${crop.emoji}</span><span>${crop.name}</span><span>${crop.seedCost}💰</span>`;
      btn.addEventListener('click', () => {
        state.selectedSeed = state.selectedSeed === key ? null : key;
        SFX.click();
        renderSeedBar();
      });
      bar.appendChild(btn);
    });
  }

  CROP_ORDER.forEach((key, i) => {
    const crop = CROPS[key];
    const btn = bar.children[i];
    btn.classList.toggle('selected', state.selectedSeed === key);
    btn.disabled = state.coins < crop.seedCost;
  });
}

function plotUnlockCost() {
  return PLOT_UNLOCK_BASE_COST + (state.unlockedPlots - INITIAL_UNLOCKED_PLOTS) * PLOT_UNLOCK_INCREMENT;
}

function unlockPlot() {
  if (state.unlockedPlots >= PLOT_COUNT) return;
  const cost = plotUnlockCost();
  if (state.coins < cost) {
    SFX.error();
    showToast('Not enough coins!');
    return;
  }
  state.coins -= cost;
  state.unlockedPlots += 1;
  SFX.unlockPlot();
  showToast('New plot unlocked!');
  saveState();
  render();
}

function plotGrowthStage(progress) {
  return progress < 0.4 ? 0 : progress < 0.75 ? 1 : 2;
}

// A plot only needs rebuilding when its *structure* changes. Rebuilding every
// tick would restart the sway/bounce animations a second into every loop.
function plotSignature(plot, idx) {
  if (idx >= state.unlockedPlots) {
    return idx === state.unlockedPlots ? 'locked:next' : 'locked:far';
  }
  if (!plot.crop) return 'empty';
  if (plot.rotten) return `rotten:${plot.crop}`;
  const progress = plotProgress(plot);
  if (progress >= 1) return `${isWilting(plot) ? 'wilting' : 'ready'}:${plot.crop}`;
  return `grow:${plot.crop}:${plotGrowthStage(progress)}`;
}

function buildPlotCell(cell, plot, idx, sig) {
  cell.className = 'plot';
  cell.innerHTML = '';
  cell.onclick = null;
  cell.disabled = false;
  const label = `Plot ${idx + 1}`;

  if (idx >= state.unlockedPlots) {
    cell.classList.add('locked');
    const cost = PLOT_UNLOCK_BASE_COST + (idx - INITIAL_UNLOCKED_PLOTS) * PLOT_UNLOCK_INCREMENT;
    cell.innerHTML = `<span aria-hidden="true">🔒</span><span class="plot-lock-cost" aria-hidden="true">${cost}💰</span>`;
    if (idx === state.unlockedPlots) {
      cell.classList.add('unlockable');
      cell.title = `Unlock this plot for ${cost}💰`;
      cell.setAttribute('aria-label', `${label}, locked. Unlock for ${cost} coins`);
      cell.onclick = () => unlockPlot();
    } else {
      cell.title = 'Unlock the previous plot first';
      cell.setAttribute('aria-label', `${label}, locked. Unlock the previous plot first`);
      // Nothing to activate, so keep it out of the tab order.
      cell.disabled = true;
    }
  } else if (!plot.crop) {
    cell.classList.add('empty');
    cell.innerHTML = '<span aria-hidden="true">➕</span>';
    cell.title = 'Plant a seed here';
    cell.setAttribute('aria-label', `${label}, empty. Plant the selected seed`);
    cell.onclick = () => plantSeed(idx);
  } else {
    const crop = CROPS[plot.crop];
    const progress = plotProgress(plot);
    const sprite = document.createElement('span');
    sprite.className = 'crop-sprite';

    sprite.setAttribute('aria-hidden', 'true');

    if (plot.rotten) {
      cell.classList.add('rotten');
      sprite.textContent = '🥀';
      cell.appendChild(sprite);
      cell.title = `Rotten ${crop.name} — tap to clear`;
      cell.setAttribute('aria-label', `${label}, ${crop.name} has rotted. Tap to clear it`);
      cell.onclick = () => clearRottenPlot(idx);
    } else if (progress >= 1) {
      const wilting = isWilting(plot);
      cell.classList.add('ready');
      if (wilting) cell.classList.add('wilting');
      sprite.textContent = crop.emoji;
      cell.appendChild(sprite);
      cell.title = `Harvest ${crop.name}`;
      cell.setAttribute(
        'aria-label',
        `${label}, ${crop.name} ready to harvest${wilting ? ', going off soon' : ''}`,
      );
      cell.onclick = () => harvestPlot(idx);

      // Doubles as the shelf-life gauge once a crop is ripe.
      const bar = document.createElement('div');
      bar.className = 'plot-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', `${crop.name} freshness`);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      const fill = document.createElement('div');
      fill.className = 'plot-progress-fill freshness';
      bar.appendChild(fill);
      cell.appendChild(bar);
    } else {
      const stage = plotGrowthStage(progress);
      sprite.textContent = stage === 0 ? '🌱' : stage === 1 ? '🌿' : crop.emoji;
      // Scale the sprite as it matures instead of fading the whole tile, so the
      // soil and progress bar stay fully legible.
      sprite.style.fontSize = `${0.62 + stage * 0.19}em`;
      cell.appendChild(sprite);
      // Coarse label only: a live percentage here would make a screen reader
      // re-announce the tile every second while it is focused.
      cell.setAttribute('aria-label', `${label}, ${crop.name} growing`);

      const bar = document.createElement('div');
      bar.className = 'plot-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', `${crop.name} growth`);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      const fill = document.createElement('div');
      fill.className = 'plot-progress-fill';
      bar.appendChild(fill);
      cell.appendChild(bar);
    }
  }

  cell.dataset.sig = sig;
}

function renderPlots() {
  const grid = document.getElementById('plotsGrid');

  // Create the fixed set of tiles once, then reuse them across ticks.
  // Real buttons so the grid is reachable and operable from the keyboard.
  while (grid.children.length < PLOT_COUNT) {
    const cell = document.createElement('button');
    cell.type = 'button';
    grid.appendChild(cell);
  }

  state.plots.forEach((plot, idx) => {
    const cell = grid.children[idx];
    const sig = plotSignature(plot, idx);
    if (cell.dataset.sig !== sig) buildPlotCell(cell, plot, idx, sig);

    // Progress is continuous, so it updates in place every tick.
    const fill = cell.querySelector('.plot-progress-fill');
    if (fill && plot.crop && !plot.rotten) {
      const crop = CROPS[plot.crop];
      const ripe = fill.classList.contains('freshness');
      const percent = Math.round((ripe ? freshness(plot) : plotProgress(plot)) * 100);
      fill.style.width = `${percent}%`;
      cell.title = ripe
        ? `${crop.name} ready — ${percent}% fresh`
        : `${crop.name} growing... ${percent}%`;
      fill.parentElement.setAttribute('aria-valuenow', String(percent));
    }
  });
}

function plantSeed(idx) {
  const plot = state.plots[idx];
  if (plot.crop) return;
  if (!state.selectedSeed) {
    SFX.error();
    showToast('Pick a seed first!');
    return;
  }
  const crop = CROPS[state.selectedSeed];
  if (state.coins < crop.seedCost) {
    SFX.error();
    showToast('Not enough coins!');
    return;
  }
  state.coins -= crop.seedCost;
  plot.crop = state.selectedSeed;
  plot.plantedAt = nowSec();
  SFX.plant();
  saveState();
  render();
}

function clearRottenPlot(idx) {
  const plot = state.plots[idx];
  if (!plot.crop || !plot.rotten) return;
  const crop = CROPS[plot.crop];
  state.plots[idx] = emptyPlot();
  SFX.error();
  showToast(`Cleared the rotten ${crop.name} — ripe crops keep for `
    + `${CROP_SPOIL_DAYS} days, so harvest them before the bar runs out.`);
  saveState();
  render();
}

function harvestPlot(idx) {
  const plot = state.plots[idx];
  if (!plot.crop || plot.rotten) return;
  const crop = CROPS[plot.crop];
  if (plotProgress(plot) < 1) return;
  const yielded = cropYield(crop);
  state.inventory[plot.crop] += yielded;
  state.stats.totalHarvested += yielded;
  SFX.harvest();
  spawnFloatText(`+${yielded} ${crop.emoji}`, document.getElementById('plotsGrid').children[idx], 'gain');
  showToast(`Harvested ${yielded}x ${crop.emoji} ${crop.name}`
    + (isFarmerTired() ? ' — halved, the farmer is exhausted. Eat a pumpkin!' : ''));
  state.plots[idx] = emptyPlot();
  saveState();
  render();
}

/* ------------------------------------------------------------------ */
/* Animals tab                                                          */
/* ------------------------------------------------------------------ */

function animalSignature(animal, def, ready) {
  // A dog's buttons depend on which livestock is actually in the pens, so the
  // signature tracks that rather than a single can-feed flag.
  const supply = def.eatsLivestock
    ? DOG_PREY_ORDER.map((k) => (state[ANIMALS[k].stateKey].length > 0 ? '1' : '0')).join('')
    : (canFeed(def) ? 'fed' : 'nofood');
  const hungry = `${isStarving(animal) ? 'starving' : 'hungry'}:${supply}`;
  // A guardian on duty has no "ready" step — its shift just runs down.
  if (def.guards) {
    if (animal.state === 'producing') return 'onduty';
    return hungry;
  }
  if (ready) return 'ready';
  if (animal.state === 'producing') return 'producing';
  return hungry;
}

function buildAnimalCard(card, animal, kind, def, ready, sig) {
  card.className = 'animal-card';
  card.innerHTML = '';

  const emoji = document.createElement('div');
  emoji.className = 'animal-emoji';
  emoji.textContent = def.emoji;
  emoji.setAttribute('aria-hidden', 'true');
  card.appendChild(emoji);

  const stateLabel = document.createElement('div');
  const btn = document.createElement('button');
  btn.className = 'animal-btn';

  if (ready && !def.guards) {
    stateLabel.className = 'animal-state ready';
    stateLabel.textContent = `${def.produceEmoji} Ready!`;
    card.appendChild(stateLabel);

    btn.textContent = `Collect ${def.produceEmoji}`;
    btn.onclick = () => collectAnimal(kind, animal.id);
    card.appendChild(btn);
  } else if (animal.state === 'producing') {
    const onDuty = Boolean(def.guards);
    stateLabel.className = `animal-state ${onDuty ? 'onduty' : 'producing'}`;
    stateLabel.textContent = onDuty ? '🛡️ On duty' : 'Producing...';
    card.appendChild(stateLabel);

    const bar = document.createElement('div');
    bar.className = 'animal-progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', onDuty ? `${def.name} on duty` : `${def.name} production`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('div');
    fill.className = 'animal-progress-fill';
    bar.appendChild(fill);
    card.appendChild(bar);

    btn.textContent = onDuty ? 'On duty' : 'Producing...';
    btn.disabled = true;
    card.appendChild(btn);
  } else {
    const starving = isStarving(animal);
    if (starving) card.classList.add('starving');
    stateLabel.className = `animal-state hungry${starving ? ' starving' : ''}`;
    stateLabel.textContent = starving ? '💀 Starving!' : 'Hungry';
    card.appendChild(stateLabel);

    // How long the animal has left before it starves.
    const bar = document.createElement('div');
    bar.className = 'animal-progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', `${def.name} time left before starving`);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('div');
    fill.className = 'animal-progress-fill hunger';
    bar.appendChild(fill);
    card.appendChild(bar);

    if (def.eatsLivestock) {
      // A dog gets one button per animal it could be fed, since which one you
      // give up is the whole decision.
      DOG_PREY_ORDER.forEach((prey) => {
        const preyDef = ANIMALS[prey];
        const available = state[preyDef.stateKey].length;
        const feedBtn = document.createElement('button');
        feedBtn.className = 'animal-btn prey-btn';
        feedBtn.textContent = `${preyDef.emoji} ${DOG_PREY[prey].shiftTime}s`;
        feedBtn.disabled = available === 0;
        feedBtn.setAttribute(
          'aria-label',
          `Slaughter a ${preyDef.name} to feed this dog for ${DOG_PREY[prey].shiftTime} seconds`
          + ` (${available} available)`,
        );
        feedBtn.onclick = () => feedDog(animal.id, prey);
        card.appendChild(feedBtn);
      });
    } else {
      btn.textContent = feedLabel(def);
      btn.disabled = !canFeed(def);
      btn.setAttribute(
        'aria-label',
        `Feed this ${def.name} ${def.feed.amount} ${GOODS[def.feed.good].name}`,
      );
      btn.onclick = () => feedAnimal(kind, animal.id);
      card.appendChild(btn);
    }

    const sellBtn = document.createElement('button');
    sellBtn.className = 'animal-btn-sell';
    const refund = Math.round(def.buyBaseCost * ANIMAL_SELL_REFUND_RATE);
    sellBtn.textContent = `Sell (${refund}💰)`;
    sellBtn.onclick = () => sellAnimal(kind, animal.id);
    card.appendChild(sellBtn);
  }

  card.dataset.sig = sig;
  card.dataset.animalId = String(animal.id);
}

function renderAnimalList(kind) {
  const def = ANIMALS[kind];
  const list = state[def.stateKey];
  const container = document.getElementById(kind + 'List');

  if (list.length === 0) {
    const plural = def.pluralName || `${def.name.toLowerCase()}s`;
    const message = `No ${plural} yet — buy one below!`;
    if (container.firstElementChild?.tagName !== 'P') {
      container.innerHTML = '';
      const empty = document.createElement('p');
      empty.textContent = message;
      container.appendChild(empty);
    }
    return;
  }

  // Drop the "none yet" placeholder and any cards for sold animals.
  if (container.firstElementChild?.tagName === 'P') container.innerHTML = '';
  while (container.children.length > list.length) {
    container.removeChild(container.lastElementChild);
  }
  while (container.children.length < list.length) {
    container.appendChild(document.createElement('div'));
  }

  list.forEach((animal, i) => {
    const card = container.children[i];
    const progress = animalProgress(animal, def);
    const ready = animal.state === 'producing' && progress >= 1;
    const sig = animalSignature(animal, def, ready);

    if (card.dataset.sig !== sig || card.dataset.animalId !== String(animal.id)) {
      buildAnimalCard(card, animal, kind, def, ready, sig);
    }

    const fill = card.querySelector('.animal-progress-fill');
    if (fill) {
      // The same bar shows production while fed and hunger while not.
      const hungry = fill.classList.contains('hunger');
      const percent = Math.round((hungry ? fedness(animal) : progress) * 100);
      fill.style.width = `${percent}%`;
      fill.parentElement.setAttribute('aria-valuenow', String(percent));
    }
  });
}

/* Coverage is the whole point of owning guardians, so it gets its own line
   rather than being something the player has to infer from lost animals. */
function renderGuardStatus(kind) {
  const el = document.getElementById(`${kind}GuardStatus`);
  if (!el) return;

  const def = ANIMALS[kind];
  const charges = guardedCount(kind);
  const noun = kind === 'dog'
    ? (charges === 1 ? 'animal' : 'animals')
    : (charges === 1 ? 'planted plot' : 'planted plots');
  const onDuty = onDutyCount(kind);
  const covered = Math.min(guardCapacity(kind), charges);
  const short = covered < charges;

  let text;
  if (charges === 0) {
    text = kind === 'dog'
      ? 'No livestock to guard yet.'
      : 'Nothing planted to guard yet.';
  } else if (onDuty === 0) {
    text = `⚠️ No ${pluralOf(def)} on duty — all ${charges} ${noun} unguarded.`;
  } else if (short) {
    const needed = Math.ceil(charges / GUARD_CAPACITY) - onDuty;
    text = `⚠️ ${onDuty} on duty, covering ${covered} of ${charges} ${noun}`
      + ` — feed or buy ${needed} more.`;
  } else {
    text = `🛡️ ${onDuty} on duty — all ${charges} ${noun} covered.`;
  }

  el.textContent = text;
  el.classList.toggle('short', charges > 0 && short);
}

function feedAnimal(kind, id) {
  const def = ANIMALS[kind];
  // Dogs are fed livestock, which is a different transaction entirely.
  if (def.eatsLivestock) return;
  const animal = state[def.stateKey].find((a) => a.id === id);
  if (!animal || animal.state !== 'hungry') return;
  if (!canFeed(def)) {
    SFX.error();
    const good = GOODS[def.feed.good];
    showToast(`A ${def.name} needs ${def.feed.amount} ${good.name} — grow `
      + `${CROPS[def.feed.good] ? 'and harvest it on the Farm tab' : 'some first'}.`);
    return;
  }
  state.inventory[def.feed.good] -= def.feed.amount;
  animal.state = 'producing';
  animal.feedAt = nowSec();
  animal.starvesAt = null;
  animal.starvingWarned = false;
  SFX.feed();
  saveState();
  render();
}

/* Take an animal out of the pen for the dog. A hungry one goes first — no
   sense destroying a production cycle that is already half run. */
function pickForSlaughter(kind) {
  const list = state[ANIMALS[kind].stateKey];
  const idle = list.findIndex((a) => a.state === 'hungry');
  return idle === -1 ? (list.length > 0 ? 0 : -1) : idle;
}

function feedDog(id, prey) {
  const def = ANIMALS.dog;
  const dog = state[def.stateKey].find((a) => a.id === id);
  if (!dog || dog.state !== 'hungry') return;

  const preyDef = ANIMALS[prey];
  const shift = DOG_PREY[prey];
  if (!preyDef || !shift) return;

  const idx = pickForSlaughter(prey);
  if (idx === -1) {
    SFX.error();
    showToast(`No ${pluralOf(preyDef)} to spare — a dog only eats livestock, `
      + 'so buy one from the pens below.');
    return;
  }

  // Losing a cow or a sheep is expensive enough to be worth confirming; a
  // chicken is the intended staple and would only get in the way.
  if (SLAUGHTER_CONFIRM.includes(prey)) {
    const confirmed = window.confirm(
      `Slaughter a ${preyDef.name} to feed this dog?\n\n`
      + `It keeps the dog on duty for ${shift.shiftTime} seconds. The `
      + `${preyDef.name} is gone for good.`,
    );
    if (!confirmed) return;
  }

  state[preyDef.stateKey].splice(idx, 1);
  dog.state = 'producing';
  dog.feedAt = nowSec();
  dog.shiftTime = shift.shiftTime;
  dog.starvesAt = null;
  dog.starvingWarned = false;
  SFX.feed();
  showToast(`🐕 Slaughtered a ${preyDef.name} — the dog is on watch for ${shift.shiftTime}s.`);
  saveState();
  render();
}

/* ------------------------------------------------------------------ */
/* Guardians and raids                                                   */
/* ------------------------------------------------------------------ */

/* One fed guardian can only be in so many places at once. Each covers this
   many of its charges — livestock for a dog, planted plots for a cat — so a
   farm that grows has to grow its guard with it. A full sixteen-plot field
   takes four cats; a dozen animals take three dogs. */
const GUARD_CAPACITY = 4;

// A guardian is only protecting while its last meal lasts.
function onDutyCount(kind) {
  const def = ANIMALS[kind];
  return state[def.stateKey].filter(
    (a) => a.state === 'producing' && animalProgress(a, def) < 1,
  ).length;
}

function isOnDuty(kind) {
  return onDutyCount(kind) > 0;
}

// What a guardian kind is responsible for: dogs count the herd, cats count
// the crops actually in the ground.
function guardedCount(kind) {
  if (kind === 'dog') {
    return LIVESTOCK_ORDER.reduce((n, k) => n + state[ANIMALS[k].stateKey].length, 0);
  }
  return state.plots.filter((p) => p.crop && CROPS[p.crop] && !p.rotten).length;
}

function guardCapacity(kind) {
  return onDutyCount(kind) * GUARD_CAPACITY;
}

/* 1 = every charge covered, 0 = none. Cover a fraction of the farm and you
   turn away that fraction of raids: one dog watching eight animals is in the
   right place half the time. */
function guardCoverage(kind) {
  const charges = guardedCount(kind);
  if (charges === 0) return 1; // nothing to lose
  return clamp01(guardCapacity(kind) / charges);
}

// Guardians have no produce to collect, so their shift simply ends.
function updateGuardians() {
  let changed = false;
  GUARDIAN_ORDER.forEach((kind) => {
    const def = ANIMALS[kind];
    state[def.stateKey].forEach((a) => {
      if (a.state === 'producing' && animalProgress(a, def) >= 1) {
        becomeHungry(a);
        changed = true;
      }
    });
  });
  if (changed) saveState();
}

function scheduleRaid(minMs, maxMs) {
  return Date.now() + minMs + Math.random() * (maxMs - minMs);
}

function pluralOf(def) {
  return def.pluralName || `${def.name.toLowerCase()}s`;
}

function resolveWolfRaid() {
  const guarded = isOnDuty('dog');
  // Full cover always turns the wolf away; partial cover does so in
  // proportion, which is what makes a bigger herd need more dogs.
  if (Math.random() < guardCoverage('dog')) {
    if (guarded) {
      SFX.collect();
      showToast('🐕 Your dogs chased off a wolf!');
    }
    return;
  }
  const herd = [];
  LIVESTOCK_ORDER.forEach((kind) => {
    state[ANIMALS[kind].stateKey].forEach((animal) => herd.push({ kind, id: animal.id }));
  });
  if (herd.length === 0) return; // nothing out there to take

  const taken = herd[Math.floor(Math.random() * herd.length)];
  const def = ANIMALS[taken.kind];
  const list = state[def.stateKey];
  list.splice(list.findIndex((a) => a.id === taken.id), 1);
  SFX.error();
  showToast(guarded
    ? `🐺 Your dogs were spread too thin — a wolf took one of your ${pluralOf(def)}!`
      + ` Each dog on duty only covers ${GUARD_CAPACITY} animals.`
    : `🐺 A wolf took one of your ${pluralOf(def)}! A fed dog would have chased it off.`);
}

function resolvePestRaid() {
  const guarded = isOnDuty('cat');
  if (Math.random() < guardCoverage('cat')) {
    if (guarded) {
      SFX.collect();
      showToast('🐈 Your cats saw off the crows!');
    }
    return;
  }
  const planted = state.plots
    .map((plot, index) => ({ plot, index }))
    .filter(({ plot }) => plot.crop && CROPS[plot.crop] && !plot.rotten);
  if (planted.length === 0) return;

  const hit = planted[Math.floor(Math.random() * planted.length)];
  const crop = CROPS[hit.plot.crop];
  state.plots[hit.index] = emptyPlot();
  SFX.error();
  showToast(guarded
    ? `🐦 Your cats were spread too thin — crows ate your ${crop.name}!`
      + ` Each cat on duty only covers ${GUARD_CAPACITY} plots.`
    : `🐦 Crows ate your ${crop.name}! A fed cat would have kept them off.`);
}

// Raids that came due while the tab was closed are rescheduled rather than
// resolved, so an overnight break cannot wipe a farm out.
function updateRaids() {
  const now = Date.now();
  let changed = false;

  if (now >= state.nextWolfRaidAt) {
    if (now - state.nextWolfRaidAt < RAID_STALE_MS) resolveWolfRaid();
    state.nextWolfRaidAt = scheduleRaid(WOLF_RAID_MIN_MS, WOLF_RAID_MAX_MS);
    changed = true;
  }
  if (now >= state.nextPestRaidAt) {
    if (now - state.nextPestRaidAt < RAID_STALE_MS) resolvePestRaid();
    state.nextPestRaidAt = scheduleRaid(PEST_RAID_MIN_MS, PEST_RAID_MAX_MS);
    changed = true;
  }
  if (changed) saveState();
}

function collectAnimal(kind, id) {
  const def = ANIMALS[kind];
  const animal = state[def.stateKey].find((a) => a.id === id);
  if (!animal || animal.state !== 'producing') return;
  if (animalProgress(animal, def) < 1) return;
  state.inventory[def.produceKey] += def.produceYield;
  SFX.collect();
  spawnFloatText(
    `+${def.produceYield} ${def.produceEmoji}`,
    document.querySelector(`#${kind}List [data-animal-id="${id}"]`),
    'gain',
  );
  showToast(`Collected ${def.produceYield}x ${def.produceEmoji}`);
  becomeHungry(animal);
  saveState();
  render();
}

function sellAnimal(kind, id) {
  const def = ANIMALS[kind];
  const list = state[def.stateKey];
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1 || list[idx].state !== 'hungry') return;
  const refund = Math.round(def.buyBaseCost * ANIMAL_SELL_REFUND_RATE);

  // Selling is irreversible and buying back costs more than the refund, so
  // the Sell button sitting right under Feed deserves a check.
  const buyBack = buyAnimalCost(kind);
  const confirmed = window.confirm(
    `Sell this ${def.name} for ${refund} coins?\n\n`
    + `Buying another would cost ${buyBack} coins.`,
  );
  if (!confirmed) return;

  list.splice(idx, 1);
  state.coins += refund;
  SFX.sell();
  showToast(`Sold ${def.name} for ${refund}💰 — buying another now costs ${buyAnimalCost(kind)}💰.`);
  saveState();
  render();
}

function buyAnimalCost(kind) {
  const def = ANIMALS[kind];
  const owned = state[def.stateKey].length;
  return def.buyBaseCost + owned * def.costIncrement;
}

function renderBuyButtons() {
  ANIMAL_ORDER.forEach((kind) => {
    const def = ANIMALS[kind];
    const cost = buyAnimalCost(kind);
    const btn = document.getElementById('buy' + kind[0].toUpperCase() + kind.slice(1) + 'Btn');
    btn.textContent = `Buy ${def.name} (${cost}💰)`;
    btn.disabled = state.coins < cost;
    btn.onclick = () => buyAnimal(kind);
  });
}

function buyAnimal(kind) {
  const def = ANIMALS[kind];
  const cost = buyAnimalCost(kind);
  if (state.coins < cost) {
    SFX.error();
    showToast('Not enough coins!');
    return;
  }
  state.coins -= cost;
  state[def.stateKey].push(becomeHungry({ id: state.nextAnimalId++ }));
  SFX.buy();
  showToast(`Bought a new ${def.name}!`);
  saveState();
  render();
}

/* ------------------------------------------------------------------ */
/* Upgrades                                                             */
/* ------------------------------------------------------------------ */

function buyUpgrade(key) {
  const def = UPGRADES[key];
  const level = upgradeLevel(key);
  if (level >= def.maxLevel) return;

  const cost = upgradeCost(key);
  if (state.coins < cost) {
    SFX.error();
    showToast('Not enough coins!');
    return;
  }

  state.coins -= cost;
  state.upgrades[key] = level + 1;
  SFX.unlockPlot();
  showToast(`${def.name} upgraded to level ${level + 1}!`);
  saveState();
  render();
}

function renderUpgrades() {
  const list = document.getElementById('upgradeList');

  if (list.children.length !== UPGRADE_ORDER.length) {
    list.innerHTML = '';
    UPGRADE_ORDER.forEach((key) => {
      const def = UPGRADES[key];
      const item = document.createElement('div');
      item.className = 'upgrade-item';
      item.innerHTML = `
        <div class="item-emoji" aria-hidden="true">${def.emoji}</div>
        <div class="upgrade-name">${def.name}</div>
        <div class="upgrade-effect"></div>
        <div class="upgrade-level"></div>
      `;
      const btn = document.createElement('button');
      btn.addEventListener('click', () => buyUpgrade(key));
      item.appendChild(btn);
      list.appendChild(item);
    });
  }

  UPGRADE_ORDER.forEach((key, i) => {
    const def = UPGRADES[key];
    const level = upgradeLevel(key);
    const maxed = level >= def.maxLevel;
    const item = list.children[i];

    item.classList.toggle('maxed', maxed);
    // Show what the upgrade is currently doing, or what the first level buys.
    item.querySelector('.upgrade-effect').textContent =
      level > 0 ? def.describe(level) : `Next: ${def.describe(1)}`;
    item.querySelector('.upgrade-level').textContent = `Level ${level} / ${def.maxLevel}`;

    const btn = item.querySelector('button');
    if (maxed) {
      btn.textContent = 'Maxed out';
      btn.disabled = true;
      btn.setAttribute('aria-label', `${def.name} is fully upgraded`);
    } else {
      const cost = upgradeCost(key);
      btn.textContent = `Upgrade (${cost}💰)`;
      btn.disabled = state.coins < cost;
      btn.setAttribute('aria-label', `Upgrade ${def.name} to level ${level + 1} for ${cost} coins`);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Market tab                                                           */
/* ------------------------------------------------------------------ */

function renderMarket() {
  renderUpgrades();
  renderSoundSettings();

  const goods = Object.entries(GOODS);
  const sellList = document.getElementById('sellList');

  if (sellList.children.length !== goods.length) {
    sellList.innerHTML = '';
    goods.forEach(([key, good]) => {
      const item = document.createElement('div');
      item.className = 'market-item';
      item.innerHTML = `
        <div class="item-emoji">${good.emoji}</div>
        <div>${good.name}</div>
        <div class="market-have">Have: 0</div>
        <div class="market-price">${good.sellPrice}💰 each</div>
      `;
      const btn = document.createElement('button');
      btn.addEventListener('click', () => sellAll(key));
      item.appendChild(btn);
      sellList.appendChild(item);
    });
  }

  goods.forEach(([key], i) => {
    const qty = state.inventory[key];
    const price = goodPrice(key);
    const item = sellList.children[i];
    item.querySelector('.market-have').textContent = `Have: ${qty}`;
    // Priced through goodPrice so the Market Contacts upgrade shows up here.
    item.querySelector('.market-price').textContent = `${price}💰 each`;
    const btn = item.querySelector('button');
    btn.textContent = `Sell All (${qty * price}💰)`;
    btn.disabled = qty <= 0;
  });

  const invList = document.getElementById('inventoryList');
  const overview = [
    { emoji: '💰', name: 'Coins', value: state.coins },
    { emoji: '🐄', name: 'Cows', value: state.cows.length },
    { emoji: '🐔', name: 'Chickens', value: state.chickens.length },
    { emoji: '🐑', name: 'Sheep', value: state.sheep.length },
    { emoji: '🐕', name: 'Dogs', value: state.dogs.length },
    { emoji: '🐈', name: 'Cats', value: state.cats.length },
    { emoji: '🌱', name: 'Plots planted', value: state.plots.filter((p) => p.crop).length + ' / ' + state.unlockedPlots },
    { emoji: '🔓', name: 'Plots unlocked', value: state.unlockedPlots + ' / ' + PLOT_COUNT },
  ];

  if (invList.children.length !== overview.length) {
    invList.innerHTML = '';
    overview.forEach((o) => {
      const item = document.createElement('div');
      item.className = 'inventory-item';
      item.innerHTML = `<div class="item-emoji">${o.emoji}</div><div>${o.name}</div><div class="inv-value"></div>`;
      invList.appendChild(item);
    });
  }

  overview.forEach((o, i) => {
    invList.children[i].querySelector('.inv-value').textContent = String(o.value);
  });
}

function sellAll(key) {
  const qty = state.inventory[key];
  if (qty <= 0) return;
  const good = GOODS[key];
  const earned = qty * goodPrice(key);
  state.coins += earned;
  state.stats.totalCoinsEarned += earned;
  state.inventory[key] = 0;
  SFX.sell();
  const goodIndex = Object.keys(GOODS).indexOf(key);
  spawnFloatText(`+${earned} 💰`, document.getElementById('sellList').children[goodIndex], 'coins');
  showToast(`Sold ${qty}x ${good.emoji} for ${earned}💰`);
  saveState();
  render();
}

/* ------------------------------------------------------------------ */
/* Onboarding                                                            */
/* ------------------------------------------------------------------ */

function dismissOnboarding() {
  state.onboarded = true;
  saveState();
  render();
}

/* ------------------------------------------------------------------ */
/* Welcome back                                                          */
/* ------------------------------------------------------------------ */

// Below this, an absence isn't worth remarking on.
const AWAY_REPORT_MIN_MS = 2 * 60 * 1000;

function pluralise(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function formatAway(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return pluralise(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return pluralise(hours, 'hour');
  return pluralise(Math.floor(hours / 24), 'day');
}

// Work out what finished while the tab was closed. Crops and animals run off
// absolute timestamps, so anything whose completion time falls between the
// last visit and now ripened in the player's absence.
function buildAwayReport(lastSeenAt) {
  const awayMs = Date.now() - lastSeenAt;
  if (!Number.isFinite(awayMs) || awayMs < AWAY_REPORT_MIN_MS) return null;

  const seenAtSec = lastSeenAt / 1000;
  const now = nowSec();

  const crops = state.plots.filter((p) => {
    if (!p.crop || !CROPS[p.crop]) return false;
    const readyAt = p.plantedAt + cropGrowTime(CROPS[p.crop]);
    return readyAt <= now && readyAt > seenAtSec;
  }).length;

  let produce = 0;
  ANIMAL_ORDER.forEach((kind) => {
    const def = ANIMALS[kind];
    state[def.stateKey].forEach((a) => {
      if (a.state !== 'producing' || a.feedAt === null) return;
      const doneAt = a.feedAt + animalProduceTime(def);
      if (doneAt <= now && doneAt > seenAtSec) produce += 1;
    });
  });

  if (crops === 0 && produce === 0) return null;

  const parts = [];
  if (crops > 0) parts.push(`${pluralise(crops, 'crop')} ripened`);
  if (produce > 0) parts.push(`${pluralise(produce, 'animal')} finished producing`);
  return `Welcome back! You were away ${formatAway(awayMs)} — ${parts.join(' and ')}.`;
}

function showWelcomeBack(message) {
  if (!message) return;
  document.getElementById('welcomeBackText').textContent = message;
  document.getElementById('welcomeBack').classList.remove('hidden');
}

function dismissWelcomeBack() {
  document.getElementById('welcomeBack').classList.add('hidden');
  SFX.click();
}

/* ------------------------------------------------------------------ */
/* Save data export / import                                            */
/* ------------------------------------------------------------------ */

function downloadSave() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `farm-life-save-${dateStamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('Save file downloaded');
}

function loadSaveFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      SFX.error();
      showToast('That file is not a valid save.');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.plots) || typeof parsed.coins !== 'number') {
      SFX.error();
      showToast('That file is not a valid Farm Life save.');
      return;
    }
    if (!window.confirm('Loading this save will replace your current progress. Continue?')) {
      return;
    }
    state = migrateSave(parsed);
    saveState();
    SFX.buy();
    showToast('Save loaded!');
    render();
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------ */
/* Top bar / day-night cycle                                            */
/* ------------------------------------------------------------------ */

const SKY_COLORS = {
  day: { top: [126, 200, 240], bottom: [191, 230, 168], ground: [143, 201, 106] },
  dusk: { top: [247, 129, 74], bottom: [255, 178, 106], ground: [186, 158, 96] },
  night: { top: [12, 22, 54], bottom: [28, 44, 78], ground: [34, 58, 32] },
};

let currentNightFactor = 0;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return `rgb(${Math.round(lerp(c1[0], c2[0], t))}, ${Math.round(lerp(c1[1], c2[1], t))}, ${Math.round(lerp(c1[2], c2[2], t))})`;
}

// Pass the sky through a warm dusk band instead of fading blue straight to
// navy. The sinusoidal night factor lingers near its extremes, so the orange
// window stays brief — which is what makes it read as a real sunset.
function skyColorAt(band, nightFactor) {
  const t = clamp01(nightFactor);
  return t < 0.5
    ? lerpColor(SKY_COLORS.day[band], SKY_COLORS.dusk[band], t * 2)
    : lerpColor(SKY_COLORS.dusk[band], SKY_COLORS.night[band], (t - 0.5) * 2);
}

function updateDayNightVisuals() {
  // Normalise into [0, 1) so a save from the future (clock change, edited
  // file) can't push the sun off the side of the sky.
  const rawPhase = (Date.now() - state.dayStartedAt) / DAY_LENGTH_MS;
  const phase = ((rawPhase % 1) + 1) % 1;
  // Smooth sinusoid: 0 at midday, peaks at 1 in the middle of the cycle (midnight).
  const nightFactor = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const root = document.documentElement.style;
  root.setProperty('--sky-top', skyColorAt('top', nightFactor));
  root.setProperty('--sky-bottom', skyColorAt('bottom', nightFactor));
  root.setProperty('--sky-ground', skyColorAt('ground', nightFactor));
  root.setProperty('--night', (nightFactor * 0.8).toFixed(3));

  // The sun rides an arc across the light half of the cycle, the moon across
  // the dark half. Shifting the phase by a quarter puts each at its zenith
  // exactly when the sky is brightest / darkest.
  const q = (phase + 0.25) % 1;
  const isNight = q > 0.5;
  const arc = isNight ? (q - 0.5) / 0.5 : q / 0.5;
  const body = document.getElementById('celestialBody');
  if (body) {
    // Arc through the clear sky strip above the UI, so it stays visible
    // instead of passing behind the panels at its zenith.
    const band = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--sky-band'),
    ) || 94;
    body.style.left = `${(6 + arc * 88).toFixed(2)}%`;
    body.style.top = `${(band * 0.56 - Math.sin(arc * Math.PI) * band * 0.42).toFixed(1)}px`;
    body.classList.toggle('moon', isNight);
  }

  currentNightFactor = nightFactor;
}

let lastCoinsShown = null;

function renderTopbar() {
  const coinsEl = document.getElementById('coinsLabel');
  coinsEl.textContent = `💰 ${state.coins}`;
  if (lastCoinsShown !== null && state.coins !== lastCoinsShown) {
    coinsEl.classList.remove('pop');
    void coinsEl.offsetWidth; // restart the animation
    coinsEl.classList.add('pop');
  }
  lastCoinsShown = state.coins;

  const isNight = currentNightFactor > 0.5;
  const farmer = FARMERS[state.farmer];
  document.getElementById('dayLabel').textContent =
    `${farmer ? `${farmer.emoji} ` : ''}${isNight ? '🌙 Night' : '☀️ Day'} ${state.day}`;

  const muteBtn = document.getElementById('muteBtn');
  muteBtn.textContent = state.muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', state.muted ? 'Unmute sound' : 'Mute sound');
  muteBtn.setAttribute('aria-pressed', String(state.muted));
}

function toggleMute() {
  state.muted = !state.muted;
  saveState();
  syncMusic();
  render();
  SFX.click();
}

function toggleMusic() {
  state.musicOn = !state.musicOn;
  saveState();
  syncMusic();
  render();
  SFX.click();
}

function setVolume(value) {
  state.volume = clamp01(value);
  // Reaching for the slider implies wanting to hear something.
  if (state.volume > 0) state.muted = false;
  saveState();
  syncMusic();
  render();
}

function renderSoundSettings() {
  const musicBtn = document.getElementById('musicToggleBtn');
  const slider = document.getElementById('volumeSlider');
  const readout = document.getElementById('volumeReadout');
  if (!musicBtn || !slider) return;

  musicBtn.textContent = state.musicOn ? '🎵 Music: On' : '🎵 Music: Off';
  musicBtn.setAttribute('aria-pressed', String(state.musicOn));

  const percent = Math.round(masterVolume() * 100);
  if (document.activeElement !== slider) slider.value = String(percent);
  readout.textContent = `${percent}%`;
}

function updateDay() {
  const elapsed = Date.now() - state.dayStartedAt;
  if (elapsed >= DAY_LENGTH_MS) {
    // Advance by every whole day that has passed, not just one. Crops and
    // animals run off absolute timestamps and so catch up fully after the tab
    // has been closed; the calendar has to catch up the same way. Carrying the
    // remainder forward (rather than resetting to now) also keeps the
    // day/night phase continuous instead of drifting on every rollover.
    const daysPassed = Math.floor(elapsed / DAY_LENGTH_MS);
    state.day += daysPassed;
    state.dayStartedAt += daysPassed * DAY_LENGTH_MS;
  }
  updateDayNightVisuals();
}

/* ------------------------------------------------------------------ */
/* Achievements tab                                                      */
/* ------------------------------------------------------------------ */

function checkAchievements() {
  ACHIEVEMENTS.forEach((ach) => {
    if (state.unlockedAchievements.includes(ach.id)) return;
    if (!ach.check(state)) return;
    state.unlockedAchievements.push(ach.id);
    state.coins += ach.reward;
    SFX.achievement();
    showToast(`🏆 ${ach.name} unlocked! +${ach.reward}💰`);
    saveState();
  });
}

function renderAchievements() {
  const list = document.getElementById('achievementsList');

  if (list.children.length !== ACHIEVEMENTS.length) {
    list.innerHTML = '';
    ACHIEVEMENTS.forEach(() => list.appendChild(document.createElement('div')));
  }

  ACHIEVEMENTS.forEach((ach, i) => {
    const unlocked = state.unlockedAchievements.includes(ach.id);
    const card = list.children[i];
    const sig = unlocked ? 'unlocked' : 'locked';
    if (card.dataset.sig === sig) return;

    card.className = 'achievement-card' + (unlocked ? ' unlocked' : '');
    card.innerHTML = `
      <div class="achievement-emoji">${unlocked ? ach.emoji : '🔒'}</div>
      <div class="achievement-name">${ach.name}</div>
      <div class="achievement-desc">${ach.description}</div>
      <div class="achievement-reward">${unlocked ? 'Earned' : 'Reward'}: ${ach.reward}💰</div>
    `;
    card.dataset.sig = sig;
  });

  const progress = document.getElementById('achievementsProgress');
  progress.textContent = `${state.unlockedAchievements.length} / ${ACHIEVEMENTS.length} unlocked`;
}

/* ------------------------------------------------------------------ */
/* Dream tab — the two grand goals                                      */
/* ------------------------------------------------------------------ */

function renderDream() {
  const intro = document.getElementById('dreamIntro');
  const owned = state.dreamHome;

  intro.textContent = owned
    ? `You bought the ${DREAM_HOMES[owned].name}. The farm keeps running — `
      + 'this one is yours for good.'
    : 'Two ways to finish the story, and you only ever get one of them. '
      + 'Buying either takes the other off the market permanently.';

  const list = document.getElementById('dreamList');
  if (list.children.length !== DREAM_ORDER.length) {
    list.innerHTML = '';
    DREAM_ORDER.forEach(() => list.appendChild(document.createElement('div')));
  }

  DREAM_ORDER.forEach((key, i) => {
    const home = DREAM_HOMES[key];
    const card = list.children[i];
    const isOwned = owned === key;
    const forfeited = Boolean(owned) && !isOwned;
    const affordable = !owned && state.coins >= home.cost;
    const percent = Math.min(100, Math.floor((state.coins / home.cost) * 100));

    const status = isOwned ? 'owned' : forfeited ? 'forfeited' : affordable ? 'ready' : 'saving';
    const sig = `${status}:${status === 'saving' ? percent : ''}`;
    if (card.dataset.sig !== sig) {
      card.className = `dream-card ${status}`;
      card.innerHTML = '';

      const emoji = document.createElement('div');
      emoji.className = 'dream-emoji';
      emoji.textContent = forfeited ? '🚫' : home.emoji;
      emoji.setAttribute('aria-hidden', 'true');
      card.appendChild(emoji);

      const name = document.createElement('div');
      name.className = 'dream-name';
      name.textContent = home.name;
      card.appendChild(name);

      const tagline = document.createElement('div');
      tagline.className = 'dream-tagline';
      tagline.textContent = home.tagline;
      card.appendChild(tagline);

      const desc = document.createElement('div');
      desc.className = 'dream-desc';
      desc.textContent = home.describe;
      card.appendChild(desc);

      const price = document.createElement('div');
      price.className = 'dream-price';
      price.textContent = `${home.cost.toLocaleString('en-GB')}💰`;
      card.appendChild(price);

      if (!owned) {
        const bar = document.createElement('div');
        bar.className = 'dream-progress';
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-label', `Savings towards the ${home.name}`);
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        const fill = document.createElement('div');
        fill.className = 'dream-progress-fill';
        bar.appendChild(fill);
        card.appendChild(bar);
      }

      const btn = document.createElement('button');
      btn.className = 'dream-btn';
      if (isOwned) {
        btn.textContent = '🎉 Yours!';
        btn.disabled = true;
      } else if (forfeited) {
        btn.textContent = 'No longer available';
        btn.disabled = true;
      } else {
        btn.textContent = `Buy the ${home.name}`;
        btn.disabled = !affordable;
        btn.onclick = () => buyDreamHome(key);
      }
      card.appendChild(btn);
      card.dataset.sig = sig;
    }

    // Savings creep up constantly, so the bar and its label update in place.
    const fill = card.querySelector('.dream-progress-fill');
    if (fill) {
      fill.style.width = `${percent}%`;
      fill.parentElement.setAttribute('aria-valuenow', String(percent));
      fill.parentElement.title =
        `${state.coins.toLocaleString('en-GB')} of ${home.cost.toLocaleString('en-GB')}💰 saved`;
    }
  });
}

function buyDreamHome(key) {
  const home = DREAM_HOMES[key];
  if (!home || state.dreamHome) return;
  if (state.coins < home.cost) {
    SFX.error();
    showToast('Not enough coins!');
    return;
  }

  // Irreversible and it forfeits the other goal, so make the trade explicit.
  const other = DREAM_ORDER.find((k) => k !== key);
  const confirmed = window.confirm(
    `Buy the ${home.name} for ${home.cost.toLocaleString('en-GB')} coins?\n\n`
    + `This is final: the ${DREAM_HOMES[other].name} will no longer be available.`,
  );
  if (!confirmed) return;

  state.coins -= home.cost;
  state.dreamHome = key;
  SFX.achievement();
  showToast(`${home.emoji} You bought the ${home.name}! The farm is a home now.`);
  spawnFloatText(home.emoji, document.getElementById('dreamList'), 'gain');
  saveState();
  render();
}

/* ------------------------------------------------------------------ */
/* Render / loop                                                        */
/* ------------------------------------------------------------------ */

function render() {
  updateGuardians();
  checkAchievements();
  renderTopbar();
  renderFarmerPicker();
  if (activeTab === 'farm') {
    document.getElementById('onboardingBanner').classList.toggle('hidden', state.onboarded);
    renderFarmer();
    renderSeedBar();
    renderPlots();
  } else if (activeTab === 'animals') {
    ANIMAL_ORDER.forEach((kind) => renderAnimalList(kind));
    GUARDIAN_ORDER.forEach((kind) => renderGuardStatus(kind));
    renderBuyButtons();
  } else if (activeTab === 'market') {
    renderMarket();
    renderFarmerChoice();
  } else if (activeTab === 'achievements') {
    renderAchievements();
  } else if (activeTab === 'dream') {
    renderDream();
  }
}

function tick() {
  // While the tab is backgrounded — switching apps on a phone, mostly —
  // there is nothing to draw. Everything runs off absolute timestamps, so
  // skipping the work costs no progress and it all catches up on return.
  if (document.hidden) return;
  updateDay();
  updateSpoilage();
  // Before starvation, so a guardian coming off shift starts its hunger clock
  // on the same tick rather than the next one.
  updateGuardians();
  updateStarvation();
  updateRaids();
  render();
  state.lastSeenAt = Date.now();
  saveState();
}

// If another tab (or the installed app alongside the browser) has played more
// recently than us, take its progress instead of writing our stale copy over
// the top of it. Only the visible tab ticks, so this is all it takes for two
// copies of the game to stop overwriting each other.
function adoptNewerSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw);
    if (Number.isFinite(stored.lastSeenAt) && stored.lastSeenAt > (state.lastSeenAt || 0)) {
      state = migrateSave(stored);
      return true;
    }
  } catch (e) { /* unreadable save: keep playing with what we have */ }
  return false;
}

// Leaving the page is the moment progress is most likely to be lost, so
// commit it rather than waiting for the next tick.
function handleVisibilityChange() {
  if (document.hidden) {
    state.lastSeenAt = Date.now();
    saveState();
    stopMusic();
    // Let the browser reclaim the audio graph instead of leaving scheduled
    // notes queued against a context the OS has frozen.
    if (audioCtx && audioCtx.state === 'running') audioCtx.suspend().catch(() => {});
  } else {
    // Shelf life and hunger only burn down while someone is actually playing,
    // so hand back the time spent in the background. If we adopted another
    // tab's save instead, migrateSave has already done that for its copy.
    if (!adoptNewerSave()) shiftPlayClocks(state, Date.now() - state.lastSeenAt);
    // Push any raid that fell due while away out to a fresh interval.
    const now = Date.now();
    if (now >= state.nextWolfRaidAt) state.nextWolfRaidAt = scheduleRaid(WOLF_RAID_MIN_MS, WOLF_RAID_MAX_MS);
    if (now >= state.nextPestRaidAt) state.nextPestRaidAt = scheduleRaid(PEST_RAID_MIN_MS, PEST_RAID_MAX_MS);
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    syncMusic();
    updateDay();
    render();
  }
}

/* ------------------------------------------------------------------ */
/* Init                                                                  */
/* ------------------------------------------------------------------ */

function init() {
  // Read the absence before anything overwrites lastSeenAt.
  const awayReport = buildAwayReport(state.lastSeenAt);

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });
  document.getElementById('muteBtn').addEventListener('click', toggleMute);
  document.getElementById('helpBtn').addEventListener('click', openHelp);
  document.getElementById('helpCloseBtn').addEventListener('click', closeHelp);
  document.getElementById('helpPanel').addEventListener('click', (e) => {
    if (e.target.id === 'helpPanel') closeHelp(); // tap the backdrop to dismiss
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHelp();
  });
  document.getElementById('onboardingDismissBtn').addEventListener('click', dismissOnboarding);
  document.getElementById('welcomeDismissBtn').addEventListener('click', dismissWelcomeBack);

  document.getElementById('musicToggleBtn').addEventListener('click', toggleMusic);
  const volumeSlider = document.getElementById('volumeSlider');
  volumeSlider.addEventListener('input', () => setVolume(Number(volumeSlider.value) / 100));

  document.addEventListener('visibilitychange', handleVisibilityChange);
  // pagehide is the one teardown event phones fire reliably; unload is not.
  window.addEventListener('pagehide', () => {
    state.lastSeenAt = Date.now();
    saveState();
  });

  document.getElementById('downloadSaveBtn').addEventListener('click', downloadSave);
  const loadInput = document.getElementById('loadSaveInput');
  document.getElementById('loadSaveBtn').addEventListener('click', () => loadInput.click());
  loadInput.addEventListener('change', () => {
    if (loadInput.files.length > 0) loadSaveFromFile(loadInput.files[0]);
    loadInput.value = '';
  });

  // Persist straight away rather than waiting for the first tick, so a
  // migrated save is committed even if the player closes the tab immediately.
  state.lastSeenAt = Date.now();
  saveState();

  updateDayNightVisuals();
  render();
  showWelcomeBack(awayReport);
  setInterval(tick, 1000);
  armMusicOnFirstGesture();
  registerServiceWorker();
}

// Caches the app shell so the game keeps working offline and can be installed
// to a home screen. Registration failing is never fatal — the game runs fine
// without it (and service workers are unavailable on file:// URLs).
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

init();
