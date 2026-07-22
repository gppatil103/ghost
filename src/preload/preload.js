const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghost', {
  // settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  completeOnboarding: () => ipcRenderer.invoke('complete-onboarding'),

  // api keys
  saveApiKey: (provider, key) => ipcRenderer.invoke('save-api-key', { provider, key }),
  hasApiKey: (provider) => ipcRenderer.invoke('has-api-key', provider),
  clearApiKey: (provider) => ipcRenderer.invoke('clear-api-key', provider),

  // window control
  toggleClickThrough: () => ipcRenderer.invoke('toggle-clickthrough'),
  resizePanel: (width, height) => ipcRenderer.invoke('resize-panel', { width, height }),
  hidePanel: () => ipcRenderer.invoke('hide-panel'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // capture
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),

  // actions
  runAction: (payload) => ipcRenderer.invoke('run-action', payload),
  transcribeClip: (audioBase64, mimeType) => ipcRenderer.invoke('transcribe-clip', { audioBase64, mimeType }),

  // events from main -> renderer
  onTriggerAction: (cb) => ipcRenderer.on('trigger-action', (_e, actionId) => cb(actionId)),
  onToggleSmart: (cb) => ipcRenderer.on('toggle-smart', () => cb()),
  onShowTutorial: (cb) => ipcRenderer.on('show-tutorial', () => cb()),
  onClickThroughChanged: (cb) => ipcRenderer.on('click-through-changed', (_e, v) => cb(v)),
  onStreamChunk: (cb) => ipcRenderer.on('stream-chunk', (_e, data) => cb(data)),
  onStreamDone: (cb) => ipcRenderer.on('stream-done', (_e, data) => cb(data)),
  onStreamError: (cb) => ipcRenderer.on('stream-error', (_e, data) => cb(data)),
});
