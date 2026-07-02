// Domain types for the audio-transcription pipeline:
//   audio source -> transcript -> summary -> stored recording
// Pure types — no Electron, no DOM. Everything else in the app speaks these.

/** A single timestamped segment of transcribed speech. */
export interface TranscriptSegment {
  /** segment start time in seconds */
  start: number;
  /** segment end time in seconds */
  end: number;
  text: string;
}

/** A completed transcript. */
export interface Transcript {
  /** full transcript text */
  text: string;
  segments: TranscriptSegment[];
  /** model id used to produce it */
  model?: string;
  /** language used, or auto-detected name ("auto" if unknown) */
  language?: string;
  /** true when the language was auto-detected */
  detected?: boolean;
}

/** An AI-generated summary of a transcript. */
export interface Summary {
  /** prose summary */
  text: string;
  keyPoints: string[];
  /** extracted action items (may be empty) */
  actionItems: string[];
  /** provider id that produced it */
  provider?: string;
}

/** The source audio for a session. */
export interface AudioSource {
  kind: 'import' | 'record';
  /** original file path (for imports) */
  path?: string;
  /** display name */
  name?: string;
}

/** A recording persisted to the local library (userData/recordings/<id>/). */
export interface StoredRecording {
  /** "rec_" + random hex */
  id: string;
  /** ISO timestamp */
  createdAt: string;
  source: AudioSource;
  durationSec: number;
  /** on-disk audio file info */
  audio: { file: string; mime: string; bytes: number };
  transcript: Transcript | null;
  summary: Summary | null;
}

/** Lightweight metadata for the library list view (no transcript/summary payload). */
export interface RecordingMeta {
  id: string;
  createdAt: string;
  source: AudioSource;
  durationSec: number;
  audio: { mime?: string; bytes?: number };
  hasSummary: boolean;
  language: string | null;
  detected: boolean;
  segmentCount: number;
}

/** Input for persisting a new recording. */
export interface SaveRecordingInput {
  audioBytes: ArrayBuffer | Uint8Array;
  mime?: string;
  /** file extension without the dot (e.g. "webm") */
  ext?: string;
  source?: AudioSource;
  durationSec?: number;
  transcript?: Transcript | null;
  summary?: Summary | null;
}

/** Progress events emitted while loading/downloading a model or transcribing. */
export interface ProgressEvent {
  status: string;
  /** 0-100 while downloading */
  progress?: number;
  /** file currently being downloaded */
  file?: string;
}

export type ProgressCallback = (p: ProgressEvent) => void;

/** A Whisper model the engine knows about, with local cache status. */
export interface WhisperModelInfo {
  id: string;
  label: string;
  size: string;
  note: string;
  cached: boolean;
}

/** User preferences persisted in userData/preferences.json. */
export interface Prefs {
  provider: string;
  summaryModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  transcriptionModel: string;
  /** weight precision, e.g. "q8" — int8 keeps allocations small and CPU fast */
  transcriptionDtype: string;
  language: string;
  setupComplete: boolean;
}
