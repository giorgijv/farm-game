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
they keep progressing while the tab is closed — come back after a while and a
summary tells you what ripened while you were away.

Progress saves automatically to `localStorage`. Because that is per-browser,
the Market tab also offers **Download Save** / **Load Save** to back progress
up or move it between devices.

## Install and offline play

The game ships a web app manifest and a service worker that precaches the
whole app shell, so it can be installed to a home screen and played with no
network connection. As usual for service workers, the first visit runs from
the network and the offline cache takes effect from the next load onwards.

## Accessibility

Every control is a real button, so the whole game — including the plot grid —
is reachable and operable from the keyboard, with a high-contrast focus ring.
Plots carry descriptive labels ("Plot 3, Wheat ready to harvest"), growth and
production are exposed as progress bars, and status messages are announced
through a polite live region. Animation is disabled under
`prefers-reduced-motion`.

## Development

Everything is hand-written HTML, CSS and JavaScript — no framework, no build
step, and no external assets. All artwork is CSS-generated, so the game works
offline once loaded.

- `index.html` — markup and the scenery layers
- `styles.css` — the whole visual system
- `script.js` — game state, systems, rendering and audio
- `sw.js` / `manifest.webmanifest` — offline caching and installability
- `tests/` — Playwright end-to-end suite

### Tests

```bash
npm install
npx playwright install chromium   # first run only
npm test
```

The suite covers the core loop, animal production, the market, achievements,
the day cycle, save loading/migration, the welcome-back summary, keyboard
operability, and offline play. It also asserts that the once-a-second render
reuses DOM nodes, since rebuilding them would silently restart every CSS
animation.

If you are running in a sandbox that already ships a Chromium whose build
number does not match this Playwright version, point the tests at it:

```bash
CHROMIUM_PATH=/path/to/chrome npm test
```

CI runs the same suite on every push and pull request.
