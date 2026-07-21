// Local-only persistence. Settings live in a plain JSON file; API keys are
// encrypted with Electron's safeStorage (backed by Windows DPAPI) before
// ever touching disk, and never leave the machine.

const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

let userDataDir = null;
let settingsPath = null;
let keysPath = null;

const DEFAULT_SETTINGS = {
  onboardingComplete: false,
  provider: 'openai',        // 'openai' | 'anthropic' | 'gemini'
  smartMode: false,          // false = fast model, true = slower/better model
  transcriptionProvider: 'auto', // 'auto' | 'openai' | 'gemini' | 'none'
  hideFromCapture: true,    // best-effort Windows capture-exclusion, off by default
  panelOpacity: 0.86,
  theme: 'dark',
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function init(dir) {
  userDataDir = dir;
  settingsPath = path.join(dir, 'ghost-settings.json');
  keysPath = path.join(dir, 'ghost-keys.enc.json');
}

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(settingsPath, {}) };
}

function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(settingsPath, next);
  return next;
}

// --- API keys ---
// Stored as { provider: base64(encryptedBuffer) }. If the OS-level
// encryption backend isn't available (rare, e.g. some locked-down VMs),
// we refuse to store the raw key and tell the caller instead of silently
// writing plaintext secrets to disk.

function loadKeyFile() {
  return readJson(keysPath, {});
}

function saveApiKey(provider, key) {
  if (!key || typeof key !== 'string') throw new Error('Empty key');
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secure storage is unavailable on this machine; refusing to store an unencrypted key.');
  }
  const encrypted = safeStorage.encryptString(key.trim());
  const all = loadKeyFile();
  all[provider] = encrypted.toString('base64');
  writeJson(keysPath, all);
  return true;
}

function getApiKey(provider) {
  const all = loadKeyFile();
  const b64 = all[provider];
  if (!b64) return null;
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

function getAllApiKeys() {
  return {
    openai: getApiKey('openai'),
    anthropic: getApiKey('anthropic'),
    gemini: getApiKey('gemini'),
  };
}

function hasApiKey(provider) {
  return !!getApiKey(provider);
}

function clearApiKey(provider) {
  const all = loadKeyFile();
  delete all[provider];
  writeJson(keysPath, all);
  return true;
}

module.exports = {
  init, getSettings, setSettings,
  saveApiKey, getApiKey, getAllApiKeys, hasApiKey, clearApiKey,
};
