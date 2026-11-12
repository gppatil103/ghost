import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const v = require('../src/main/validate.js');

const basePayload = { requestId: 'req_1', action: 'assist' };

describe('validateRunPayload', () => {
  it('accepts a minimal payload and fills defaults', () => {
    const out = v.validateRunPayload(basePayload);
    expect(out).toMatchObject({
      requestId: 'req_1',
      action: 'assist',
      transcript: '',
      userQuestion: '',
      history: [],
    });
    expect(out.imageBase64).toBeUndefined();
  });

  it('rejects unknown actions, including prototype keys', () => {
    expect(() => v.validateRunPayload({ ...basePayload, action: 'constructor' })).toThrow(/Unknown action/);
    expect(() => v.validateRunPayload({ ...basePayload, action: '__proto__' })).toThrow(/Unknown action/);
  });

  it('ignores a renderer-supplied provider (not part of the payload)', () => {
    const out = v.validateRunPayload({ ...basePayload, provider: 'constructor' });
    expect(out).not.toHaveProperty('provider');
  });

  it('rejects bad request ids', () => {
    expect(() => v.validateRunPayload({ ...basePayload, requestId: '../x' })).toThrow(/requestId/);
  });

  it('enforces the image size limit and mime allowlist', () => {
    const tooBig = 'A'.repeat(v.LIMITS.imageBase64Chars + 4);
    expect(() => v.validateRunPayload({ ...basePayload, imageBase64: tooBig })).toThrow(/too large/);
    expect(() =>
      v.validateRunPayload({ ...basePayload, imageBase64: 'AAAA', imageMimeType: 'image/svg+xml' }),
    ).toThrow(/Unsupported/);
    expect(() => v.validateRunPayload({ ...basePayload, imageBase64: '<script>' })).toThrow(/Invalid image/);
    const ok = v.validateRunPayload({ ...basePayload, imageBase64: 'AAAA', imageMimeType: 'image/jpeg' });
    expect(ok.imageMimeType).toBe('image/jpeg');
  });

  it('caps question length', () => {
    expect(() =>
      v.validateRunPayload({ ...basePayload, userQuestion: 'x'.repeat(v.LIMITS.userQuestionChars + 1) }),
    ).toThrow(/too long/);
  });

  it('validates and trims history', () => {
    const history = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      text: `t${i}`,
    }));
    const out = v.validateRunPayload({ ...basePayload, history });
    expect(out.history).toHaveLength(v.LIMITS.historyTurns);
    expect(out.history.at(-1).text).toBe('t29');
    expect(() => v.validateRunPayload({ ...basePayload, history: [{ role: 'system', text: 'x' }] })).toThrow(
      /role/,
    );
  });
});

describe('validateClip', () => {
  it('allows webm/wav only and caps size', () => {
    expect(v.validateClip({ audioBase64: 'AAAA', mimeType: 'audio/webm' })).toEqual({
      audioBase64: 'AAAA',
      mimeType: 'audio/webm',
    });
    expect(() => v.validateClip({ audioBase64: 'AAAA', mimeType: 'video/mp4' })).toThrow(/Unsupported/);
    expect(() =>
      v.validateClip({ audioBase64: 'A'.repeat(v.LIMITS.audioBase64Chars + 4), mimeType: 'audio/webm' }),
    ).toThrow(/too large/);
  });
});

describe('validateSettingsPatch', () => {
  it('accepts known keys with the right types', () => {
    expect(v.validateSettingsPatch({ smartMode: true, provider: 'gemini' })).toEqual({
      smartMode: true,
      provider: 'gemini',
    });
  });

  it('rejects unknown keys and wrong types', () => {
    expect(() => v.validateSettingsPatch({ evil: 1 })).toThrow(/Unknown setting/);
    expect(() => v.validateSettingsPatch({ smartMode: 'yes' })).toThrow(/true\/false/);
    expect(() => v.validateSettingsPatch({ provider: 'toString' })).toThrow(/Unknown provider/);
    expect(() => v.validateSettingsPatch({ panelOpacity: 5 })).toThrow(/panelOpacity/);
  });

  it('validates accent', () => {
    for (const a of ['blue', 'violet', 'green', 'orange'])
      expect(v.validateSettingsPatch({ accent: a })).toEqual({ accent: a });
    expect(() => v.validateSettingsPatch({ accent: 'pink' })).toThrow(/accent/);
    expect(() => v.validateSettingsPatch({ accent: 1 })).toThrow(/accent/);
    expect(v.ACCENT_IDS).toEqual(['blue', 'violet', 'green', 'orange']);
  });

  it('validates theme', () => {
    for (const t of ['system', 'light', 'dark'])
      expect(v.validateSettingsPatch({ theme: t })).toEqual({ theme: t });
    expect(() => v.validateSettingsPatch({ theme: 'sepia' })).toThrow(/theme/);
    expect(() => v.validateSettingsPatch({ theme: true })).toThrow(/theme/);
    expect(v.THEME_IDS).toEqual(['system', 'light', 'dark']);
  });

  it('does not allow prototype pollution through __proto__', () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}}');
    expect(() => v.validateSettingsPatch(patch)).toThrow(/Unknown setting/);
    expect({}.polluted).toBeUndefined();
  });

  it('validates model overrides and shortcuts', () => {
    expect(v.validateSettingsPatch({ models: { openai: { fast: 'gpt-x', smart: '' } } })).toEqual({
      models: { openai: { fast: 'gpt-x' } },
    });
    expect(() => v.validateSettingsPatch({ models: { openai: { fast: 'bad id!' } } })).toThrow(/model id/);
    expect(() => v.validateSettingsPatch({ models: { nope: {} } })).toThrow(/provider/);
    expect(v.validateSettingsPatch({ shortcuts: { assist: 'Alt+F1', recap: '' } })).toEqual({
      shortcuts: { assist: 'Alt+F1', recap: '' },
    });
    expect(() => v.validateSettingsPatch({ shortcuts: { assist: 'Ctrl + ; rm' } })).toThrow(
      /Invalid shortcut/,
    );
    expect(() => v.validateSettingsPatch({ shortcuts: { launch_nukes: 'F1' } })).toThrow(/Unknown shortcut/);
  });
});

describe('other validators', () => {
  it('validateApiKeyArgs', () => {
    expect(v.validateApiKeyArgs({ provider: 'openai', key: '  sk-abc  ' })).toEqual({
      provider: 'openai',
      key: 'sk-abc',
    });
    expect(() => v.validateApiKeyArgs({ provider: 'x', key: 'k' })).toThrow(/provider/);
    expect(() => v.validateApiKeyArgs({ provider: 'openai', key: 'has space' })).toThrow(/API key/);
  });

  it('validateResize clamps', () => {
    expect(v.validateResize({ width: 10, height: 99999 })).toEqual({
      width: v.PANEL_SIZE.minWidth,
      height: v.PANEL_SIZE.maxHeight,
    });
    expect(v.validateResize({ width: 'x' })).toEqual({ width: undefined, height: undefined });
  });
});

describe('RateLimiter', () => {
  it('allows max calls per window', () => {
    let t = 0;
    const rl = new v.RateLimiter(2, 1000, () => t);
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(false);
    t = 1001;
    expect(rl.tryAcquire()).toBe(true);
  });
});
