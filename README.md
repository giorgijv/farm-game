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
- **Animals** — buy cows, chickens and sheep. Each eats its own food, and the
  bill scales with what it produces: a chicken cycle costs 3 coins of wheat
  and returns 5, a cow costs 12 of corn and returns 18, a sheep costs 20 of
  carrot and returns 28. Feed one to start production, then collect milk,
  eggs or wool when the timer finishes. Animals can be sold back for half
  their base price.
- **Guardians** — a **dog** (fed on eggs) chases off the wolves that
  otherwise carry away livestock, and a **cat** (fed on milk) keeps crows
  from eating planted crops. Both protect only while fed: a guardian works a
  shift, then goes hungry and needs feeding again. Raids are infrequent and
  jittered, and any that fall due while the game is closed are skipped rather
  than resolved, so a farm is never wiped out overnight.
- **Market** — sell produce for coins, review your holdings, adjust sound, and
  export or import your save. It also sells four permanent **upgrades** —
  faster crops, faster animals, larger harvests and better prices — each with
  three increasingly expensive levels, so late-game coins always have
  somewhere to go.
- **Awards** — eleven achievements covering harvesting, livestock, expansion
  and wealth, each paying a one-off coin reward.

Sound effects and the background music loop are synthesised with the Web Audio
API — there are no audio files. Music, volume and a master mute live under
Market → Sound.

A full day passes every 90 seconds, carrying the sky from daylight through a
warm dusk to a starlit night. Crops and animals run on real timestamps, so
they keep progressing while the tab is closed — come back after a while and a
summary tells you what ripened while you were away.

Progress saves automatically to `localStorage`. Because that is per-browser,
the Market tab also offers **Download Save** / **Load Save** to back progress
up or move it between devices.

## On a phone

The game is built to be played on a phone. Open the link in Chrome on Android
and use **Add to Home screen** — the manifest and service worker make it launch
full-screen and run with no network connection. (As usual for service workers,
the first visit loads from the network and the offline cache takes effect from
the next load onwards.)

Every control is sized to Material's 48dp touch target, the layout reflows from
a three-column field in portrait to six columns in landscape, hover effects are
suppressed on touch so they cannot stick after a tap, and padding respects
display cutouts and the gesture bar when running full-screen.

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

`tests/game.spec.js` covers the core loop, animal production, the market,
upgrades, achievements, the day cycle, save loading/migration, the welcome-back
summary, keyboard operability, and offline play. It also asserts that the
once-a-second render reuses DOM nodes, since rebuilding them would silently
restart every CSS animation.

`tests/mobile.spec.js` runs the game at phone sizes — 360px, 393px and
landscape — checking that nothing scrolls sideways, that no control falls below
the 44px touch floor, and that the whole loop can be played by tapping.

If you are running in a sandbox that already ships a Chromium whose build
number does not match this Playwright version, point the tests at it:

```bash
CHROMIUM_PATH=/path/to/chrome npm test
```

CI runs the same suite on every push and pull request.
