// Ghost — main process
// Owns the floating panel window, global shortcuts, screen/audio capture
// plumbing, and routes actions to the selected LLM provider.
//
// Security model: the renderer is sandboxed and treated as untrusted. Every
// IPC handler checks that the call came from Ghost's own index.html and
// validates its payload (see validate.js). Navigation, new windows and
// permissions are locked down, and screen/system-audio capture is only
// granted right after the user explicitly asks for it.

const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  session,
  screen,
  Tray,
  Menu,
  nativeImage,
} = require('electron');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const store = require('./store');
const { isPositionVisible } = require('./window-position');
const { runAction, transcribeClip, ACTIONS } = require('./actions');
const {
  RateLimiter,
  ACTION_IDS,
  validateRunPayload,
  validateRequestId,
  validateClip,
  validateApiKeyArgs,
  validateProvider,
  validateResize,
  validateHistoryForSave,
} = require('./validate');
const { INVOKE, EVENTS } = require('../shared/ipc-channels');

const isWindows = process.platform === 'win32';
const windowsBuild = isWindows ? os.release() : '';
// WDA_EXCLUDEFROMCAPTURE needs Windows 10 2004 (build 19041) or newer.
const supportsCaptureProtection = isWindows && parseInt(windowsBuild.split('.')[2], 10) >= 19041;
console.log(
  `[ghost] Windows build: ${windowsBuild}, capture protection supported: ${supportsCaptureProtection}`,
);

const INDEX_PATH = path.join(__dirname, '..', 'renderer', 'index.html');
const INDEX_URL = pathToFileURL(INDEX_PATH).href;

let mainWindow = null;
let tray = null;
let clickThrough = false;

const isDev = !app.isPackaged;

// Fuses already block --inspect / NODE_OPTIONS in packaged builds; also
// refuse Chromium's remote-debugging switches, which would let any local
// process drive the renderer and read what's on screen.
if (!isDev && ['remote-debugging-port', 'remote-debugging-pipe'].some((s) => app.commandLine.hasSwitch(s))) {
  console.error('[ghost] refusing to start with remote debugging enabled in a packaged build');
  app.exit(1);
}

// Only our own bundled page may talk to the main process or get permissions.
function isAppUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href === INDEX_URL;
  } catch {
    return false;
  }
}

function isTrustedSender(event) {
  return !!(event.senderFrame && isAppUrl(event.senderFrame.url));
}

function createWindow() {
  const settings = store.getSettings();
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const size = { width: 460, height: 560 };
  const workAreas = screen.getAllDisplays().map((d) => d.workArea);
  // Reopen where the user left the panel, unless that spot is no longer on screen.
  const position = isPositionVisible(settings.windowPosition, size, workAreas)
    ? settings.windowPosition
    : { x: sw - size.width - 24, y: 48 };

  mainWindow = new BrowserWindow({
    ...size,
    ...position,
    minWidth: 320,
    minHeight: 400,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    minimizable: false, // minimized windows can show up in task-switcher previews
    maximizable: false,
    fullscreenable: false,
    type: 'toolbar', // keeps the panel out of Alt+Tab on Windows

    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Keep the panel above fullscreen apps / games / video calls on Windows.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile(INDEX_PATH);

  mainWindow.once('ready-to-show', () => {
    mainWindow.setOpacity(settings.panelOpacity);
    applyContentProtection(settings.hideFromCapture);
    mainWindow.show();
    if (!settings.onboardingComplete) sendEvent(EVENTS.SHOW_TUTORIAL);
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    try {
      store.setSettings({ windowPosition: { x, y } });
    } catch (e) {
      console.error('[ghost] could not save window position', e);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendEvent(channel, data) {
  if (mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else mainWindow.show();
}

function showAndSend(channel, data) {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  sendEvent(channel, data);
}

function sendAction(actionId) {
  if (!ACTION_IDS.includes(actionId)) return;
  showAndSend(EVENTS.TRIGGER_ACTION, actionId);
}

// Best-effort only: on Windows this sets the WDA_EXCLUDEFROMCAPTURE window
// affinity flag, which many (not all) screen-share and recording tools will
// honor. It is NOT a guarantee — some capture methods, OS versions, or
// third-party tools can still see the window. Off by default; the user
// opts in from Settings after reading the in-app warning.
function applyContentProtection(enabled) {
  if (!mainWindow) return;
  try {
    mainWindow.setContentProtection(!!enabled);
  } catch (e) {
    console.error('[ghost] setContentProtection failed', e);
  }
}

function toggleClickThrough() {
  if (!mainWindow) return;
  clickThrough = !clickThrough;
  // forward: true keeps mouse-move events flowing so hover still works.
  mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  mainWindow.setFocusable(!clickThrough);
  // Fade almost all the way out so the panel is out of the way, but still
  // findable; restore the user's chosen opacity when turned back off.
  mainWindow.setOpacity(clickThrough ? 0.01 : store.getSettings().panelOpacity);
  sendEvent(EVENTS.CLICK_THROUGH_CHANGED, clickThrough);
}

// ---- Global shortcuts (user-configurable, with conflict reporting) ----
const SHORTCUT_HANDLERS = {
  toggle_window: toggleWindow,
  assist: () => sendAction(ACTIONS.ASSIST),
  what_to_say: () => sendAction(ACTIONS.WHAT_TO_SAY),
  follow_up: () => sendAction(ACTIONS.FOLLOW_UP),
  recap: () => sendAction(ACTIONS.RECAP),
  ask_anything: () => sendAction(ACTIONS.ASK_ANYTHING),
  solve_code: () => sendAction(ACTIONS.SOLVE_CODE),
  toggle_smart: () => sendEvent(EVENTS.TOGGLE_SMART),
  toggle_clickthrough: toggleClickThrough,
  toggle_mic: () => showAndSend(EVENTS.TOGGLE_MIC),
};

let shortcutStatus = {};

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const { shortcuts } = store.getSettings();
  const status = {};
  const taken = new Map(); // normalized accelerator -> command

  for (const [cmd, accel] of Object.entries(shortcuts)) {
    const handler = SHORTCUT_HANDLERS[cmd];
    if (!handler) continue;
    if (!accel) {
      status[cmd] = { accelerator: '', ok: true, disabled: true };
      continue;
    }

    const norm = accel.toLowerCase();
    if (taken.has(norm)) {
      status[cmd] = { accelerator: accel, ok: false, error: `Same key as "${taken.get(norm)}"` };
      continue;
    }
    let ok = false;
    let error = '';
    try {
      // register() returns false when another app already owns the combo.
      ok = globalShortcut.register(accel, handler);
      if (!ok) error = 'Already in use by another app';
    } catch {
      error = 'Not a valid shortcut';
    }
    if (ok) taken.set(norm, cmd);
    else console.warn(`[ghost] shortcut ${accel} for ${cmd} failed: ${error}`);
    status[cmd] = { accelerator: accel, ok, error };
  }
  shortcutStatus = status;
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Ghost — AI copilot');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggleWindow },
    { label: 'Click-through', click: toggleClickThrough },
    { type: 'separator' },
    { label: 'Settings', click: () => showAndSend(EVENTS.OPEN_SETTINGS) },
    { label: 'Quit Ghost', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', toggleWindow);
}

// ---- Session hardening ----

// Screen / system-audio capture is granted only to our own page, and only
// within a few seconds of the renderer arming it in response to the user
// clicking Screen / Meeting (or running "Solve coding problem"). Each arm
// is single-use. Loopback audio is only handed out for Meeting.
const CAPTURE_ARM_MS = 5000;
let armedCapture = null; // { kind: 'screen' | 'meeting', expires }

function installDisplayMediaHandler(ses) {
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const armed = armedCapture;
      armedCapture = null;
      const fromApp = request.frame && isAppUrl(request.frame.url);
      if (!fromApp || !armed || Date.now() > armed.expires) {
        console.warn('[ghost] denied an unarmed or foreign display-media request');
        callback({});
        return;
      }
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (!sources.length) {
            callback({});
            return;
          }
          const grant = { video: sources[0] };
          if (armed.kind === 'meeting' && request.audioRequested) grant.audio = 'loopback';
          callback(grant);
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}

// Everything is denied except mic access (getUserMedia audio) and
// clipboard writes for the "Copy" button, and only for our own page.
const ALLOWED_PERMISSIONS = new Set(['media', 'clipboard-sanitized-write', 'display-capture']);

function installPermissionHandlers(ses) {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let ok = ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl || webContents.getURL());
    // getUserMedia is only ever used for the mic — never the camera.
    if (ok && permission === 'media' && (details.mediaTypes || []).includes('video')) ok = false;
    if (!ok) console.warn(`[ghost] denied permission request: ${permission}`);
    callback(ok);
  });
  ses.setPermissionCheckHandler((webContents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission) && !!webContents && isAppUrl(webContents.getURL());
  });
}

// No navigation away from index.html, no popups, no <webview>.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// ---- IPC ----

// Registers an invoke handler that rejects calls from anything other than
// our own index.html. Thrown errors surface as rejected promises in the
// renderer.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.warn(`[ghost] blocked IPC "${channel}" from untrusted sender`);
      throw new Error('Untrusted IPC sender');
    }
    return fn(event, ...args);
  });
}

const actionLimiter = new RateLimiter(20, 60_000); // LLM requests per minute
const clipLimiter = new RateLimiter(30, 60_000); // transcription clips per minute (~7s each)
const inflight = new Map(); // requestId -> AbortController

function registerIpc() {
  handle(INVOKE.GET_SETTINGS, () => store.getSettings());

  handle(INVOKE.SET_SETTINGS, (_e, patch) => {
    const next = store.setSettings(patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'hideFromCapture'))
      applyContentProtection(next.hideFromCapture);
    if (Object.prototype.hasOwnProperty.call(patch, 'shortcuts')) registerShortcuts();
    if (Object.prototype.hasOwnProperty.call(patch, 'panelOpacity') && mainWindow && !clickThrough) {
      mainWindow.setOpacity(next.panelOpacity);
    }
    if (patch.saveHistory === false) store.clearHistory();
    return next;
  });

  handle(INVOKE.COMPLETE_ONBOARDING, () => store.setSettings({ onboardingComplete: true }));

  handle(INVOKE.SAVE_API_KEY, (_e, args) => {
    const { provider, key } = validateApiKeyArgs(args);
    return store.saveApiKey(provider, key);
  });
  handle(INVOKE.HAS_API_KEY, (_e, provider) => store.hasApiKey(validateProvider(provider)));
  handle(INVOKE.CLEAR_API_KEY, (_e, provider) => store.clearApiKey(validateProvider(provider)));

  handle(INVOKE.TOGGLE_CLICKTHROUGH, () => {
    toggleClickThrough();
    return clickThrough;
  });

  handle(INVOKE.RESIZE_PANEL, (_e, args) => {
    if (!mainWindow) return;
    const { width, height } = validateResize(args);
    const [w, h] = mainWindow.getSize();
    mainWindow.setSize(width || w, height || h);
  });

  handle(INVOKE.HIDE_PANEL, () => mainWindow && mainWindow.hide());
  handle(INVOKE.QUIT_APP, () => app.quit());

  handle(INVOKE.ARM_CAPTURE, (_e, kind) => {
    if (kind !== 'screen' && kind !== 'meeting') throw new Error('Invalid capture kind');
    armedCapture = { kind, expires: Date.now() + CAPTURE_ARM_MS };
    return true;
  });

  handle(INVOKE.GET_SHORTCUT_STATUS, () => shortcutStatus);

  handle(INVOKE.GET_HISTORY, () => (store.getSettings().saveHistory ? store.loadHistory() : []));
  handle(INVOKE.SAVE_HISTORY, (_e, history) => {
    if (!store.getSettings().saveHistory) return false;
    return store.saveHistory(validateHistoryForSave(history));
  });
  handle(INVOKE.CLEAR_HISTORY, () => store.clearHistory());

  // Rolling mic/meeting-audio transcription. Renderer sends short clips
  // (~7s) as base64; we return best-effort transcript text for that clip.
  handle(INVOKE.TRANSCRIBE_CLIP, async (_e, args) => {
    const { audioBase64, mimeType } = validateClip(args);
    if (!clipLimiter.tryAcquire()) throw new Error('Too many transcription requests — skipping this clip.');
    const keys = {};
    for (const p of ['openai', 'gemini']) if (store.hasApiKey(p)) keys[p] = store.getApiKey(p);
    return transcribeClip(
      { audioBuffer: Buffer.from(audioBase64, 'base64'), mimeType },
      keys,
      store.getSettings().provider,
    );
  });

  // Streaming LLM action. The renderer sends the action id + any captured
  // screenshot/transcript/history; we stream provider text back over
  // 'stream-chunk' / 'stream-done' / 'stream-error' tagged with requestId.
  // The provider always comes from saved settings, never from the payload.
  handle(INVOKE.RUN_ACTION, async (event, raw) => {
    const payload = validateRunPayload(raw);
    if (!actionLimiter.tryAcquire()) throw new Error('Slow down — too many requests in the last minute.');

    const settings = store.getSettings();
    const providerName = settings.provider;
    const apiKey = store.getApiKey(providerName);
    const webContents = event.sender;
    const send = (channel, data) => {
      if (!webContents.isDestroyed()) webContents.send(channel, data);
    };
    const { requestId } = payload;

    const controller = new AbortController();
    inflight.set(requestId, controller);
    console.log(
      `[ghost] action=${payload.action} provider=${providerName} smart=${settings.smartMode} turns=${payload.history.length}`,
    );

    try {
      await runAction(
        payload,
        { settings, providerName, apiKey, signal: controller.signal },
        {
          onChunk: (text) => send(EVENTS.STREAM_CHUNK, { requestId, text }),
          onDone: (meta) => send(EVENTS.STREAM_DONE, { requestId, meta }),
        },
      );
    } catch (err) {
      const cancelled = controller.signal.aborted;
      if (!cancelled) console.error('[ghost] run-action failed:', err);
      send(EVENTS.STREAM_ERROR, {
        requestId,
        message: cancelled ? 'Stopped.' : String((err && err.message) || err),
        retryable: !cancelled && !!(err && err.retryable),
        cancelled,
      });
    } finally {
      inflight.delete(requestId);
    }
    return true;
  });

  handle(INVOKE.CANCEL_ACTION, (_e, requestId) => {
    const controller = inflight.get(validateRequestId(requestId));
    if (controller) controller.abort();
    return !!controller;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) mainWindow.show();
  });

  app.whenReady().then(() => {
    if (isWindows) app.setAppUserModelId('com.gppatil103.ghost');
    store.init(app.getPath('userData'));
    installDisplayMediaHandler(session.defaultSession);
    installPermissionHandlers(session.defaultSession);
    registerIpc();
    createWindow();
    createTray();
    registerShortcuts();

    app.on('activate', () => {
      if (!mainWindow) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  // Ghost lives in the tray; closing the window doesn't quit the app.
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
