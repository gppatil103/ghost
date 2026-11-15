// encodeImage does the crop/downscale maths on a NativeImage-shaped object,
// so it can be checked here with a fake image and no Electron runtime.
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { encodeImage, MAX_SIDE } = require('../src/main/screenshot.js');

function fakeImage(width, height, log = []) {
  return {
    getSize: () => ({ width, height }),
    isEmpty: () => false,
    crop(rect) {
      log.push(['crop', rect]);
      return fakeImage(rect.width, rect.height, log);
    },
    resize({ width: w, height: h }) {
      log.push(['resize', { width: w, height: h }]);
      return fakeImage(w, h, log);
    },
    toJPEG: () => Buffer.from('jpeg-bytes'),
  };
}

describe('encodeImage', () => {
  it('encodes the whole image when there is no rect and it is small enough', () => {
    const log = [];
    const out = encodeImage(fakeImage(800, 600, log));
    expect(out).toEqual({ base64: Buffer.from('jpeg-bytes').toString('base64'), mimeType: 'image/jpeg' });
    expect(log).toEqual([]);
  });

  it('crops in physical pixels using the display scale factor', () => {
    const log = [];
    encodeImage(fakeImage(3840, 2160, log), { x: 100, y: 50, width: 400, height: 300 }, 2);
    expect(log[0]).toEqual(['crop', { x: 200, y: 100, width: 800, height: 600 }]);
  });

  it('clamps a rect that runs off the edge and rejects an empty one', () => {
    const log = [];
    encodeImage(fakeImage(1000, 1000, log), { x: 900, y: 900, width: 500, height: 500 }, 1);
    expect(log[0]).toEqual(['crop', { x: 900, y: 900, width: 100, height: 100 }]);
    expect(() => encodeImage(fakeImage(1000, 1000), { x: 1000, y: 0, width: 10, height: 10 }, 1)).toThrow(
      /empty/,
    );
  });

  it('downscales so the longest edge is at most MAX_SIDE', () => {
    const log = [];
    encodeImage(fakeImage(3840, 2160, log));
    expect(log[0]).toEqual(['resize', { width: MAX_SIDE, height: 1080 }]);
  });

  it('can skip the downscale for a full-resolution preview', () => {
    const log = [];
    encodeImage(fakeImage(3840, 2160, log), null, 1, Infinity);
    expect(log).toEqual([]);
  });
});
