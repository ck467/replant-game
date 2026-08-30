// Timed challenge: plant 3 full trees before the 2-minute clock runs out.
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
  }

  // targetPatch: when the run starts from tapping a patch, the first tree
  // restores that exact patch; later trees green random barren ones.
  start(targetPatch = null) {
    this.targetPatch = targetPatch;
    this.running = true;
    this.treesDone = 0;
    this.deadline = null; // clock starts on the first crate open
    this.hud.hidden = false;
    this.renderHud(CONFIG.CHALLENGE.TIME_MS);
    this.showScreen('puzzle-screen');
    this.tick = setInterval(() => this.onTick(), 200);
    this.nextTree();
  }

  // carry: {board, species} — leftover items from the previous tree stay on
  // the board, and the species stays the same so they don't shape-shift.
  nextTree(carry = null) {
    const species = carry
      ? carry.species
      : CONFIG.SPECIES[Math.floor(Math.random() * CONFIG.SPECIES.length)];
    // Coach once per account, on the run's first tree only
    const acc = this.getAccount();
    this.puzzle = new Puzzle(species, {
      spawnBudget: Infinity,
      board: carry ? carry.board : undefined,
      tutor: this.treesDone === 0 && !acc.tutorDone,
      onTutorComplete: () => {
        const a = this.getAccount();
        a.tutorDone = true;
        saveAccount(a);
      },
      onSpawn: () => {
        if (!this.deadline) this.deadline = Date.now() + CONFIG.CHALLENGE.TIME_MS;
      },
      onWin: () => this.treeWon(),
      onLose: () => {}, // unlimited spawns: only the clock can end the run
      onQuit: () => this.abort()
    });
  }

  treeWon() {
    if (!this.running) return; // the clock ran out during the win celebration
    const grown = this.puzzle; // keeps the finished board (and its tree) on screen
    this.puzzle = null;
    this.treesDone++;
    const acc = this.getAccount();
    if (this.targetPatch != null && this.isPatchBarren(this.targetPatch)) {
      this.socket.emit('restore', { idx: this.targetPatch, name: acc.name, avatar: acc.avatar });
    } else {
      this.socket.emit('challenge-tree', { name: acc.name, avatar: acc.avatar });
    }
    this.targetPatch = null;
    // The clock always runs its course — beating the goal just keeps counting
    if (this.treesDone === CONFIG.CHALLENGE.GOAL_TREES) {
      this.toast(`🏆 Goal reached — ${this.treesDone} trees! Keep planting!`);
    } else {
      this.toast(`🌳 Tree ${this.treesDone}/${CONFIG.CHALLENGE.GOAL_TREES} planted — keep going!`);
    }
    this.renderHud(this.deadline - Date.now());
    // The tree lingers on the plot while the toast shows; once the toast
    // fades it flies into the counter, and then the next board arrives.
    this.celebration = setTimeout(() => {
      if (!this.running) return;
      grown.flyToCounter();
      this.celebration = setTimeout(() => {
        if (!this.running) return;
        // Leftover items stay on the board for the next tree
        const leftover = grown.board.slice();
        leftover[grown.winCellIdx] = 0; // the tree itself flew away
        const hasItems = leftover.some(v => v > 0);
        this.nextTree(hasItems ? { board: leftover, species: grown.species } : null);
      }, 700);
    }, 2500);
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
    clearTimeout(this.celebration);
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
          timeMs: CONFIG.CHALLENGE.TIME_MS
        })
      });
      const data = await res.json();
      rankLine = ` You're #${data.rank} of ${data.total} planters!`;
    } catch (e) { /* offline? show result without rank */ }

    const solution = CONFIG.SOLUTIONS[Math.floor(Math.random() * CONFIG.SOLUTIONS.length)];
    this.showOverlay({
      title: success ? `🏆 Amazing, ${acc.name}!` : "⏰ Time's up!",
      body: `You planted ${this.treesDone} tree${this.treesDone === 1 ? '' : 's'}. Every tree counts!${rankLine}` +
        ` 🌱 In real life: ${solution}!`,
      buttonText: '🔁 Play again',
      onButton: () => this.start(),
      button2Text: '🗺️ Back to map',
      onButton2: () => this.showScreen('map-screen')
    });
  }
}
