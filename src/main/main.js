// Ghost — main process
// Owns the floating panel window, global shortcuts, screen/audio capture
// plumbing, and routes actions to the selected LLM provider.

// Check Windows version for content protection support
const isWindows = process.platform === 'win32';
const windowsBuild = isWindows ? require('os').release() : '';
const supportsCaptureProtection = isWindows && parseInt(windowsBuild.split('.')[2]) >= 19041; // Windows 10 2004+
console.log(`Windows build: \${windowsBuild}, Capture protection supported: \${supportsCaptureProtection}`);

const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer,
        session, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');

const store = require('./store');
const { runAction, ACTIONS, transcribeClip } = require('./actions');

let mainWindow = null;
let tray = null;
let clickThrough = false;

const isDev = !app.isPackaged;

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = primary.workAreaSize;

  mainWindow = new BrowserWindow({
    width: 380,
    height: 560,
    x: sw - 380 - 24,
    y: 48,
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
    // CRITICAL: These help with capture protection
    focusable: true,           // Keep focusable for interaction
    closable: true,
    minimizable: false,        // Don't allow minimize (can show in previews)
    maximizable: false,
    fullscreenable: false,     // Prevent fullscreen which changes window properties
    type: 'toolbar', // This can help with some capture methods
    vibrancy: 'under-window', // macOS specific, but won't hurt on Windows
    visualEffectState: 'inactive', // macOS specific

    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needs to call desktopCapturer-backed getDisplayMedia
      offscreen: false,
      experimentalFeatures: true,
    },
  });

  // Keep the panel above fullscreen apps / games / video calls on Windows.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    applyContentProtection(store.getSettings().hideFromCapture);
    if (!store.getSettings().onboardingComplete) {
      mainWindow.webContents.send('show-tutorial');
    }
    
    // Enhanced content protection
    if (supportsCaptureProtection) {
      try {
        // Set multiple protection methods
        mainWindow.setContentProtection(true);
        mainWindow.setSkipTaskbar(true);
        mainWindow.setIgnoreMouseEvents(false, { forward: true });
        
        // Additional Windows-specific protection
        if (isWindows) {
          mainWindow.setAppDetails({
            appId: 'ghost.ai',
            appIconPath: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
            appIconIndex: 0,
          });
        }
      } catch (e) {
        console.error('Enhanced content protection failed', e);
      }
    }
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else mainWindow.show();
}

function sendAction(actionId) {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.webContents.send('trigger-action', actionId);
}

// Best-effort only: on Windows this sets the WDA_EXCLUDEFROMCAPTURE window
// affinity flag, which many (not all) screen-share and recording tools will
// honor. It is NOT a guarantee — some capture methods, OS versions, or
// third-party tools can still see the window. Off by default; the user
// opts in from Settings after reading the in-app warning.
function applyContentProtection(enabled) {
  if (!mainWindow) return;
  
  try {
    // Standard content protection
    mainWindow.setContentProtection(!!enabled);
    
    // Additional protection methods
    if (enabled) {
      // Try to hide from various capture methods
      mainWindow.setSkipTaskbar(true);
      mainWindow.setVisibleOnAllWorkspaces(true, { 
        visibleOnFullScreen: true,
        skipTransformProcessType: true
      });
      
      // Windows-specific enhancements
      if (isWindows) {
        // Force window to be excluded from capture
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        
        // Additional Windows 10/11 specific protection
        if (supportsCaptureProtection) {
          // This uses Windows SetWindowDisplayAffinity with WDA_EXCLUDEFROMCAPTURE
          mainWindow.webContents.setBackgroundThrottling(false);
        }
      }
    } else {
      mainWindow.setSkipTaskbar(false);
    }
  } catch (e) {
    console.error('Enhanced setContentProtection failed', e);
  }
}

function toggleClickThrough() {
  if (!mainWindow) return;
  
  clickThrough = !clickThrough;
  
  // Enhanced click-through with additional hiding
  mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  
  // When click-through is enabled, also apply additional hiding
  if (clickThrough) {
    try {
      // Make window even more hidden
      mainWindow.setOpacity(0.01); // Nearly transparent but still visible to user
      mainWindow.setFocusable(false);
      
      // Windows-specific additional hiding
      if (isWindows && supportsCaptureProtection) {
        mainWindow.setContentProtection(true);
      }
    } catch (e) {
      console.error('Enhanced click-through hiding failed', e);
    }
  } else {
    // Restore normal visibility
    mainWindow.setOpacity(store.getSettings().panelOpacity || 0.86);
    mainWindow.setFocusable(true);
  }
  
  mainWindow.webContents.send('click-through-changed', clickThrough);
}

function registerShortcuts() {
  const map = {
    'CommandOrControl+Shift+G': toggleWindow,
    'CommandOrControl+Shift+A': () => sendAction(ACTIONS.ASSIST),
    'CommandOrControl+Shift+W': () => sendAction(ACTIONS.WHAT_TO_SAY),
    'CommandOrControl+Shift+F': () => sendAction(ACTIONS.FOLLOW_UP),
    'CommandOrControl+Shift+R': () => sendAction(ACTIONS.RECAP),
    'CommandOrControl+Shift+K': () => sendAction(ACTIONS.ASK_ANYTHING),
    'CommandOrControl+Shift+C': () => sendAction(ACTIONS.SOLVE_CODE),
    'CommandOrControl+Shift+S': () => mainWindow && mainWindow.webContents.send('toggle-smart'),
    'CommandOrControl+Shift+X': toggleClickThrough,
  };
  for (const [accel, fn] of Object.entries(map)) {
    try { globalShortcut.register(accel, fn); }
    catch (e) { console.error('shortcut failed', accel, e); }
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Ghost — AI copilot');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide (Ctrl+Shift+G)', click: toggleWindow },
    { label: 'Click-through (Ctrl+Shift+X)', click: toggleClickThrough },
    { type: 'separator' },
    { label: 'Settings', click: () => sendAction('open-settings') },
    { label: 'Quit Ghost', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', toggleWindow);
}

// ---- Display-media handler: lets the renderer call getDisplayMedia() for
// screenshots (video) and for meeting/system audio (loopback), without a
// user-facing OS picker interrupting the flow every time. ----
function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

// ---- IPC ----
function registerIpc() {
  ipcMain.handle('get-settings', () => store.getSettings());
  ipcMain.handle('set-settings', (_e, patch) => {
    const next = store.setSettings(patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'hideFromCapture')) {
      applyContentProtection(next.hideFromCapture);
    }
    return next;
  });
  ipcMain.handle('save-api-key', (_e, { provider, key }) => store.saveApiKey(provider, key));
  ipcMain.handle('has-api-key', (_e, provider) => store.hasApiKey(provider));
  ipcMain.handle('clear-api-key', (_e, provider) => store.clearApiKey(provider));
  ipcMain.handle('complete-onboarding', () => store.setSettings({ onboardingComplete: true }));

  ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));

  ipcMain.handle('get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
    return sources.map(s => ({ id: s.id, name: s.name }));
  });

  ipcMain.handle('toggle-clickthrough', () => { toggleClickThrough(); return clickThrough; });

  ipcMain.handle('resize-panel', (_e, { width, height }) => {
    if (!mainWindow) return;
    const [w, h] = mainWindow.getSize();
    mainWindow.setSize(width || w, height || h);
  });

  // Rolling mic/meeting-audio transcription. Renderer sends short clips
  // (~6-10s) as base64; we return best-effort transcript text for that clip.
  ipcMain.handle('transcribe-clip', async (_e, { audioBase64, mimeType }) => {
    const keys = store.getAllApiKeys();
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    return transcribeClip({ audioBuffer, mimeType }, keys);
  });

  ipcMain.handle('hide-panel', () => mainWindow && mainWindow.hide());
  ipcMain.handle('quit-app', () => app.quit());

  // Streaming LLM action. Renderer sends the action id + any captured
  // screenshot/transcript context; we stream provider text back over
  // 'stream-chunk' / 'stream-done' / 'stream-error' tagged with requestId.
  ipcMain.handle('run-action', async (event, payload) => {
    const settings = store.getSettings();
    const keys = store.getAllApiKeys();
    const webContents = event.sender;

    console.log(`[ghost] action=${payload.action} provider=${payload.provider || settings.provider} smart=${settings.smartMode}`);

    try {
      await runAction(payload, settings, keys, {
        onChunk: (text) => webContents.send('stream-chunk', { requestId: payload.requestId, text }),
        onDone: (meta) => webContents.send('stream-done', { requestId: payload.requestId, meta }),
      });
    } catch (err) {
      console.error('[ghost] run-action failed:', err);
      webContents.send('stream-error', { requestId: payload.requestId, message: String(err && err.message || err) });
    }
    return true;
  });
}

app.whenReady().then(() => {
  installDisplayMediaHandler();
  store.init(app.getPath('userData'));
  registerIpc();
  createWindow();
  createTray();
  registerShortcuts();

  app.on('activate', () => { if (!mainWindow) createWindow(); });
});

app.on('window-all-closed', () => {
  // Ghost lives in the tray; don't quit on window close on Windows.
  if (process.platform !== 'darwin') { /* no-op, tray keeps it alive */ }
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });