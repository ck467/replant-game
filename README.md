# 🌍 Replant: Restore the Balance

A merge game about reversing deforestation — built for a grade 6 IB exhibition.

Half the Earth is green, half is barren, and deforestation keeps spreading.
Players tap a barren patch, then merge seeds → sprouts → saplings → young trees →
one **mature tree** (Merge Town style) to restore that patch. Restore enough
patches to bring the world back into balance — while the plague keeps eating
green patches on a timer.

## Run it

```bash
npm install
npm start          # http://localhost:3000
```

## Tests

```bash
npx playwright install chromium   # first time only
npm run test:e2e                  # 6 end-to-end tests
```

## Tuning the game

Everything lives in `public/js/config.js`:

| Setting | Default | What it does |
|---|---|---|
| `BOARD_COLS/ROWS` | 3×3 | Puzzle board size |
| `SPAWN_WEIGHTS` | 70/15/10/5 | Chance of stage 1/2/3/4 drops |
| `CHALLENGE` | 4 trees / 60s | The timed run every session plays |
| `MAP_COLS/ROWS` | 12×8 | World map patches |
| `SPREAD_INTERVAL_MS` | 45000 | How often deforestation claims a green patch |
| `RESTORE_GOAL_PCT` | 75 | Green % that counts as "balance restored" |
| `SPECIES` | Lemon, Coffee, Orange, Avocado | Names, sprite tiles, and win-screen facts |

## How it plays

- **Anon accounts** — every player types a name and gets a random crop-portrait
  avatar (🎲 to reroll). No passwords; the identity lives in the browser's
  localStorage and on the leaderboard. A shared booth tablet uses the
  "🙋 New player" button between students.
- **One mode: the timed run** — plant **4 full trees before the 60-second
  timer** (unlimited crates; the clock starts on your first crate open).
  Reaching the goal ends the run on the spot.
  Tap a barren patch to start a run whose FIRST tree restores that exact
  patch; the ⏱️ button starts a run that greens random patches. Every
  restored patch is stamped with your avatar (hover shows "Restored by ___")
  and adds to your leaderboard total. Tune in `CONFIG.CHALLENGE`.
- **🏆 Top Planters leaderboard** — ranked by total trees, ties broken by
  best challenge run. Always on screen on desktop; a drawer (🏆 button) on
  small screens. Live-updates for everyone over Socket.IO. Player data
  persists in `players.json` — delete it to clear the board for a new day.

## Multiplayer

The world map is **shared by everyone**. The server owns the grid (persisted to
`map-state.json`), runs the deforestation timer, and broadcasts every change
over Socket.IO — so when one player restores a patch, all connected players see
it turn green instantly. The HUD shows how many players are online. The ↺
button resets the world for everyone (booth-admin use).

Puzzle sessions are per-player and run entirely in the browser.

## Structure

- `server.js` — Express + Socket.IO: shared grid, plague timer, restore/reset events
- `public/js/config.js` — all balance and content
- `public/js/puzzle.js` — merge-board session (spawn, tap-tap merge, win/lose)
- `public/js/map.js` — socket-driven view of the shared world
- `public/js/main.js` — screens, HUD, overlays

## Art credits

- World map tiles: ["The Blind Hummingbird Forest Set"](https://spriteshift.itch.io/)
  by **Spriteshift**, CC0.
- Puzzle item sprites: ["Farming crops 16x16"](https://opengameart.org/content/farming-crops-16x16)
  by **josehzz** (OpenGameArt), CC0 — the Lemon, Coffee, Orange, and Avocado
  crops provide the 5 growth stages per species.

Sheets and license copies live in `public/assets/`; both are drawn as CSS
sprites (see the sprite math comments in `css/style.css` and
`js/config.js` `SPECIES[].tiles`).

Derived tiles (generated from the CC0 sources, in `public/assets/`):
`grass_16.png` and `water_16.png`/`water_v_16.png` are crops/rotations of
the Hummingbird sheet; `soil_16.png` is the grass tile hue-shifted to brown;
`crate_16.png` and `bulldozer_16.png` are original 16px sprites drawn to
match the set's palette.

## Roadmap

1. ✅ Merge puzzle + world map
2. ✅ Multiplayer shared world (Socket.IO)
3. Merge Town-style art via Gemini image generation (emoji tiles are drop-in
   placeholders — swap per stage/species with no code changes; needs a
   `GEMINI_API_KEY`)
4. Host online (needs a WebSocket-friendly host, e.g. Heroku like WordDuel)
