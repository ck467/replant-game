// Orchestrates screens: intro (account) → world map ↔ puzzles & challenges.

let worldMap = null;
let account = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // Screen changes always tuck the leaderboard drawer away
  document.getElementById('leaderboard').classList.remove('open');
  // On desktop the board is pinned to the map: coming back re-centers the player
  if (id === 'map-screen') focusLeaderboard();
}

// How far the world is from growing its next ring of land
function expansionHint() {
  if (worldMap.maxed) return '🌍 The forest has grown as far as it can!';
  const total = worldMap.grid.length;
  const green = worldMap.grid.filter(v => v === 'g').length;
  const need = Math.max(0, Math.ceil(total * worldMap.expandAt / 100) - green);
  return need > 0
    ? `🌱 ${need} more green ${need === 1 ? 'patch' : 'patches'} and the forest grows!`
    : '🌱 The forest is about to grow!';
}

function updateHud() {
  const pct = worldMap.greenPct();
  document.getElementById('green-pct').textContent = pct + '%';
  document.getElementById('green-bar-fill').style.width = pct + '%';
  // The world grows when it's green enough: show how close everyone is
  document.getElementById('expand-hint').textContent = expansionHint();
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

// Every message — tutorial, tree progress, a patch lost to the plague —
// goes through here. During play it sits in the open band between the
// HUD and the board; on the map it floats near the lower third.
function toast(text, ms = 2500, { fact = false } = {}) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.toggle('fact', fact);
  const inPlay = document.getElementById('puzzle-screen').classList.contains('active');
  el.classList.toggle('over-board', inPlay);
  el.classList.remove('compact');
  if (inPlay) {
    const top = document.querySelector('.puzzle-top').getBoundingClientRect();
    const board = document.getElementById('puzzle-board').getBoundingClientRect();
    el.style.width = Math.round(board.width) + 'px'; // a sign as wide as the plot
    // A long message on a short band shrinks rather than covering the board
    if (el.offsetHeight > board.top - top.bottom - 6) el.classList.add('compact');
    el.style.top = Math.round((top.bottom + board.top) / 2) + 'px';
  } else {
    el.style.top = '';
    el.style.width = '';
  }
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.classList.remove('show');
    factTicker.schedule(1200); // the band goes back to cycling facts
  }, ms);
}

// While a run is on and no message is showing, the band cycles through
// the research: what deforestation does to the world.
const factTicker = {
  running: false,
  timer: null,
  order: [],
  pos: 0,
  start() {
    this.running = true;
    this.order = CONFIG.IMPACTS.map((_, i) => i).sort(() => Math.random() - 0.5);
    this.pos = 0;
    this.schedule(1500);
  },
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    const el = document.getElementById('toast');
    if (el.classList.contains('fact')) el.classList.remove('show', 'fact');
  },
  schedule(ms) {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), ms);
  },
  next() {
    const el = document.getElementById('toast');
    if (!this.running) return;
    if (el.classList.contains('show') && !el.classList.contains('fact')) return; // a real message is up
    const impact = CONFIG.IMPACTS[this.order[this.pos++ % this.order.length]];
    toast(`🌍 When forests are cut down, ${impact}.`, 5000, { fact: true });
  }
};

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

// input: {placeholder, value} adds a text field; its value is passed to onButton2
function showOverlay({ title, body, buttonText, onButton, list, button2Text, onButton2, celebrate, input }) {
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-body').textContent = body;
  document.querySelector('#result-overlay .overlay-card').classList.toggle('celebrate', !!celebrate);
  if (celebrate) confettiShower();

  const field = document.getElementById('overlay-input');
  field.hidden = !input;
  if (input) {
    field.placeholder = input.placeholder || '';
    field.value = input.value || '';
  }

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
    btn2.onclick = () => { hide(); onButton2(field.value.trim()); };
  }
  field.onkeydown = e => { if (e.key === 'Enter' && button2Text) btn2.click(); };

  document.getElementById('result-overlay').classList.add('show');
  if (input) setTimeout(() => field.focus(), 50);
}

// ----- Leaderboard panel (always on for desktop, drawer on small screens) -----

function formatRunTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Players who have restored a patch: the server pre-sorts by patches, then
// by fastest goal time. The full board arrives; the panel pages through it,
// and whenever it is shown it opens on the player's own page with their
// row centered.
const BOARD_PAGE_SIZE = 30;
let boardPlayers = [];
let boardPage = 0;
let boardFollowMe = true; // stick to the player's page until they page by hand

function renderLeaderboard(players) {
  if (players) boardPlayers = players;
  const rows = document.getElementById('board-rows');
  const empty = document.getElementById('board-empty');
  const pages = Math.max(1, Math.ceil(boardPlayers.length / BOARD_PAGE_SIZE));
  const myIdx = account ? boardPlayers.findIndex(p => p.name === account.name) : -1;
  if (boardFollowMe && myIdx >= 0) boardPage = Math.floor(myIdx / BOARD_PAGE_SIZE);
  boardPage = Math.max(0, Math.min(boardPage, pages - 1));
  const start = boardPage * BOARD_PAGE_SIZE;
  const list = boardPlayers.slice(start, start + BOARD_PAGE_SIZE);
  rows.style.counterReset = `rank ${start}`; // ranks continue across pages
  const statsFor = p => `🌍 ${p.patches}` +
    (p.bestTimeMs != null ? ` · ⏱️ ${formatRunTime(p.bestTimeMs)}` : '');

  const pager = document.getElementById('board-pager');
  pager.hidden = pages <= 1;
  document.getElementById('board-page-label').textContent = `${boardPage + 1} / ${pages}`;
  document.getElementById('board-prev').disabled = boardPage === 0;
  document.getElementById('board-next').disabled = boardPage >= pages - 1;

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
  centerMyRow();
}

// Scroll the list so the player's own row sits in the middle of the panel
function centerMyRow() {
  const rows = document.getElementById('board-rows');
  const me = rows.querySelector('.board-row.me');
  if (!me || !rows.clientHeight) return;
  rows.scrollTop = (me.offsetTop - rows.offsetTop) - (rows.clientHeight - me.offsetHeight) / 2;
}

// Every time the board is shown it jumps back to the player's page
function focusLeaderboard() {
  boardFollowMe = true;
  renderLeaderboard();
}

function showLeaderboard() {
  focusLeaderboard();
  document.getElementById('leaderboard').classList.add('open');
}

function turnBoardPage(delta) {
  boardFollowMe = false;
  boardPage += delta;
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
    // Locked meadow around the map: tell them what opens it
    onLockedClick: () => toast(`🔒 This land is locked. ${expansionHint()}`, 3500),
    // Every destroyed patch teaches a real consequence
    onSpread: () => {
      const impact = CONFIG.IMPACTS[Math.floor(Math.random() * CONFIG.IMPACTS.length)];
      toast(`🪓 Deforestation spread — ${impact}!`);
    },
    onChange: () => updateHud(),
    // Everyone's restoring paid off: new land appeared around the edges
    onGrow: () => {
      toast('🌍 The forest grows! New land has appeared around the edges — go explore!', 4500);
      confettiShower();
    }
  });

  socket.on('leaderboard', renderLeaderboard);

  setupIntro(() => {
    // Only the booth admin sees the reset buttons
    const isAdmin = account.name.toLowerCase() === 'admin';
    document.getElementById('reset-btn').hidden = !isAdmin;
    document.getElementById('reset-board-btn').hidden = !isAdmin;
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
    const drawer = document.getElementById('leaderboard');
    if (drawer.classList.contains('open')) drawer.classList.remove('open');
    else showLeaderboard();
  });
  document.getElementById('board-prev').addEventListener('click', () => turnBoardPage(-1));
  document.getElementById('board-next').addEventListener('click', () => turnBoardPage(1));
  // Tapping anywhere outside the open drawer dismisses it
  document.addEventListener('pointerdown', e => {
    const drawer = document.getElementById('leaderboard');
    if (drawer.classList.contains('open') &&
        !e.target.closest('#leaderboard') && !e.target.closest('#board-toggle')) {
      drawer.classList.remove('open');
    }
  }, true);

  // Booth staff: two separate resets, each confirmed with the admin key
  // (remembered on the device once the server accepts it), each leaving
  // the other alone
  const ADMIN_KEY_STORE = 'replant_admin_key_v1';
  const loadAdminKey = () => { try { return localStorage.getItem(ADMIN_KEY_STORE) || ''; } catch (e) { return ''; } };
  const saveAdminKey = k => { try { localStorage.setItem(ADMIN_KEY_STORE, k); } catch (e) {} };
  const onAdminReply = (key, doneMsg) => res => {
    if (res && res.ok) { saveAdminKey(key); toast(doneMsg); }
    else if (res && res.error === 'wrong-key') toast('🔒 Wrong admin key');
    else toast('🔒 Resets are switched off on this server');
  };
  const adminConfirm = ({ title, body, action, send }) => showOverlay({
    title, body,
    input: { placeholder: 'Admin key', value: loadAdminKey() },
    buttonText: 'Cancel',
    onButton: () => {},
    button2Text: action,
    onButton2: key => send(key)
  });
  document.getElementById('reset-btn').addEventListener('click', () => adminConfirm({
    title: '↺ Reset the world?',
    body: 'A fresh map for EVERYONE playing — every restored patch is gone. The leaderboard is kept.',
    action: '↺ Reset the world',
    send: key => worldMap.reset(key, onAdminReply(key, '🗺️ The world starts over'))
  }));
  document.getElementById('reset-board-btn').addEventListener('click', () => adminConfirm({
    title: '🗑️ Clear the leaderboard?',
    body: "Every player's patches and times are erased for EVERYONE. The world map is kept.",
    action: '🗑️ Clear it',
    send: key => socket.emit('reset-leaderboard', { key }, onAdminReply(key, '🏆 Leaderboard cleared'))
  }));

  startAmbient();
}

document.addEventListener('DOMContentLoaded', init);
