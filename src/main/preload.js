// Preload: exposes a minimal, safe API to the renderer over contextBridge.
// The renderer never gets Node or ipcRenderer directly.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Audio
  pickAudioFile: () => ipcRenderer.invoke('audio:pickFile'),
  requestMicAccess: () => ipcRenderer.invoke('audio:requestMicAccess'),

  // Transcription — pcm is a Float32Array (mono 16kHz) prepared in the renderer
  transcribe: (pcm, opts) => ipcRenderer.invoke('transcribe:run', pcm, opts),
  onTranscribeProgress: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('transcribe:progress', listener);
    return () => ipcRenderer.removeListener('transcribe:progress', listener);
  },

  // Summarization
  summarize: (transcriptText) => ipcRenderer.invoke('summarize:run', transcriptText),

  // Whisper model list (with cache status)
  listWhisperModels: () => ipcRenderer.invoke('whisper:listModels'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  saveApiKey: (apiKey) => ipcRenderer.invoke('settings:saveKey', apiKey),
});
