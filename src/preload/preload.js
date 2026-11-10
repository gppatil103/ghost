// Runs sandboxed, so it can only require('electron') — channel names are
// repeated from src/shared/ipc-channels.js (kept in sync by a unit test).
const { contextBridge, ipcRenderer } = require('electron');

// Subscribes to a main -> renderer event and returns an unsubscribe function.
function on(channel, cb) {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('ghost', {
  // settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  completeOnboarding: () => ipcRenderer.invoke('complete-onboarding'),
  getShortcutStatus: () => ipcRenderer.invoke('get-shortcut-status'),

  // api keys
  saveApiKey: (provider, key) => ipcRenderer.invoke('save-api-key', { provider, key }),
  hasApiKey: (provider) => ipcRenderer.invoke('has-api-key', provider),
  clearApiKey: (provider) => ipcRenderer.invoke('clear-api-key', provider),

  // window control
  toggleClickThrough: () => ipcRenderer.invoke('toggle-clickthrough'),
  resizePanel: (width, height) => ipcRenderer.invoke('resize-panel', { width, height }),
  hidePanel: () => ipcRenderer.invoke('hide-panel'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // capture: must be called right before getDisplayMedia, or main denies it
  armCapture: (kind) => ipcRenderer.invoke('arm-capture', kind),

  // actions
  runAction: (payload) => ipcRenderer.invoke('run-action', payload),
  cancelAction: (requestId) => ipcRenderer.invoke('cancel-action', requestId),
  transcribeClip: (audioBase64, mimeType) => ipcRenderer.invoke('transcribe-clip', { audioBase64, mimeType }),

  // chat history (only persisted when the user opts in)
  getHistory: () => ipcRenderer.invoke('get-history'),
  saveHistory: (history) => ipcRenderer.invoke('save-history', history),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // events from main -> renderer (each returns an unsubscribe function)
  onTriggerAction: (cb) => on('trigger-action', cb),
  onToggleSmart: (cb) => on('toggle-smart', cb),
  onToggleMic: (cb) => on('toggle-mic', cb),
  onOpenSettings: (cb) => on('open-settings', cb),
  onShowTutorial: (cb) => on('show-tutorial', cb),
  onClickThroughChanged: (cb) => on('click-through-changed', cb),
  onStreamChunk: (cb) => on('stream-chunk', cb),
  onStreamDone: (cb) => on('stream-done', cb),
  onStreamError: (cb) => on('stream-error', cb),
});
