// Puzzle session: merge identical items up the chain until one Mature Tree exists.
// Pure state lives on the instance; DOM rendering is in render().

// Rare crate drops get a floating celebration
const LUCKY_VFX = {
  3: ['Lucky!', '#ffd93d'],
  4: ['Super Lucky!', '#ff9f43'],
  5: ['Mega Lucky!', '#c77dff']
};

class Puzzle {
  constructor(species, { onWin, onLose, onQuit, onSpawn, spawnWeights, spawnBudget, tutor = true, onTutorComplete, board }) {
    this.species = species;
    this.onWin = onWin;
    this.onLose = onLose;
    this.onQuit = onQuit;
    this.onSpawn = onSpawn;
    this.spawnWeights = spawnWeights || CONFIG.SPAWN_WEIGHTS;
    this.cells = CONFIG.BOARD_COLS * CONFIG.BOARD_ROWS;
    // 0 = empty, 1..5 = stage; a carried-over board keeps last round's items
    this.board = board ? board.slice() : new Array(this.cells).fill(0);
    this.spawnsLeft = spawnBudget !== undefined ? spawnBudget : Infinity;
    this.spawnCount = 0;
    this.selected = -1;
    this.finished = false;
    this.tutorEnabled = tutor;
    this.onTutorComplete = onTutorComplete;

    this.el = document.getElementById('puzzle-screen');
    this.boardEl = document.getElementById('puzzle-board');
    this.bindUI();
    this.render();
    this.showTutor('Tap "Open Crate" to get your first seeds! 👇');
  }

  bindUI() {
    this.crateBtn = document.getElementById('crate-btn');
    this.crateHandler = () => this.spawn();
    this.crateBtn.addEventListener('click', this.crateHandler);

    // The ← button is owned by the Challenge (it confirms before quitting)
    this.recipeBtn = document.getElementById('recipe-btn');
    this.recipeHandler = () => this.showRecipe();
    this.recipeBtn.addEventListener('click', this.recipeHandler);
    document.getElementById('recipe-close').onclick = () =>
      document.getElementById('recipe-overlay').classList.remove('show');
  }

  teardown() {
    this.crateBtn.removeEventListener('click', this.crateHandler);
    this.recipeBtn.removeEventListener('click', this.recipeHandler);
    window.removeEventListener('pointermove', this.dragMoveHandler);
    window.removeEventListener('pointerup', this.dragEndHandler);
    if (this.drag && this.drag.ghost) this.drag.ghost.remove();
    this.drag = null;
  }

  // ----- Staged tutorial, delivered through the shared toast system -----

  showTutor(text) {
    if (this.tutorEnabled) toast(text, 4500);
  }

  // ----- Recipe book -----

  showRecipe() {
    const chain = document.getElementById('recipe-chain');
    chain.innerHTML = '';
    for (let stage = 1; stage <= CONFIG.CHAIN_LENGTH; stage++) {
      if (stage > 1) {
        const arrow = document.createElement('span');
        arrow.className = 'recipe-arrow';
        arrow.textContent = '➜';
        chain.appendChild(arrow);
      }
      const step = document.createElement('span');
      step.className = 'recipe-step';
      step.innerHTML = this.spriteHTML(stage) +
        `<span class="recipe-label">${CONFIG.STAGE_NAMES[stage - 1]}</span>`;
      chain.appendChild(step);
    }

    const trees = document.getElementById('recipe-trees');
    trees.innerHTML = '';
    CONFIG.SPECIES.forEach(sp => {
      const [col, row] = sp.tiles[CONFIG.CHAIN_LENGTH - 1];
      const x = (col / (CONFIG.CROP_SHEET.cols - 1)) * 100;
      const y = (row / (CONFIG.CROP_SHEET.rows - 1)) * 100;
      const item = document.createElement('span');
      item.className = 'recipe-step' + (sp.id === this.species.id ? ' current' : '');
      item.innerHTML =
        `<span class="cell-sprite" style="background-position:${x.toFixed(4)}% ${y.toFixed(4)}%"></span>` +
        `<span class="recipe-label">${sp.name}</span>`;
      trees.appendChild(item);
    });

    document.getElementById('recipe-overlay').classList.add('show');
  }

  rollStage() {
    if (typeof window.__TEST_FORCE_SPAWN_STAGE === 'number') {
      return window.__TEST_FORCE_SPAWN_STAGE;
    }
    let roll = Math.random() * 100;
    for (let stage = 0; stage < this.spawnWeights.length; stage++) {
      roll -= this.spawnWeights[stage];
      if (roll < 0) return stage + 1;
    }
    return 1;
  }

  spawn() {
    if (this.finished || this.spawnsLeft <= 0) return;
    const empties = [];
    this.board.forEach((v, i) => { if (v === 0) empties.push(i); });
    if (empties.length === 0) {
      toast('🧺 The plot is full — merge something first!');
      return;
    }
    const idx = empties[Math.floor(Math.random() * empties.length)];
    const stage = this.rollStage();
    this.board[idx] = stage;
    this.spawnsLeft--;
    // Coach the merge the moment a matching pair actually exists
    if (this.tutorEnabled && !this.mergeHintShown) {
      const counts = {};
      this.board.forEach(v => { if (v > 0 && v < CONFIG.CHAIN_LENGTH) counts[v] = (counts[v] || 0) + 1; });
      if (Object.values(counts).some(n => n >= 2)) {
        this.mergeHintShown = true;
        this.showTutor('You have a matching pair! Drag one onto the other — or tap them one after the other.');
      }
    }
    if (this.onSpawn) this.onSpawn();
    this.render();
    this.flyFromCrate(idx, stage);
    if (LUCKY_VFX[stage]) {
      setTimeout(() => this.luckyVfx(idx, stage), 400); // as the item lands
    }
    this.checkLoss();
  }

  luckyVfx(idx, stage) {
    const cell = this.boardEl.querySelector(`[data-idx="${idx}"]`);
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    const [text, color] = LUCKY_VFX[stage];
    const el = document.createElement('div');
    el.className = 'lucky-vfx';
    el.textContent = text;
    el.style.color = color;
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + r.height * 0.3) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  // The spawned item pops out of the crate and arcs onto its cell.
  flyFromCrate(idx, stage) {
    const cell = this.boardEl.querySelector(`[data-idx="${idx}"]`);
    if (!cell || !cell.animate) {
      this.animateCell(idx, 'pop-in');
      return;
    }
    // Board state is already rendered; hide the item while its flyer travels
    cell.classList.add('landing');

    const crateRect = this.crateBtn.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const fromX = crateRect.left + crateRect.width / 2;
    const fromY = crateRect.top + crateRect.height * 0.35; // out of the crate's lid
    const dx = cellRect.left + cellRect.width / 2 - fromX;
    const dy = cellRect.top + cellRect.height / 2 - fromY;

    const flyer = document.createElement('div');
    flyer.className = 'spawn-flyer';
    flyer.innerHTML = this.spriteHTML(stage, 'cell-sprite flyer-sprite');
    flyer.style.left = fromX + 'px';
    flyer.style.top = fromY + 'px';
    document.body.appendChild(flyer);

    this.crateBtn.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(0.92)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'ease-out' }
    );

    const hop = flyer.animate([
      { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.6, offset: 0 },
      { transform: `translate(-50%, -50%) translate(${dx * 0.25}px, ${dy * 0.3 - 70}px) scale(1.15) rotate(-8deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1)`, opacity: 1, offset: 1 }
    ], { duration: 380, easing: 'ease-in-out' });

    hop.onfinish = () => {
      flyer.remove();
      // The board may have re-rendered mid-flight — re-query before revealing
      const landed = this.boardEl.querySelector(`[data-idx="${idx}"]`);
      if (landed) {
        landed.classList.remove('landing');
        this.animateCell(idx, 'pop-in');
      }
    };
  }

  // ----- Drag & drop (pointer events cover mouse and touch) -----

  dragStart(e, idx) {
    if (this.finished || this.board[idx] === 0) return;
    this.drag = { idx, startX: e.clientX, startY: e.clientY, ghost: null };
    this.dragMoveHandler = ev => this.dragMove(ev);
    this.dragEndHandler = ev => this.dragEnd(ev);
    window.addEventListener('pointermove', this.dragMoveHandler);
    window.addEventListener('pointerup', this.dragEndHandler);
  }

  dragMove(e) {
    if (!this.drag) return;
    if (!this.drag.ghost) {
      // Only becomes a drag after moving a little — short presses stay taps
      const dist = Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY);
      if (dist < 8) return;
      const source = this.boardEl.querySelector(`[data-idx="${this.drag.idx}"]`);
      const ghost = source.cloneNode(true);
      const rect = source.getBoundingClientRect();
      ghost.className = 'cell filled drag-ghost';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      document.body.appendChild(ghost);
      source.classList.add('drag-source');
      this.drag.ghost = ghost;
    }
    this.drag.ghost.style.left = e.clientX + 'px';
    this.drag.ghost.style.top = e.clientY + 'px';

    const target = this.dropTargetAt(e.clientX, e.clientY);
    this.boardEl.querySelectorAll('.drop-ok').forEach(c => c.classList.remove('drop-ok'));
    if (target !== null) {
      this.boardEl.querySelector(`[data-idx="${target}"]`).classList.add('drop-ok');
    }
  }

  dragEnd(e) {
    window.removeEventListener('pointermove', this.dragMoveHandler);
    window.removeEventListener('pointerup', this.dragEndHandler);
    if (!this.drag) return;
    const wasDragging = !!this.drag.ghost;
    if (wasDragging) {
      this.drag.ghost.remove();
      this.justDragged = true; // swallow the click that follows pointerup
      const target = this.dropTargetAt(e.clientX, e.clientY);
      const from = this.drag.idx;
      this.drag = null;
      if (target !== null) {
        this.merge(from, target);
        return;
      }
      this.render(); // snap back
    } else {
      this.drag = null; // it was a tap; the click handler takes it from here
    }
  }

  // Index of a valid merge target under the pointer, else null.
  dropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest('#puzzle-board .cell');
    if (!cell) return null;
    const idx = +cell.dataset.idx;
    const stage = this.board[this.drag.idx];
    if (idx !== this.drag.idx && this.board[idx] === stage && stage < CONFIG.CHAIN_LENGTH) {
      return idx;
    }
    return null;
  }

  tapCell(idx) {
    if (this.justDragged) { this.justDragged = false; return; }
    if (this.finished) return;
    const stage = this.board[idx];
    if (this.selected === -1) {
      if (stage > 0) { this.selected = idx; this.render(); }
      return;
    }
    if (idx === this.selected) {
      this.selected = -1;
      this.render();
      return;
    }
    if (stage > 0 && stage === this.board[this.selected] && stage < CONFIG.CHAIN_LENGTH) {
      this.merge(this.selected, idx);
    } else if (stage > 0) {
      this.selected = idx; // switch selection
      this.render();
    } else {
      this.selected = -1;
      this.render();
    }
  }

  merge(from, to) {
    const next = this.board[to] + 1;
    this.board[from] = 0;
    this.board[to] = next;
    this.selected = -1;
    if (!this.mergedOnce) {
      this.mergedOnce = true;
      this.showTutor(`Keep merging all the way to a Mature ${this.species.name} Tree! 🌳`);
      if (this.tutorEnabled && this.onTutorComplete) this.onTutorComplete();
    }
    this.render();
    this.animateCell(to, 'pop-merge');
    if (next === CONFIG.CHAIN_LENGTH) {
      this.finished = true;
      this.winCellIdx = to; // the tree stays put; the run flies it later
      this.confettiBurst(to);
      setTimeout(() => { this.teardown(); this.onWin(); }, 700);
      return;
    }
    this.checkLoss();
  }

  // Celebration confetti right on the cell where the tree formed
  confettiBurst(idx) {
    const cell = this.boardEl.querySelector(`[data-idx="${idx}"]`);
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    confettiAt(r.left + r.width / 2, r.top + r.height / 2);
  }

  // The finished tree lifts off the plot and flies into the 🌳 counter
  flyToCounter(idx = this.winCellIdx) {
    const cell = this.boardEl.querySelector(`[data-idx="${idx}"]`);
    const target = document.getElementById('school-trees');
    if (!cell || !target || !cell.animate || target.hidden) return;
    const cr = cell.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const fromX = cr.left + cr.width / 2;
    const fromY = cr.top + cr.height / 2;
    const dx = tr.left + tr.width / 2 - fromX;
    const dy = tr.top + tr.height / 2 - fromY;

    cell.classList.add('landing'); // the tree has left the ground

    const flyer = document.createElement('div');
    flyer.className = 'spawn-flyer';
    flyer.innerHTML = this.spriteHTML(CONFIG.CHAIN_LENGTH, 'cell-sprite flyer-sprite');
    flyer.style.left = fromX + 'px';
    flyer.style.top = fromY + 'px';
    document.body.appendChild(flyer);

    const hop = flyer.animate([
      { transform: 'translate(-50%, -50%) scale(1.25)', opacity: 1, offset: 0 },
      { transform: `translate(-50%, -50%) translate(${dx * 0.3}px, ${dy * 0.5 - 40}px) scale(1) rotate(8deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0.85, offset: 1 }
    ], { duration: 620, easing: 'ease-in-out' });

    hop.onfinish = () => {
      flyer.remove();
      target.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }],
        { duration: 320, easing: 'ease-out' }
      );
    };
  }

  // Exact check: with no spawns left, can the items on the board still
  // combine into a stage-5 tree? (Greedy carry, like binary addition.)
  canStillWin() {
    if (this.spawnsLeft > 0) return true;
    const counts = new Array(CONFIG.CHAIN_LENGTH + 1).fill(0);
    this.board.forEach(v => { if (v > 0) counts[v]++; });
    for (let s = 1; s < CONFIG.CHAIN_LENGTH; s++) {
      counts[s + 1] += Math.floor(counts[s] / 2);
    }
    return counts[CONFIG.CHAIN_LENGTH] >= 1;
  }

  checkLoss() {
    if (!this.finished && !this.canStillWin()) {
      this.finished = true;
      setTimeout(() => { this.teardown(); this.onLose(); }, 500);
    }
  }

  animateCell(idx, cls) {
    const cell = this.boardEl.children[idx];
    if (!cell) return;
    cell.classList.remove('pop-in', 'pop-merge');
    void cell.offsetWidth; // restart animation
    cell.classList.add(cls);
  }

  itemLabel(stage) {
    return stage === CONFIG.CHAIN_LENGTH
      ? `${this.species.name} Tree`
      : CONFIG.STAGE_NAMES[stage - 1];
  }

  // CSS background-position for this species' tile at `stage` on the crop sheet
  spritePos(stage) {
    const [col, row] = this.species.tiles[stage - 1];
    const x = (col / (CONFIG.CROP_SHEET.cols - 1)) * 100;
    const y = (row / (CONFIG.CROP_SHEET.rows - 1)) * 100;
    return `${x.toFixed(4)}% ${y.toFixed(4)}%`;
  }

  spriteHTML(stage, cls = 'cell-sprite') {
    return `<span class="${cls}" style="background-position:${this.spritePos(stage)}"></span>`;
  }

  render() {
    document.getElementById('puzzle-goal').innerHTML =
      `Grow <b>Mature ${this.species.name} Trees</b> ${this.spriteHTML(CONFIG.CHAIN_LENGTH, 'cell-sprite goal-sprite')}`;
    const budgetEl = document.getElementById('crate-count');
    budgetEl.hidden = this.spawnsLeft === Infinity;
    document.getElementById('spawns-left').textContent =
      this.spawnsLeft === Infinity ? '' : this.spawnsLeft;
    this.crateBtn.disabled = this.spawnsLeft <= 0;

    this.boardEl.style.gridTemplateColumns = `repeat(${CONFIG.BOARD_COLS}, 1fr)`;
    this.boardEl.innerHTML = '';
    this.board.forEach((stage, idx) => {
      const cell = document.createElement('button');
      cell.className = 'cell' + (stage > 0 ? ' filled stage-' + stage : '');
      cell.dataset.idx = idx;
      if (idx === this.selected) cell.classList.add('selected');
      if (stage > 0) {
        cell.innerHTML =
          this.spriteHTML(stage) +
          `<span class="cell-label">${this.itemLabel(stage)}</span>` +
          `<span class="cell-stage">${'●'.repeat(stage)}</span>`;
        cell.addEventListener('pointerdown', e => this.dragStart(e, idx));
      }
      cell.addEventListener('click', () => this.tapCell(idx));
      this.boardEl.appendChild(cell);
    });
  }
}
