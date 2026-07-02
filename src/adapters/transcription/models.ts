// The Whisper model catalog + local cache inspection (cheap fs checks).

import fs from 'node:fs';
import path from 'node:path';
import type { WhisperModelInfo } from '../../core/types';

export const KNOWN_MODELS: Omit<WhisperModelInfo, 'cached'>[] = [
  { id: 'onnx-community/whisper-tiny',                       label: 'Whisper Tiny',                         size: '~78 MB',  note: 'fastest, least accurate' },
  { id: 'onnx-community/whisper-base',                       label: 'Whisper Base',                         size: '~145 MB', note: 'fast, decent accuracy' },
  { id: 'onnx-community/whisper-small',                      label: 'Whisper Small',                        size: '~466 MB', note: 'balanced speed/accuracy' },
  { id: 'onnx-community/whisper-large-v3-turbo',             label: 'Whisper Large v3 Turbo',               size: '~1.6 GB', note: 'high accuracy, fast' },
  { id: 'onnx-community/whisper-large-v3-turbo_timestamped', label: 'Whisper Large v3 Turbo (timestamped)', size: '~1.9 GB', note: 'high accuracy, fast, word-level timestamps' },
  { id: 'onnx-community/whisper-large-v3',                   label: 'Whisper Large v3',                     size: '~3.1 GB', note: 'best accuracy, slow' },
];

export function isModelCached(cacheDir: string | null, modelId: string): boolean {
  if (!cacheDir) return false;
  const modelDir = path.join(cacheDir, modelId);
  try {
    if (!fs.existsSync(path.join(modelDir, 'config.json'))) return false;
    const onnxDir = path.join(modelDir, 'onnx');
    return fs.existsSync(onnxDir) && fs.readdirSync(onnxDir).some((f) => f.endsWith('.onnx'));
  } catch {
    return false;
  }
}

export function listModels(cacheDir: string | null): WhisperModelInfo[] {
  return KNOWN_MODELS.map((m) => ({ ...m, cached: isModelCached(cacheDir, m.id) }));
}
