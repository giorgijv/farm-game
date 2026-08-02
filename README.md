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

The **❓ button** in the top bar opens a full rundown of every system in the
game. It is generated from the same constants the game runs on, so the rules on
screen can never drift from the rules being enforced.

## How it works

- **Difficulty** — three tiers, chosen on the first screen and changeable any
  time under Market → Difficulty:

  | | Prices | Spoil/hunger clocks | Raids | Subsidy | Start |
  |---|---|---|---|---|---|
  | 🌻 **Relaxed** | +25% | ×2 | rarer | 150 | 200 |
  | 🚜 **Farmer** | standard | standard | standard | 100 | 100 |
  | 🌪️ **Hard** | −20% | ×0.5 | ~2× as often | 50 | 50 |

  Both dream homes cost 20,000 and 40,000 on every tier, so the difficulty
  shows up as how long the run takes rather than as a different finish line.
  The in-game guide always quotes the numbers your current tier is enforcing.

- **The farmer** — the first thing a new game asks is who is running the place:
  a female or male farmer. They do every job here, and they eat too. A meal of
  **2 pumpkins** keeps them going for three in-game days.
  Going hungry happens in two steps. First they are **exhausted**: every
  harvest is halved, and the bar switches from energy to a countdown. Keep
  working through that without eating for four more in-game days and they
  **collapse — that is game over**, with the run summed up and the option to
  start a new farm or load a save. A tired harvest never yields nothing, so
  the way out stays open right up to the last moment. The choice of farmer can
  be changed later under Market → Farmer. The game refers to your farmer by the
  gender you picked — he/him or she/her.
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
  their base price — selling asks for confirmation first, since the Sell
  button sits under Feed and buying a replacement costs more than the refund.
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
  Raids are played out rather than merely reported: crows sweep in over the
  field, a wolf comes in low at the pens, and a guardian on duty charges in and
  drives them off in front of you. Whatever was taken flashes where it stood.
  The attacker aims at the real tile or card when you are on that tab and
  crosses mid-screen when you are not, so a raid is never invisible. All of it
  is skipped under `prefers-reduced-motion`, which still leaves the message.
- **Subsidy** — a farm starts with **100 coins**, and every seven in-game days
  it keeps going the state pays a **government subsidy of 100 coins** (the
  first on day 8). Those are days *played*, not days on the wall clock, so the
  subsidy has to be earned at the wheel — you cannot leave the tab shut for a
  month and come back to a fortune. It is deliberately a trickle next to what a
  worked field earns: enough to stop a struggling farm stalling out, nowhere
  near enough to make farming optional.
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
  asks for confirmation because it cannot be undone. Buying one rolls the
  ending: your new home from the inside — a beamed cottage or a marble villa —
  with fireworks over the fields through the window and the run summed up. It
  can be replayed any time from the owned card.

Sound effects and the background music loop are synthesised with the Web Audio
API — there are no audio files. Music, volume and a master mute live under
Market → Sound.

A full day passes every 90 seconds **of play**, carrying the sky from daylight
through a warm dusk to a starlit night. The calendar is banked a tick at a time
while the game is open and stops dead when it is closed, so days — and the
weekly subsidy that rides on them — are something you play through rather than
wait out.

Crops and animals are the exception, and deliberately so: they run on real
timestamps and keep growing while the tab is closed, so coming back after a
while still greets you with a summary of what ripened. Everything that costs
you (spoilage, hunger, starvation, raids) and everything that pays you (the
calendar, the subsidy) is measured in play time instead.

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
achievements, the two dream homes, the weekly subsidy, the difficulty tiers, the day cycle, save loading/migration, the
welcome-back summary, the help panel, the farmer's collapse and game over,
the ending celebration, keyboard operability, and offline play. It also asserts that the
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

### Play-testing

`tools/playtest.js` drives the real UI on every difficulty and checks the save
after every action. Two phases: a real-time bot that plants, harvests, feeds,
buys and sells, and a stress phase that forces the events a short run cannot
reach — the weekly subsidy, spoilage, starvation, raids with and without a
guardian, the farmer's collapse, the ending, and a tier switch on top of each.

```bash
npm run playtest              # 60s x 2 runs per tier, then the stress phase
node tools/playtest.js 120 3  # longer runs, more of them
```

Every scenario asserts what it expected to happen, not merely that nothing
threw: a structural check alone will happily pass a subsidy that quietly
forgets to record itself. The harness is verified by injecting known faults and
confirming it reports them.
