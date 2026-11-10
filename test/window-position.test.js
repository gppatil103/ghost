import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { isPositionVisible } = require('../src/main/window-position.js');
const { validateSettingsPatch } = require('../src/main/validate.js');

const size = { width: 460, height: 560 };
const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const leftMonitor = { x: -1600, y: 0, width: 1600, height: 900 };

describe('isPositionVisible', () => {
  it('accepts a position inside a display', () => {
    expect(isPositionVisible({ x: 300, y: 150 }, size, [primary])).toBe(true);
  });

  it('accepts a position on a secondary monitor with negative coordinates', () => {
    expect(isPositionVisible({ x: -1000, y: 100 }, size, [primary, leftMonitor])).toBe(true);
  });

  it('rejects a position on a monitor that is no longer connected', () => {
    expect(isPositionVisible({ x: -1000, y: 100 }, size, [primary])).toBe(false);
  });

  it('rejects a window whose header sits above the top of the display', () => {
    expect(isPositionVisible({ x: 300, y: -200 }, size, [primary])).toBe(false);
  });

  it('rejects a window with too little of its header on screen to grab', () => {
    expect(isPositionVisible({ x: 1900, y: 150 }, size, [primary])).toBe(false);
  });

  it('accepts a window partly off screen with enough header left to grab', () => {
    expect(isPositionVisible({ x: 1700, y: 150 }, size, [primary])).toBe(true);
  });

  it('rejects missing or malformed positions', () => {
    expect(isPositionVisible(undefined, size, [primary])).toBe(false);
    expect(isPositionVisible({ x: 'a', y: 1 }, size, [primary])).toBe(false);
  });
});

describe('windowPosition setting', () => {
  it('accepts integer coordinates, including negative ones', () => {
    expect(validateSettingsPatch({ windowPosition: { x: -1000, y: 20 } })).toEqual({
      windowPosition: { x: -1000, y: 20 },
    });
  });

  it('drops extra fields', () => {
    expect(validateSettingsPatch({ windowPosition: { x: 1, y: 2, evil: true } })).toEqual({
      windowPosition: { x: 1, y: 2 },
    });
  });

  it('rejects non-integer or absurd coordinates', () => {
    expect(() => validateSettingsPatch({ windowPosition: { x: 1.5, y: 2 } })).toThrow(/windowPosition/);
    expect(() => validateSettingsPatch({ windowPosition: { x: 1e9, y: 2 } })).toThrow(/windowPosition/);
    expect(() => validateSettingsPatch({ windowPosition: 'top-left' })).toThrow(/windowPosition/);
  });
});
