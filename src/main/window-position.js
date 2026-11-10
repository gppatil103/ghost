// Decides whether a saved window position is still usable. The panel is
// frameless and can only be moved by dragging it, so restoring it somewhere
// the user can't grab (a monitor that was unplugged, say) would strand it.

const MIN_GRAB_WIDTH = 100; // px of the window that must overlap a display
const GRAB_HEIGHT = 40; // px of the header that must fit above the display's bottom

// `areas` are display work areas: { x, y, width, height }.
function isPositionVisible(position, size, areas) {
  if (!position || !Number.isInteger(position.x) || !Number.isInteger(position.y)) return false;
  const { x, y } = position;
  return areas.some((area) => {
    const overlap = Math.min(x + size.width, area.x + area.width) - Math.max(x, area.x);
    return overlap >= MIN_GRAB_WIDTH && y >= area.y && y + GRAB_HEIGHT <= area.y + area.height;
  });
}

module.exports = { isPositionVisible };
