# Ghost

A small, glassy, always-on-top AI copilot panel for Windows. Bring your own
API key (OpenAI, Anthropic, or Google Gemini) — nothing is sent anywhere
except directly to the provider you pick, and your key never leaves your
machine unencrypted.

## What it does

- Floats as a frameless, translucent panel that stays above other windows.
- **Screen**: grabs a single screenshot when you ask (never continuous).
- **Mic** / **Meeting**: rolling, short-clip transcription of your
  microphone or Windows system audio (e.g. a call), used as live context —
  off by default, toggle each independently.
- Actions: **Assist**, **What to say**, **Follow-ups**, **Recap**,
  **Ask anything**, and **Solve coding problem on screen**.
- **Smart** toggle: fast/cheap model by default, switch to a stronger,
  slower model for harder problems.
- Streams answers into the panel token-by-token.
- Global hotkeys work even when the panel doesn't have focus (see below).
- Friendly first-run tutorial covering permissions, keys, and setup.

## Not included, on purpose

Ghost does **not** try to hide the fact that it's an AI from anyone in a
call, and the "hide from screen-share" toggle in Settings is:

- **Off by default.**
- **Best-effort only** — it sets the Windows `WDA_EXCLUDEFROMCAPTURE`
  window flag, which many but not all recording/screen-share tools honor.
  It is not a guarantee, can be defeated by OS updates or certain capture
  methods, and should only be used for legitimate purposes (private notes,
  personal assistance, accessibility) with respect for your organization's
  and meeting counterparts' recording/consent policies.

## Setup

```bash
npm install
npm start        # run in dev
npm run dist      # build a Windows installer + portable exe
```

On first launch, Ghost walks you through:
1. Picking a provider and pasting an API key (stored locally, encrypted
   with Windows DPAPI via Electron's `safeStorage`).
2. What Screen / Mic / Meeting actually do and when Windows will prompt you
   for permission.
3. The privacy note above.
4. A Zoom-specific tip (see below).

## Zoom / meeting audio note

Ghost captures "meeting audio" via Windows system-audio loopback — it
listens to whatever is actually playing out of your speakers, not to Zoom
directly. That means:

- Make sure Zoom's audio output is your normal speakers/system device, not
  an exclusive-mode or app-isolated audio device — otherwise Ghost won't
  hear the other participants.
- Your own mic is captured completely separately, so it works either way.

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+G` | Show / hide the panel |
| `Ctrl+Shift+A` | Assist |
| `Ctrl+Shift+W` | What to say |
| `Ctrl+Shift+F` | Follow-up questions |
| `Ctrl+Shift+R` | Recap |
| `Ctrl+Shift+K` | Focus "Ask anything" |
| `Ctrl+Shift+C` | Solve coding problem on screen |
| `Ctrl+Shift+S` | Toggle Smart mode |
| `Ctrl+Shift+X` | Toggle click-through (let clicks pass through the panel) |

## Providers & models

| Provider | Fast model | Smart model | Notes |
|---|---|---|---|
| OpenAI | `gpt-5.6-luna` | `gpt-5.6-sol` | Also used for mic/meeting transcription (Whisper-family) |
| Anthropic | `claude-haiku-4-5` | `claude-sonnet-5` | No native audio input — falls back to OpenAI/Gemini for transcription |
| Gemini | `gemini-3.1-flash-lite` | `gemini-3.1-pro-preview` | Can also transcribe audio directly |

Model names are current as of mid-2026; check each provider's docs and
update `src/main/llm/*.js` if they've shipped newer ones by the time you
build this.

## Project layout

```
src/
  main/            Electron main process: window, shortcuts, IPC, storage
    llm/           One module per provider (streaming chat + transcription)
    actions.js      Prompt templates + provider routing
    store.js         Settings + encrypted API key storage
    main.js           App entry point
  preload/            contextBridge API exposed to the renderer
  renderer/           The panel UI (vanilla HTML/CSS/JS, no framework)
    capture.js         Screen/mic/meeting audio capture
    tutorial.js        First-run walkthrough
    renderer.js         UI wiring, streaming render
```

No React/Electron-heavy framework in the renderer — kept intentionally
plain so the packaged app stays small and starts fast.

## Known limitations

- Transcription is clip-based (~7s rolling chunks), not true live streaming
  ASR — there's a few seconds of lag, and short utterances can get split
  across chunks.
- Content-protection ("hide from capture") is Windows-only and best-effort,
  as described above.
- A placeholder tray icon is included at `src/renderer/assets/tray.png`.
  For a polished installer, drop your own `build/icon.ico` in and add
  `"icon": "build/icon.ico"` back into the `win` block of `package.json`.
