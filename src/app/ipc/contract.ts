// The typed IPC contract between renderer and main.
// Single source of truth: channel names, payload shapes, and the Api surface
// the preload script exposes as window.api. Main handlers and the preload
// facade both import this file, so a mismatch is a compile error instead of a
// runtime surprise in one of four processes.

import type {
  Prefs,
  ProgressEvent,
  RecordingMeta,
  SaveRecordingInput,
  StoredRecording,
  Summary,
  Transcript,
  WhisperModelInfo,
} from '../../core/types';

export const CHANNELS = {
  pickFile: 'audio:pickFile',
  requestMicAccess: 'audio:requestMicAccess',
  systemAudioStatus: 'audio:systemAudioStatus',
  transcribe: 'transcribe:run',
  transcribeProgress: 'transcribe:progress',
  summarize: 'summarize:run',
  systemInfo: 'system:info',
  ollamaCheck: 'ollama:check',
  whisperPreload: 'whisper:preload',
  whisperPreloadProgress: 'whisper:preload-progress',
  whisperListModels: 'whisper:listModels',
  openExternal: 'shell:openExternal',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsSaveKey: 'settings:saveKey',
  recordingsSave: 'recordings:save',
  recordingsUpdateTranscript: 'recordings:updateTranscript',
  recordingsUpdateSummary: 'recordings:updateSummary',
  recordingsList: 'recordings:list',
  recordingsGet: 'recordings:get',
  recordingsGetAudio: 'recordings:getAudio',
  recordingsDelete: 'recordings:delete',
} as const;

export interface TranscribeRequestOpts {
  model?: string;
  dtype?: string;
  language?: string;
}

export interface SystemInfo {
  ramGb: number;
  platform: NodeJS.Platform;
  arch: string;
}

export type SettingsView = Prefs & { hasApiKey: boolean };

/** What window.api looks like from the renderer's point of view. */
export interface Api {
  // Audio
  pickAudioFile(): Promise<{ path: string; name: string } | null>;
  requestMicAccess(): Promise<boolean>;
  systemAudioStatus(): Promise<string>;

  // Transcription — pcm is a Float32Array (mono 16kHz) prepared in the renderer
  transcribe(pcm: Float32Array, opts?: TranscribeRequestOpts): Promise<Transcript>;
  onTranscribeProgress(cb: (p: ProgressEvent) => void): () => void;

  // Summarization
  summarize(transcriptText: string): Promise<Summary>;

  // Setup wizard helpers
  getSystemInfo(): Promise<SystemInfo>;
  checkOllama(baseUrl: string): Promise<boolean>;
  preloadWhisper(model: string): Promise<void>;
  onWhisperPreloadProgress(cb: (p: ProgressEvent) => void): () => void;
  openExternal(url: string): Promise<void>;

  // Whisper model list (with cache status)
  listWhisperModels(): Promise<WhisperModelInfo[]>;

  // Settings
  getSettings(): Promise<SettingsView>;
  saveSettings(partial: Partial<Prefs>): Promise<Prefs>;
  saveApiKey(apiKey: string): Promise<{ hasApiKey: boolean }>;

  // Recordings library (local persistence)
  saveRecording(input: SaveRecordingInput): Promise<RecordingMeta>;
  updateRecordingTranscript(id: string, transcript: Transcript): Promise<RecordingMeta>;
  updateRecordingSummary(id: string, summary: Summary): Promise<RecordingMeta>;
  listRecordings(): Promise<RecordingMeta[]>;
  getRecording(id: string): Promise<StoredRecording>;
  getRecordingAudio(id: string): Promise<{ bytes: ArrayBuffer; mime: string }>;
  deleteRecording(id: string): Promise<{ id: string; deleted: boolean }>;
}
