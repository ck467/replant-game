# Replant: Restore the Balance — Project Report

**A deforestation merge game built for a Grade 6 IB Exhibition**

- **Live game**: https://replant-game-eb74f1caed0c.herokuapp.com/
- **Source**: https://github.com/ck467/replant-game
- **Stack**: Node.js + Express + Socket.IO server, vanilla JS/HTML/CSS client (no build step), Playwright e2e tests, deployed on Heroku (Basic dyno)
- **Art**: CC0 pixel art — "Blind Hummingbird Forest Set" (Spriteshift) + "Farming crops 16x16" (josehzz), plus derived/hand-drawn tiles in the same palette

---

## The Concept

The student's vision: Earth is half green, half barren, and deforestation is a
plague that keeps spreading, fed by greed and neglect for future generations.
Players push it back by growing trees through a Merge Town-style mechanic —
combining seeds → sprouts → saplings → young trees → mature trees — and every
restored patch heals a shared world map that hundreds of players work on
together.

---

## Development Journey — the prompts that shaped the product

### 1. "Let's build a game around deforestation… merge mechanic like Merge Town… multiplayer… don't over-engineer"
The founding brief. Established through clarifying questions: 2-item merges,
a 3×3 board (the student pushed back on larger grids — Merge Town's cozy 3×3
was right), a 5-stage merge chain, four tree species, a 12×8 shared world at
~half green, and a vanilla-JS/Express stack matching a school project's scale.
The first playable prototype shipped the same day with the full loop: tap a
barren patch → merge puzzle → patch restored, plus a spreading plague and win
facts about real trees.

### 2. Multiplayer from day one
The world map moved from browser storage to a server-authoritative grid over
Socket.IO: one shared Earth, live-broadcast restores and spreads, an online
player count, and state that survives restarts. A two-browser test proves one
player's restored patch appears on another's screen instantly.

### 3. "Use the assets from this folder" — the pixel-art pivot
The student supplied the CC0 Blind Hummingbird tileset. The map was rebuilt as
CSS sprites — living bush tiles vs. burnt-bush tiles from the same sheet made
the healthy/dead contrast seamless. When the puzzle needed matching art, the
CC0 "Farming crops 16x16" pack provided four real *tree* crops (Lemon, Coffee,
Orange, Avocado) with exactly five growth stages each — the species were
renamed to match the art, with new kid-friendly facts (shade-grown coffee
protects rainforests). Missing tiles were *derived* rather than sourced: grass
hue-shifted into soil, water rotated for vertical rivers, and an original
crate and bulldozer hand-drawn pixel-by-pixel in the set's palette.

### 4. "Build it like the example, full page" → the expansive world
Several iterations landed on the final world design: a fixed 32×18-tile scene
at a crisp 64px pixel scale that players **drag to pan** (mouse, touch, or
scroll-wheel), opening centered on the playable grid. Wild bush groves clump
organically across the meadow (hash-based, identical for every player), a
river flows down the right edge into a full-width channel with animated
current, a fence lines the bottom, and the whole game — intro, map, puzzle —
lives on the same tiled grass with wood-sign UI panels.

### 5. "Make the map feel alive"
Ambient systems: the living forest sways in the wind (per-patch randomized
rhythm), gust streaks sweep the screen, fly swarms hover, beetles from the
tileset's 4-frame walk cycle roam the meadow, and a hummingbird periodically
flies across flapping two sprite frames. Falling leaves drift over the puzzle
board. At 0% green the world visibly **dies** — groves burn, critters vanish,
the map darkens — and one replanted patch revives it all.

### 6. "Bulldozers are destroying the trees"
Deforestation became visible: two hand-drawn pixel bulldozers patrol the
barren zone, and when the plague claims a patch, the nearest dozer drives
over, the tree shakes, dust bursts, and it withers — the "human greed" of the
concept, embodied on the map.

### 7. One identity system: anon accounts, avatars, and a shared leaderboard
The early school/online mode split was unified: every player creates an
anonymous account (name + random crop-portrait avatar with a 🎲 reroll) that
persists on their device. Restored patches carry a wooden signpost with the
planter's name ("Restored by ___"), and a live leaderboard — pinned on desktop, a
bottom-sheet drawer on mobile — updates for everyone in real time.

### 8. The single game mode: a timed run with real stakes
The game converged on one loop, refined across several prompts:
- Tap a grey **dead tree** (the only interactable patches) to start a
  **60-second run** with unlimited crates — the clock is the pressure.
- **Goal: 4 mature trees.** Reaching the goal ends the run on the spot;
  the clock only matters if you fall short.
- **Qualification rule**: only reaching 4 trees restores the tapped patch.
  Quitting (with a confirmation warning) or falling short restores nothing.
- Leftover board items carry over between trees; a completed tree flies into
  the HUD counter after lingering through its toast — and the crate stays
  open the whole time, so play never pauses for a celebration.
- **One leaderboard: 🏆 Top Planters** — only players who have restored a
  patch are listed, most patches first, fastest goal time breaking ties.
- **Signposts on the map** (the student's design): every restored patch
  carries a little wooden signpost painted with the planter's name.

### 9. Game feel ("juice")
Layered feedback for every action: items pop out of the crate and arc onto
the soil; rare drops float "Lucky! / Super Lucky! / Mega Lucky!" text;
merges pop; the finished tree erupts confetti at its cell; qualifying runs
end in a golden-glow modal under a confetti shower announcing "🌍 Patch
restored!". A once-per-account staged tutorial (open the crate → merge the
pair → grow the tree) and a 📖 recipe book showing the merge chain and all
four collectible trees onboard new players; all messages flow through one
board-width wood-sign toast system.

### 10. "What can we do with this information?" — the research, in the game
The student's IB research became gameplay: an ℹ️ **"Why it matters"** page
presents her outcomes (CO₂, biodiversity loss, extinction, soil erosion,
droughts, global warming) and solutions (FSC products, plant a tree yearly,
eat less beef, reuse paper, replant, support indigenous land rights). Every
bulldozed patch teaches one consequence in its toast; while a run is on and
nothing else is being said, the message band between the HUD and the board
cycles through those consequences; every run's result screen sends players
off with one real-world action.

### 11. Mobile-first polish for the exhibition
The gameplay screens track the *visible* viewport (no scrolling, nothing
hidden under browser chrome), the goal + timer pin to the top with toasts in
the open band above the board, controls align to the board's edges, double-tap
zoom is disabled, and the leaderboard drawer covers half the screen with a
scrolling roster and outside-tap dismissal.

### 12. "Deploy so her classmates can play"
Repository published to GitHub (ck467/replant-game) and deployed to Heroku on
a Basic dyno (no sleeping), verified end-to-end on the live URL including
WebSockets and the leaderboard. An `admin` account gates the reset buttons
for booth staff.

### 13. "The data is lost each time" — a real database
Heroku's disk is wiped on every restart, and the dyno restarts daily, so no
leaderboard could survive a night. The world map and the players moved into a
Supabase Postgres table (loaded on boot, written through on every change),
with the last file-based snapshot carried over as a seed so nothing earned was
lost. Resets are now on demand only: the admin gets two buttons, ↺ reset the
world (leaderboard kept) and 🗑️ clear the leaderboard (map kept), each
confirmed with an admin key that the server checks — typing "admin" as a
name is no longer enough to wipe anything. The board itself lists everyone who has restored a patch, 30 per page,
and opens on the player's own row, highlighted and centered, every time it is
shown.

---

## Quality practice

Every feature landed with Playwright end-to-end coverage — **20 tests** at the
time of writing, spanning account creation, the tutorial, merging (tap and
drag), the qualification rule, quit warnings, the message band, leaderboard
paging and drawer behavior, the admin resets, bulldozer destruction, the
dead-world state, and two-browser real-time multiplayer. Testing repeatedly caught real UX bugs before players
did (dead buttons during celebrations, click-stealing overlays, layout
regressions).

## Exhibition-day runbook

1. Nothing to prepare the evening before: the world and leaderboard live in
   the database and survive restarts and deploys.
2. Morning: sign in as **admin** on a staff device → ↺ resets the world
   fresh, and 🗑️ clears the leaderboard if you want a clean race. The first
   reset asks for the admin key (the `ADMIN_KEY` set on Heroku); the device
   remembers it after that.
3. Kids visit the URL, make an account, and race to 4 trees.
4. Balance knobs if needed (`public/js/config.js` / `server.js`):
   `CHALLENGE.GOAL_TREES`, `CHALLENGE.TIME_MS`, `SPAWN_WEIGHTS`,
   `SPREAD_INTERVAL_MS` (currently 90s).

## The message, by design

The game's structure *is* the argument: bulldozers embody greed; the plague
punishes neglect; restoration takes real effort (4 trees, earned); individual
contribution is honored for good (every restorer stays on the board) even
when the world loses ground; and the world itself can die from inaction — or
be revived by a single player who plants again.
