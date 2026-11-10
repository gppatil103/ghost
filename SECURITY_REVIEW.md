# Ghost — Security Review & Improvement Report

_Reviewed: 2026-10-27 · Scope: all source under `src/` (main, preload, renderer, store, LLM providers) and `package.json`._

> **Status (v1.1.0, `develop` branch):** all findings, bugs and improvements below have been addressed — see [CHANGELOG.md](CHANGELOG.md). Two items need action outside the codebase: **code signing** requires you to buy a certificate (setup documented in the README), and **consent** for meeting capture is ultimately the user's responsibility (the app now shows a ● REC badge and consent reminders).

---

## What's already good

- API keys are encrypted with Electron `safeStorage` (Windows DPAPI), and saving is refused if encryption is unavailable.
- A strict Content-Security-Policy is set in `index.html` (`script-src 'self'`, `connect-src 'self'`).
- `contextIsolation: true` and `nodeIntegration: false`.
- LLM output is inserted with `createTextNode`, so model replies can't inject HTML.
- DevTools only auto-open in development (`!app.isPackaged`).

---

## Security findings

### 🔴 High

#### 1. `open-external` opens any URL unchecked
**Where:** `src/main/main.js:246` — `ipcMain.handle('open-external', (_e, url) => shell.openExternal(url))`

**Risk:** If anything ever executes in the renderer (XSS, a bad dependency, injected content), it can launch `file://`, `ms-msdt:`, `search-ms:` or any other registered protocol handler. These are well-known Windows code-execution vectors. The renderer doesn't even use this API today.

**Best fix:** Remove the handler and the `openExternal` export from `preload.js`. If it's needed later, parse with `new URL(url)`, allow only `https:`, and only hosts on a fixed allowlist.

#### 2. Screen + system audio capture is silently auto-approved
**Where:** `src/main/main.js` → `installDisplayMediaHandler()`

**Risk:** Every `getDisplayMedia` request is granted `sources[0]` (whole primary screen) plus loopback audio with no OS picker. Any code running in the window can silently record your full screen and audio. The tutorial also tells users "Windows shows a built-in picker", which isn't true with this handler.

**Best fix:**
- Have the main process set a short-lived "capture allowed" flag only when the user clicks **Screen** / **Meeting** (via a dedicated IPC call), and reject requests without that flag.
- Check that `request.frame.url` is the app's own `index.html`.
- Only grant `audio: 'loopback'` for the Meeting action, not for screenshots.
- Update the tutorial text to match real behaviour.

#### 3. Renderer sandbox is disabled
**Where:** `webPreferences: { sandbox: false, experimentalFeatures: true }`

**Risk:** The comment says the sandbox must be off for `getDisplayMedia`, but it doesn't — `getDisplayMedia` works in a sandboxed renderer, and the preload only uses `contextBridge` / `ipcRenderer`, which are available in sandboxed preloads. With the sandbox off, any renderer bug gets a far less restricted process.

**Best fix:** Set `sandbox: true` and remove `experimentalFeatures: true`.

### 🟠 Medium

#### 4. No permission handler
**Risk:** Electron grants every permission request by default (mic, notifications, geolocation, etc.).

**Best fix:** Add `session.defaultSession.setPermissionRequestHandler` and `setPermissionCheckHandler`; allow only `media` from the app's own `file://` origin and deny everything else.

#### 5. No navigation / new-window guards
**Risk:** If the window navigates away (a link, injected content), the remote page inherits the preload API — including `runAction` and `saveApiKey`.

**Best fix:**
```js
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
```

#### 6. IPC handlers don't verify the sender or validate input
**Where:** all handlers in `registerIpc()`

**Problems:**
- `set-settings` saves any keys/values it receives.
- `run-action` lets the renderer override `payload.provider`; values like `constructor` resolve on the `PROVIDERS` object and crash.
- `save-api-key` / `clear-api-key` accept any provider string.
- `resize-panel` accepts unbounded numbers.

**Best fix:**
- Check `event.senderFrame.url` matches the app's `index.html` in every handler.
- Allowlist providers (`openai | anthropic | gemini`) and action ids.
- Validate settings against a small schema (allowed keys + types).
- Clamp resize width/height to sane bounds.

#### 7. Unbounded payload size and request rate
**Where:** `transcribe-clip`, `run-action`, provider `fetch` calls

**Risk:** Any size of base64 audio/image and any `mimeType` is accepted; there's no rate limit and no request timeout. A runaway loop can burn API credits or exhaust memory, and a stalled provider hangs the request forever.

**Best fix:** Cap audio (~2 MB) and image (~8 MB) size, allowlist mime types (`audio/webm`, `audio/wav`), add a simple per-minute rate limit, and pass `signal: AbortSignal.timeout(60_000)` to `fetch`.

#### 8. Prompt injection via screen / meeting audio
**Risk:** On-screen text or something said in a meeting can instruct the model ("ignore previous instructions…"). Impact is low today because output is display-only, but becomes serious if you add tools/actions or render markdown/links.

**Best fix:** Keep output as plain text (or sanitize with DOMPurify if you add markdown), wrap captured content in clearly delimited tags and tell the model it's untrusted data, and never let a model reply trigger an action without explicit user confirmation.

#### 9. Outdated Electron
**Where:** `package.json` → `"electron": "^33.0.0"`

**Risk:** Electron 33 is well past its support window and missing Chromium security patches.

**Best fix:** Upgrade to a currently supported Electron major, run `npm audit`, and keep it updated (Dependabot/Renovate).

### 🟡 Low / Privacy

#### 10. Tray "Settings" silently triggers an AI request
`sendAction('open-settings')` sends `trigger-action`, which the renderer treats as an action id → falls back to **Assist** and sends the current transcript to the provider instead of opening Settings.
**Fix:** Use a dedicated `open-settings` IPC event that calls `openSettings()` in the renderer.

#### 11. Capture-hiding defaults contradict the UI text
Comments and Settings text say hiding is "off by default", but `DEFAULT_SETTINGS.hideFromCapture` is `true` (`store.js:18`), and the `ready-to-show` block in `main.js` forces `setContentProtection(true)` regardless of the setting.
**Fix:** Default to off and respect the user's choice everywhere.

#### 12. Consent / legal exposure
Meeting audio of other participants is sent to third-party AI providers without their knowledge. Many jurisdictions require all-party consent to record calls.
**Fix:** Show a clear "recording" indicator, add a consent reminder, and clear the transcript when capture stops (`clearTranscript()` exists but is never called).

#### 13. No build hardening
No Electron fuses and no code signing.
**Fix:** Use `@electron/fuses` to disable `RunAsNode` and `EnableNodeCliInspectArguments` and enable ASAR integrity validation; sign the installer.

#### 14. Leftover files
- `src/main.js` is a stale duplicate of the main process (not the entry point) that also contains the unrestricted `open-external` handler.
- `src.zip` is untracked in the repo root and could be committed by accident.

**Fix:** Delete both; add `*.zip` and `.env` to `.gitignore`.

#### 15. Minor
- Settings are written non-atomically — a crash mid-write can wipe them. Write to a temp file, then `rename`.
- All three API keys are decrypted on every request (`getAllApiKeys`). Decrypt only the one in use.
- An error message tells users to open DevTools with Ctrl+Shift+I — don't suggest that in production builds.

### Recommended fix order
1. #1 Remove/validate `open-external`
2. #2 Gate display-media capture
3. #3 Enable sandbox
4. #5 Navigation guards
5. #4 Permission handler
6. #6 / #7 IPC validation and limits
7. Everything else

---

## Bugs found

### A. Ghost has no conversation memory
Every request is a brand-new single-message conversation:
- `renderer.js` sends only the current question/transcript/screenshot.
- `actions.js` builds a fresh prompt each call; nothing stores history.
- All three providers hard-code a single user message (`messages: [{ role: 'user', ... }]` / `contents: [{ role: 'user', ... }]`).

So "remember this" is seen once and then forgotten.

**Fix:** Keep a `history` array in the renderer (append the user turn and the final assistant text on `stream-done`), send it with each request, and map it per provider (`user`/`assistant` for Anthropic & OpenAI, `user`/`model` for Gemini). Cap it to the last ~10–20 turns, attach screenshots only to the current turn, and add a **New chat** button to clear it.

### B. Stream listener leak
`runAction()` in `renderer.js` registers three new `onStreamChunk/Done/Error` listeners on every request and never removes them. The `requestId` check prevents wrong output, but listeners pile up forever.
**Fix:** Register one set of listeners at startup and dispatch via a `Map<requestId, entry>`, or have the preload return an unsubscribe function and call it on done/error.

### C. Stale duplicate main file
The stale `src/main.js` uses `width: 420` with `x: sw - 380 - 24`, so the window would overflow the screen edge if that file were ever used (the real `src/main/main.js` is correct). Another reason to delete it.

---

## Other improvements

### Features
- **Cancel / stop button** for in-flight responses (use `AbortController`, pass the signal through IPC).
- **Markdown + code-block rendering** for replies (with `marked` + `DOMPurify`), plus a copy button on code blocks.
- **Persistent chat history** (optional, opt-in) saved locally, with a clear-all option.
- **Model picker / custom model ids** in Settings instead of hard-coded constants, so model updates don't require a code change.
- **Transcript viewer** — show the live rolling transcript and let the user clear it.
- **Shortcut customization** and conflict detection (`globalShortcut.register` silently returns `false` when another app owns the key — currently ignored).
- **Mic hotkey** — the Mic button's tooltip mentions `Ctrl+Shift+L`, but no such shortcut is registered.
- **Provider error UX** — friendly messages for 401 (bad key), 429 (rate limit), and network errors, with a retry button.
- **Token/cost indicator** per response.

### Code quality
- Add **ESLint + Prettier** and a `lint` script.
- Consider **TypeScript** (or JSDoc + `// @ts-check`) for the IPC payload shapes.
- Extract provider-specific code behind one interface and add **unit tests** (e.g. Vitest) for `sse.js`, `buildUserText`, and per-provider request builders.
- Add a **shared IPC channel constants** module so main/preload/renderer can't drift.
- Remove dead/unused code: `openExternal`, `getScreenSources`, `transcriptionProvider` setting (never read), `theme` setting (never read).
- Fix stale comments (e.g. "off by default" for capture hiding, "Windows shows a picker").

### Performance
- Downscale / JPEG-compress screenshots before sending (full-resolution PNGs are large and slow and cost more tokens).
- Skip transcription for silent clips using a simple volume (RMS) check instead of the byte-size heuristic.
- Avoid overlapping transcription requests piling up when the provider is slow (queue or drop).

### Project / repo hygiene
- Update `package.json`: real `author`, `appId` (`com.yourname.ghost`), and add a `repository` field.
- Add the missing `src/renderer/assets/icon.png` (referenced by `setAppDetails`; only `tray.png` exists) and set an app icon in the electron-builder config.
- Add CI (GitHub Actions) to run lint, tests, and `npm audit` on every push.
- Add a `CHANGELOG.md` and use semantic versioning for releases.
- Document the security model (what's sent where, where keys live) in the README.
