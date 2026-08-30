// World map: a socket-driven view of the shared world.
// The server owns the grid; this class renders it and forwards actions.
//
// The screen is a 20x11 decorative tile scene (grass, river, fence, decor)
// with the playable 12x8 patch grid embedded at PLAY_COL/PLAY_ROW.

// The world is a fixed, expansive scene — bigger than most viewports —
// that the player pans around. Tiles are a fixed 64px (4x pixel scale).
const SCENE = {
  COLS: 32,
  ROWS: 18,
  TILE: 64,
  PLAY_COL: 10,  // 12x8 play grid at cols 10-21, rows 4-11
  PLAY_ROW: 4,
  RIVER_COL: 26, // straight channel down into the bottom river
  RIVER_ROW: 16,
  FENCE_ROW: 17,
  HB: 'assets/blind_hummingbird_spritesheet_16x16.png',    // 8x4 sheet
  DECOR: 'assets/forest_decoration_set_16x16.png'          // 8x4 sheet
};

// Hand-placed critters and set pieces [sheet, col, row]
// (the hummingbird is alive now — it flies by, spawned by ambient.js)
const SET_PIECES = {
  '15,1': [SCENE.HB, 2, 0],    // pink flower pair
  '6,14': [SCENE.DECOR, 0, 2], // crystal
  '24,2': [SCENE.DECOR, 2, 0], // fallen log
  '3,3': [SCENE.DECOR, 0, 2],  // crystal in the far meadow
  '29,12': [SCENE.DECOR, 1, 0] // rock beyond the river
};

// Hash-scattered decor: lush picks for the left/top, dead picks for the right
const LUSH_DECOR = [[3, 1], [4, 1], [7, 0], [2, 1], [4, 3], [5, 3], [1, 1]];
const DEAD_DECOR = [[1, 0], [2, 0], [6, 0], [3, 0]];

class WorldMap {
  constructor(socket, { onPatchClick, onSpread, onChange }) {
    this.socket = socket;
    this.onPatchClick = onPatchClick;
    this.onSpread = onSpread;
    this.onChange = onChange;
    this.cols = CONFIG.MAP_COLS;
    this.rows = CONFIG.MAP_ROWS;
    this.grid = [];
    this.el = document.getElementById('world-map');

    this.owners = {};

    socket.on('map', ({ cols, rows, grid, owners }) => {
      this.cols = cols;
      this.rows = rows;
      this.grid = grid;
      this.owners = owners || {};
      this.render();
      this.onChange();
    });

    this.initPan();
    this.initDozers();

    socket.on('patch', ({ idx, state, cause, owner }) => {
      const apply = () => {
        this.grid[idx] = state;
        if (state === 'g' && owner) this.owners[idx] = owner;
        else delete this.owners[idx];
        this.render();
        this.animatePatch(idx, state === 'g' ? 'patch-restored' : 'patch-lost');
        if (cause === 'spread') this.onSpread();
        this.onChange();
      };
      // The plague arrives on wheels: a bulldozer drives over first
      if (cause === 'spread') this.destroyPatch(idx, apply);
      else apply();
    });
  }

  // ----- Bulldozers: the deforestation made visible -----

  patchScenePx(idx) {
    const c = SCENE.PLAY_COL + (idx % this.cols);
    const r = SCENE.PLAY_ROW + Math.floor(idx / this.cols);
    return { x: c * SCENE.TILE, y: r * SCENE.TILE };
  }

  initDozers() {
    // Two dozers idle in the deforested zone
    this.dozers = [
      { x: (SCENE.PLAY_COL + 8) * SCENE.TILE, y: (SCENE.PLAY_ROW + 1) * SCENE.TILE, flip: false, el: null },
      { x: (SCENE.PLAY_COL + 10) * SCENE.TILE, y: (SCENE.PLAY_ROW + 6) * SCENE.TILE, flip: true, el: null }
    ];
    // A few beetles wander the meadow (4-frame walk cycle from the HB sheet)
    this.critters = [
      { x: 3 * SCENE.TILE, y: 5 * SCENE.TILE, flip: false, el: null, pace: 7 },
      { x: 6 * SCENE.TILE, y: 12 * SCENE.TILE, flip: true, el: null, pace: 9 },
      { x: 24 * SCENE.TILE, y: 12 * SCENE.TILE, flip: false, el: null, pace: 8 }
    ];
    setInterval(() => this.patrol(), 6000);
    setInterval(() => this.wander(), 5000);
  }

  wander() {
    this.critters.forEach(cr => {
      if (!cr.el || Math.random() < 0.35) return; // beetles nap a lot
      let c, r;
      do {
        c = Math.floor(Math.random() * SCENE.COLS);
        r = 1 + Math.floor(Math.random() * (SCENE.RIVER_ROW - 2));
      } while (c === SCENE.RIVER_COL); // beetles can't swim
      const x = c * SCENE.TILE, y = r * SCENE.TILE;
      cr.flip = x > cr.x;
      cr.el.classList.toggle('flip', cr.flip);
      cr.x = x;
      cr.y = y;
      cr.el.style.left = x + 'px';
      cr.el.style.top = y + 'px';
    });
  }

  moveDozer(d, x, y, rush) {
    if (!d.el) return;
    d.flip = x > d.x; // sprite faces left; flip when driving right
    d.el.classList.toggle('flip', d.flip);
    d.el.classList.toggle('rush', !!rush);
    d.x = x;
    d.y = y;
    d.el.style.left = x + 'px';
    d.el.style.top = y + 'px';
  }

  patrol() {
    if (!this.grid.length) return;
    const barren = this.grid.map((v, i) => v === 'b' ? i : -1).filter(i => i >= 0);
    if (!barren.length) return;
    this.dozers.forEach(d => {
      if (d.busy || Math.random() < 0.4) return; // sometimes they just idle
      const { x, y } = this.patchScenePx(barren[Math.floor(Math.random() * barren.length)]);
      this.moveDozer(d, x, y, false);
    });
  }

  destroyPatch(idx, apply) {
    const { x, y } = this.patchScenePx(idx);
    // Nearest free dozer takes the job
    const d = [...this.dozers].sort((a, b) =>
      (Math.hypot(a.x - x, a.y - y) + (a.busy ? 1e6 : 0)) -
      (Math.hypot(b.x - x, b.y - y) + (b.busy ? 1e6 : 0)))[0];
    d.busy = true;
    this.moveDozer(d, x, y, true);
    setTimeout(() => {
      const cell = this.el.querySelector(`[data-map-idx="${idx}"]`);
      if (cell) cell.classList.add('patch-shake');
    }, 700);
    setTimeout(() => {
      d.busy = false;
      apply(); // re-renders the map…
      this.dustBurst(x, y); // …so the dust goes on top of the fresh DOM
    }, 1400);
  }

  dustBurst(x, y) {
    const dust = document.createElement('div');
    dust.className = 'dust';
    dust.style.left = x + 'px';
    dust.style.top = y + 'px';
    for (let i = 0; i < 5; i++) {
      const puff = document.createElement('span');
      puff.className = 'puff';
      const ang = (i / 5) * Math.PI * 2;
      puff.style.setProperty('--dx', Math.round(Math.cos(ang) * 22) + 'px');
      puff.style.setProperty('--dy', Math.round(Math.sin(ang) * 14 - 14) + 'px');
      puff.style.animationDelay = (i * 40) + 'ms';
      dust.appendChild(puff);
    }
    this.el.appendChild(dust);
    setTimeout(() => dust.remove(), 1200);
  }

  renderDozers() {
    this.dozers.forEach(d => {
      d.el = document.createElement('div');
      d.el.className = 'dozer' + (d.flip ? ' flip' : '');
      d.el.style.left = d.x + 'px';
      d.el.style.top = d.y + 'px';
      this.el.appendChild(d.el);
    });
    this.critters.forEach((cr, i) => {
      cr.el = document.createElement('div');
      cr.el.className = 'critter' + (cr.flip ? ' flip' : '');
      cr.el.style.left = cr.x + 'px';
      cr.el.style.top = cr.y + 'px';
      cr.el.style.transitionDuration = `${cr.pace}s, ${cr.pace}s`;
      cr.el.style.animationDelay = `-${i * 0.2}s`;
      this.el.appendChild(cr.el);
    });
  }

  greenPct() {
    if (this.grid.length === 0) return 0;
    const green = this.grid.filter(v => v === 'g').length;
    return Math.round((green / this.grid.length) * 100);
  }

  restore(idx, account) {
    // The server broadcasts the 'patch' update back, tagged with the planter
    this.socket.emit('restore', { idx, name: account.name, avatar: account.avatar });
  }

  reset() {
    this.socket.emit('reset-world');
  }

  animatePatch(idx, cls) {
    const patch = this.el.querySelector(`[data-map-idx="${idx}"]`);
    if (!patch) return;
    void patch.offsetWidth;
    patch.classList.add(cls);
  }

  // Layer one sheet tile over the grass base on a scenery cell
  static sprite(el, sheet, col, row) {
    el.style.backgroundImage = `url('${sheet}'), url('assets/grass_16.png')`;
    el.style.backgroundSize = '800% 400%, 100% 100%';
    el.style.backgroundPosition =
      `${(col / 7 * 100).toFixed(4)}% ${(row / 3 * 100).toFixed(4)}%, 0 0`;
  }

  buildSceneCell(c, r) {
    const cell = document.createElement('div');
    cell.className = 'scene-cell';
    const key = `${c},${r}`;
    const isRiver = c === SCENE.RIVER_COL && r < SCENE.RIVER_ROW || r === SCENE.RIVER_ROW;
    if (isRiver) {
      cell.classList.add(r === SCENE.RIVER_ROW ? 'water-h' : 'water-v');
    } else if (r === SCENE.FENCE_ROW) {
      WorldMap.sprite(cell, SCENE.DECOR, 6, 2); // fence line along the bottom
    } else if (SET_PIECES[key]) {
      const [sheet, col, row] = SET_PIECES[key];
      WorldMap.sprite(cell, sheet, col, row);
    } else {
      const dead = c >= SCENE.PLAY_COL + this.cols; // right of the grid feels the blight
      // Clumped wild forest: a coarse block hash makes bushes grow in
      // 2x2-ish groves rather than uniform noise (burnt ones on the dead side)
      // When the whole world is deforested, the wild forest dies too
      const dying = dead || this.worldDead;
      const grove = (((c >> 1) * 97 + (r >> 1) * 193 + 11) * 2654435761 >>> 0) % 100;
      const inGrove = ((c * 41 + r * 61 + 5) * 2654435761 >>> 0) % 100;
      const h = ((c * 73 + r * 151 + 7) * 2654435761 >>> 0) % 100;
      if (grove < (dead ? 20 : 35) && inGrove < 78) {
        WorldMap.sprite(cell, SCENE.HB, 5, dying ? 2 : 1); // bush / burnt bush
        if (!dying) {
          cell.classList.add('grove'); // living bushes sway like the play grid's
          cell.style.setProperty('--sway-dur', (2.6 + (inGrove % 17) / 10) + 's');
          cell.style.setProperty('--sway-delay', '-' + (inGrove % 31) / 10 + 's');
        }
      } else if (h < 26) {
        const list = dying ? DEAD_DECOR : LUSH_DECOR;
        const [col, row] = list[h % list.length];
        WorldMap.sprite(cell, SCENE.DECOR, col, row);
      } else {
        cell.style.background = "url('assets/grass_16.png')";
        cell.style.backgroundSize = '100% 100%';
      }
    }
    return cell;
  }

  buildPatch(idx) {
    const v = this.grid[idx];
    const patch = document.createElement('button');
    patch.className = 'patch ' + (v === 'g' ? 'green' : 'barren');
    patch.dataset.mapIdx = idx;
    const h = ((idx + 1) * 2654435761 >>> 0) % 100;
    if (v === 'g') {
      // Deterministic variety: some green patches are clearings with decor
      if (h < 22) patch.classList.add('clearing', 'd' + (h % 4));
      else if (h < 32) patch.classList.add('clearing'); // plain grass gap
    }
    if (v === 'b') {
      // Every barren patch is a grey dead tree — the thing you restore
      patch.addEventListener('click', () => this.onPatchClick(idx));
      patch.title = 'Restore this tree!';
    } else {
      patch.disabled = true; // living forest is scenery, not a button
      // Randomize the wind sway so the forest doesn't move in lockstep
      patch.style.setProperty('--sway-dur', (2.6 + (h % 17) / 10) + 's');
      patch.style.setProperty('--sway-delay', '-' + (h % 31) / 10 + 's');
      const owner = this.owners[idx];
      if (owner) {
        const badge = document.createElement('span');
        badge.className = 'avatar-sprite patch-owner';
        paintAvatar(badge, owner.avatar);
        patch.appendChild(badge);
        patch.title = `Restored by ${owner.name}`;
      }
    }
    return patch;
  }

  render() {
    // 0% green = total collapse: the whole map goes dark and lifeless
    this.worldDead = this.grid.length > 0 && !this.grid.includes('g');
    document.getElementById('map-screen').classList.toggle('world-dead', this.worldDead);
    this.el.style.gridTemplateColumns = `repeat(${SCENE.COLS}, var(--tile))`;
    this.el.innerHTML = '';
    for (let r = 0; r < SCENE.ROWS; r++) {
      for (let c = 0; c < SCENE.COLS; c++) {
        const pc = c - SCENE.PLAY_COL;
        const pr = r - SCENE.PLAY_ROW;
        const inPlay = pc >= 0 && pc < this.cols && pr >= 0 && pr < this.rows;
        this.el.appendChild(
          inPlay ? this.buildPatch(pr * this.cols + pc) : this.buildSceneCell(c, r)
        );
      }
    }
    if (this.dozers) this.renderDozers();
  }

  // ----- Panning: the world is bigger than the screen; drag to explore -----

  initPan() {
    this.screenEl = document.getElementById('map-screen');
    this.panX = 0;
    this.panY = 0;
    this.didPan = false;

    this.screenEl.addEventListener('pointerdown', e => {
      if (e.target.closest('.map-overlay') || e.target.closest('.leaderboard')) return; // UI pans nothing
      this.dragging = { x: e.clientX, y: e.clientY, moved: false };
    });
    window.addEventListener('pointermove', e => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragging.x;
      const dy = e.clientY - this.dragging.y;
      if (!this.dragging.moved && Math.hypot(dx, dy) < 8) return;
      this.dragging.moved = true;
      this.screenEl.classList.add('panning');
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
      this.panX += dx;
      this.panY += dy;
      this.applyPan();
    });
    window.addEventListener('pointerup', () => {
      if (this.dragging && this.dragging.moved) this.didPan = true;
      this.dragging = null;
      this.screenEl.classList.remove('panning');
    });
    // A drag that ends on a patch must not count as a tap on it
    this.screenEl.addEventListener('click', e => {
      if (this.didPan) {
        this.didPan = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);

    this.screenEl.addEventListener('wheel', e => {
      e.preventDefault();
      this.panX -= e.deltaX;
      this.panY -= e.deltaY;
      this.applyPan();
    }, { passive: false });

    window.addEventListener('resize', () => this.applyPan());
    this.centerOnPlayGrid();
  }

  applyPan() {
    const w = SCENE.COLS * SCENE.TILE;
    const h = SCENE.ROWS * SCENE.TILE;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Clamp so the scene edge never leaves a gap; center if it fits entirely
    this.panX = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, this.panX));
    this.panY = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, this.panY));
    this.el.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
  }

  centerOnPlayGrid() {
    const cx = (SCENE.PLAY_COL + this.cols / 2) * SCENE.TILE;
    const cy = (SCENE.PLAY_ROW + this.rows / 2) * SCENE.TILE;
    this.panX = window.innerWidth / 2 - cx;
    this.panY = window.innerHeight / 2 - cy;
    this.applyPan();
  }
}
