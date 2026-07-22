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
- **Bring your own key** — works with Anthropic (Claude), OpenAI (GPT), or Google (Gemini); nothing routes through a third-party server
- **Screen + audio context** — one-shot screenshots and rolling mic/system-audio clips feed into your prompt
- **Streaming responses** — tokens appear in the panel as they're generated, not after a long wait
- **Global hotkeys** — trigger actions from anywhere, even when the panel isn't focused
- **Fast/Smart model toggle** — switch between a cheap, fast model and a stronger one per provider
- **Click-through mode** — make the panel ignore clicks and fade to near-invisible when you need it out of the way
- **Optional capture exclusion** — best-effort toggle to hide the panel from screen-share/recording tools
- **Local, encrypted key storage** — API keys are encrypted at rest using your OS's native credential protection, stored outside the project folder entirely

## Hotkeys

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+G` | General assist |
| `Ctrl+Shift+A` | Ask anything |
| `Ctrl+Shift+W` | What to say |
| `Ctrl+Shift+F` | Follow-up |
| `Ctrl+Shift+R` | Recap |
| `Ctrl+Shift+K` | Solve code |
| `Ctrl+Shift+C` | Capture screen |
| `Ctrl+Shift+S` | Settings |
| `Ctrl+Shift+X` | Toggle click-through mode |

## Tech Stack

- **[Electron](https://www.electronjs.org/)** — packages the Chromium renderer + Node.js backend + app code into a single desktop executable
- **Vanilla JavaScript** — no frontend framework in the renderer, kept intentionally light for fast startup
- **electron-builder** — bundles the app into a Windows installer (NSIS) and/or a portable single-file `.exe`

## Architecture

Ghost runs as three cooperating processes, standard Electron shape:

```
src/
  main/                 # Node.js backend — runs in the background
    main.js               window creation, global hotkeys, IPC hub, tray
    actions.js            prompt templates, routes requests to the right provider
    store.js              settings + encrypted API key storage
    llm/
      anthropic.js         Claude API calls (streaming)
      openai.js            GPT API calls (streaming)
      gemini.js            Gemini API calls (streaming)
      sse.js               shared server-sent-events parsing

  preload/
    preload.js            security bridge — exposes a whitelisted API to the renderer,
                          no direct Node access from the UI

  renderer/               # the UI
    index.html            panel layout
    styles.css            glass/translucent theme
    renderer.js            UI wiring, renders streamed tokens
    capture.js             screen/audio capture logic
    tutorial.js            first-run walkthrough
```

**Data flow:** a button click in the renderer sends an IPC message to the main process → `actions.js` builds the prompt (optionally with a screenshot or audio transcript) → the matching provider module streams the response back over IPC → the renderer paints tokens into the panel as they arrive.

The `preload` script is the security boundary: it exposes only a whitelisted `window.ghost.*` API to the UI, with `contextIsolation` on and `nodeIntegration` off — the renderer never gets raw Node access.

## Getting Started

### Prerequisites

- Windows 10/11
- [Node.js](https://nodejs.org/) (LTS recommended)
- An API key from at least one of: [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), [Google AI Studio](https://aistudio.google.com/)

### Run from source

```bash
git clone https://github.com/<your-username>/ghost.git
cd ghost
npm install
npm start
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

On first launch, enter your API key in Settings — it's encrypted and stored locally, never bundled with the app or written into the project folder.

## Security & Privacy

- API keys are encrypted using your OS's native credential protection (Windows DPAPI, via Electron's `safeStorage`) and tied to your logged-in user account.
- Keys are stored in your OS's per-user app data directory, **outside the project folder** — they are never part of the source tree and won't end up in a Git commit.
- No telemetry, no relay server. Requests go straight from your machine to the AI provider you configured.
- The capture-exclusion toggle is best-effort: not all screen-recording or screen-share tools honor the underlying OS flag.

## Contributing

Issues and pull requests are welcome. Please avoid committing `node_modules/` or `dist/` — make sure your `.gitignore` includes:

```
node_modules/
dist/
```

## License

MIT
