// @ts-check
// Input validation for everything that crosses the IPC boundary. The
// renderer is treated as untrusted: every handler in main.js runs its
// payload through one of these before touching the store or a provider.

const PROVIDER_IDS = ['openai', 'anthropic', 'gemini'];

const ACTION_IDS = ['assist', 'what_to_say', 'follow_up', 'recap', 'ask_anything', 'solve_code'];

const SHORTCUT_COMMANDS = [
  'toggle_window',
  'assist',
  'what_to_say',
  'follow_up',
  'recap',
  'ask_anything',
  'solve_code',
  'toggle_smart',
  'toggle_clickthrough',
  'toggle_mic',
];

const ACCENT_IDS = ['blue', 'violet', 'green', 'orange'];
const THEME_IDS = ['system', 'light', 'dark'];

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'];
const AUDIO_MIME_TYPES = ['audio/webm', 'audio/wav'];

// base64 is ~4/3 the size of the raw bytes.
const LIMITS = {
  imageBase64Chars: Math.ceil((8 * 1024 * 1024 * 4) / 3), // ~8 MB image
  audioBase64Chars: Math.ceil((2 * 1024 * 1024 * 4) / 3), // ~2 MB clip
  userQuestionChars: 8000,
  transcriptChars: 14000,
  historyTurns: 20,
  historyTurnChars: 20000,
  requestIdChars: 64,
};

const PANEL_SIZE = { minWidth: 320, maxWidth: 1600, minHeight: 300, maxHeight: 1600 };

class ValidationError extends Error {}

function fail(msg) {
  throw new ValidationError(msg);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
}

function optionalString(v, max, name) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') fail(`${name} must be a string`);
  if (v.length > max) fail(`${name} is too long`);
  return v;
}

function validateProvider(v) {
  if (!PROVIDER_IDS.includes(v)) fail(`Unknown provider: ${String(v).slice(0, 40)}`);
  return v;
}

function validateAction(v) {
  if (!ACTION_IDS.includes(v)) fail(`Unknown action: ${String(v).slice(0, 40)}`);
  return v;
}

function validateRequestId(v) {
  if (typeof v !== 'string' || !/^[\w-]{1,64}$/.test(v)) fail('Invalid requestId');
  return v;
}

function validateHistory(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail('history must be an array');
  return v.slice(-LIMITS.historyTurns).map((turn) => {
    if (!isPlainObject(turn)) fail('history turn must be an object');
    if (turn.role !== 'user' && turn.role !== 'assistant') fail('history role must be user or assistant');
    if (typeof turn.text !== 'string') fail('history text must be a string');
    return { role: turn.role, text: turn.text.slice(0, LIMITS.historyTurnChars) };
  });
}

/** @returns {import('../shared/ipc-channels').RunActionPayload} */
function validateRunPayload(p) {
  if (!isPlainObject(p)) fail('Invalid payload');
  const out = {
    requestId: validateRequestId(p.requestId),
    action: validateAction(p.action),
    transcript: optionalString(p.transcript, LIMITS.transcriptChars, 'transcript'),
    userQuestion: optionalString(p.userQuestion, LIMITS.userQuestionChars, 'Question'),
    history: validateHistory(p.history),
    imageBase64: undefined,
    imageMimeType: undefined,
  };
  if (p.imageBase64) {
    if (typeof p.imageBase64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(p.imageBase64))
      fail('Invalid image data');
    if (p.imageBase64.length > LIMITS.imageBase64Chars) fail('Screenshot is too large (max ~8 MB)');
    const mime = p.imageMimeType || 'image/png';
    if (!IMAGE_MIME_TYPES.includes(mime)) fail('Unsupported image type');
    out.imageBase64 = p.imageBase64;
    out.imageMimeType = mime;
  }
  return out;
}

function validateClip(p) {
  if (!isPlainObject(p)) fail('Invalid payload');
  const { audioBase64, mimeType } = p;
  if (typeof audioBase64 !== 'string' || !audioBase64 || !/^[A-Za-z0-9+/=]+$/.test(audioBase64))
    fail('Invalid audio data');
  if (audioBase64.length > LIMITS.audioBase64Chars) fail('Audio clip is too large (max ~2 MB)');
  if (!AUDIO_MIME_TYPES.includes(mimeType)) fail('Unsupported audio type');
  return { audioBase64, mimeType };
}

function validateApiKeyArgs(p) {
  if (!isPlainObject(p)) fail('Invalid payload');
  validateProvider(p.provider);
  if (typeof p.key !== 'string' || !p.key.trim()) fail('Empty key');
  if (p.key.length > 500 || /\s/.test(p.key.trim())) fail('That does not look like an API key');
  return { provider: p.provider, key: p.key.trim() };
}

function validateResize(p) {
  if (!isPlainObject(p)) fail('Invalid payload');
  const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : undefined);
  return {
    width: clamp(p.width, PANEL_SIZE.minWidth, PANEL_SIZE.maxWidth),
    height: clamp(p.height, PANEL_SIZE.minHeight, PANEL_SIZE.maxHeight),
  };
}

const MODEL_ID_RE = /^[\w.:/-]{1,100}$/;
// Electron accelerators: modifier/key names joined by "+", e.g. "CommandOrControl+Shift+G".
const ACCELERATOR_RE = /^[A-Za-z0-9]+(\+[A-Za-z0-9]+)*$/;

function validateModels(v) {
  if (!isPlainObject(v)) fail('models must be an object');
  const out = {};
  for (const [provider, pair] of Object.entries(v)) {
    validateProvider(provider);
    if (!isPlainObject(pair)) fail('model override must be an object');
    out[provider] = {};
    for (const tier of ['fast', 'smart']) {
      const id = pair[tier];
      if (id === undefined || id === '') continue;
      if (typeof id !== 'string' || !MODEL_ID_RE.test(id)) fail(`Invalid ${tier} model id for ${provider}`);
      out[provider][tier] = id;
    }
  }
  return out;
}

function validateShortcuts(v) {
  if (!isPlainObject(v)) fail('shortcuts must be an object');
  const out = {};
  for (const [cmd, accel] of Object.entries(v)) {
    if (!SHORTCUT_COMMANDS.includes(cmd)) fail(`Unknown shortcut command: ${cmd.slice(0, 40)}`);
    if (accel !== '' && (typeof accel !== 'string' || accel.length > 60 || !ACCELERATOR_RE.test(accel))) {
      fail(`Invalid shortcut for ${cmd}`);
    }
    out[cmd] = accel;
  }
  return out;
}

const bool = (name) => (v) => (typeof v === 'boolean' ? v : fail(`${name} must be true/false`));

const MAX_SCREEN_COORD = 100_000;

function validateWindowPosition(v) {
  const isCoord = (n) => Number.isInteger(n) && Math.abs(n) <= MAX_SCREEN_COORD;
  if (!isPlainObject(v) || !isCoord(v.x) || !isCoord(v.y)) fail('windowPosition must be integer x and y');
  return { x: v.x, y: v.y };
}

const SETTINGS_SCHEMA = {
  onboardingComplete: bool('onboardingComplete'),
  provider: validateProvider,
  smartMode: bool('smartMode'),
  hideFromCapture: bool('hideFromCapture'),
  saveHistory: bool('saveHistory'),
  keepTranscriptAfterStop: bool('keepTranscriptAfterStop'),
  panelOpacity: (v) => (typeof v === 'number' && v >= 0.2 && v <= 1 ? v : fail('panelOpacity must be 0.2–1')),
  windowPosition: validateWindowPosition,
  accent: (v) => (ACCENT_IDS.includes(v) ? v : fail(`accent must be one of ${ACCENT_IDS.join(', ')}`)),
  theme: (v) => (THEME_IDS.includes(v) ? v : fail(`theme must be one of ${THEME_IDS.join(', ')}`)),
  models: validateModels,
  shortcuts: validateShortcuts,
};

function validateSettingsPatch(patch) {
  if (!isPlainObject(patch)) fail('Invalid settings');
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    // Object.hasOwn, not SETTINGS_SCHEMA[key]: keys like "__proto__" or
    // "constructor" would otherwise resolve to Object.prototype members.
    if (!Object.hasOwn(SETTINGS_SCHEMA, key)) fail(`Unknown setting: ${key.slice(0, 40)}`);
    out[key] = SETTINGS_SCHEMA[key](value);
  }
  return out;
}

function validateHistoryForSave(v) {
  if (!Array.isArray(v)) fail('history must be an array');
  // Persisted history keeps more turns than a single request sends.
  return validateHistory(v.slice(-200));
}

// Fixed-window limiter: at most `max` calls per `windowMs`.
class RateLimiter {
  constructor(max, windowMs, now = () => Date.now()) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = [];
  }

  tryAcquire() {
    const t = this.now();
    this.hits = this.hits.filter((h) => t - h < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(t);
    return true;
  }
}

module.exports = {
  PROVIDER_IDS,
  ACTION_IDS,
  SHORTCUT_COMMANDS,
  ACCENT_IDS,
  THEME_IDS,
  LIMITS,
  PANEL_SIZE,
  ValidationError,
  RateLimiter,
  validateProvider,
  validateAction,
  validateRequestId,
  validateRunPayload,
  validateClip,
  validateApiKeyArgs,
  validateResize,
  validateSettingsPatch,
  validateHistory,
  validateHistoryForSave,
};
