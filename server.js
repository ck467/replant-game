const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'map-state.json');
const PLAYERS_FILE = process.env.PLAYERS_FILE || path.join(__dirname, 'players.json');
const SEED_DIR = path.join(__dirname, 'seed');
// Booth-staff resets must carry this key; with it unset they are disabled
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// Authoritative world settings (client gets these with the map payload)
// The world starts as every land tile of the client's 32x18 scene…
const START_COLS = 31;
const START_ROWS = 16;
// …and GROWS: whenever the land is EXPAND_AT_PCT green, a ring of new land
// (mostly barren, with wild green pockets) appears around it, up to
// MAX_EXPANSIONS rings (31x16 → 51x36).
const EXPAND_AT_PCT = process.env.EXPAND_AT_PCT !== undefined
  ? parseFloat(process.env.EXPAND_AT_PCT) : 60;
const MAX_EXPANSIONS = 10;
const NEW_LAND_GREEN_PCT = 22;
const SPREAD_INTERVAL_MS = 90000; // rebalanced: a run now restores ONE patch
// The plague only ever eats WILD green — a patch a planter restored is
// theirs for good — and it halts once the world is this green or less, so
// it can never be eaten to nothing while the booth is busy
const PLAGUE_FLOOR_PCT = process.env.PLAGUE_FLOOR_PCT !== undefined
  ? parseFloat(process.env.PLAGUE_FLOOR_PCT) : 15;
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
  // TLS with certificate verification. Supabase signs its pooler with its
  // own root CA, bundled in certs/ (public; expires 2031). Any extra CA can
  // be pointed to with DATABASE_CA_FILE; DATABASE_SSL=no-verify is the last
  // resort (still encrypted, unverified).
  const caFile = process.env.DATABASE_CA_FILE || path.join(__dirname, 'certs', 'supabase-prod-ca-2021.crt');
  const ssl = { rejectUnauthorized: process.env.DATABASE_SSL !== 'no-verify' };
  if (fs.existsSync(caFile)) ssl.ca = fs.readFileSync(caFile, 'utf8');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 3 });
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

// Half green (left), half barren (right), with a ragged frontier
function generateGrid(cols, rows) {
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const frontier = Math.floor(cols / 2) + (Math.floor(Math.random() * 5) - 2);
    for (let c = 0; c < cols; c++) {
      grid.push(c < frontier ? 'g' : 'b');
    }
  }
  return grid;
}

// world: { cols, rows, grid: ['g'|'b'...], owners: {idx -> {name, avatar}},
//          expansions: rings of land added so far }
function freshWorld() {
  return {
    cols: START_COLS,
    rows: START_ROWS,
    grid: generateGrid(START_COLS, START_ROWS),
    owners: {},
    expansions: 0
  };
}

function validWorld(data) {
  if (!data || !Array.isArray(data.grid)) return null;
  const cols = data.cols || START_COLS;
  const rows = data.rows || START_ROWS;
  if (data.grid.length !== cols * rows) return null; // corrupt or an older layout — regenerate
  return { cols, rows, grid: data.grid, owners: data.owners || {}, expansions: data.expansions || 0 };
}

function mapPayload(extra = {}) {
  return {
    cols: world.cols,
    rows: world.rows,
    grid: world.grid,
    owners: world.owners,
    expandAt: EXPAND_AT_PCT,
    maxed: world.expansions >= MAX_EXPANSIONS,
    ...extra
  };
}

// Wild green in the new land comes in 2x2 clumps, not salt-and-pepper
function wildPocket(c, r, seed) {
  return (Math.imul((c >> 1) * 97 + (r >> 1) * 193 + seed, 2654435761) >>> 0) % 100 < NEW_LAND_GREEN_PCT;
}

// Once the land is green enough, a ring of new land appears around it. The
// old world shifts one tile right and down inside the bigger grid; every
// planter's patch and sign comes along.
function maybeExpand() {
  if (world.expansions >= MAX_EXPANSIONS || greenPct() < EXPAND_AT_PCT) return false;
  const oc = world.cols, or = world.rows;
  const nc = oc + 2, nr = or + 2;
  const grid = new Array(nc * nr).fill('b');
  const owners = {};
  const seed = Math.floor(Math.random() * 1e6);
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const i = r * nc + c;
      const inner = c >= 1 && c <= oc && r >= 1 && r <= or;
      if (inner) {
        const oi = (r - 1) * oc + (c - 1);
        grid[i] = world.grid[oi];
        if (world.owners[oi]) owners[i] = world.owners[oi];
      } else if (wildPocket(c, r, seed)) {
        grid[i] = 'g';
      }
    }
  }
  world = { cols: nc, rows: nr, grid, owners, expansions: world.expansions + 1 };
  saveWorld();
  io.emit('map', mapPayload({ grew: true }));
  return true;
}

function greenPct() {
  return world.grid.filter(v => v === 'g').length / world.grid.length * 100;
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
  maybeExpand(); // enough green? the world grows a ring
  return true;
}

function neighbors(idx) {
  const { cols, rows } = world;
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  const out = [];
  if (r > 0) out.push(idx - cols);
  if (r < rows - 1) out.push(idx + cols);
  if (c > 0) out.push(idx - 1);
  if (c < cols - 1) out.push(idx + 1);
  return out;
}

// One tick of the plague: a random WILD green patch on the frontier turns
// barren. A patch with a planter's sign on it is never touched, and nothing
// happens at all once the world is at or below the green floor.
function spread() {
  if (greenPct() <= PLAGUE_FLOOR_PCT) return;
  const frontier = [];
  world.grid.forEach((v, i) => {
    if (v !== 'g' || world.owners[i]) return;
    if (neighbors(i).some(n => world.grid[n] === 'b')) frontier.push(i);
  });
  if (frontier.length === 0) return;
  const victim = frontier[Math.floor(Math.random() * frontier.length)];
  world.grid[victim] = 'b';
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
    world = { ...world, grid: world.grid.map(() => 'b'), owners: {} };
    saveWorld();
    io.emit('map', mapPayload());
    res.sendStatus(204);
  });
  // Greens the first `count` barren patches as WILD forest (no planter)
  app.post('/debug/wild', (req, res) => {
    let left = parseInt(req.body.count, 10) || 0;
    world.grid = world.grid.map(v => (v === 'b' && left-- > 0) ? 'g' : v);
    saveWorld();
    io.emit('map', mapPayload());
    res.sendStatus(204);
  });
  app.post('/debug/reset', (req, res) => {
    world = freshWorld();
    saveWorld();
    players = {};
    savePlayers();
    io.emit('map', mapPayload());
    broadcastLeaderboard();
    res.sendStatus(204);
  });
}

// ---------- Sockets ----------

io.on('connection', (socket) => {
  socket.emit('map', mapPayload());
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

  // Booth staff controls, each authorized by ADMIN_KEY: a fresh map keeps
  // the leaderboard, and a cleared leaderboard keeps the map. The client
  // gets an ack so it can say "wrong key" instead of silently doing nothing.
  const authorizeAdmin = (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!ADMIN_KEY) { reply({ ok: false, error: 'disabled' }); return null; }
    if (!payload || typeof payload.key !== 'string' || payload.key !== ADMIN_KEY) {
      reply({ ok: false, error: 'wrong-key' });
      return null;
    }
    return reply;
  };

  socket.on('reset-world', (payload, ack) => {
    const done = authorizeAdmin(payload, ack);
    if (!done) return;
    world = freshWorld();
    saveWorld();
    io.emit('map', mapPayload());
    done({ ok: true });
  });

  socket.on('reset-leaderboard', (payload, ack) => {
    const done = authorizeAdmin(payload, ack);
    if (!done) return;
    players = {};
    savePlayers();
    broadcastLeaderboard();
    done({ ok: true });
  });

  socket.on('disconnect', () => {
    io.emit('players', io.engine.clientsCount);
  });
});

async function boot() {
  if (!ADMIN_KEY) console.warn('ADMIN_KEY not set — the admin reset buttons will be refused');
  await initStorage();
  world = validWorld(await loadState('world', STATE_FILE, path.join(SEED_DIR, 'map-state.json')))
    || freshWorld();
  saveWorld();
  players = validPlayers(await loadState('players', PLAYERS_FILE, path.join(SEED_DIR, 'players.json')));
  savePlayers();
  server.listen(PORT, () => {
    console.log(`Replant running at http://localhost:${PORT} (${pool ? 'database' : 'file'} storage)`);
  });
}

boot().catch(e => { console.error('failed to start:', e); process.exit(1); });
