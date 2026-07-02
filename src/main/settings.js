// App settings + secure credential storage.
// Preferences live in a JSON file in the app's userData dir. The LLM API key is
// encrypted at rest via Electron's safeStorage (OS-backed) so it never sits in
// plain text on disk, and is never written into application code.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const PREFS_FILE = 'preferences.json';
const KEY_FILE = 'credential.bin';

const DEFAULTS = {
  provider: 'ollama',
  summaryModel: 'claude-opus-4-8',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  transcriptionModel: 'onnx-community/whisper-base',
  // int8 weights: keeps onnxruntime's allocations small enough that Electron's
  // Chromium allocator doesn't hard-abort the app when loading large models.
  transcriptionDtype: 'q8',
  language: 'auto',
  setupComplete: false,
};

function prefsPath() {
  return path.join(app.getPath('userData'), PREFS_FILE);
}
function keyPath() {
  return path.join(app.getPath('userData'), KEY_FILE);
}

function loadPrefs() {
  try {
    const raw = fs.readFileSync(prefsPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function savePrefs(partial) {
  const next = { ...loadPrefs(), ...partial };
  fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/**
 * Persist the API key, encrypted when the OS supports it.
 * @param {string} apiKey
 */
function saveApiKey(apiKey) {
  if (!apiKey) {
    try { fs.unlinkSync(keyPath()); } catch {}
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(keyPath(), safeStorage.encryptString(apiKey));
  } else {
    // Fallback: still keep it out of source, but plain on disk. Warn the user in UI.
    fs.writeFileSync(keyPath(), Buffer.from(apiKey, 'utf8'));
  }
}

/**
 * @returns {string|null}
 */
function loadApiKey() {
  let buf;
  try {
    buf = fs.readFileSync(keyPath());
  } catch {
    return null;
  }
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf);
    } catch {
      return buf.toString('utf8'); // was written as plaintext fallback
    }
  }
  return buf.toString('utf8');
}

function hasApiKey() {
  return !!loadApiKey();
}

module.exports = { loadPrefs, savePrefs, saveApiKey, loadApiKey, hasApiKey, DEFAULTS };
