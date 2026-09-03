const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'map-state.json');
const PLAYERS_FILE = process.env.PLAYERS_FILE || path.join(__dirname, 'players.json');
const SEED_DIR = path.join(__dirname, 'seed');

// Authoritative world settings (client gets these with the map payload)
const MAP_COLS = 12;
const MAP_ROWS = 8;
const SPREAD_INTERVAL_MS = 90000; // rebalanced: a run now restores ONE patch
const AVATAR_COUNT = 20;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---------- Identity ----------
// A "temp account" is a display name plus a crop-portrait avatar index.

function cleanName(raw) {
  return String(raw || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 20);
}

function cleanAvatar(raw) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n < AVATAR_COUNT ? n : 0;
}

// ---------- Storage ----------
// With DATABASE_URL set (Supabase Postgres on Heroku) the world and the
// players survive restarts and deploys. Without it (local dev, tests) they
// live in JSON files next to the server, which Heroku wipes on every restart.

let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // TLS with certificate verification. If the host's certificate can't be
    // verified from the dyno, set DATABASE_SSL=no-verify (still encrypted).
    ssl: { rejectUnauthorized: process.env.DATABASE_SSL !== 'no-verify' },
    max: 3
  });
  pool.on('error', e => console.error('db pool error:', e.message));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// Writes are fire-and-forget but serialized per key, so the latest state
// always lands last.
const writeQueue = {};
function persist(key, file, value) {
  if (!pool) {
    try { fs.writeFileSync(file, JSON.stringify(value)); } catch (e) {}
    return;
  }
  const json = JSON.stringify(value);
  writeQueue[key] = (writeQueue[key] || Promise.resolve())
    .then(() => pool.query(
      'INSERT INTO game_state (key, value) VALUES ($1, $2::jsonb) ' +
      'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
      [key, json]
    ))
    .catch(e => console.error(`db: saving ${key} failed:`, e.message));
}

async function loadState(key, file, seedFile) {
  if (!pool) return readJson(file) ?? readJson(seedFile);
  const r = await pool.query('SELECT value FROM game_state WHERE key = $1', [key]);
  if (r.rows.length) return r.rows[0].value;
  // First boot against an empty database: carry over the snapshot taken
  // from the old file-based server so nothing already earned is lost.
  const seed = readJson(seedFile);
  if (seed) console.log(`db: no ${key} yet — seeding from ${path.basename(seedFile)}`);
  return seed;
}

async function initStorage() {
  if (!pool) return;
  try {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS game_state (' +
      'key text PRIMARY KEY, value jsonb NOT NULL, ' +
      'updated_at timestamptz NOT NULL DEFAULT now())'
    );
    // A free Supabase project pauses after a week without traffic
    setInterval(() => pool.query('SELECT 1').catch(() => {}), 6 * 60 * 60 * 1000);
    console.log('db: connected');
  } catch (e) {
    // Keep the game up on an unreachable database — but nothing will
    // persist until the next restart finds it again.
    console.error('db: unreachable, falling back to files:', e.message);
    pool = null;
  }
}

// ---------- Shared world state ----------

function generateGrid() {
  const grid = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    const frontier = Math.floor(MAP_COLS / 2) + (Math.floor(Math.random() * 5) - 2);
    for (let c = 0; c < MAP_COLS; c++) {
      grid.push(c < frontier ? 'g' : 'b');
    }
  }
  return grid;
}

function validWorld(data) {
  if (Array.isArray(data) && data.length === MAP_COLS * MAP_ROWS) {
    return { grid: data, owners: {} }; // legacy format
  }
  if (data && Array.isArray(data.grid) && data.grid.length === MAP_COLS * MAP_ROWS) {
    return { grid: data.grid, owners: data.owners || {} };
  }
  return null; // first boot or corrupt — regenerate
}

let world = null; // set in boot()

function saveWorld() {
  persist('world', STATE_FILE, world);
}

// ---------- Players & leaderboard ----------
// players: { name -> { name, avatar, trees, patches, bestTimeMs | null } }
// The board lists only players who have restored a patch, most patches first,
// fastest goal time breaking ties.

function validPlayers(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  Object.values(data).forEach(p => { // older saves predate patch counts
    p.patches = p.patches || 0;
    if (p.bestTimeMs === undefined) p.bestTimeMs = null;
  });
  return data;
}

let players = {}; // set in boot()

function savePlayers() {
  persist('players', PLAYERS_FILE, players);
}

function getPlayer(name, avatar) {
  if (!players[name]) players[name] = { name, avatar, trees: 0, patches: 0, bestTimeMs: null };
  players[name].avatar = avatar; // latest avatar wins (same-name rejoin)
  return players[name];
}

function rankedPlayers() {
  return Object.values(players)
    .filter(p => p.patches > 0)
    .sort((a, b) =>
      b.patches - a.patches ||
      (a.bestTimeMs ?? Infinity) - (b.bestTimeMs ?? Infinity) ||
      a.name.localeCompare(b.name)
    );
}

// The whole board goes out: the client pages through it
function broadcastLeaderboard() {
  io.emit('leaderboard', rankedPlayers());
}

app.get('/api/leaderboard', (req, res) => {
  res.json(rankedPlayers());
});

// A finished timed-challenge run: remember the player's fastest goal time
app.post('/api/challenge/run', (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'name required' });
  const avatar = cleanAvatar(req.body.avatar);
  const trees = Math.max(0, Math.min(99, parseInt(req.body.trees, 10) || 0));
  const timeMs = Math.max(0, Math.min(3600000, parseInt(req.body.timeMs, 10) || 0));
  const player = getPlayer(name, avatar);
  player.trees += trees;
  if (req.body.reached === true && (player.bestTimeMs === null || timeMs < player.bestTimeMs)) {
    player.bestTimeMs = timeMs;
  }
  savePlayers();
  broadcastLeaderboard();
  const ranked = rankedPlayers();
  res.json({
    rank: ranked.findIndex(p => p.name === name) + 1, // 0 = not on the board
    total: ranked.length
  });
});

// ---------- World changes ----------

// Greens a patch in the player's name. Lifetime tree counts come from
// finished runs (the /api/challenge/run POST), not from map changes.
function restorePatch(idx, name, avatar) {
  if (world.grid[idx] === 'g') return false; // already restored
  world.grid[idx] = 'g';
  const owner = { name, avatar };
  world.owners[idx] = owner;
  saveWorld();
  getPlayer(name, avatar).patches++;
  savePlayers();
  io.emit('patch', { idx, state: 'g', cause: 'restore', owner });
  broadcastLeaderboard();
  return true;
}

function neighbors(idx) {
  const r = Math.floor(idx / MAP_COLS);
  const c = idx % MAP_COLS;
  const out = [];
  if (r > 0) out.push(idx - MAP_COLS);
  if (r < MAP_ROWS - 1) out.push(idx + MAP_COLS);
  if (c > 0) out.push(idx - 1);
  if (c < MAP_COLS - 1) out.push(idx + 1);
  return out;
}

// One tick of the plague: a random green patch on the frontier turns barren.
function spread() {
  const frontier = [];
  world.grid.forEach((v, i) => {
    if (v === 'g' && neighbors(i).some(n => world.grid[n] === 'b')) frontier.push(i);
  });
  if (frontier.length === 0) return;
  const victim = frontier[Math.floor(Math.random() * frontier.length)];
  world.grid[victim] = 'b';
  delete world.owners[victim];
  saveWorld();
  io.emit('patch', { idx: victim, state: 'b', cause: 'spread' });
}

if (!process.env.SPREAD_DISABLED) {
  // The plague only advances while someone is playing — otherwise an idle
  // server quietly deforests the whole world overnight.
  setInterval(() => {
    if (io.engine.clientsCount > 0) spread();
  }, SPREAD_INTERVAL_MS);
}

// Test-only hooks so e2e tests can control the world deterministically.
if (process.env.TEST_MODE) {
  app.post('/debug/spread', (req, res) => { spread(); res.sendStatus(204); });
  app.post('/debug/kill', (req, res) => {
    world = { grid: world.grid.map(() => 'b'), owners: {} };
    saveWorld();
    io.emit('map', { cols: MAP_COLS, rows: MAP_ROWS, grid: world.grid, owners: world.owners });
    res.sendStatus(204);
  });
  app.post('/debug/reset', (req, res) => {
    world = { grid: generateGrid(), owners: {} };
    saveWorld();
    players = {};
    savePlayers();
    io.emit('map', { cols: MAP_COLS, rows: MAP_ROWS, grid: world.grid, owners: world.owners });
    broadcastLeaderboard();
    res.sendStatus(204);
  });
}

// ---------- Sockets ----------

io.on('connection', (socket) => {
  socket.emit('map', { cols: MAP_COLS, rows: MAP_ROWS, grid: world.grid, owners: world.owners });
  socket.emit('leaderboard', rankedPlayers());
  io.emit('players', io.engine.clientsCount);

  // A won patch puzzle restores the chosen patch in the player's name
  socket.on('restore', ({ idx, name, avatar }) => {
    const who = cleanName(name);
    if (!who) return;
    if (!Number.isInteger(idx) || idx < 0 || idx >= world.grid.length) return;
    restorePatch(idx, who, cleanAvatar(avatar));
  });

  // A challenge-run tree greens a random barren patch in the player's name
  socket.on('challenge-tree', ({ name, avatar }) => {
    const who = cleanName(name);
    if (!who) return;
    const barren = [];
    world.grid.forEach((v, i) => { if (v === 'b') barren.push(i); });
    if (barren.length === 0) return;
    restorePatch(barren[Math.floor(Math.random() * barren.length)], who, cleanAvatar(avatar));
  });

  // Booth staff controls: a fresh map keeps the leaderboard, and a cleared
  // leaderboard keeps the map
  socket.on('reset-world', () => {
    world = { grid: generateGrid(), owners: {} };
    saveWorld();
    io.emit('map', { cols: MAP_COLS, rows: MAP_ROWS, grid: world.grid, owners: world.owners });
  });

  socket.on('reset-leaderboard', () => {
    players = {};
    savePlayers();
    broadcastLeaderboard();
  });

  socket.on('disconnect', () => {
    io.emit('players', io.engine.clientsCount);
  });
});

async function boot() {
  await initStorage();
  world = validWorld(await loadState('world', STATE_FILE, path.join(SEED_DIR, 'map-state.json')))
    || { grid: generateGrid(), owners: {} };
  saveWorld();
  players = validPlayers(await loadState('players', PLAYERS_FILE, path.join(SEED_DIR, 'players.json')));
  savePlayers();
  server.listen(PORT, () => {
    console.log(`Replant running at http://localhost:${PORT} (${pool ? 'database' : 'file'} storage)`);
  });
}

boot().catch(e => { console.error('failed to start:', e); process.exit(1); });
