// Region selector. Main sends a frozen screenshot of the display; the user
// drags a rectangle (or clicks for the whole screen, or presses Esc). The
// rectangle goes back to main in this window's CSS pixels, which match the
// display's DIP coordinates because the window covers the display exactly.
(function () {
  const shot = document.getElementById('shot');
  const dim = document.getElementById('dim');
  const box = document.getElementById('box');
  const sizeLabel = document.getElementById('size');
  const MIN_DRAG = 4; // smaller than this is a click → whole screen

  let start = null;
  let dragging = false;
  let finished = false;

  window.ghost.onRegionImage((dataUrl) => {
    shot.src = dataUrl;
  });

  function normalize(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function drawBox(rect) {
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    sizeLabel.textContent = `${rect.width} × ${rect.height}`;
    box.hidden = false;
    dim.hidden = true;
  }

  function finish(result) {
    if (finished) return;
    finished = true;
    window.ghost.regionResult(result);
  }

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || finished) return;
    start = { x: e.clientX, y: e.clientY };
    dragging = true;
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = normalize(start, { x: e.clientX, y: e.clientY });
    if (rect.width >= MIN_DRAG || rect.height >= MIN_DRAG) drawBox(rect);
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging || e.button !== 0) return;
    dragging = false;
    const rect = normalize(start, { x: e.clientX, y: e.clientY });
    const isClick = rect.width < MIN_DRAG || rect.height < MIN_DRAG;
    finish({ cancelled: false, rect: isClick ? null : rect });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') finish({ cancelled: true, rect: null });
    else if (e.key === 'Enter') finish({ cancelled: false, rect: null });
  });
})();
