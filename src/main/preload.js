// Preload: exposes a minimal, safe API to the renderer over contextBridge.
// The renderer never gets Node or ipcRenderer directly.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Audio
  pickAudioFile: () => ipcRenderer.invoke('audio:pickFile'),
  requestMicAccess: () => ipcRenderer.invoke('audio:requestMicAccess'),
  systemAudioStatus: () => ipcRenderer.invoke('audio:systemAudioStatus'),

  // Transcription — pcm is a Float32Array (mono 16kHz) prepared in the renderer
  transcribe: (pcm, opts) => ipcRenderer.invoke('transcribe:run', pcm, opts),
  onTranscribeProgress: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('transcribe:progress', listener);
    return () => ipcRenderer.removeListener('transcribe:progress', listener);
  },

  // Summarization
  summarize: (transcriptText) => ipcRenderer.invoke('summarize:run', transcriptText),

  // Setup wizard helpers
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  checkOllama: (baseUrl) => ipcRenderer.invoke('ollama:check', baseUrl),
  preloadWhisper: (model) => ipcRenderer.invoke('whisper:preload', model),
  onWhisperPreloadProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('whisper:preload-progress', listener);
    return () => ipcRenderer.removeListener('whisper:preload-progress', listener);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Whisper model list (with cache status)
  listWhisperModels: () => ipcRenderer.invoke('whisper:listModels'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  saveApiKey: (apiKey) => ipcRenderer.invoke('settings:saveKey', apiKey),

  // Recordings library (local persistence)
  saveRecording: (input) => ipcRenderer.invoke('recordings:save', input),
  updateRecordingTranscript: (id, transcript) => ipcRenderer.invoke('recordings:updateTranscript', id, transcript),
  updateRecordingSummary: (id, summary) => ipcRenderer.invoke('recordings:updateSummary', id, summary),
  listRecordings: () => ipcRenderer.invoke('recordings:list'),
  getRecording: (id) => ipcRenderer.invoke('recordings:get', id),
  getRecordingAudio: (id) => ipcRenderer.invoke('recordings:getAudio', id),
  deleteRecording: (id) => ipcRenderer.invoke('recordings:delete', id),
});
