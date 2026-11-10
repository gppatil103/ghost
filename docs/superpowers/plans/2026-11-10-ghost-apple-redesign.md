# Ghost Apple-style Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-lay out and restyle Ghost's renderer into a quieter, Apple-style dark-glass panel with tabbed Settings, a selectable accent, and CSS spring motion — same features.

**Architecture:** Renderer-only rewrite of `index.html` + `styles.css`, targeted edits to `renderer.js` / `tutorial.js`, plus one validated `accent` setting in main. Structural guarantees (required IDs, a11y media queries) are pinned by static-file tests that read the HTML/CSS as text — no DOM test environment needed.

**Tech Stack:** Electron 44 (Chromium with CSS `linear()` easing), vanilla JS, Vitest, ESLint.

**Spec:** `docs/superpowers/specs/2026-11-10-ghost-apple-redesign-design.md`

## Global Constraints

- No new dependencies; no external scripts, fonts, or stylesheets; CSP in `index.html` unchanged.
- Main process changes limited to the `accent` setting (validate.js + store.js).
- Every element ID currently used by `renderer.js`, `capture.js`, `tutorial.js` stays, except `#quick-opacity` (deleted).
- Accent values exactly: `blue #5b8cff` (default), `violet #9b7bff`, `green #34c77b`, `orange #ff9f43`.
- Settings tabs exactly: `AI · Look · Privacy · Keys`.
- Animate only `transform` / `opacity` (plus the transcript drawer's `grid-template-rows`).
- Font stack: `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`.
- `npm test` and `npm run lint` pass after every task.

## Review Focus

1. **Status messages still reach the user** (meeting consent, mic denied, "still answering", save errors) — the hint line becomes a toast; it must show every message `renderer.js` writes to `#capture-hint`. → Task 4 test + manual check.
2. **Drag vs. scroll vs. select** — the title bar and empty areas must still drag the window; chip row must wheel-scroll; answer text must stay selectable. → Task 3 CSS test (`.chips` is `no-drag`) + Task 6 manual.
3. **Hidden sheet stays hidden after close animation** — closed Settings/tutorial must not intercept clicks (overlay `display:none` after exit). → Task 4 implementation rule + Task 6 manual.
4. **Unknown/old accent value in stored settings** (e.g. hand-edited file) — UI must fall back to blue instead of a broken color. → Task 4 `applyAccent` fallback; Task 1 validator rejects.
5. **Narrow window (320px min width)** — title bar must not overflow. → Task 3 `@media (max-width: 380px)` rule + Task 6 manual at 320px.

---

### Task 1: `accent` setting

**Files:**
- Modify: `src/main/validate.js` (SETTINGS_SCHEMA, ~line 177; export `ACCENT_IDS`)
- Modify: `src/main/store.js` (DEFAULT_SETTINGS, ~line 27)
- Test: `test/validate.test.js` (inside `describe('validateSettingsPatch')`)

**Interfaces:**
- Produces: `ACCENT_IDS = ['blue', 'violet', 'green', 'orange']` exported from validate.js; `settings.accent` returned by `window.ghost.getSettings()`, default `'blue'`.

- [ ] **Step 1: Write the failing test**

```js
it('validates accent', () => {
  for (const a of ['blue', 'violet', 'green', 'orange'])
    expect(v.validateSettingsPatch({ accent: a })).toEqual({ accent: a });
  expect(() => v.validateSettingsPatch({ accent: 'pink' })).toThrow(/accent/);
  expect(() => v.validateSettingsPatch({ accent: 1 })).toThrow(/accent/);
  expect(v.ACCENT_IDS).toEqual(['blue', 'violet', 'green', 'orange']);
});
```

- [ ] **Step 2: Run** `npx vitest run test/validate.test.js` — Expected: FAIL (`Unknown setting: accent`).
- [ ] **Step 3: Implement** — add `ACCENT_IDS`, schema entry `accent: (v) => (ACCENT_IDS.includes(v) ? v : fail('accent must be one of ' + ACCENT_IDS.join(', ')))`, export `ACCENT_IDS`; add `accent: 'blue'` to `DEFAULT_SETTINGS` with a one-line comment.
- [ ] **Step 4: Run** `npx vitest run test/validate.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(settings): add validated accent setting`

---

### Task 2: New panel markup (`index.html`)

**Files:**
- Modify: `src/renderer/index.html` (full rewrite of `<body>`; `<head>` CSP unchanged)
- Create: `test/renderer-structure.test.js`

**Interfaces:**
- Produces (used by Tasks 3–5):
  - SVG sprite: `<svg class="sprite" aria-hidden="true">` with `<symbol id="i-NAME" viewBox="0 0 24 24">` for NAME in `mic speaker screen transcript bolt plus gear minus x send stop copy retry code`. Use: `<svg class="icon"><use href="#i-mic"/></svg>`.
  - Title bar `header#drag-region.titlebar`; capture group `.capture-group` holding `#btn-mic`, `#btn-meeting`, `#btn-screen`, `#btn-transcript` (all `.icon-toggle`, each with `aria-label` + `title`; `#btn-transcript` also has `hidden` attribute initially).
  - Smart toggle: keep `<input type="checkbox" id="smart-toggle">` inside `label.smart-toggle` showing the bolt icon.
  - Chip row `div.chips` containing `button.chip.action-btn[data-action]` ×5 in order assist, what_to_say, follow_up, recap, solve_code (solve_code also `.chip--accent`).
  - Transcript drawer: `#transcript-panel.drawer` (class `open` toggles it; no longer uses `.hidden`), inner `#transcript-text`, `#transcript-clear`.
  - Toast: `<div id="capture-hint" class="toast" role="status" aria-live="polite"></div>`.
  - `form#ask-form.inputbar` containing `#attachment-preview` (with `#attachment-thumb-img`, `#attachment-remove`), `#ask-input`, `#btn-stop`, `#ask-send`.
  - Settings: `#settings-overlay.overlay` > `.sheet` > header with `#settings-close`; `div.segmented[role=tablist]` with four `button.seg[role=tab][data-tab]` for `ai look privacy keys` plus `span.seg-pill`; four `section.tab-page[data-tab][role=tabpanel]`.
  - Look tab: `div.swatches[role=radiogroup]` with `button.swatch[data-accent][role=radio]` ×4 (blue, violet, green, orange); `#panel-opacity` + `#panel-opacity-value`.
  - Privacy tab: `#save-history`, `#keep-transcript`, `#hide-from-capture`; consent/best-effort text and Zoom note each inside `<details class="learn-more"><summary>Learn more</summary>…</details>` (copy unchanged from current file).
  - AI tab: `#provider-select`, `#key-input`, `#key-save`, `#key-clear`, `#key-status`, `#model-fast`, `#model-smart`, `#models-save`, `#models-status`.
  - Keys tab: `#shortcut-list`, `#shortcuts-save`, `#shortcuts-reset`, `#shortcuts-status`, `#rerun-tutorial`.
  - Both overlays (`#settings-overlay`, `#tutorial-overlay`) start with the `hidden` **attribute** (not the `.hidden` class); Task 4 toggles it.
  - Unchanged: `#tutorial-sheet`, `#capture-video`, `#capture-canvas`, script tags and order.

- [ ] **Step 1: Write the failing test** `test/renderer-structure.test.js` — reads `src/renderer/index.html` with `fs.readFileSync`, then:

```js
const REQUIRED_IDS = ['panel','drag-region','status-dot','rec-badge','smart-toggle','btn-new-chat','btn-settings',
  'btn-minimize','btn-close','btn-mic','btn-meeting','btn-screen','btn-transcript','transcript-panel',
  'transcript-text','transcript-clear','capture-hint','response','attachment-preview','attachment-thumb-img',
  'attachment-remove','ask-form','ask-input','btn-stop','ask-send','settings-overlay','settings-close',
  'provider-select','key-input','key-save','key-clear','key-status','model-fast','model-smart','models-save',
  'models-status','save-history','keep-transcript','panel-opacity','panel-opacity-value','hide-from-capture',
  'shortcut-list','shortcuts-save','shortcuts-reset','shortcuts-status','rerun-tutorial','tutorial-overlay',
  'tutorial-sheet','capture-video','capture-canvas'];
it.each(REQUIRED_IDS)('has #%s exactly once', (id) =>
  expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1));
it('drops the header opacity slider', () => expect(html).not.toMatch(/id="quick-opacity"/));
it('has the four settings tabs in order', () =>
  expect([...html.matchAll(/class="seg"[^>]*data-tab="(\w+)"/g)].map((m) => m[1])).toEqual(['ai','look','privacy','keys']));
it('has the four accent swatches', () =>
  expect([...html.matchAll(/data-accent="(\w+)"/g)].map((m) => m[1])).toEqual(['blue','violet','green','orange']));
it('has the five action chips in order', () =>
  expect([...html.matchAll(/data-action="(\w+)"/g)].map((m) => m[1])).toEqual(['assist','what_to_say','follow_up','recap','solve_code']));
it('defines every icon used', () => {
  const used = new Set([...html.matchAll(/href="#(i-[\w-]+)"/g)].map((m) => m[1]));
  for (const id of used) expect(html).toContain(`<symbol id="${id}"`);
});
it('keeps the CSP unchanged', () => expect(html).toContain("default-src 'none'; script-src 'self';"));
it('toast is a polite live region', () => expect(html).toMatch(/id="capture-hint"[^>]*aria-live="polite"/));
```

- [ ] **Step 2: Run** `npx vitest run test/renderer-structure.test.js` — Expected: FAIL (quick-opacity present, no tabs/swatches).
- [ ] **Step 3: Rewrite `<body>` of `src/renderer/index.html`** per the Interfaces list and spec §3–§4. Icons: simple 24-unit line paths, `fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"` set on the `.icon` CSS (not per symbol). Every icon-only button gets `aria-label`.
- [ ] **Step 4: Run** the test — Expected: PASS. (App is unstyled/partly broken until Tasks 3–4; that's expected.)
- [ ] **Step 5: Commit** — `feat(ui): new panel and tabbed settings markup`

---

### Task 3: Visual system & motion (`styles.css`)

**Files:**
- Modify: `src/renderer/styles.css` (full rewrite)
- Test: `test/renderer-structure.test.js` (add a `describe('styles.css')` block reading the CSS file)

**Interfaces:**
- Consumes: class names from Task 2.
- Produces (state classes Task 4 toggles): `.on` (icon-toggle active), `.drawer.open`, `.overlay.open` (visible, animating in; overlay has `hidden` attribute when fully closed), `.seg[aria-selected="true"]`, `.tab-page.active`, `.toast.show`, `.inputbar.busy` (shows stop, hides send), `.swatch[aria-checked="true"]`, `.entry` enter animation, `.answer-tools` (copy/retry row). CSS variable `--accent` (set inline by JS), `--accent-soft: color-mix(in srgb, var(--accent) 18%, transparent)`.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Write `styles.css`** from spec §5–§6. Pinned values: panel bg `rgba(18,18,24,.74)`, `blur(28px) saturate(170%)`; input bar + sheet `blur(36px)`; border `rgba(255,255,255,.10)`, top edge `.18`; text alphas `.94/.62/.40`; `--danger #ff5f57`, `--ok #34c77b`; radii 8/12/16; input bar inset 10px radius 14px; `:root { font-size: 13.5px }` and sizes in `rem`. Easing (Chromium `linear()`), use these exact curves:

```css
--spring: linear(0, 0.157, 0.438, 0.66, 0.808, 0.897, 0.947, 0.974, 0.988, 0.995, 1); /* ~350ms */
--spring-bouncy: linear(0, 0.2, 0.55, 0.85, 1.02, 1.07, 1.06, 1.03, 1.01, 1, 1);     /* ~450ms */
```

Rules that need care: `.response` has `mask-image: linear-gradient(transparent, #000 14px, #000 calc(100% - 24px), transparent)` and `padding-bottom` ≥ input-bar height; chips row `overflow-x: auto; scrollbar-width: none` with side fade mask; `.drawer { display:grid; grid-template-rows:0fr; transition: grid-template-rows 350ms var(--spring) } .drawer.open { grid-template-rows:1fr }` with an inner `overflow:hidden` child; sheet enter = `translateY(16px)→0` + opacity, exit reverses on the same path; `.seg-pill` positioned with `transform: translateX(calc(var(--seg-index) * 100%))`, transition `450ms var(--spring-bouncy)`; `:active` → buttons `scale(.96)`, chips `scale(.98)`, `transition-duration: 0ms` on press; reduced-motion media sets all transitions to `opacity 120ms ease` and removes transforms; reduced-transparency sets `backdrop-filter:none` and alphas `.96`; contrast-more sets solid bg and border `rgba(255,255,255,.35)`. At `max-width: 380px`: titlebar gaps 2px, icon buttons 24px, brand name hidden (dot + REC stay). Keep the `.hidden { display:none !important }` utility (still used by `#rec-badge`, `#attachment-preview`).

- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ui): Apple-style glass material, type and spring motion`

---

### Task 4: Renderer behaviour (`renderer.js`)

**Files:**
- Modify: `src/renderer/renderer.js`
- Test: `test/renderer-structure.test.js` (static checks on renderer.js text)

**Interfaces:**
- Consumes: Task 1 `settings.accent`; Task 2 IDs/classes; Task 3 state classes.
- Produces (internal functions): `showToast(text: string): void`, `applyAccent(id: string): void`, `selectTab(name: 'ai'|'look'|'privacy'|'keys'): void`, `openOverlay(el: HTMLElement): void`, `closeOverlay(el: HTMLElement): void`. `tutorial.js` uses `openOverlay`/`closeOverlay` via `window.ghostUI = { openOverlay, closeOverlay }` (renderer.js loads after tutorial.js, so tutorial must look it up at call time, not at load).

- [ ] **Step 1: Write the failing tests** (static)

```js
it('routes every status message through showToast', () =>
  expect(js).not.toMatch(/captureHint\.textContent\s*=/));
it('no longer references the header opacity slider', () => expect(js).not.toMatch(/quick-opacity|quickOpacity/));
it('falls back to blue for unknown accents', () => expect(js).toMatch(/ACCENTS\[[^\]]+\]\s*\|\|\s*ACCENTS\.blue/));
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**
  - Replace each `captureHint.textContent = X` with `showToast(X)`. `showToast` sets text, adds `.show`, clears the previous timer, removes `.show` after 8000ms if text contains `⚠` or `agreed`, else 4000ms.
  - `ACCENTS = { blue:'#5b8cff', violet:'#9b7bff', green:'#34c77b', orange:'#ff9f43' }`; `applyAccent(id)` sets `--accent` on `document.documentElement` to `ACCENTS[id] || ACCENTS.blue` and syncs swatch `aria-checked`. Call in `boot()` and in `openSettings()`; swatch click → `applyAccent` then `saveSetting({ accent })`.
  - Delete `quickOpacity` and its listener; `syncOpacityControls` updates only `#panel-opacity` + value.
  - Transcript: `#btn-transcript` `hidden` attribute removed while `isMicOn() || isMeetingOn()` (do this inside `updateRecBadge`); when both stop, also close the drawer. Toggle uses `transcriptPanel.classList.toggle('open')`; `onTranscriptChange` checks `.open` instead of `.hidden`.
  - `setBusy(busy)` toggles `askForm.classList.toggle('busy', busy)` (CSS swaps send/stop); keep `askSend.disabled`.
  - Overlays: `openOverlay(el)` removes `hidden` attr, forces reflow, adds `.open`. `closeOverlay(el)` removes `.open`, then sets `hidden` on `transitionend` of the sheet **or** after 400ms fallback timer, whichever first (reduced-motion still fires transitionend). Settings open/close and `#rerun-tutorial` use these. `Escape` closes Settings.
  - Tabs: `selectTab(name)` sets `aria-selected`, `.active` page, `--seg-index` on `.segmented`; remembers `lastTab` in a module variable; `openSettings()` calls `selectTab(lastTab)` (default `'ai'`). Left/Right arrow keys move between tabs.
  - Answers: in `finalizeEntry`, append `div.answer-tools` with `Copy` (copies `req.text` / restored reply) and `Retry` (calls the request's `retry`, only for live answers, not restored history). `finalizeEntry(entry, meta, tools)` gains a third optional param `{ text, retry }`.
  - Empty-state copy: `"Ask anything, or pick an action above. Ghost only sees your screen or hears audio when you turn on a capture icon."`
- [ ] **Step 4: Run** `npm test && npm run lint` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ui): toast, tabs, accent, overlays and answer tools`

---

### Task 5: Tutorial copy & overlay motion

**Files:**
- Modify: `src/renderer/tutorial.js`
- Test: `test/renderer-structure.test.js`

**Interfaces:**
- Consumes: `window.ghostUI.openOverlay/closeOverlay` (Task 4).

- [ ] **Step 1: Failing test**

```js
it('tutorial points at the new controls', () => {
  expect(tut).not.toMatch(/"Screen" pill|"Mic" or "Meeting"/);
  expect(tut).toMatch(/icons? in the title bar/);
  expect(tut).toMatch(/Settings → AI|AI tab/);
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Update copy** — step 2: key is added in "Settings (⚙) → AI tab"; step 3: "the screen, mic, and speaker icons in the title bar"; step 5: hide-from-capture lives in "Settings → Privacy"; step 7: shortcuts editable in "Settings → Keys". Replace `overlay.classList.remove/add('hidden')` with `window.ghostUI.openOverlay(overlay)` / `closeOverlay(overlay)`. Remove the 👋 emoji from the title (icons are SVG now; keep text-only).
- [ ] **Step 4: Run** `npm test && npm run lint` — PASS.
- [ ] **Step 5: Commit** — `feat(ui): update tutorial for redesigned panel`

---

### Task 6: Real-window verification & changelog

**Files:**
- Modify: `CHANGELOG.md` (add "Unreleased — Redesign" entry linking the spec)

- [ ] **Step 1:** `npm start`; walk the spec §8 manual checklist plus Review Focus 1–5. For each failure, fix in the owning task's file and re-run `npm test`.
- [ ] **Step 2:** Check blur renders on the real transparent window (spec §9). If `backdrop-filter` shows nothing, raise panel alpha to `.88` (record in CHANGELOG).
- [ ] **Step 3:** Windows Settings → Accessibility → Visual effects → Animation effects **off**; confirm fades only.
- [ ] **Step 4:** Resize to 320px wide; confirm title bar fits without overflow.
- [ ] **Step 5:** `npm test && npm run lint` — PASS. Add CHANGELOG entry. Commit — `docs: changelog for UI redesign`.
