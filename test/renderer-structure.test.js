// Static checks on the renderer's HTML/CSS/JS. renderer.js, capture.js and
// tutorial.js look elements up by ID, so a missing or duplicated ID silently
// breaks a feature; these tests pin the contract without a DOM environment.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', f), 'utf8');
const html = read('index.html');

const REQUIRED_IDS = [
  'panel',
  'drag-region',
  'status-dot',
  'rec-badge',
  'smart-toggle',
  'btn-new-chat',
  'btn-settings',
  'btn-minimize',
  'btn-close',
  'btn-mic',
  'btn-meeting',
  'btn-screen',
  'btn-transcript',
  'transcript-panel',
  'transcript-text',
  'transcript-clear',
  'capture-hint',
  'response',
  'attachment-preview',
  'attachment-thumb-img',
  'attachment-remove',
  'ask-form',
  'ask-input',
  'btn-stop',
  'ask-send',
  'settings-overlay',
  'settings-close',
  'provider-select',
  'key-input',
  'key-save',
  'key-clear',
  'key-status',
  'model-fast',
  'model-smart',
  'models-save',
  'models-status',
  'save-history',
  'keep-transcript',
  'panel-opacity',
  'panel-opacity-value',
  'hide-from-capture',
  'shortcut-list',
  'shortcuts-save',
  'shortcuts-reset',
  'shortcuts-status',
  'rerun-tutorial',
  'tutorial-overlay',
  'tutorial-sheet',
  'capture-video',
  'capture-canvas',
];

describe('index.html', () => {
  it.each(REQUIRED_IDS)('has #%s exactly once', (id) =>
    expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1),
  );

  it('drops the header opacity slider', () => expect(html).not.toMatch(/id="quick-opacity"/));

  it('has the four settings tabs in order', () =>
    expect([...html.matchAll(/class="seg"[^>]*data-tab="(\w+)"/g)].map((m) => m[1])).toEqual([
      'ai',
      'look',
      'privacy',
      'keys',
    ]));

  it('has the four accent swatches', () =>
    expect([...html.matchAll(/data-accent="(\w+)"/g)].map((m) => m[1])).toEqual([
      'blue',
      'violet',
      'green',
      'orange',
    ]));

  it('has the three theme options in order', () =>
    expect([...html.matchAll(/data-theme-choice="(\w+)"/g)].map((m) => m[1])).toEqual([
      'system',
      'light',
      'dark',
    ]));

  it('has the ambient glass backdrop inside the panel', () =>
    expect(html).toMatch(
      /<div id="panel" class="panel">\s*(<!--[^>]*-->\s*)?<div class="ambient" aria-hidden="true">/,
    ));

  it('has the five action chips in order', () =>
    expect([...html.matchAll(/data-action="(\w+)"/g)].map((m) => m[1])).toEqual([
      'assist',
      'what_to_say',
      'follow_up',
      'recap',
      'solve_code',
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

describe('styles.css', () => {
  const css = read('styles.css');

  it('defines spring easing tokens with linear()', () => {
    expect(css).toMatch(/--spring:\s*linear\(/);
    expect(css).toMatch(/--spring-bouncy:\s*linear\(/);
  });

  it('honours reduced motion, transparency and contrast', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
    expect(css).toMatch(/@media \(prefers-contrast: more\)/);
  });

  it('keeps the chip row scrollable inside the drag region', () =>
    expect(css).toMatch(/\.chips\s*\{[^}]*-webkit-app-region:\s*no-drag/));

  it('has a narrow-width rule', () => expect(css).toMatch(/@media \(max-width: 380px\)/));

  it('loads no external resources', () => expect(css).not.toMatch(/@import|url\(\s*['"]?https?:/));

  it('hides overlays that carry the hidden attribute', () =>
    expect(css).toMatch(/\.overlay\[hidden\]\s*\{[^}]*display:\s*none/));

  // Review fix: Settings save errors are toasted while the sheet covers the panel.
  it('shows the toast above open sheets', () => {
    expect(css).toMatch(/\.toast\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.toast\s*\{[^}]*z-index:\s*60/);
  });

  // Review fix: REC is a privacy indicator and must never be covered by the controls.
  it('never lets the title-bar controls cover the REC badge', () => {
    expect(css).toMatch(/\.rec-badge\s*\{[^}]*flex-shrink:\s*0/);
    expect(css).toMatch(/\.titlebar-controls\s*\{[^}]*flex-shrink:\s*0/);
    expect(css).toMatch(/\.brand-name\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});

describe('tutorial.js', () => {
  const tut = read('tutorial.js');

  it('points at the new controls', () => {
    expect(tut).not.toMatch(/"Screen" pill|"Mic" or "Meeting"/);
    expect(tut).toMatch(/icons? in the title bar/);
    expect(tut).toMatch(/Settings → AI|AI tab/);
  });

  it('opens and closes through the shared overlay helpers', () => {
    expect(tut).toMatch(/window\.ghostUI\.openOverlay\(overlay\)/);
    expect(tut).toMatch(/window\.ghostUI\.closeOverlay\(overlay\)/);
    expect(tut).not.toMatch(/overlay\.classList\.(add|remove)\('hidden'\)/);
  });
});

describe('renderer.js', () => {
  const js = read('renderer.js');

  it('routes every status message through showToast', () => {
    // The only direct write is the one inside showToast itself.
    expect(js.match(/captureHint\.textContent\s*=/g)).toHaveLength(1);
    expect(js).toMatch(/function showToast\(text\) \{[^}]*captureHint\.textContent = text;/);
  });

  it('no longer references the header opacity slider', () =>
    expect(js).not.toMatch(/quick-opacity|quickOpacity/));

  it('applies the saved theme and follows Windows when set to system', () => {
    expect(js).toMatch(/applyTheme\(settings\.theme\)/);
    expect(js).toMatch(/matchMedia\('\(prefers-color-scheme: dark\)'\)/);
    expect(js).toMatch(/saveSetting\(\{ theme: themeChoice \}\)/);
  });

  it('falls back to blue for unknown accents', () =>
    expect(js).toMatch(/ACCENTS\[[^\]]+\]\s*\|\|\s*ACCENTS\.blue/));

  it('drives overlays and the transcript drawer with the new state hooks', () => {
    expect(js).toMatch(/window\.ghostUI\s*=\s*\{\s*openOverlay,\s*closeOverlay\s*\}/);
    expect(js).toMatch(/transcriptPanel\.classList\.toggle\('open'/);
    expect(js).not.toMatch(/settingsOverlay\.classList\.(add|remove)\('hidden'\)/);
  });

  // Review fix: a kept transcript is still sent to the AI, so it must stay visible/clearable.
  it('keeps the transcript button while any transcript text exists', () => {
    expect(js).toMatch(/btnTranscript\.hidden = !\(on \|\| hasText\)/);
    expect(js).toMatch(/const hasText = !!window\.ghostCapture\.getCombinedTranscript\(\)/);
    expect(js).toMatch(/onTranscriptChange\(\(\) => \{[^}]*updateRecBadge\(\)/);
  });

  // Review fix: a plain mouse wheel must scroll the horizontal chip row.
  it('maps vertical wheel to horizontal chip scrolling', () =>
    expect(js).toMatch(/chips\.addEventListener\(\s*'wheel'[\s\S]{0,400}\{ passive: false \}/));
});
