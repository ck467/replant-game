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

  // Gusts of wind sweeping across
  setInterval(() => {
    if (!onMap()) return;
    const gust = document.createElement('div');
    gust.className = 'gust';
    gust.style.top = (8 + Math.random() * 70) + '%';
    gust.style.animationDuration = (4 + Math.random() * 3) + 's';
    gust.addEventListener('animationend', () => gust.remove());
    layer.appendChild(gust);
  }, 3500);

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
