// Timed challenge: plant GOAL_TREES full trees before the clock runs out.
// Hitting the goal ends the run; the clock running out ends it too.
// Runs under the player's account; every tree greens a random shared patch.

function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

class Challenge {
  constructor(socket, { showOverlay, showScreen, toast, getAccount, isPatchBarren }) {
    this.socket = socket;
    this.showOverlay = showOverlay;
    this.showScreen = showScreen;
    this.toast = toast;
    this.getAccount = getAccount;
    this.isPatchBarren = isPatchBarren;
    this.hud = document.getElementById('school-hud');
    this.timerEl = document.getElementById('school-timer');
    this.treesEl = document.getElementById('school-trees');
    // The run owns the ← button: quitting a live run needs a confirmation
    document.getElementById('puzzle-quit').addEventListener('click', () => {
      if (!this.running) return;
      if (!this.deadline) { this.abort(); return; } // no crate opened yet — nothing at stake
      this.confirmQuit();
    });
  }

  confirmQuit() {
    this.showOverlay({
      title: '🚪 Leave the run?',
      body: 'The timer is still going! If you quit now, no patch gets restored and your trees are lost.',
      buttonText: '🌱 Keep playing',
      onButton: () => {},
      button2Text: '🗺️ Quit',
      onButton2: () => this.abort()
    });
  }

  // targetPatch: the tapped dead tree, restored when the run reaches its goal.
  // One Puzzle lives for the whole run: finished trees sit on the plot while
  // they celebrate, then fly off, and play never pauses in between.
  start(targetPatch = null) {
    this.targetPatch = targetPatch;
    this.running = true;
    this.treesDone = 0;
    this.goalTimeMs = null;
    this.deadline = null; // clock starts on the first crate open
    this.celebrations = new Set();
    this.hud.hidden = false;
    this.renderHud(CONFIG.CHALLENGE.TIME_MS);
    this.showScreen('puzzle-screen');
    this.tick = setInterval(() => this.onTick(), 200);
    factTicker.start();
    const species = CONFIG.SPECIES[Math.floor(Math.random() * CONFIG.SPECIES.length)];
    const acc = this.getAccount();
    this.puzzle = new Puzzle(species, {
      spawnBudget: Infinity,
      tutor: !acc.tutorDone, // coach once per account
      onTutorComplete: () => {
        const a = this.getAccount();
        a.tutorDone = true;
        saveAccount(a);
      },
      onSpawn: () => {
        if (!this.deadline) this.deadline = Date.now() + CONFIG.CHALLENGE.TIME_MS;
      },
      onWin: idx => this.treeWon(idx),
      onLose: () => {} // unlimited spawns: only the clock can end the run
    });
  }

  // idx: the cell the new tree stands on. The crate stays open throughout;
  // only that cell is spoken for until the tree flies into the counter.
  treeWon(idx) {
    if (!this.running) return; // the clock ran out during the win celebration
    this.treesDone++;
    // The map only changes when the run QUALIFIES: the final goal tree
    // restores the tapped patch. Quitting or falling short restores nothing.
    const reachedGoal = this.treesDone >= CONFIG.CHALLENGE.GOAL_TREES;
    if (this.treesDone === CONFIG.CHALLENGE.GOAL_TREES) {
      const acc = this.getAccount();
      if (this.targetPatch != null && this.isPatchBarren(this.targetPatch)) {
        this.socket.emit('restore', { idx: this.targetPatch, name: acc.name, avatar: acc.avatar });
      } else {
        this.socket.emit('challenge-tree', { name: acc.name, avatar: acc.avatar });
      }
      // The leaderboard remembers how fast you reached the goal
      this.goalTimeMs = CONFIG.CHALLENGE.TIME_MS - Math.max(0, this.deadline - Date.now());
      this.toast(`🏆 ${this.treesDone} trees — you restored a patch!`);
    } else if (!reachedGoal) {
      this.toast(`🌳 Tree ${this.treesDone}/${CONFIG.CHALLENGE.GOAL_TREES} planted — keep going!`);
    }
    this.renderHud(this.deadline - Date.now());
    // The tree lingers on the plot while the toast shows; once the toast
    // fades it flies into the counter and frees its cell — and if that was
    // the goal tree, the run ends.
    const later = (ms, fn) => {
      const t = setTimeout(() => { this.celebrations.delete(t); if (this.running) fn(); }, ms);
      this.celebrations.add(t);
    };
    later(2500, () => {
      this.puzzle.flyToCounter(idx);
      later(700, () => {
        this.puzzle.clearCell(idx);
        if (reachedGoal) this.endRun();
      });
    });
  }

  onTick() {
    if (!this.deadline) return;
    const left = this.deadline - Date.now();
    this.renderHud(left);
    if (left <= 0) this.endRun();
  }

  renderHud(msLeft) {
    this.timerEl.textContent = formatTime(this.deadline ? msLeft : CONFIG.CHALLENGE.TIME_MS);
    this.timerEl.classList.toggle('low', this.deadline && msLeft < 15000);
    this.treesEl.textContent = `🌳 ${this.treesDone}/${CONFIG.CHALLENGE.GOAL_TREES}`;
  }

  stopRun() {
    this.running = false;
    clearInterval(this.tick);
    this.celebrations.forEach(t => clearTimeout(t));
    this.celebrations.clear();
    factTicker.stop();
    this.hud.hidden = true;
    if (this.puzzle) {
      this.puzzle.finished = true; // freeze the board
      this.puzzle.teardown();
      this.puzzle = null;
    }
  }

  abort() {
    this.stopRun();
    this.showScreen('map-screen');
  }

  async endRun() {
    this.stopRun();
    const acc = this.getAccount();
    const success = this.treesDone >= CONFIG.CHALLENGE.GOAL_TREES;
    let rankLine = '';
    try {
      const res = await fetch('/api/challenge/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: acc.name,
          avatar: acc.avatar,
          trees: this.treesDone,
          reached: success,
          timeMs: success ? this.goalTimeMs : CONFIG.CHALLENGE.TIME_MS
        })
      });
      const data = await res.json();
      if (data.rank > 0) rankLine = ` You're #${data.rank} of ${data.total} restorers!`;
    } catch (e) { /* offline? show result without rank */ }

    const solution = CONFIG.SOLUTIONS[Math.floor(Math.random() * CONFIG.SOLUTIONS.length)];
    this.showOverlay({
      title: success ? `🌍 Patch restored, ${acc.name}!` : "⏰ Time's up!",
      body: success
        ? `Your ${CONFIG.CHALLENGE.GOAL_TREES} trees brought a patch of the forest back to life` +
          ` in ${formatTime(this.goalTimeMs)}!${rankLine} 🌱 In real life: ${solution}!`
        : `🌳 Planted: ${this.treesDone}. Reach ${CONFIG.CHALLENGE.GOAL_TREES} trees to restore a patch!` +
          `${rankLine} 🌱 In real life: ${solution}!`,
      celebrate: success,
      buttonText: '🗺️ Back to map',
      onButton: () => {
        // Back on the map, show them where they landed on the board
        this.showScreen('map-screen');
        document.getElementById('leaderboard').classList.add('open');
      }
    });
  }
}
