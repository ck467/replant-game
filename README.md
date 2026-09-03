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

## Persistence

Set `DATABASE_URL` to a Postgres connection string (the live game uses a
Supabase project's **session pooler** URL) and the world map and leaderboard
live in one `game_state` table, surviving restarts and deploys. The table is
created on first boot; an empty database is seeded from `seed/` (the snapshot
carried over from the file-based days). Without `DATABASE_URL` the server
falls back to `map-state.json` / `players.json` on disk (fine locally; wiped
on every Heroku restart). TLS is verified against Supabase's root CA bundled
in `certs/`; point `DATABASE_CA_FILE` at another CA for a different host, or
set `DATABASE_SSL=no-verify` as a last resort.

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

The plague itself is tuned in `server.js` (or by environment variable):
`SPREAD_INTERVAL_MS` (90s between bulldozings, only while someone is
connected), `RESTORE_GRACE_MS` (a freshly restored patch is safe for 10
minutes), and `PLAGUE_FLOOR_PCT` (the plague halts at 15% green or less, so
the world can never be eaten to nothing).

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
  restored patch gets a signpost with your name and adds to your
  leaderboard total. Tune in `CONFIG.CHALLENGE`.
- **🏆 Top Planters leaderboard** — only players who have restored a
  patch appear, ranked by patches restored, ties broken by fastest goal
  time. The whole board is listed, 30 per page, and every time it is shown
  it opens on the player's own page with their row highlighted and
  centered. Always on screen on desktop; a drawer (🏆 button) on small
  screens. Live-updates for everyone over Socket.IO.
- **Signposts** — every restored patch on the map carries a little wooden
  signpost painted with the planter's name (hover shows "Restored by ___").
- **Admin resets** — signing in as `admin` shows two buttons: ↺ resets the
  world map (leaderboard kept) and 🗑️ clears the leaderboard (map kept).
  Each asks for the admin key, which the server checks against its
  `ADMIN_KEY` environment variable (unset = resets refused); the device
  remembers an accepted key. Nothing resets on deploy any more.
- **One message band** — every message during a run (tutorial, tree
  progress, a patch lost to the plague) shows on the wood sign between the
  HUD and the board; between messages the sign cycles through the
  deforestation facts from `CONFIG.IMPACTS`.

## Multiplayer

The world map is **shared by everyone**. The server owns the grid (persisted to
the database, or `map-state.json` locally), runs the deforestation timer, and
broadcasts every change over Socket.IO — so when one player restores a patch,
all connected players see it turn green instantly. The HUD shows how many
players are online.

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
