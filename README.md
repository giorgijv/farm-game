# 🚜 Farm Life

A browser farming game. Plant and harvest crops, raise cows, chickens and
sheep, and sell what you produce at the market to expand the farm — until you
can afford a country house, or hold out for the villa.

Play it at **https://giorgijv.github.io/farm-game/**

## Play

It's a static site with no build step. Either open `index.html` directly in a
browser, or serve the folder:

```bash
npm run serve     # http://localhost:4173
```

## How it works

- **The farmer** — the first thing a new game asks is who is running the place:
  a female or male farmer. They do every job here, and they eat too. A meal of
  **2 pumpkins** keeps them going for three in-game days; run out and they are
  exhausted, and every harvest is halved until they eat again. A tired harvest
  never yields nothing, so a farmer can always work their way back to a
  pumpkin. The choice can be changed later under Market → Farmer.
- **Farm** — pick a seed (wheat, corn, carrot or pumpkin) and plant it on an
  empty plot. Crops grow through seed → sprout → ripe; tap a ripe plot to
  harvest. Eight of the sixteen plots start locked and are bought one at a
  time with coins.
- **Spoilage** — a ripe crop keeps for two in-game days. The plot's bar
  switches from growth to shelf life the moment it ripens, turning red with an
  hourglass for the last third of the window; leave it past that and the crop
  rots and has to be cleared for nothing. The countdown only runs while the
  game is open, so closing the tab never costs a harvest — crops that ripen
  while you are away are still waiting when you come back.
- **Animals** — buy cows, chickens and sheep. Each eats its own food, and the
  bill scales with what it produces: a chicken cycle costs 3 coins of wheat
  and returns 5, a cow costs 12 of corn and returns 18, a sheep costs 20 of
  carrot and returns 28. Feed one to start production, then collect milk,
  eggs or wool when the timer finishes. Animals can be sold back for half
  their base price.
- **Hunger** — an animal left hungry for four in-game days starves and is
  gone. Its bar counts down to that instead of up to produce, and the card
  turns red with a pulsing **Starving!** and a one-off warning for the final
  day. Selling a starving animal still recovers half its price, and — as with
  crops — the clock only runs while the game is open, so nothing dies while
  you are away.
- **Guardians** — a **dog** chases off the wolves that otherwise carry away
  livestock, and a **cat** (fed on milk) keeps crows from eating planted
  crops. A dog will not touch produce: feeding one means **slaughtering an
  animal**, and the bigger the animal the longer the watch — a chicken buys
  90 seconds, a sheep 200, a cow 320. Giving up a cow or a sheep asks for
  confirmation; a chicken, the intended staple, does not. Both guardians
  protect only while fed: one works a shift, then goes hungry and needs
  feeding again. Each one on duty covers
  **four** of its charges, so the guard has to grow with the farm — a dozen
  animals need three dogs, a full sixteen-plot field needs four cats. Cover
  only part of the farm and you turn away only that share of raids, so a lone
  dog watching eight animals is in the right place half the time. The Animals
  tab shows the coverage and warns when it falls short. Raids are infrequent
  and jittered, and any that fall due while the game is closed are skipped
  rather than resolved, so a farm is never wiped out overnight.
- **Market** — sell produce for coins, review your holdings, adjust sound, and
  export or import your save. It also sells four permanent **upgrades** —
  faster crops, faster animals, larger harvests and better prices — each with
  three increasingly expensive levels, so late-game coins always have
  somewhere to go.
- **Awards** — eleven achievements covering harvesting, livestock, expansion
  and wealth, each paying a one-off coin reward.
- **Dream** — the two grand goals everything else builds towards: a **Country
  House** for 20,000 coins or a **Grand Villa** for 40,000. They are strictly
  either/or — buying one takes the other off the market for good, so the run
  ends on a choice between cashing out early and holding out for twice the
  price. Both cards show live progress towards their price, and the purchase
  asks for confirmation because it cannot be undone.

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

`tests/game.spec.js` covers the core loop, the farmer and their meals, animal
production, guardians and raids, guard coverage scaling with the farm, feeding
a dog on livestock, crop spoilage, animal starvation, the market, upgrades,
achievements, the two dream homes, the day cycle, save loading/migration, the
welcome-back summary, keyboard operability, and offline play. It also asserts that the
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
