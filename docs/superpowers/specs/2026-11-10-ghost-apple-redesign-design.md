# Ghost — Apple-style UI redesign

**Date:** 2026-11-10
**Status:** Draft, awaiting review
**Scope:** Renderer only (`src/renderer/index.html`, `styles.css`, `renderer.js`, `tutorial.js`), plus one validated `accent` setting in the main process. LLM providers, IPC channels, and window dragging are unchanged.

## 1. Goal

Make Ghost feel calm, quick, and native: same features, reorganized into a quieter fixed panel with Apple-style materials, typography, and motion.

**Success criteria**
- Every existing feature still reachable and working (capture, actions, ask, stop, screenshot attach, transcript, smart mode, new chat, settings, tutorial, shortcuts).
- Nothing is captured without an explicit user action (unchanged behavior).
- `npm test` and `npm run lint` pass.
- Fewer always-visible controls: title bar + chip row + input, instead of header + pill row + hint + 5-button grid + input.

**Non-goals:** new features, light theme, collapsible/expanding bar, gesture physics, new dependencies.

## 2. Decisions (agreed)

| Topic | Decision |
| --- | --- |
| Scope | Look + feel + layout; features unchanged |
| Layout | Fixed panel, decluttered |
| Theme | Dark glass only, user-selectable accent |
| Settings | Segmented tabs |
| Motion | CSS-only, spring curves via `linear()` easing; no JS animation library (Electron 44 supports `linear()`) |

## 3. Main panel layout

```
╭────────────────────────────────────────────────╮
│ ● Ghost REC    [mic][meet][screen][tx]  ⚡ ＋ ⚙ – × │  title bar (drag region)
├────────────────────────────────────────────────┤
│ (Assist)(What to say)(Follow-ups)(Recap)(Solve code)→ │  chip row, horizontal scroll
│ ┌ transcript drawer (when open) ┐                     │
│                                                       │
│  response stream (scrolls under input)                │
│                                                       │
│  ╭ [thumb] Ask anything…                 ■/➤ ╮ ← floating glass
╰────────────────────────────────────────────────╯
```

**Title bar (~40px):** status dot + "Ghost" + REC badge on the left. Right: a grouped capture control (Mic, Meeting, Screen as icon toggles; Transcript icon appears only while Mic or Meeting is on), Smart toggle (bolt icon, accent-filled when on), New chat, Settings, Minimize, Close. Below 380px width, title-bar gaps shrink to 2px, icon buttons to 24px, and the "Ghost" wordmark hides (dot and REC stay).

**Removed from main panel:** header opacity slider (moves to Settings → Look). The always-visible capture hint line becomes a transient **toast** (`#capture-hint`, same ID): a small glass capsule above the input bar that shows each status message for 4s then fades out. Messages containing a warning (⚠) or the meeting-consent reminder stay 8s. `aria-live="polite"`.

**Chip row:** single row, horizontal scroll with edge fade mask, no wrap. "Solve code" becomes a normal chip with a code icon and accent tint.

**Response area:** fills remaining height; bottom padding equals input-bar height so the last line clears it. Top/bottom edges use a gradient mask (scroll edge effect) instead of borders. Empty state: short centered hint explaining that nothing is captured until a capture icon is turned on.

**Entries:** user message as a right-aligned soft bubble; answer as plain text on the material with a small accent tag (Assist, Recap…). Copy / Retry row under each answer, visible on hover and for the latest answer. Code blocks keep their copy bar, restyled.

**Input bar:** floating, inset 10px from panel edges, radius 14px, thicker material than the panel. The screenshot thumbnail sits inside the bar on the left (replaces the separate preview row; remove button kept). Send and Stop swap in place with a cross-fade.

## 4. Settings (segmented tabs)

The sheet slides up from the panel bottom and exits the same way, over a dimming scrim. Header: "Settings" + close. Below: segmented control **AI · Look · Privacy · Keys** with a sliding selection pill.

- **AI:** provider select; API key + Save / Clear + status; Fast / Smart model fields + Save.
- **Look:** accent swatches — Blue `#5b8cff` (default), Violet `#9b7bff`, Green `#34c77b`, Orange `#ff9f43`; panel opacity slider with value.
- **Privacy:** remember chats; keep transcript; hide-from-capture. Consent + best-effort notes behind a "Learn more" `<details>`; Zoom audio note behind its own "Learn more".
- **Keys:** shortcut editor, Save, Reset; "Replay tutorial" at the bottom.

The last selected tab is remembered for the session (in memory only).

## 5. Visual system

**Material:** panel `rgba(18,18,24,.74)` (the Look → opacity slider keeps controlling whole-window opacity via `mainWindow.setOpacity`, unchanged), `backdrop-filter: blur(28px) saturate(170%)`, 1px border `rgba(255,255,255,.10)` with a brighter top edge `rgba(255,255,255,.18)`. Input bar and sheet are thicker: blur 36px, deeper shadow. Never stack a light translucent surface on another.

**Tokens (`:root`):** `--accent` (from settings, default blue), `--accent-soft` (accent at 18% alpha via `color-mix`), `--text` .94, `--text-2` .62, `--text-3` .40, `--danger #ff5f57`, `--ok #34c77b`, radii 8 / 12 / 16, spacing 4 / 6 / 8 / 12 / 16 / 20.

**Type:** `"Segoe UI Variable Text", "Segoe UI", system-ui`. Title 13/600; body 13.5 with 1.55 leading; small 12/1.45; caption 11/1.35 with +0.01em tracking. Answer headings −0.01em tracking, 1.25 leading. Sizes in `rem` so OS text scaling works.

**Icons:** inline SVG, 16px, 1.6px stroke, `currentColor`, defined once as `<symbol>`s in `index.html` and used via `<use href="#i-…">`. Set: mic, speaker, screen, transcript, bolt, plus, gear, minus, x, send, stop, copy, retry, code.

## 6. Motion

CSS transitions/animations only, with two easing tokens built from `linear()`:
- `--spring` — critically damped, ~350ms. Default for movement and scale.
- `--spring-bouncy` — slight overshoot, ~450ms. Only for the segmented pill and capture toggles switching on.

Rules:
- Press feedback on `:active` with no delay: buttons `scale(.96)`, chips `scale(.98)`.
- Settings sheet enters and exits along the same path (translateY + opacity); scrim fades.
- Segmented pill slides between tabs; tab content cross-fades.
- Transcript drawer opens via `grid-template-rows: 0fr → 1fr`.
- New entries fade in with a 6px rise. Streaming text is never animated per token.
- Animate only `transform` / `opacity` (plus the drawer's grid rows).
- `prefers-reduced-motion: reduce` → movement replaced by 120ms opacity fades, no overshoot.
- `prefers-reduced-transparency: reduce` → blur off, background alpha .96.
- `prefers-contrast: more` → solid backgrounds, borders `rgba(255,255,255,.35)`.

## 7. Implementation notes

- **Keep every element ID** used by `renderer.js`, `capture.js`, `tutorial.js`. New wrappers add classes only. Removed: `#quick-opacity` (its logic deleted; Settings slider stays). `#capture-hint` stays but becomes the toast. `#attachment-preview` and its children keep their IDs but move inside `#ask-form`.
- **Accent persistence:** add `accent: 'blue' | 'violet' | 'green' | 'orange'` to `SETTINGS_SCHEMA` in `src/main/validate.js` and `accent: 'blue'` to `DEFAULT_SETTINGS` in `src/main/store.js`. It travels over the existing `setSettings`/`getSettings` channel; no new IPC.
- Accent applied by setting `--accent` on `document.documentElement`.
- CSP unchanged: no external fonts or scripts; SVG inline.
- `tutorial.js` steps updated to point at the new locations (title-bar capture icons, chips, Settings tabs).

## 8. Testing

- Existing Vitest suite passes; add a `validate.js` test for `accent` (accepts the four values, rejects anything else).
- `npm run lint` passes.
- Manual check via `npm start`: each capture toggle; each action chip; ask and stop; screenshot attach and remove; transcript drawer; Smart toggle; New chat; every Settings tab control saves and persists across restart; accent changes live; opacity slider; tutorial replay; window drag from title bar and empty areas; chip row scrolls with the wheel; Windows "Animation effects" off gives fades only.

## 9. Risks

- `backdrop-filter` in a transparent Electron window can render differently than in a browser — check blur on the real window first.
- Horizontal chip scroll inside a drag region: the chip row must be `no-drag` so wheel scrolling works.
- Narrow widths: title bar has many controls; the <380px rule in §3 must be verified at the minimum window size.
