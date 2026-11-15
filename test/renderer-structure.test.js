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
  'watch-badge',
  'smart-toggle',
  'btn-new-chat',
  'btn-settings',
  'btn-maximize',
  'btn-minimize',
  'btn-close',
  'btn-mic',
  'btn-screen',
  'btn-watch',
  'btn-transcript',
  'transcript-panel',
  'transcript-text',
  'transcript-clear',
  'capture-hint',
  'response',
  'response-list',
  'attachment-preview',
  'attachment-thumb-img',
  'attachment-remove',
  'ask-form',
  'ask-input',
  'btn-stop',
  'ask-send',
  'slash-menu',
  'slash-custom',
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
  'custom-action-list',
  'custom-action-add',
  'custom-actions-save',
  'custom-actions-status',
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
      'actions',
      'look',
      'privacy',
      'keys',
    ]));

  it('has no accent picker', () => expect(html).not.toMatch(/data-accent=|class="swatch/));

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

  it('has no chip row: actions live in the "/" menu inside the input box', () => {
    expect(html).not.toMatch(/class="chips"|class="chip\b/);
    expect(html).toMatch(/<form id="ask-form"[^>]*>\s*(<!--[^>]*-->\s*)?<div id="slash-menu"/);
  });

  it('groups every tool in one pill, split by dividers, with window controls outside it', () => {
    const pill = html.match(/<div class="capture-group"[\s\S]*?\n {8}<\/div>/)[0];
    expect(
      [...pill.matchAll(/id="((?:btn-|smart-)[\w-]+)"|class="(tool-divider)"/g)].map((m) => m[1] || m[2]),
    ).toEqual([
      'btn-mic',
      'btn-screen',
      'btn-watch',
      'btn-transcript',
      'tool-divider',
      'smart-toggle',
      'tool-divider',
      'btn-new-chat',
      'tool-divider',
      'btn-settings',
    ]);
    expect(pill).not.toMatch(/btn-maximize|btn-minimize|btn-close/);
  });

  it('keeps the tools in the title bar, window controls last', () => {
    const titlebar = html.match(/<header id="drag-region"[\s\S]*?<\/header>/)[0];
    expect([...titlebar.matchAll(/id="((?:btn-|smart-)[\w-]+)"/g)].map((m) => m[1])).toEqual([
      'btn-mic',
      'btn-screen',
      'btn-watch',
      'btn-transcript',
      'smart-toggle',
      'btn-new-chat',
      'btn-settings',
      'btn-maximize',
      'btn-minimize',
      'btn-close',
    ]);
    const form = html.match(/<form id="ask-form"[\s\S]*?<\/form>/)[0];
    expect([...form.matchAll(/id="(btn-[\w-]+|ask-send)"/g)].map((m) => m[1])).toEqual([
      'btn-stop',
      'ask-send',
    ]);
  });

  it('has no meeting / system-audio capture anywhere', () => {
    expect(html).not.toMatch(/btn-meeting|i-speaker|[Mm]eeting audio/);
    expect(read('capture.js')).not.toMatch(/meeting|loopback/i);
    expect(read('renderer.js')).not.toMatch(/[Mm]eeting/);
  });

  it('lists the five "/" actions in order', () =>
    expect([...html.matchAll(/data-action="(\w+)"/g)].map((m) => m[1])).toEqual([
      'assist',
      'what_to_say',
      'follow_up',
      'recap',
      'solve_code',
      'clipboard',
    ]));

  it('reserves a slot for custom actions at the end of the "/" menu', () =>
    expect(html).toMatch(/data-action="clipboard"[\s\S]*?<div id="slash-custom"[^>]*><\/div>\s*<\/div>/));

  it('ships the region-capture selector page with the same CSP posture', () => {
    const region = read('region.html');
    expect(region).toContain("default-src 'none'; script-src 'self';");
    expect(region).toMatch(/<script src="region.js">/);
    expect(read('region.js')).toMatch(/window\.ghost\.regionResult\(/);
    expect(read('region.js')).toMatch(/window\.ghost\.onRegionImage\(/);
  });

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

  it('floats the "/" menu above the input box', () =>
    expect(css).toMatch(/\.slash-menu \{[^}]*bottom: calc\(100% \+ 6px\)/));

  it('paints an opaque panel so 100% opacity hides everything behind it', () => {
    expect(css).toMatch(/--panel-bg: linear-gradient\(160deg, #[0-9a-f]{6}, #[0-9a-f]{6}\);/);
    expect(css).not.toMatch(/--panel-bg: linear-gradient\([^)]*rgba/);
  });

  it('has a narrow-width rule', () => expect(css).toMatch(/@media \(max-width: 380px\)/));

  it('bundles Inter and uses it as the UI font', () => {
    const files = [...css.matchAll(/url\("assets\/fonts\/([\w.-]+)"\)/g)].map((m) => m[1]);
    expect(files).toEqual(['inter-latin.woff2', 'inter-latin-ext.woff2']);
    for (const f of files)
      expect(fs.existsSync(path.join(__dirname, '..', 'src', 'renderer', 'assets', 'fonts', f))).toBe(true);
    expect(css).toMatch(/font-family: "Inter", "Segoe UI Variable Text"/);
    expect(html).toMatch(/font-src 'self'/);
  });

  it('sizes the segmented control for five tabs', () => {
    expect(css).toMatch(/\.segmented \{[^}]*grid-template-columns: repeat\(5, 1fr\)/);
    expect(css).toMatch(/\.seg-pill \{[^}]*width: calc\(\(100% - 6px\) \/ 5\)/);
  });

  it('hides everything but the input in compact mode', () =>
    expect(css).toMatch(
      /body\.compact \.titlebar, body\.compact \.drawer, body\.compact \.response[^{]*\{ display: none; \}/,
    ));

  it('gives every settings tab the same full height', () =>
    expect(css).toMatch(/#settings-overlay \.sheet \{ height: 100%; \}/));

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
    expect(tut).not.toMatch(/meeting audio|system audio|Zoom|speaker/i);
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

  // The response list background drags the window; entries opt out so text stays selectable.
  it('appends entries to the draggable response list, not the scroll container', () => {
    expect(js).toMatch(/const listEl = \$\('#response-list'\)/);
    expect(js).toMatch(/listEl\.appendChild\(div\)/);
    expect(js).not.toMatch(/responseEl\.appendChild\(/);
    const css = read('styles.css');
    expect(css).toMatch(/\.response-list \{\s*-webkit-app-region: drag;/);
    expect(css).toMatch(/\.entry, \.history-note \{ -webkit-app-region: no-drag;/);
  });

  it('applies the saved theme and follows Windows when set to system', () => {
    expect(js).toMatch(/applyTheme\(settings\.theme\)/);
    expect(js).toMatch(/matchMedia\('\(prefers-color-scheme: dark\)'\)/);
    expect(js).toMatch(/saveSetting\(\{ theme: themeChoice \}\)/);
  });

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

  it('opens the "/" action menu from the input and runs the chosen action', () => {
    expect(js).toMatch(/askInput\.addEventListener\('input', updateSlashMenu\)/);
    expect(js).toMatch(/if \(!value\.startsWith\('\/'\)\) return closeSlashMenu\(\)/);
    expect(js).toMatch(/runAction\(item\.dataset\.action\)/);
    expect(js).not.toMatch(/\.chips|action-btn/);
  });

  it('captures a region through main and keeps the screenshot attached for follow-ups', () => {
    expect(js).toMatch(/await window\.ghost\.captureRegion\(\)/);
    expect(js).not.toMatch(/pendingScreenshot = null; \/\/ consume/);
    expect(js).toMatch(/function newChat\(\) \{[\s\S]{0,400}pendingScreenshot = null;/);
  });

  it('grabs a watch-mode frame per message and reads the clipboard for "/clipboard" and paste', () => {
    expect(js).toMatch(/window\.ghostCapture\.isWatchOn\(\)[\s\S]{0,120}grabWatchFrame\(\)/);
    expect(js).toMatch(/if \(item\.dataset\.action === 'clipboard'\) explainClipboard\(\)/);
    expect(js).toMatch(/askInput\.addEventListener\('paste'/);
    expect(read('capture.js')).toMatch(/captureScreenshot: captureScreenshotOrFrame/);
  });

  it('mirrors custom actions into the "/" menu and runs them as custom:<id>', () => {
    expect(js).toMatch(/item\.dataset\.action = `custom:\$\{a\.id\}`/);
    expect(js).toMatch(/setSettings\(\{ customActions: list \}\)/);
    expect(js).toMatch(/const TABS = \['ai', 'actions', 'look', 'privacy', 'keys'\]/);
  });

  it('enters compact mode from the shortcut and leaves it when an answer starts', () => {
    expect(js).toMatch(/window\.ghost\.onQuickAsk\(\(\) => setCompact\(true\)\)/);
    expect(js).toMatch(/if \(compact\) setCompact\(false\); \/\/ the answer needs the full panel/);
  });

  it('maximizes through main and swaps the icon', () => {
    expect(js).toMatch(/await window\.ghost\.toggleMaximize\(\)/);
    expect(js).toMatch(/'#i-collapse' : '#i-expand'/);
  });
});
