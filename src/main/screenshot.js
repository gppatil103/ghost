// Main-process screenshots. A whole display is grabbed with desktopCapturer
// (no getDisplayMedia round-trip through the renderer), then cropped,
// downscaled and JPEG-encoded with nativeImage. Used for region capture and
// for images read from the clipboard. The renderer's getDisplayMedia path
// still serves "Solve code" and Watch mode, which want a live stream.
const { desktopCapturer } = require('electron');

const MAX_SIDE = 1920; // longest edge sent to the model; smaller = fewer tokens
const JPEG_QUALITY = 85;

// Resolves to a NativeImage of the display at its physical pixel size.
async function grabDisplay(display) {
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale),
    },
  });
  if (!sources.length) throw new Error('No screen to capture');
  const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  const image = source.thumbnail;
  if (!image || image.isEmpty()) throw new Error('Screen capture returned no pixels');
  return image;
}

// `rect` is in DIP coordinates relative to the image's display (null = whole
// image); `scale` converts it to the image's pixels. The result is capped at
// `maxSide` on its longest edge and encoded as base64 JPEG.
function encodeImage(image, rect = null, scale = 1, maxSide = MAX_SIDE) {
  let img = image;
  if (rect) {
    const size = image.getSize();
    const x = Math.max(0, Math.round(rect.x * scale));
    const y = Math.max(0, Math.round(rect.y * scale));
    const width = Math.min(size.width - x, Math.round(rect.width * scale));
    const height = Math.min(size.height - y, Math.round(rect.height * scale));
    if (width < 1 || height < 1) throw new Error('The selected area is empty');
    img = image.crop({ x, y, width, height });
  }
  const { width, height } = img.getSize();
  const longest = Math.max(width, height);
  if (longest > maxSide) {
    const f = maxSide / longest;
    img = img.resize({ width: Math.round(width * f), height: Math.round(height * f), quality: 'good' });
  }
  return { base64: img.toJPEG(JPEG_QUALITY).toString('base64'), mimeType: 'image/jpeg' };
}

module.exports = { grabDisplay, encodeImage, MAX_SIDE, JPEG_QUALITY };
