// Orchestrates screens: intro (account) → world map ↔ puzzles & challenges.

let worldMap = null;
let account = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // Screen changes always tuck the leaderboard drawer away
  document.getElementById('leaderboard').classList.remove('open');
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
  // During play, the toast lives in the open area between the top UI and board
  const inPlay = document.getElementById('puzzle-screen').classList.contains('active');
  el.classList.toggle('over-board', inPlay);
  if (inPlay) {
    const top = document.querySelector('.puzzle-top').getBoundingClientRect();
    const board = document.getElementById('puzzle-board').getBoundingClientRect();
    el.style.top = Math.round((top.bottom + board.top) / 2) + 'px';
  } else {
    el.style.top = '';
  }
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

// A burst of confetti pieces at any screen position (shared celebration VFX)
function confettiAt(x, y) {
  const burst = document.createElement('div');
  burst.className = 'confetti';
  burst.style.left = x + 'px';
  burst.style.top = y + 'px';
  const colors = ['#ff5252', '#ffd93d', '#6bcb77', '#4d96ff', '#ff9f43', '#e878d2'];
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('span');
    const ang = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 55;
    p.style.background = colors[i % colors.length];
    p.style.width = p.style.height = (5 + Math.random() * 5) + 'px';
    p.style.setProperty('--cx', Math.round(Math.cos(ang) * dist) + 'px');
    p.style.setProperty('--cy', Math.round(Math.sin(ang) * dist - 40) + 'px');
    p.style.setProperty('--cr', Math.round(Math.random() * 720 - 360) + 'deg');
    p.style.animationDelay = (Math.random() * 100) + 'ms';
    burst.appendChild(p);
  }
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 1300);
}

// A shower of bursts for the big win
function confettiShower() {
  for (let i = 0; i < 6; i++) {
    setTimeout(() => confettiAt(
      window.innerWidth * (0.15 + Math.random() * 0.7),
      window.innerHeight * (0.12 + Math.random() * 0.4)
    ), i * 160);
  }
}

function showOverlay({ title, body, buttonText, onButton, list, button2Text, onButton2, celebrate }) {
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-body').textContent = body;
  document.querySelector('#result-overlay .overlay-card').classList.toggle('celebrate', !!celebrate);
  if (celebrate) confettiShower();

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

// Two views over the same data: lifetime trees, and today's race to the goal
let boardPlayers = [];
let boardTab = 'trees';

function localToday() {
  return new Date().toISOString().slice(0, 10);
}

function renderLeaderboard(players) {
  if (players) boardPlayers = players;
  const rows = document.getElementById('board-rows');
  const empty = document.getElementById('board-empty');

  let list, statsFor;
  if (boardTab === 'trees') {
    list = boardPlayers.slice(0, 10); // server pre-sorts by lifetime trees
    statsFor = p => `🌳 ${p.trees}`;
    empty.textContent = 'No trees planted yet — be the first!';
  } else {
    const day = localToday();
    list = boardPlayers
      .filter(p => p.bestRun && p.bestRun.day === day)
      .sort((a, b) => {
        const x = a.bestRun, y = b.bestRun;
        if (x.reached !== y.reached) return x.reached ? -1 : 1;
        if (x.reached) return x.timeMs - y.timeMs;
        return y.trees - x.trees;
      })
      .slice(0, 10);
    statsFor = p => p.bestRun.reached
      ? `⏱️ ${formatRunTime(p.bestRun.timeMs)}`
      : `🌳 ${Math.min(p.bestRun.trees, CONFIG.CHALLENGE.GOAL_TREES)}/${CONFIG.CHALLENGE.GOAL_TREES}`;
    empty.textContent = `No runs today — race to ${CONFIG.CHALLENGE.GOAL_TREES} trees!`;
  }

  empty.hidden = list.length > 0;
  rows.replaceChildren(...list.map(p => {
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
    stats.textContent = statsFor(p);

    li.append(avatar, name, stats);
    return li;
  }));
}

function setBoardTab(tab) {
  boardTab = tab;
  document.getElementById('tab-trees').classList.toggle('active', tab === 'trees');
  document.getElementById('tab-runs').classList.toggle('active', tab === 'runs');
  renderLeaderboard();
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
  document.getElementById('tab-trees').addEventListener('click', () => setBoardTab('trees'));
  document.getElementById('tab-runs').addEventListener('click', () => setBoardTab('runs'));
  // Tapping anywhere outside the open drawer dismisses it
  document.addEventListener('pointerdown', e => {
    const drawer = document.getElementById('leaderboard');
    if (drawer.classList.contains('open') &&
        !e.target.closest('#leaderboard') && !e.target.closest('#board-toggle')) {
      drawer.classList.remove('open');
    }
  }, true);

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('Start the world over for EVERYONE playing?')) worldMap.reset();
  });

  startAmbient();
}

document.addEventListener('DOMContentLoaded', init);
