// Preload: exposes a minimal, safe API to the renderer over contextBridge.
// The renderer never gets Node or ipcRenderer directly. The Api type it
// implements lives in the IPC contract — main, preload, and renderer all
// compile against the same shapes.

import { contextBridge, ipcRenderer } from 'electron';
import type { ProgressEvent } from '../../core/types';
import { CHANNELS, type Api } from '../ipc/contract';

function progressSubscription(channel: string) {
  return (cb: (p: ProgressEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: ProgressEvent) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const api: Api = {
  // Audio
  pickAudioFile: () => ipcRenderer.invoke(CHANNELS.pickFile),
  requestMicAccess: () => ipcRenderer.invoke(CHANNELS.requestMicAccess),
  systemAudioStatus: () => ipcRenderer.invoke(CHANNELS.systemAudioStatus),

  // Transcription
  transcribe: (pcm, opts) => ipcRenderer.invoke(CHANNELS.transcribe, pcm, opts),
  onTranscribeProgress: progressSubscription(CHANNELS.transcribeProgress),

  // Summarization
  summarize: (transcriptText) => ipcRenderer.invoke(CHANNELS.summarize, transcriptText),

  // Setup wizard helpers
  getSystemInfo: () => ipcRenderer.invoke(CHANNELS.systemInfo),
  checkOllama: (baseUrl) => ipcRenderer.invoke(CHANNELS.ollamaCheck, baseUrl),
  preloadWhisper: (model) => ipcRenderer.invoke(CHANNELS.whisperPreload, model),
  onWhisperPreloadProgress: progressSubscription(CHANNELS.whisperPreloadProgress),
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.openExternal, url),

  // Whisper model list (with cache status)
  listWhisperModels: () => ipcRenderer.invoke(CHANNELS.whisperListModels),

  // Settings
  getSettings: () => ipcRenderer.invoke(CHANNELS.settingsGet),
  saveSettings: (partial) => ipcRenderer.invoke(CHANNELS.settingsSave, partial),
  saveApiKey: (apiKey) => ipcRenderer.invoke(CHANNELS.settingsSaveKey, apiKey),

  // Recordings library (local persistence)
  saveRecording: (input) => ipcRenderer.invoke(CHANNELS.recordingsSave, input),
  updateRecordingTranscript: (id, transcript) => ipcRenderer.invoke(CHANNELS.recordingsUpdateTranscript, id, transcript),
  updateRecordingSummary: (id, summary) => ipcRenderer.invoke(CHANNELS.recordingsUpdateSummary, id, summary),
  listRecordings: () => ipcRenderer.invoke(CHANNELS.recordingsList),
  getRecording: (id) => ipcRenderer.invoke(CHANNELS.recordingsGet, id),
  getRecordingAudio: (id) => ipcRenderer.invoke(CHANNELS.recordingsGetAudio, id),
  deleteRecording: (id) => ipcRenderer.invoke(CHANNELS.recordingsDelete, id),
};

contextBridge.exposeInMainWorld('api', api);
