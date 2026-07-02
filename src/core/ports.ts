// Ports: the interfaces the domain core exposes to the outside world.
// Adapters (in src/adapters/) implement these; app glue (src/app/) wires them
// together. The core never imports Electron, the DOM, or an SDK — that is what
// keeps every stage of the pipeline swappable and testable in isolation.

import type {
  ProgressCallback,
  RecordingMeta,
  SaveRecordingInput,
  StoredRecording,
  Summary,
  Transcript,
  WhisperModelInfo,
} from './types';

export interface TranscribeOptions {
  model?: string;
  /** weight precision (e.g. "q8") */
  dtype?: string;
  /** spoken language (e.g. "english"); omit or "auto" to detect */
  language?: string;
  onProgress?: ProgressCallback;
}

/** Speech-to-text engine (today: Whisper in a utility process). */
export interface TranscriptionEngine {
  /** Transcribe mono 16 kHz PCM into text + timestamped segments. */
  transcribe(pcm: Float32Array, opts?: TranscribeOptions): Promise<Transcript>;
  /** Pre-download/load a model (setup wizard). */
  preload(model: string, onProgress?: ProgressCallback, dtype?: string): Promise<void>;
  /** Known models with local cache status. */
  listModels(): WhisperModelInfo[];
}

export interface SummarizeOptions {
  /** provider credential (cloud providers) */
  apiKey?: string;
  /** provider model id */
  model?: string;
  /** endpoint for local providers (e.g. Ollama) */
  baseUrl?: string;
}

/** Turns transcript text into a structured summary. */
export interface SummarizationProvider {
  id: string;
  summarize(transcript: string, opts?: SummarizeOptions): Promise<Summary>;
}

/** Local persistence for recordings (audio + transcript + summary). */
export interface RecordingStore {
  save(input: SaveRecordingInput): RecordingMeta;
  updateTranscript(id: string, transcript: Transcript): RecordingMeta;
  updateSummary(id: string, summary: Summary): RecordingMeta;
  list(): RecordingMeta[];
  get(id: string): StoredRecording;
  getAudio(id: string): { bytes: ArrayBuffer; mime: string };
  remove(id: string): { id: string; deleted: boolean };
}
