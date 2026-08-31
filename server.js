const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'map-state.json');
const PLAYERS_FILE = process.env.PLAYERS_FILE || path.join(__dirname, 'players.json');

// Authoritative world settings (client gets these with the map payload)
const MAP_COLS = 12;
const MAP_ROWS = 8;
const SPREAD_INTERVAL_MS = 45000;
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

function loadWorld() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Array.isArray(data) && data.length === MAP_COLS * MAP_ROWS) {
      return { grid: data, owners: {} }; // legacy format
    }
    if (data && Array.isArray(data.grid) && data.grid.length === MAP_COLS * MAP_ROWS) {
      return { grid: data.grid, owners: data.owners || {} };
    }
  } catch (e) { /* first boot or corrupt file — regenerate */ }
  return null;
}

let world = loadWorld() || { grid: generateGrid(), owners: {} };

function saveWorld() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(world)); } catch (e) {}
}
saveWorld();

// ---------- Players & leaderboard ----------
// players: { name -> { name, avatar, trees, bestRun: {trees, timeMs} | null } }

function loadPlayers() {
  try {
    const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
    if (players && typeof players === 'object') return players;
  } catch (e) { /* first boot */ }
  return {};
}

let players = loadPlayers();

function savePlayers() {
  try { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players)); } catch (e) {}
}

function getPlayer(name, avatar) {
  if (!players[name]) players[name] = { name, avatar, trees: 0, bestRun: null };
  players[name].avatar = avatar; // latest avatar wins (same-name rejoin)
  return players[name];
}

function rankedPlayers() {
  return Object.values(players).sort((a, b) =>
    b.trees - a.trees || a.name.localeCompare(b.name)
  );
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// A reaches the goal faster, or plants more trees if neither reached it
function runBetter(a, b) {
  if (!b) return true;
  if (a.reached !== b.reached) return a.reached;
  if (a.reached) return a.timeMs < b.timeMs;
  return a.trees > b.trees;
}

// Today's run ranking: goal-reachers by speed, then the rest by tree count
function rankedRunsToday() {
  const day = today();
  return Object.values(players)
    .filter(p => p.bestRun && p.bestRun.day === day)
    .sort((a, b) => runBetter(a.bestRun, b.bestRun) ? -1 : 1);
}

function broadcastLeaderboard() {
  io.emit('leaderboard', rankedPlayers().slice(0, 50));
}

app.get('/api/leaderboard', (req, res) => {
  res.json(rankedPlayers().slice(0, 50));
});

// A finished timed-challenge run: record the player's best FOR TODAY
app.post('/api/challenge/run', (req, res) => {
  const name = cleanName(req.body.name);
  if (!name) return res.status(400).json({ error: 'name required' });
  const avatar = cleanAvatar(req.body.avatar);
  const trees = Math.max(0, Math.min(99, parseInt(req.body.trees, 10) || 0));
  const timeMs = Math.max(0, Math.min(3600000, parseInt(req.body.timeMs, 10) || 0));
  const run = { trees, timeMs, reached: req.body.reached === true, day: today() };
  const player = getPlayer(name, avatar);
  const best = player.bestRun;
  if (!best || best.day !== run.day || runBetter(run, best)) {
    player.bestRun = run;
  }
  savePlayers();
  broadcastLeaderboard();
  const ranked = rankedRunsToday();
  res.json({
    rank: ranked.findIndex(p => p.name === name) + 1,
    total: ranked.length
  });
});

// ---------- World changes ----------

function restorePatch(idx, name, avatar) {
  if (world.grid[idx] === 'g') return false; // already restored
  world.grid[idx] = 'g';
  const owner = { name, avatar };
  world.owners[idx] = owner;
  saveWorld();
  const player = getPlayer(name, avatar);
  player.trees++;
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
  socket.emit('leaderboard', rankedPlayers().slice(0, 10));
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

  socket.on('reset-world', () => {
    world = { grid: generateGrid(), owners: {} };
    saveWorld();
    io.emit('map', { cols: MAP_COLS, rows: MAP_ROWS, grid: world.grid, owners: world.owners });
  });

  socket.on('disconnect', () => {
    io.emit('players', io.engine.clientsCount);
  });
});

server.listen(PORT, () => {
  console.log(`Replant running at http://localhost:${PORT}`);
});
