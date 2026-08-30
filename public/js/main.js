// Orchestrates screens: intro (account) → world map ↔ puzzles & challenges.

let worldMap = null;
let account = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function updateHud() {
  const pct = worldMap.greenPct();
  document.getElementById('green-pct').textContent = pct + '%';
  document.getElementById('green-bar-fill').style.width = pct + '%';
  const status = document.getElementById('map-status');
  if (pct >= CONFIG.RESTORE_GOAL_PCT) {
    status.textContent = '🎉 Balance restored! The forest is thriving again.';
    status.className = 'map-status good';
  } else if (pct === 0) {
    status.textContent = '💀 The forest is gone. Tap a grey dead tree to bring it back!';
    status.className = 'map-status bad';
  } else if (pct <= 25) {
    status.textContent = '⚠️ The forest is almost gone. Plant faster!';
    status.className = 'map-status bad';
  } else {
    status.textContent = 'Deforestation is spreading. Tap a grey dead tree to restore it!';
    status.className = 'map-status';
  }
}

function toast(text, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = text;
  // During play, the toast sits at the bottom end of the game board
  const inPlay = document.getElementById('puzzle-screen').classList.contains('active');
  el.classList.toggle('over-board', inPlay);
  if (inPlay) {
    const board = document.getElementById('puzzle-board').getBoundingClientRect();
    el.style.top = (board.bottom - 10) + 'px'; // bottom edge tucks into the board
  } else {
    el.style.top = '';
  }
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

function showOverlay({ title, body, buttonText, onButton, list, button2Text, onButton2 }) {
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-body').textContent = body;

  const board = document.getElementById('overlay-board');
  board.hidden = !list || list.length === 0;
  board.replaceChildren(...(list || []).map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));

  const hide = () => document.getElementById('result-overlay').classList.remove('show');
  const btn = document.getElementById('overlay-btn');
  btn.textContent = buttonText;
  btn.onclick = () => { hide(); onButton(); };

  const btn2 = document.getElementById('overlay-btn2');
  btn2.hidden = !button2Text;
  if (button2Text) {
    btn2.textContent = button2Text;
    btn2.onclick = () => { hide(); onButton2(); };
  }

  document.getElementById('result-overlay').classList.add('show');
}

// ----- Leaderboard panel (always on for desktop, drawer on small screens) -----

function formatRunTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderLeaderboard(top) {
  const rows = document.getElementById('board-rows');
  document.getElementById('board-empty').hidden = top.length > 0;
  rows.replaceChildren(...top.map(p => {
    const li = document.createElement('li');
    li.className = 'board-row' + (account && p.name === account.name ? ' me' : '');

    const avatar = document.createElement('span');
    avatar.className = 'avatar-sprite';
    paintAvatar(avatar, p.avatar);

    const name = document.createElement('span');
    name.className = 'board-name';
    name.textContent = p.name;

    const stats = document.createElement('span');
    stats.className = 'board-stats';
    stats.textContent = `🌳 ${p.trees}` +
      (p.bestRun ? ` · ⏱️ ${p.bestRun.trees}/${formatRunTime(p.bestRun.timeMs)}` : '');

    li.append(avatar, name, stats);
    return li;
  }));
}

// ----- Account entry -----

function setupIntro(onReady) {
  const entry = document.getElementById('account-entry');
  const welcome = document.getElementById('welcome-back');
  let draftAvatar = randomAvatar();

  const showEntry = () => {
    account = null;
    entry.hidden = false;
    welcome.hidden = true;
    paintAvatar(document.getElementById('avatar-preview'), draftAvatar);
    document.getElementById('player-name').focus();
  };

  const showWelcome = (acc) => {
    entry.hidden = true;
    welcome.hidden = false;
    paintAvatar(document.getElementById('welcome-avatar'), acc.avatar);
    document.getElementById('welcome-msg').textContent = `Welcome back, ${acc.name}!`;
  };

  document.getElementById('avatar-reroll').addEventListener('click', () => {
    draftAvatar = randomAvatar();
    paintAvatar(document.getElementById('avatar-preview'), draftAvatar);
  });

  const begin = () => {
    const name = document.getElementById('player-name').value.trim();
    if (!name) { document.getElementById('player-name').focus(); return; }
    account = { name, avatar: draftAvatar };
    saveAccount(account);
    onReady();
  };
  document.getElementById('start-btn').addEventListener('click', begin);
  document.getElementById('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') begin();
  });

  document.getElementById('resume-btn').addEventListener('click', () => onReady());
  document.getElementById('switch-btn').addEventListener('click', () => {
    clearAccount();
    draftAvatar = randomAvatar();
    document.getElementById('player-name').value = '';
    showEntry();
  });

  const saved = loadAccount();
  if (saved) { account = saved; showWelcome(saved); }
  else showEntry();
}

function init() {
  const socket = io();
  window.__socket = socket; // test hook

  worldMap = new WorldMap(socket, {
    onPatchClick: idx => challenge.start(idx),
    // Every destroyed patch teaches a real consequence
    onSpread: () => {
      const impact = CONFIG.IMPACTS[Math.floor(Math.random() * CONFIG.IMPACTS.length)];
      toast(`🪓 Deforestation spread — ${impact}!`);
    },
    onChange: () => updateHud()
  });

  socket.on('leaderboard', renderLeaderboard);

  setupIntro(() => {
    // Only the booth admin sees the world-reset button
    document.getElementById('reset-btn').hidden = account.name.toLowerCase() !== 'admin';
    showScreen('map-screen');
    updateHud();
  });

  const challenge = new Challenge(socket, {
    showOverlay, showScreen, toast,
    getAccount: () => account,
    isPatchBarren: idx => worldMap.grid[idx] === 'b'
  });

  document.getElementById('info-btn').addEventListener('click', () => {
    document.getElementById('info-overlay').classList.add('show');
  });
  document.getElementById('info-close').addEventListener('click', () => {
    document.getElementById('info-overlay').classList.remove('show');
  });

  document.getElementById('board-toggle').addEventListener('click', () => {
    document.getElementById('leaderboard').classList.toggle('open');
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('Start the world over for EVERYONE playing?')) worldMap.reset();
  });

  startAmbient();
}

document.addEventListener('DOMContentLoaded', init);
