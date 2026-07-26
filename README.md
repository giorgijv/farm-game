# 🚜 Farm Life

A small browser farming game. Plant and harvest crops, feed cows and
chickens to produce milk and eggs, and sell everything at the market to
buy more seeds and animals.

## Play

It's a static site — no build step. Either:

- Open `index.html` directly in a browser, or
- Serve the folder locally, e.g. `python3 -m http.server`, then visit
  `http://localhost:8000`
- Or play the hosted version via GitHub Pages once enabled for this repo:
  `https://giorgijv.github.io/farm-game/`

## How it works

- **Farm** — pick a seed (wheat, corn, or carrot), plant it on an empty
  plot, and wait for it to grow through seed → sprout → ready stages.
  Harvest for crops.
- **Animals** — buy cows and chickens with coins. Feed them from your
  crop inventory to start production; once the timer finishes, collect
  milk or eggs.
- **Market** — sell crops, milk, and eggs for coins to buy more seeds
  and animals.

Progress is saved automatically to `localStorage`.
