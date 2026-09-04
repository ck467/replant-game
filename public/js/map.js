// World map: a socket-driven view of the shared world.
// The server owns the grid; this class renders it and forwards actions.
//
// The screen is an expansive tile scene — bigger than most viewports — that
// the player pans around, at 64px per tile (4x pixel scale). It is drawn at
// the world's EVENTUAL size (the server's maxCols x maxRows): the playable
// cols x rows grid sits centered in it, and everything around the grid is
// locked meadow — grass and flowers with a lock on each tile — that opens
// ring by ring as the world grows. A river runs down the far right edge into
// a full-width channel along the bottom, and a fence closes the last row.
// Inside the grid there is no painted-on forest: if it looks like a tree, it
// can be tapped.
const SCENE = {
  TILE: 64,
  HB: 'assets/blind_hummingbird_spritesheet_16x16.png',    // 8x4 sheet
  DECOR: 'assets/forest_decoration_set_16x16.png'          // 8x4 sheet
};

// Decoration-sheet tiles [col, row] that suit the dead zone: stones, a rock, a log, a boulder
const DEAD_DECOR = [[0, 0], [1, 0], [2, 0], [6, 0]];
// …and the locked meadow: sprigs, flowers, white flowers
const MEADOW_DECOR = [[2, 1], [3, 1], [4, 1]];

class WorldMap {
  constructor(socket, { onPatchClick, onLockedClick, onSpread, onChange, onGrow }) {
    this.socket = socket;
    this.onPatchClick = onPatchClick;
    this.onLockedClick = onLockedClick;
    this.onSpread = onSpread;
    this.onChange = onChange;
    this.onGrow = onGrow;
    this.cols = CONFIG.MAP_COLS;
    this.rows = CONFIG.MAP_ROWS;
    this.maxCols = CONFIG.MAP_COLS;
    this.maxRows = CONFIG.MAP_ROWS;
    this.grid = [];
    this.expandAt = 60;
    this.maxed = false;
    this.el = document.getElementById('world-map');

    this.owners = {};

    socket.on('map', ({ cols, rows, grid, owners, expandAt, maxed, maxCols, maxRows, grew }) => {
      const first = !this.grid.length;
      this.cols = cols;
      this.rows = rows;
      this.grid = grid;
      this.owners = owners || {};
      if (expandAt !== undefined) this.expandAt = expandAt;
      if (maxCols) { this.maxCols = maxCols; this.maxRows = maxRows; }
      this.maxed = !!maxed;
      // The grid stays centered in the full scene, so a new ring simply
      // unlocks in place — nothing on screen moves
      this.render();
      if (first) this.centerOnPlayGrid();
      this.onChange();
      if (grew && this.onGrow) this.onGrow();
    });

    this.initPan();
    this.initDozers();

    socket.on('patch', ({ idx, state, cause, owner }) => {
      const apply = () => {
        this.grid[idx] = state;
        if (state === 'g' && owner) this.owners[idx] = owner;
        else delete this.owners[idx];
        this.updatePatch(idx); // just this tile — the world is big
        this.animatePatch(idx, state === 'g' ? 'patch-restored' : 'patch-lost');
        if (cause === 'spread') this.onSpread();
        this.onChange();
      };
      // The plague arrives on wheels: a bulldozer drives over first
      if (cause === 'spread') this.destroyPatch(idx, apply);
      else apply();
    });
  }

  // The scene is the eventual world plus a river column on the right and a
  // river channel + fence row along the bottom; the current grid sits
  // centered at (offC, offR)
  get sceneCols() { return this.maxCols + 1; }
  get sceneRows() { return this.maxRows + 2; }
  get riverCol() { return this.maxCols; }
  get riverRow() { return this.maxRows; }
  get fenceRow() { return this.maxRows + 1; }
  get offC() { return (this.maxCols - this.cols) / 2; }
  get offR() { return (this.maxRows - this.rows) / 2; }

  // ----- Bulldozers: the deforestation made visible -----

  patchScenePx(idx) {
    const c = this.offC + (idx % this.cols);
    const r = this.offR + Math.floor(idx / this.cols);
    return { x: c * SCENE.TILE, y: r * SCENE.TILE };
  }

  initDozers() {
    // Two dozers idle in the deforested (right) half; beetles wander the
    // left. Positions are grid tiles, placed in scene px on first render.
    this.dozers = [
      { gc: 22, gr: 3, flip: false, el: null },
      { gc: 26, gr: 10, flip: true, el: null }
    ];
    // A few beetles wander the meadow (4-frame walk cycle from the HB sheet)
    this.critters = [
      { gc: 3, gr: 5, flip: false, el: null, pace: 7 },
      { gc: 6, gr: 12, flip: true, el: null, pace: 9 },
      { gc: 24, gr: 12, flip: false, el: null, pace: 8 }
    ];
    setInterval(() => this.patrol(), 6000);
    setInterval(() => this.wander(), 5000);
  }

  wander() {
    this.critters.forEach(cr => {
      if (!cr.el || Math.random() < 0.35) return; // beetles nap a lot
      let c, r;
      do {
        c = Math.floor(Math.random() * this.sceneCols);
        r = 1 + Math.floor(Math.random() * (this.riverRow - 2));
      } while (c === this.riverCol); // beetles can't swim
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
    // First render: turn grid-tile starting spots into scene pixels
    [...this.dozers, ...this.critters].forEach(s => {
      if (s.x === undefined) {
        s.x = (this.offC + s.gc) * SCENE.TILE;
        s.y = (this.offR + s.gr) * SCENE.TILE;
      }
    });
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

  // Admin only: the server checks the key and acks {ok, error}
  reset(key, onReply) {
    this.socket.emit('reset-world', { key }, onReply);
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

  // Outside the grid: the river, the fence, and the locked meadow the world
  // will grow into — grass with sprigs and flowers, a lock on every tile
  buildSceneCell(c, r) {
    const cell = document.createElement('div');
    cell.className = 'scene-cell';
    const isRiver = c === this.riverCol && r < this.riverRow || r === this.riverRow;
    if (isRiver) {
      cell.classList.add(r === this.riverRow ? 'water-h' : 'water-v');
    } else if (r === this.fenceRow) {
      WorldMap.sprite(cell, SCENE.DECOR, 6, 2); // fence line along the bottom
    } else {
      cell.classList.add('locked');
      const h = ((c * 73 + r * 151 + 7) * 2654435761 >>> 0) % 100;
      if (h < 45) {
        const [col, row] = MEADOW_DECOR[h % MEADOW_DECOR.length];
        WorldMap.sprite(cell, SCENE.DECOR, col, row);
      } else {
        cell.style.background = "url('assets/grass_16.png')";
        cell.style.backgroundSize = '100% 100%';
      }
      cell.title = 'Locked — grow the forest to open this land';
      cell.addEventListener('click', () => this.onLockedClick && this.onLockedClick());
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
      // The dead zone isn't one flat grey: the scorched ground varies, and
      // some tiles have a rock, a log, or a stump beside the dead tree
      patch.classList.add('ash-' + (h % 3));
      if (h < 30) {
        const [col, row] = DEAD_DECOR[h % DEAD_DECOR.length];
        const decor = document.createElement('span');
        decor.className = 'patch-decor';
        decor.style.backgroundPosition = `${(col / 7 * 100).toFixed(4)}% ${(row / 3 * 100).toFixed(4)}%`;
        patch.appendChild(decor);
      }
    } else {
      patch.disabled = true; // living forest is scenery, not a button
      // Randomize the wind sway so the forest doesn't move in lockstep
      patch.style.setProperty('--sway-dur', (2.6 + (h % 17) / 10) + 's');
      patch.style.setProperty('--sway-delay', '-' + (h % 31) / 10 + 's');
      // A restored patch gets a little wooden signpost with the planter's name
      const owner = this.owners[idx];
      if (owner) {
        const sign = document.createElement('span');
        sign.className = 'patch-sign';
        const name = document.createElement('span');
        name.className = 'patch-sign-name';
        name.textContent = owner.name;
        sign.appendChild(name);
        patch.appendChild(sign);
        patch.title = `Restored by ${owner.name}`;
      }
    }
    return patch;
  }

  // 0% green = total collapse: the whole map goes dark and lifeless
  updateDeadState() {
    this.worldDead = this.grid.length > 0 && !this.grid.includes('g');
    document.getElementById('map-screen').classList.toggle('world-dead', this.worldDead);
  }

  // Full rebuild: on arrival and whenever the world grows
  render() {
    this.updateDeadState();
    this.el.style.gridTemplateColumns = `repeat(${this.sceneCols}, var(--tile))`;
    this.el.innerHTML = '';
    const { offC, offR } = this;
    for (let r = 0; r < this.sceneRows; r++) {
      for (let c = 0; c < this.sceneCols; c++) {
        const pc = c - offC, pr = r - offR;
        const inPlay = pc >= 0 && pc < this.cols && pr >= 0 && pr < this.rows;
        this.el.appendChild(inPlay ? this.buildPatch(pr * this.cols + pc) : this.buildSceneCell(c, r));
      }
    }
    if (this.dozers) this.renderDozers();
    this.applyPan();
  }

  // One tile changed: swap just that element
  updatePatch(idx) {
    const old = this.el.querySelector(`[data-map-idx="${idx}"]`);
    if (old) old.replaceWith(this.buildPatch(idx));
    this.updateDeadState();
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
    const w = this.sceneCols * SCENE.TILE;
    const h = this.sceneRows * SCENE.TILE;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Clamp so the scene edge never leaves a gap; center if it fits entirely
    this.panX = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, this.panX));
    this.panY = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, this.panY));
    this.el.style.transform = `translate(${this.panX}px, ${this.panY}px)`;
  }

  centerOnPlayGrid() {
    const cx = (this.offC + this.cols / 2) * SCENE.TILE;
    const cy = (this.offR + this.rows / 2) * SCENE.TILE;
    this.panX = window.innerWidth / 2 - cx;
    this.panY = window.innerHeight / 2 - cy;
    this.applyPan();
  }
}
