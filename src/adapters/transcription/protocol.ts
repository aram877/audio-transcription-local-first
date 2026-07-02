// Message protocol between the main-process WhisperClient and the worker.

import type { ProgressEvent, Transcript } from '../../core/types';

export type WorkerRequest =
  | { id: number; type: 'init'; cacheDir: string | null }
  | { id: number; type: 'preload'; model: string; dtype?: string }
  | { id: number; type: 'transcribe'; pcm: Float32Array; opts: { model?: string; dtype?: string; language?: string } };

export type WorkerResponse =
  | { id: number; type: 'progress'; payload: ProgressEvent }
  | { id: number; type: 'result'; payload: Transcript | true }
  | { id: number; type: 'error'; message: string };
