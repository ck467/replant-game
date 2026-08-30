// Ambient life on the world map: wind gusts, fly swarms, hummingbird flybys.
// Purely decorative — everything lives in a pointer-transparent layer.

function startAmbient() {
  const host = document.getElementById('map-screen');
  const layer = document.createElement('div');
  layer.id = 'ambient-layer';
  host.appendChild(layer);

  const onMap = () => host.classList.contains('active');

  // Little clouds of flies hovering over the meadow
  [[16, 28], [42, 62], [72, 38]].forEach(([x, y], i) => {
    const swarm = document.createElement('div');
    swarm.className = 'fly-swarm';
    swarm.style.left = x + '%';
    swarm.style.top = y + '%';
    swarm.style.animationDelay = -(i * 2.7) + 's';
    for (let d = 0; d < 3; d++) {
      const fly = document.createElement('div');
      fly.className = 'fly' + (d ? ' f' + d : '');
      swarm.appendChild(fly);
    }
    layer.appendChild(swarm);
  });

  // The puzzle screen gets its own ambient layer (leaves + gusts)
  const puzzleHost = document.getElementById('puzzle-screen');
  const puzzleLayer = document.createElement('div');
  puzzleLayer.id = 'ambient-puzzle';
  puzzleHost.appendChild(puzzleLayer);
  const onPuzzle = () => puzzleHost.classList.contains('active');

  // Gusts of wind sweeping across whichever scene is on screen
  setInterval(() => {
    const host = onMap() ? layer : (onPuzzle() ? puzzleLayer : null);
    if (!host) return;
    const gust = document.createElement('div');
    gust.className = 'gust';
    gust.style.top = (8 + Math.random() * 70) + '%';
    gust.style.animationDuration = (4 + Math.random() * 3) + 's';
    gust.addEventListener('animationend', () => gust.remove());
    host.appendChild(gust);
  }, 3500);

  // Leaves drift down over the farm plot while you play
  const LEAF_COLORS = ['#58b04a', '#7ccf5c', '#4a9e3e', '#ffd93d'];
  setInterval(() => {
    if (!onPuzzle()) return;
    const leaf = document.createElement('span');
    leaf.className = 'leaf';
    leaf.style.left = (5 + Math.random() * 90) + '%';
    leaf.style.background = LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)];
    leaf.style.animationDuration = (6 + Math.random() * 4) + 's';
    leaf.addEventListener('animationend', () => leaf.remove());
    puzzleLayer.appendChild(leaf);
  }, 2200);

  // A hummingbird flies through every so often
  const flyBy = () => {
    if (onMap()) {
      const bird = document.createElement('div');
      bird.className = 'hummer';
      bird.style.setProperty('--y0', (12 + Math.random() * 55) + 'vh');
      bird.style.setProperty('--y1', (12 + Math.random() * 55) + 'vh');
      layer.appendChild(bird);
      setTimeout(() => bird.remove(), 14000);
    }
    setTimeout(flyBy, 14000 + Math.random() * 12000);
  };
  setTimeout(flyBy, 2500);
}
