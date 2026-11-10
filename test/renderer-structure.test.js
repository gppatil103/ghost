// Static checks on the renderer's HTML/CSS/JS. renderer.js, capture.js and
// tutorial.js look elements up by ID, so a missing or duplicated ID silently
// breaks a feature; these tests pin the contract without a DOM environment.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', f), 'utf8');
const html = read('index.html');

const REQUIRED_IDS = [
  'panel', 'drag-region', 'status-dot', 'rec-badge', 'smart-toggle', 'btn-new-chat', 'btn-settings',
  'btn-minimize', 'btn-close', 'btn-mic', 'btn-meeting', 'btn-screen', 'btn-transcript', 'transcript-panel',
  'transcript-text', 'transcript-clear', 'capture-hint', 'response', 'attachment-preview', 'attachment-thumb-img',
  'attachment-remove', 'ask-form', 'ask-input', 'btn-stop', 'ask-send', 'settings-overlay', 'settings-close',
  'provider-select', 'key-input', 'key-save', 'key-clear', 'key-status', 'model-fast', 'model-smart', 'models-save',
  'models-status', 'save-history', 'keep-transcript', 'panel-opacity', 'panel-opacity-value', 'hide-from-capture',
  'shortcut-list', 'shortcuts-save', 'shortcuts-reset', 'shortcuts-status', 'rerun-tutorial', 'tutorial-overlay',
  'tutorial-sheet', 'capture-video', 'capture-canvas',
];

describe('index.html', () => {
  it.each(REQUIRED_IDS)('has #%s exactly once', (id) =>
    expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1));

  it('drops the header opacity slider', () => expect(html).not.toMatch(/id="quick-opacity"/));

  it('has the four settings tabs in order', () =>
    expect([...html.matchAll(/class="seg"[^>]*data-tab="(\w+)"/g)].map((m) => m[1])).toEqual([
      'ai', 'look', 'privacy', 'keys',
    ]));

  it('has the four accent swatches', () =>
    expect([...html.matchAll(/data-accent="(\w+)"/g)].map((m) => m[1])).toEqual([
      'blue', 'violet', 'green', 'orange',
    ]));

  it('has the five action chips in order', () =>
    expect([...html.matchAll(/data-action="(\w+)"/g)].map((m) => m[1])).toEqual([
      'assist', 'what_to_say', 'follow_up', 'recap', 'solve_code',
    ]));

  it('defines every icon used', () => {
    const used = new Set([...html.matchAll(/href="#(i-[\w-]+)"/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) expect(html).toContain(`<symbol id="${id}"`);
  });

  it('keeps the CSP unchanged', () => expect(html).toContain("default-src 'none'; script-src 'self';"));

  it('toast is a polite live region', () => expect(html).toMatch(/id="capture-hint"[^>]*aria-live="polite"/));

  it('overlays start hidden via the hidden attribute', () => {
    expect(html).toMatch(/id="settings-overlay"[^>]*\shidden[\s>]/);
    expect(html).toMatch(/id="tutorial-overlay"[^>]*\shidden[\s>]/);
  });
});
