// Local-only persistence. Settings live in a plain JSON file; API keys and
// (opt-in) chat history are encrypted with Electron's safeStorage (backed by
// Windows DPAPI) before ever touching disk, and never leave the machine.

const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { validateSettingsPatch, validateProvider } = require('./validate');

let settingsPath = null;
let keysPath = null;
let historyPath = null;

const DEFAULT_SHORTCUTS = {
  toggle_window: 'CommandOrControl+Shift+G',
  assist: 'CommandOrControl+Shift+A',
  what_to_say: 'CommandOrControl+Shift+W',
  follow_up: 'CommandOrControl+Shift+F',
  recap: 'CommandOrControl+Shift+R',
  ask_anything: 'CommandOrControl+Shift+K',
  solve_code: 'CommandOrControl+Shift+C',
  toggle_smart: 'CommandOrControl+Shift+S',
  toggle_clickthrough: 'CommandOrControl+Shift+X',
  toggle_mic: 'CommandOrControl+Shift+L',
};

const DEFAULT_SETTINGS = {
  onboardingComplete: false,
  provider: 'openai', // 'openai' | 'anthropic' | 'gemini'
  smartMode: false, // false = fast model, true = slower/better model
  hideFromCapture: false, // best-effort Windows capture-exclusion, opt-in
  saveHistory: false, // persist chat history (encrypted) across restarts
  keepTranscriptAfterStop: false, // false = wipe the rolling transcript when capture stops
  panelOpacity: 1, // whole-window opacity (0.2–1), set from Settings → Look
  accent: 'blue', // UI accent color: 'blue' | 'violet' | 'green' | 'orange'
  theme: 'system', // 'system' follows Windows light/dark; or force 'light' | 'dark'
  windowPosition: null, // { x, y } where the user last dragged the panel
  models: {}, // per-provider { fast?, smart? } model id overrides
  shortcuts: {}, // per-command accelerator overrides; '' disables
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Write to a temp file and rename over the target, so a crash mid-write
// can't leave a truncated file behind.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function init(dir) {
  settingsPath = path.join(dir, 'ghost-settings.json');
  keysPath = path.join(dir, 'ghost-keys.enc.json');
  historyPath = path.join(dir, 'ghost-history.enc');
}

// Drop anything on disk that no longer passes the schema (e.g. settings
// from an older version) rather than failing to start.
function sanitizeStored(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    try {
      Object.assign(out, validateSettingsPatch({ [key]: value }));
    } catch {
      /* ignore stale or invalid key */
    }
  }
  return out;
}

function getSettings() {
  const stored = sanitizeStored(readJson(settingsPath, {}));
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    shortcuts: { ...DEFAULT_SHORTCUTS, ...(stored.shortcuts || {}) },
  };
}

function setSettings(patch) {
  const clean = validateSettingsPatch(patch);
  const stored = sanitizeStored(readJson(settingsPath, {}));
  const next = { ...stored, ...clean };
  writeJson(settingsPath, next);
  return getSettings();
}

// --- API keys ---
// Stored as { provider: base64(encryptedBuffer) }. If the OS-level
// encryption backend isn't available (rare, e.g. some locked-down VMs),
// we refuse to store the raw key and tell the caller instead of silently
// writing plaintext secrets to disk.

function requireEncryption() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS-level secure storage is unavailable on this machine; refusing to store unencrypted data.',
    );
  }
}

function loadKeyFile() {
  return readJson(keysPath, {});
}

function saveApiKey(provider, key) {
  validateProvider(provider);
  if (!key || typeof key !== 'string') throw new Error('Empty key');
  requireEncryption();
  const all = loadKeyFile();
  all[provider] = safeStorage.encryptString(key.trim()).toString('base64');
  writeJson(keysPath, all);
  return true;
}

// Decrypts a single provider's key on demand — callers should ask only for
// the one they're about to use.
function getApiKey(provider) {
  validateProvider(provider);
  const b64 = loadKeyFile()[provider];
  if (!b64) return null;
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

function hasApiKey(provider) {
  validateProvider(provider);
  return !!loadKeyFile()[provider];
}

function clearApiKey(provider) {
  validateProvider(provider);
  const all = loadKeyFile();
  delete all[provider];
  writeJson(keysPath, all);
  return true;
}

// --- Chat history (opt-in) ---

function loadHistory() {
  try {
    const buf = fs.readFileSync(historyPath);
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  requireEncryption();
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  const tmp = `${historyPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(history)));
  fs.renameSync(tmp, historyPath);
  return true;
}

function clearHistory() {
  try {
    fs.unlinkSync(historyPath);
  } catch {
    /* already gone */
  }
  return true;
}

module.exports = {
  DEFAULT_SHORTCUTS,
  init,
  getSettings,
  setSettings,
  saveApiKey,
  getApiKey,
  hasApiKey,
  clearApiKey,
  loadHistory,
  saveHistory,
  clearHistory,
};
