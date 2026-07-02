// App settings + secure credential storage.
// Preferences live in a JSON file in the app's userData dir. The LLM API key is
// encrypted at rest via Electron's safeStorage (OS-backed) so it never sits in
// plain text on disk, and is never written into application code.

import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { Prefs } from '../../core/types';

const PREFS_FILE = 'preferences.json';
const KEY_FILE = 'credential.bin';

export const DEFAULTS: Prefs = {
  provider: 'ollama',
  summaryModel: 'claude-opus-4-8',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  transcriptionModel: 'onnx-community/whisper-base',
  // int8 weights: keeps onnxruntime's allocations small enough that a large
  // model doesn't hard-abort the worker process on load.
  transcriptionDtype: 'q8',
  language: 'auto',
  setupComplete: false,
};

export class SettingsStore {
  constructor(private readonly userDataDir: string) {}

  private prefsPath(): string {
    return path.join(this.userDataDir, PREFS_FILE);
  }

  private keyPath(): string {
    return path.join(this.userDataDir, KEY_FILE);
  }

  loadPrefs(): Prefs {
    try {
      const raw = fs.readFileSync(this.prefsPath(), 'utf8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  savePrefs(partial: Partial<Prefs>): Prefs {
    const next = { ...this.loadPrefs(), ...partial };
    fs.writeFileSync(this.prefsPath(), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  /** Persist the API key, encrypted when the OS supports it. */
  saveApiKey(apiKey: string): void {
    if (!apiKey) {
      try { fs.unlinkSync(this.keyPath()); } catch {}
      return;
    }
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(this.keyPath(), safeStorage.encryptString(apiKey));
    } else {
      // Fallback: still keep it out of source, but plain on disk. Warn the user in UI.
      fs.writeFileSync(this.keyPath(), Buffer.from(apiKey, 'utf8'));
    }
  }

  loadApiKey(): string | null {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(this.keyPath());
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

  hasApiKey(): boolean {
    return !!this.loadApiKey();
  }
}
