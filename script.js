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

const ANIMALS = {
  cow: {
    name: 'Cow', emoji: '🐄', stateKey: 'cows', buyBaseCost: 100, costIncrement: 70,
    feedAmount: 3, produceTime: 25, produceYield: 2,
    produceKey: 'milk', produceEmoji: '🥛',
  },
  chicken: {
    name: 'Chicken', emoji: '🐔', stateKey: 'chickens', buyBaseCost: 40, costIncrement: 25,
    feedAmount: 1, produceTime: 15, produceYield: 1,
    produceKey: 'egg', produceEmoji: '🥚',
  },
  sheep: {
    name: 'Sheep', pluralName: 'sheep', emoji: '🐑', stateKey: 'sheep', buyBaseCost: 150, costIncrement: 90,
    feedAmount: 4, produceTime: 35, produceYield: 2,
    produceKey: 'wool', produceEmoji: '🧶',
  },
};

const ANIMAL_ORDER = ['cow', 'chicken', 'sheep'];
const ANIMAL_SELL_REFUND_RATE = 0.5;

const GOODS = {
  wheat: { emoji: '🌾', name: 'Wheat', sellPrice: CROPS.wheat.sellPrice },
  corn: { emoji: '🌽', name: 'Corn', sellPrice: CROPS.corn.sellPrice },
  carrot: { emoji: '🥕', name: 'Carrot', sellPrice: CROPS.carrot.sellPrice },
  pumpkin: { emoji: '🎃', name: 'Pumpkin', sellPrice: CROPS.pumpkin.sellPrice },
  milk: { emoji: '🥛', name: 'Milk', sellPrice: 9 },
  egg: { emoji: '🥚', name: 'Egg', sellPrice: 5 },
  wool: { emoji: '🧶', name: 'Wool', sellPrice: 14 },
};

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
    check: (s) => ANIMAL_ORDER.every((kind) => s[ANIMALS[kind].stateKey].length >= 1),
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
    plots: Array.from({ length: PLOT_COUNT }, () => ({ crop: null, plantedAt: null })),
    cows: [],
    chickens: [],
    sheep: [],
    nextAnimalId: 1,
    inventory: { wheat: 0, corn: 0, carrot: 0, pumpkin: 0, milk: 0, egg: 0, wool: 0 },
    stats: { totalHarvested: 0, totalCoinsEarned: 0 },
    unlockedAchievements: [],
    muted: false,
    onboarded: false,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    const fresh = freshState();
    return Object.assign(fresh, parsed);
  } catch (e) {
    return freshState();
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
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
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1600);
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

function pickCropToConsume(amount) {
  // Prefer consuming the cheapest crop first, spread across types if needed.
  const have = CROP_ORDER.reduce((sum, k) => sum + state.inventory[k], 0);
  if (have < amount) return null;
  const plan = {};
  let remaining = amount;
  for (const key of CROP_ORDER) {
    if (remaining <= 0) break;
    const take = Math.min(state.inventory[key], remaining);
    if (take > 0) {
      plan[key] = take;
      remaining -= take;
    }
  }
  return plan;
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

function playTone(freq, duration, type, volume, delay) {
  if (state.muted) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const startAt = ctx.currentTime + (delay || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, startAt);
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
  render();
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
  const crop = CROPS[plot.crop];
  const progress = clamp01((nowSec() - plot.plantedAt) / crop.growTime);
  if (progress >= 1) return `ready:${plot.crop}`;
  return `grow:${plot.crop}:${plotGrowthStage(progress)}`;
}

function buildPlotCell(cell, plot, idx, sig) {
  cell.className = 'plot';
  cell.innerHTML = '';
  cell.onclick = null;

  if (idx >= state.unlockedPlots) {
    cell.classList.add('locked');
    const cost = PLOT_UNLOCK_BASE_COST + (idx - INITIAL_UNLOCKED_PLOTS) * PLOT_UNLOCK_INCREMENT;
    cell.innerHTML = `<span>🔒</span><span class="plot-lock-cost">${cost}💰</span>`;
    if (idx === state.unlockedPlots) {
      cell.classList.add('unlockable');
      cell.title = `Unlock this plot for ${cost}💰`;
      cell.onclick = () => unlockPlot();
    } else {
      cell.title = 'Unlock the previous plot first';
    }
  } else if (!plot.crop) {
    cell.classList.add('empty');
    cell.textContent = '➕';
    cell.title = 'Plant a seed here';
    cell.onclick = () => plantSeed(idx);
  } else {
    const crop = CROPS[plot.crop];
    const progress = clamp01((nowSec() - plot.plantedAt) / crop.growTime);
    const sprite = document.createElement('span');
    sprite.className = 'crop-sprite';

    if (progress >= 1) {
      cell.classList.add('ready');
      sprite.textContent = crop.emoji;
      cell.appendChild(sprite);
      cell.title = `Harvest ${crop.name}`;
      cell.onclick = () => harvestPlot(idx);
    } else {
      const stage = plotGrowthStage(progress);
      sprite.textContent = stage === 0 ? '🌱' : stage === 1 ? '🌿' : crop.emoji;
      // Scale the sprite as it matures instead of fading the whole tile, so the
      // soil and progress bar stay fully legible.
      sprite.style.fontSize = `${0.62 + stage * 0.19}em`;
      cell.appendChild(sprite);

      const bar = document.createElement('div');
      bar.className = 'plot-progress';
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
  while (grid.children.length < PLOT_COUNT) {
    grid.appendChild(document.createElement('div'));
  }

  state.plots.forEach((plot, idx) => {
    const cell = grid.children[idx];
    const sig = plotSignature(plot, idx);
    if (cell.dataset.sig !== sig) buildPlotCell(cell, plot, idx, sig);

    // Progress is continuous, so it updates in place every tick.
    const fill = cell.querySelector('.plot-progress-fill');
    if (fill && plot.crop) {
      const crop = CROPS[plot.crop];
      const progress = clamp01((nowSec() - plot.plantedAt) / crop.growTime);
      fill.style.width = `${Math.round(progress * 100)}%`;
      cell.title = `${crop.name} growing... ${Math.round(progress * 100)}%`;
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

function harvestPlot(idx) {
  const plot = state.plots[idx];
  if (!plot.crop) return;
  const crop = CROPS[plot.crop];
  const elapsed = nowSec() - plot.plantedAt;
  if (elapsed < crop.growTime) return;
  state.inventory[plot.crop] += crop.yield;
  state.stats.totalHarvested += crop.yield;
  SFX.harvest();
  spawnFloatText(`+${crop.yield} ${crop.emoji}`, document.getElementById('plotsGrid').children[idx], 'gain');
  showToast(`Harvested ${crop.yield}x ${crop.emoji} ${crop.name}`);
  plot.crop = null;
  plot.plantedAt = null;
  saveState();
  render();
}

/* ------------------------------------------------------------------ */
/* Animals tab                                                          */
/* ------------------------------------------------------------------ */

function animalSignature(animal, def, ready) {
  if (ready) return 'ready';
  if (animal.state === 'producing') return 'producing';
  const haveEnough = CROP_ORDER.reduce((sum, k) => sum + state.inventory[k], 0) >= def.feedAmount;
  return `hungry:${haveEnough ? 'fed' : 'nofood'}`;
}

function buildAnimalCard(card, animal, kind, def, ready, sig) {
  card.className = 'animal-card';
  card.innerHTML = '';

  const emoji = document.createElement('div');
  emoji.className = 'animal-emoji';
  emoji.textContent = def.emoji;
  card.appendChild(emoji);

  const stateLabel = document.createElement('div');
  const btn = document.createElement('button');
  btn.className = 'animal-btn';

  if (ready) {
    stateLabel.className = 'animal-state ready';
    stateLabel.textContent = `${def.produceEmoji} Ready!`;
    card.appendChild(stateLabel);

    btn.textContent = `Collect ${def.produceEmoji}`;
    btn.onclick = () => collectAnimal(kind, animal.id);
    card.appendChild(btn);
  } else if (animal.state === 'producing') {
    stateLabel.className = 'animal-state producing';
    stateLabel.textContent = 'Producing...';
    card.appendChild(stateLabel);

    const bar = document.createElement('div');
    bar.className = 'animal-progress';
    const fill = document.createElement('div');
    fill.className = 'animal-progress-fill';
    bar.appendChild(fill);
    card.appendChild(bar);

    btn.textContent = 'Producing...';
    btn.disabled = true;
    card.appendChild(btn);
  } else {
    stateLabel.className = 'animal-state hungry';
    stateLabel.textContent = 'Hungry';
    card.appendChild(stateLabel);

    const haveEnough = CROP_ORDER.reduce((sum, k) => sum + state.inventory[k], 0) >= def.feedAmount;
    btn.textContent = `Feed (${def.feedAmount} ${def.feedAmount === 1 ? 'crop' : 'crops'})`;
    btn.disabled = !haveEnough;
    btn.onclick = () => feedAnimal(kind, animal.id);
    card.appendChild(btn);

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
    const progress = animal.state === 'producing'
      ? clamp01((nowSec() - animal.feedAt) / def.produceTime)
      : 0;
    const ready = animal.state === 'producing' && progress >= 1;
    const sig = animalSignature(animal, def, ready);

    if (card.dataset.sig !== sig || card.dataset.animalId !== String(animal.id)) {
      buildAnimalCard(card, animal, kind, def, ready, sig);
    }

    const fill = card.querySelector('.animal-progress-fill');
    if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
  });
}

function feedAnimal(kind, id) {
  const def = ANIMALS[kind];
  const animal = state[def.stateKey].find((a) => a.id === id);
  if (!animal || animal.state !== 'hungry') return;
  const plan = pickCropToConsume(def.feedAmount);
  if (!plan) {
    SFX.error();
    showToast('Not enough crops to feed!');
    return;
  }
  Object.entries(plan).forEach(([k, amt]) => { state.inventory[k] -= amt; });
  animal.state = 'producing';
  animal.feedAt = nowSec();
  SFX.feed();
  saveState();
  render();
}

function collectAnimal(kind, id) {
  const def = ANIMALS[kind];
  const animal = state[def.stateKey].find((a) => a.id === id);
  if (!animal || animal.state !== 'producing') return;
  const progress = (nowSec() - animal.feedAt) / def.produceTime;
  if (progress < 1) return;
  state.inventory[def.produceKey] += def.produceYield;
  SFX.collect();
  spawnFloatText(
    `+${def.produceYield} ${def.produceEmoji}`,
    document.querySelector(`#${kind}List [data-animal-id="${id}"]`),
    'gain',
  );
  showToast(`Collected ${def.produceYield}x ${def.produceEmoji}`);
  animal.state = 'hungry';
  animal.feedAt = null;
  saveState();
  render();
}

function sellAnimal(kind, id) {
  const def = ANIMALS[kind];
  const list = state[def.stateKey];
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1 || list[idx].state !== 'hungry') return;
  const refund = Math.round(def.buyBaseCost * ANIMAL_SELL_REFUND_RATE);
  list.splice(idx, 1);
  state.coins += refund;
  SFX.sell();
  showToast(`Sold ${def.name} for ${refund}💰`);
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
  state[def.stateKey].push({ id: state.nextAnimalId++, state: 'hungry', feedAt: null });
  SFX.buy();
  showToast(`Bought a new ${def.name}!`);
  saveState();
  render();
}

/* ------------------------------------------------------------------ */
/* Market tab                                                           */
/* ------------------------------------------------------------------ */

function renderMarket() {
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
        <div>${good.sellPrice}💰 each</div>
      `;
      const btn = document.createElement('button');
      btn.addEventListener('click', () => sellAll(key));
      item.appendChild(btn);
      sellList.appendChild(item);
    });
  }

  goods.forEach(([key, good], i) => {
    const qty = state.inventory[key];
    const item = sellList.children[i];
    item.querySelector('.market-have').textContent = `Have: ${qty}`;
    const btn = item.querySelector('button');
    btn.textContent = `Sell All (${qty * good.sellPrice}💰)`;
    btn.disabled = qty <= 0;
  });

  const invList = document.getElementById('inventoryList');
  const overview = [
    { emoji: '💰', name: 'Coins', value: state.coins },
    { emoji: '🐄', name: 'Cows', value: state.cows.length },
    { emoji: '🐔', name: 'Chickens', value: state.chickens.length },
    { emoji: '🐑', name: 'Sheep', value: state.sheep.length },
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
  const earned = qty * good.sellPrice;
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
    state = Object.assign(freshState(), parsed);
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
  const phase = ((Date.now() - state.dayStartedAt) / DAY_LENGTH_MS) % 1;
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
  document.getElementById('dayLabel').textContent = `${isNight ? '🌙 Night' : '☀️ Day'} ${state.day}`;
  document.getElementById('muteBtn').textContent = state.muted ? '🔇' : '🔊';
}

function toggleMute() {
  state.muted = !state.muted;
  saveState();
  render();
  SFX.click();
}

function updateDay() {
  const elapsed = Date.now() - state.dayStartedAt;
  if (elapsed >= DAY_LENGTH_MS) {
    state.day += 1;
    state.dayStartedAt = Date.now();
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
/* Render / loop                                                        */
/* ------------------------------------------------------------------ */

function render() {
  checkAchievements();
  renderTopbar();
  if (activeTab === 'farm') {
    document.getElementById('onboardingBanner').classList.toggle('hidden', state.onboarded);
    renderSeedBar();
    renderPlots();
  } else if (activeTab === 'animals') {
    ANIMAL_ORDER.forEach((kind) => renderAnimalList(kind));
    renderBuyButtons();
  } else if (activeTab === 'market') {
    renderMarket();
  } else if (activeTab === 'achievements') {
    renderAchievements();
  }
}

function tick() {
  updateDay();
  render();
  saveState();
}

/* ------------------------------------------------------------------ */
/* Init                                                                  */
/* ------------------------------------------------------------------ */

function init() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });
  document.getElementById('muteBtn').addEventListener('click', toggleMute);
  document.getElementById('onboardingDismissBtn').addEventListener('click', dismissOnboarding);

  document.getElementById('downloadSaveBtn').addEventListener('click', downloadSave);
  const loadInput = document.getElementById('loadSaveInput');
  document.getElementById('loadSaveBtn').addEventListener('click', () => loadInput.click());
  loadInput.addEventListener('change', () => {
    if (loadInput.files.length > 0) loadSaveFromFile(loadInput.files[0]);
    loadInput.value = '';
  });

  updateDayNightVisuals();
  render();
  setInterval(tick, 1000);
}

init();
