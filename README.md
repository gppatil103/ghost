# Ghost

A floating, always-on-top AI copilot for Windows. Bring your own API key, get instant AI assistance overlaid on top of any app, game, or call.

![platform](https://img.shields.io/badge/platform-Windows-blue)
![electron](https://img.shields.io/badge/built%20with-Electron-47848F)
![license](https://img.shields.io/badge/license-MIT-green)

## What is Ghost?

Ghost is a lightweight desktop panel that sits above everything else on your screen. Trigger it with a hotkey, ask it to look at your screen, listen to audio, or answer a question — and it streams the response back in real time. No account, no server, no subscription: you bring your own API key for Claude, GPT, or Gemini, and Ghost talks directly to that provider.

It's built for moments where you want a quick, unobtrusive assist — during a meeting, while coding, while gaming, or while reading something on screen — without alt-tabbing to a browser tab.

## Features

- **Always-on-top floating panel** — frameless, translucent, pinned to a corner, stays above fullscreen apps and games
- **Conversation memory** — Ghost remembers the chat until you press **＋ New chat**; optionally keep it (encrypted) across restarts
- **Bring your own key** — works with Anthropic (Claude), OpenAI (GPT), or Google (Gemini); nothing routes through a third-party server
- **Screen + audio context** — one-shot screenshots and rolling mic/system-audio transcripts feed into your prompt, with a live transcript viewer
- **Streaming responses with formatting** — markdown, code blocks with a Copy button, a **Stop** button, and token usage per reply
- **Friendly errors** — clear messages for bad keys, rate limits, outages and timeouts, with a **Retry** button
- **Configurable** — pick custom model ids per provider, rebind every global shortcut (with conflict detection), adjust panel opacity
- **Click-through mode** — make the panel ignore clicks and fade to near-invisible when you need it out of the way
- **Optional capture exclusion** — best-effort toggle to hide the panel from screen-share/recording tools (off by default)
- **Local, encrypted storage** — API keys (and saved chats) are encrypted at rest with your OS's native credential protection

## Hotkeys

All of these can be changed (or turned off) in **Settings → Shortcuts**. If another app already owns a combo, Settings tells you.

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
| `Ctrl+Shift+L` | Toggle mic |
| `Ctrl+Shift+X` | Toggle click-through mode |

## Tech Stack

- **[Electron](https://www.electronjs.org/)** — packages the Chromium renderer + Node.js backend + app code into a single desktop executable
- **Vanilla JavaScript** — no frontend framework in the renderer, kept intentionally light for fast startup
- **electron-builder** — bundles the app into a Windows installer (NSIS) and/or a portable single-file `.exe`, with hardened Electron fuses
- **Vitest + ESLint + Prettier** — unit tests, linting and formatting; run in CI on every push

## Architecture

```
src/
  main/                 # Node.js backend — runs in the background
    main.js               window, global hotkeys, tray, IPC hub, session hardening
    actions.js            prompt templates, history normalisation, routes to a provider
    validate.js           validation + rate limiting for everything crossing IPC
    store.js              settings (schema-checked) + encrypted keys and chat history
    llm/
      anthropic.js         Claude API calls (streaming)
      openai.js            GPT API calls (streaming) + transcription
      gemini.js            Gemini API calls (streaming) + transcription fallback
      sse.js               shared server-sent-events parsing
      errors.js            friendly, retry-aware provider errors

  shared/
    ipc-channels.js       IPC channel names + payload typedefs

  preload/
    preload.js            security bridge — exposes a whitelisted window.ghost API

  renderer/               # the UI (sandboxed)
    index.html            panel layout + Content-Security-Policy
    styles.css            glass/translucent theme
    renderer.js           UI wiring, conversation state, settings
    markdown.js           safe markdown → DOM renderer (no innerHTML)
    capture.js            screenshot / mic / meeting-audio capture
    tutorial.js           first-run walkthrough

test/                   # Vitest unit tests
```

**Data flow:** a button click in the renderer sends an IPC message (with the recent conversation) to the main process → `validate.js` checks it → `actions.js` builds the prompt (optionally with a screenshot or audio transcript) → the matching provider module streams the response back over IPC → the renderer renders markdown as tokens arrive.

## Getting Started

### Prerequisites

- Windows 10/11
- [Node.js](https://nodejs.org/) 22 LTS or newer
- An API key from at least one of: [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), [Google AI Studio](https://aistudio.google.com/)

### Run from source

```bash
git clone https://github.com/gppatil103/ghost.git
cd ghost
npm install
npm start
```

### Develop

```bash
npm run lint          # ESLint
npm test              # Vitest unit tests
npm run format        # Prettier
npm run audit         # npm audit (high+ severity)
```

### Build a standalone Windows executable

```bash
npm run dist
```

This produces, in the `dist/` folder:
- `Ghost Setup <version>.exe` — installer (Start Menu shortcut, uninstaller included)
- `Ghost <version>.exe` — portable, single-file, no install step required

> **Note:** if the build fails with a symlink/permission error while downloading `winCodeSign`, that's an irrelevant macOS code-signing step. Skip it with:
> ```powershell
> $env:CSC_IDENTITY_AUTO_DISCOVERY="false"
> npm run dist
> ```

**Code signing:** unsigned builds trigger Windows SmartScreen warnings and can't be verified by users. To sign, get a code-signing certificate and set `CSC_LINK` (path/URL to the `.pfx`) and `CSC_KEY_PASSWORD` before `npm run dist` — electron-builder signs automatically.

On first launch, enter your API key in Settings — it's encrypted and stored locally, never bundled with the app or written into the project folder.

## Security & Privacy

**What is sent where**

| Data | Leaves your PC? | Goes to |
|---|---|---|
| Your typed messages + recent conversation | Yes, per request | The provider you selected |
| Screenshot (only when you click Screen / Solve) | Yes, with that one request | The provider you selected |
| Mic / meeting audio clips (only while Mic/Meeting is on) | Yes, ~every 7s (silent clips skipped) | OpenAI transcription, or Gemini if no OpenAI key |
| API keys | Only in the auth header to that provider | — |
| Settings, saved chats | No | Your `%APPDATA%` folder |

**How the app protects you**

- API keys and saved chats are encrypted with Windows DPAPI (Electron `safeStorage`), tied to your user account, and stored outside the project folder. Ghost refuses to save them if encryption is unavailable.
- The renderer runs **sandboxed** with `contextIsolation` on and `nodeIntegration` off, under a strict Content-Security-Policy. It can only reach a small whitelisted `window.ghost` API.
- Every IPC call is checked to come from Ghost's own page and is validated (types, sizes, allowlisted providers/actions/settings) and rate-limited.
- Navigation, pop-up windows, `<webview>` and all browser permissions are blocked, except microphone access and clipboard writes for Ghost's own page.
- Screen / system-audio capture is only granted for a few seconds after you click **Screen**, **Meeting** or **Solve**, never silently in the background. A red **● REC** badge shows while audio is being transcribed.
- Model replies are rendered as text (markdown is built node-by-node, links are shown as plain text), and captured screen/audio content is marked as untrusted in the prompt to blunt prompt-injection.
- Requests time out after 2 minutes; OpenAI requests are sent with `store: false`.
- Packaged builds disable `RunAsNode`, `NODE_OPTIONS` and `--inspect`, and enable ASAR integrity validation via Electron fuses.
- No telemetry, no relay server.

**Please note**

- Meeting capture sends other people's voices to your AI provider. Many jurisdictions require everyone's consent to record or transcribe a call — ask first.
- The capture-exclusion toggle is best-effort: not all screen-recording or screen-share tools honor the underlying OS flag.

See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the full review and [CHANGELOG.md](CHANGELOG.md) for what changed.

## Contributing

Issues and pull requests are welcome. Please run `npm run lint` and `npm test` before opening a PR — CI runs both plus `npm audit`.

## License

MIT
