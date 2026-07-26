# 🚜 Farm Life

A browser farming game. Plant and harvest crops, raise cows, chickens and
sheep, and sell what you produce at the market to expand the farm.

Play it at **https://giorgijv.github.io/farm-game/**

## Play

It's a static site with no build step. Either open `index.html` directly in a
browser, or serve the folder:

```bash
npm run serve     # http://localhost:4173
```

## How it works

- **Farm** — pick a seed (wheat, corn, carrot or pumpkin) and plant it on an
  empty plot. Crops grow through seed → sprout → ripe; tap a ripe plot to
  harvest. Eight of the sixteen plots start locked and are bought one at a
  time with coins.
- **Animals** — buy cows, chickens and sheep. Feed each from your crop
  inventory to start production, then collect milk, eggs or wool when the
  timer finishes. Animals can be sold back for half their base price.
- **Market** — sell produce for coins, review your holdings, and export or
  import your save.
- **Awards** — eleven achievements covering harvesting, livestock, expansion
  and wealth, each paying a one-off coin reward.

A full day passes every 90 seconds, carrying the sky from daylight through a
warm dusk to a starlit night. Crops and animals run on real timestamps, so
they keep progressing while the tab is closed.

Progress saves automatically to `localStorage`. Because that is per-browser,
the Market tab also offers **Download Save** / **Load Save** to back progress
up or move it between devices.

## Development

Everything is hand-written HTML, CSS and JavaScript — no framework, no build
step, and no external assets. All artwork is CSS-generated, so the game works
offline once loaded.

- `index.html` — markup and the scenery layers
- `styles.css` — the whole visual system
- `script.js` — game state, systems, rendering and audio
- `tests/` — Playwright end-to-end suite

### Tests

```bash
npm install
npx playwright install chromium   # first run only
npm test
```

The suite covers the core loop, animal production, the market, achievements,
the day cycle, and save loading/migration. It also asserts that the
once-a-second render reuses DOM nodes, since rebuilding them would silently
restart every CSS animation.

If you are running in a sandbox that already ships a Chromium whose build
number does not match this Playwright version, point the tests at it:

```bash
CHROMIUM_PATH=/path/to/chrome npm test
```

CI runs the same suite on every push and pull request.
