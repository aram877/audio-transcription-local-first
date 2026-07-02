// IPC handlers: the thin controller layer. Each handler parses the request,
// calls a port (never an adapter directly), and returns the result. All the
// dependencies arrive injected, so this file is pure wiring.

import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, dialog, ipcMain, shell, systemPreferences } from 'electron';
import { isSupportedExtension, SUPPORTED_EXTENSIONS } from '../../core/formats';
import type { RecordingStore, TranscriptionEngine, SummarizationProvider } from '../../core/ports';
import type { ProgressEvent } from '../../core/types';
import type { SettingsStore } from '../../adapters/storage/settings';
import { CHANNELS } from '../ipc/contract';

export interface IpcDeps {
  engine: TranscriptionEngine;
  store: RecordingStore;
  settings: SettingsStore;
  getSummarizer: (id: string) => SummarizationProvider;
  isLocalProvider: (id: string) => boolean;
  getWindow: () => BrowserWindow | null;
}

export function registerIpc(deps: IpcDeps): void {
  const { engine, store, settings } = deps;

  // --- Audio: pick & validate a file ---
  ipcMain.handle(CHANNELS.pickFile, async () => {
    const win = deps.getWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose an audio file',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: SUPPORTED_EXTENSIONS.map((e) => e.replace('.', '')) },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    if (!isSupportedExtension(filePath)) {
      throw new Error(`Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    }
    return { path: filePath, name: path.basename(filePath) };
  });

  // --- Microphone access (macOS gate; no-op elsewhere) ---
  ipcMain.handle(CHANNELS.requestMicAccess, async () => {
    if (process.platform !== 'darwin') return true;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    try {
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return false;
    }
  });

  // --- System-audio (screen-capture) permission status, for UI hints ---
  // macOS gates loopback audio behind Screen & System Audio Recording; there is
  // no programmatic prompt for it — the first capture attempt triggers one.
  ipcMain.handle(CHANNELS.systemAudioStatus, () => {
    if (process.platform !== 'darwin') return 'granted';
    try { return systemPreferences.getMediaAccessStatus('screen'); } catch { return 'unknown'; }
  });

  // --- Transcription: run local Whisper on mono 16kHz PCM ---
  ipcMain.handle(CHANNELS.transcribe, async (event, pcm: Float32Array | ArrayBuffer, opts: { model?: string; dtype?: string; language?: string } = {}) => {
    const prefs = settings.loadPrefs();
    const onProgress = (payload: ProgressEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(CHANNELS.transcribeProgress, payload);
    };
    // pcm arrives as a Float32Array (structured clone); ensure the right view.
    const samples = pcm instanceof Float32Array ? pcm : new Float32Array(pcm);
    return engine.transcribe(samples, {
      model: opts.model || prefs.transcriptionModel,
      dtype: opts.dtype || prefs.transcriptionDtype,
      language: opts.language || prefs.language,
      onProgress,
    });
  });

  // --- Summarization: send transcript text to the configured provider ---
  ipcMain.handle(CHANNELS.summarize, async (_event, transcriptText: string) => {
    const prefs = settings.loadPrefs();
    const provider = deps.getSummarizer(prefs.provider);

    if (deps.isLocalProvider(prefs.provider)) {
      // Local LLM (e.g. Ollama) — no credential, stays on the machine.
      return provider.summarize(transcriptText, {
        baseUrl: prefs.ollamaBaseUrl,
        model: prefs.ollamaModel,
      });
    }

    // Cloud provider — needs an API key.
    const apiKey = settings.loadApiKey();
    if (!apiKey) {
      throw new Error('No API key configured. Add one in Settings, or switch to a local provider.');
    }
    return provider.summarize(transcriptText, { apiKey, model: prefs.summaryModel });
  });

  // --- System info for setup wizard ---
  ipcMain.handle(CHANNELS.systemInfo, () => ({
    ramGb: Math.round(os.totalmem() / 1073741824),
    platform: process.platform,
    arch: process.arch,
  }));

  // --- Ollama connectivity check ---
  ipcMain.handle(CHANNELS.ollamaCheck, async (_e, baseUrl: string) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${baseUrl || 'http://localhost:11434'}/api/version`, { signal: ctrl.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  });

  // --- Whisper model pre-download for setup wizard ---
  ipcMain.handle(CHANNELS.whisperPreload, async (event, model: string) => {
    const prefs = settings.loadPrefs();
    const onProgress = (p: ProgressEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(CHANNELS.whisperPreloadProgress, p);
    };
    await engine.preload(model, onProgress, prefs.transcriptionDtype);
  });

  // --- Open URL in system browser ---
  ipcMain.handle(CHANNELS.openExternal, (_e, url: string) => shell.openExternal(url));

  // --- Whisper model list with cache status ---
  ipcMain.handle(CHANNELS.whisperListModels, () => engine.listModels());

  // --- Settings ---
  ipcMain.handle(CHANNELS.settingsGet, async () => ({
    ...settings.loadPrefs(),
    hasApiKey: settings.hasApiKey(),
  }));
  ipcMain.handle(CHANNELS.settingsSave, async (_e, partial) => settings.savePrefs(partial || {}));
  ipcMain.handle(CHANNELS.settingsSaveKey, async (_e, apiKey: string) => {
    settings.saveApiKey(apiKey);
    return { hasApiKey: settings.hasApiKey() };
  });

  // --- Recordings library (local persistence) ---
  ipcMain.handle(CHANNELS.recordingsSave, async (_e, input) => store.save(input));
  ipcMain.handle(CHANNELS.recordingsUpdateTranscript, async (_e, id, transcript) => store.updateTranscript(id, transcript));
  ipcMain.handle(CHANNELS.recordingsUpdateSummary, async (_e, id, summary) => store.updateSummary(id, summary));
  ipcMain.handle(CHANNELS.recordingsList, async () => store.list());
  ipcMain.handle(CHANNELS.recordingsGet, async (_e, id) => store.get(id));
  ipcMain.handle(CHANNELS.recordingsGetAudio, async (_e, id) => store.getAudio(id));
  ipcMain.handle(CHANNELS.recordingsDelete, async (_e, id) => store.remove(id));
}
