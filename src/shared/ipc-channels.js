// @ts-check
// Single source of truth for IPC channel names. The main process requires
// this module directly. The sandboxed preload can't require local files, so
// it repeats these strings — test/ipc-channels.test.js fails if they drift.

/** renderer -> main, request/response via ipcRenderer.invoke */
const INVOKE = {
  GET_SETTINGS: 'get-settings',
  SET_SETTINGS: 'set-settings',
  COMPLETE_ONBOARDING: 'complete-onboarding',
  SAVE_API_KEY: 'save-api-key',
  HAS_API_KEY: 'has-api-key',
  CLEAR_API_KEY: 'clear-api-key',
  TOGGLE_CLICKTHROUGH: 'toggle-clickthrough',
  RESIZE_PANEL: 'resize-panel',
  HIDE_PANEL: 'hide-panel',
  QUIT_APP: 'quit-app',
  ARM_CAPTURE: 'arm-capture',
  RUN_ACTION: 'run-action',
  CANCEL_ACTION: 'cancel-action',
  TRANSCRIBE_CLIP: 'transcribe-clip',
  GET_SHORTCUT_STATUS: 'get-shortcut-status',
  GET_HISTORY: 'get-history',
  SAVE_HISTORY: 'save-history',
  CLEAR_HISTORY: 'clear-history',
};

/** main -> renderer, fire-and-forget via webContents.send */
const EVENTS = {
  TRIGGER_ACTION: 'trigger-action',
  TOGGLE_SMART: 'toggle-smart',
  TOGGLE_MIC: 'toggle-mic',
  OPEN_SETTINGS: 'open-settings',
  SHOW_TUTORIAL: 'show-tutorial',
  CLICK_THROUGH_CHANGED: 'click-through-changed',
  STREAM_CHUNK: 'stream-chunk',
  STREAM_DONE: 'stream-done',
  STREAM_ERROR: 'stream-error',
};

/**
 * @typedef {{ role: 'user' | 'assistant', text: string }} HistoryTurn
 *
 * @typedef {object} RunActionPayload
 * @property {string} requestId
 * @property {string} action
 * @property {string} [transcript]
 * @property {string} [userQuestion]
 * @property {string} [imageBase64]
 * @property {'image/png' | 'image/jpeg'} [imageMimeType]
 * @property {HistoryTurn[]} [history]
 *
 * @typedef {{ inputTokens?: number, outputTokens?: number }} Usage
 *
 * @typedef {object} StreamDoneMeta
 * @property {string} provider
 * @property {string} model
 * @property {string} fullText
 * @property {Usage} usage
 *
 * @typedef {{ requestId: string, message: string, retryable: boolean, cancelled?: boolean }} StreamError
 */

module.exports = { INVOKE, EVENTS };
