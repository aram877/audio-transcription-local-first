// Local Whisper transcription via @huggingface/transformers (ONNX runtime).
// Runs entirely on-device: the model is downloaded once to a local cache and
// inference happens in-process. No audio is sent to any external service.

const fs = require('fs');
const path = require('path');
const { TARGET_SAMPLE_RATE } = require('../../shared/formats');

const KNOWN_MODELS = [
  { id: 'onnx-community/whisper-tiny',                       label: 'Whisper Tiny',                         size: '~78 MB',  note: 'fastest, least accurate' },
  { id: 'onnx-community/whisper-base',                       label: 'Whisper Base',                         size: '~145 MB', note: 'fast, decent accuracy' },
  { id: 'onnx-community/whisper-small',                      label: 'Whisper Small',                        size: '~466 MB', note: 'balanced speed/accuracy' },
  { id: 'onnx-community/whisper-large-v3-turbo',             label: 'Whisper Large v3 Turbo',               size: '~1.6 GB', note: 'high accuracy, fast' },
  { id: 'onnx-community/whisper-large-v3-turbo_timestamped', label: 'Whisper Large v3 Turbo (timestamped)', size: '~1.9 GB', note: 'high accuracy, fast, word-level timestamps' },
  { id: 'onnx-community/whisper-large-v3',                   label: 'Whisper Large v3',                     size: '~3.1 GB', note: 'best accuracy, slow' },
];

let _configuredCacheDir = null;

function setCacheDir(dir) {
  _configuredCacheDir = dir;
}

function _cacheDir() {
  if (_configuredCacheDir) return _configuredCacheDir;
  // Dev fallback: .cache next to the transformers package (not inside ASAR in prod).
  try {
    const pkg = require.resolve('@huggingface/transformers/package.json');
    return path.join(path.dirname(pkg), '.cache');
  } catch {
    return null;
  }
}

function isModelCached(modelId) {
  const cacheDir = _cacheDir();
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

function listModels() {
  return KNOWN_MODELS.map((m) => ({ ...m, cached: isModelCached(m.id) }));
}

// Default model id. Whisper sizes trade speed for accuracy; "base" is a
// reasonable default for an MVP. Selection is wired through settings later.
const DEFAULT_MODEL = 'onnx-community/whisper-base';

let _pipelinePromise = null;
let _loadedModel = null;

/**
 * Lazily load the ASR pipeline. Throws an actionable error if the model
 * cannot be loaded/downloaded (e.g. offline first run).
 * @param {string} model
 * @param {(p: {status: string, progress?: number}) => void} [onProgress]
 */
async function getPipeline(model, onProgress) {
  if (_pipelinePromise && _loadedModel === model) return _pipelinePromise;

  _loadedModel = model;
  _pipelinePromise = (async () => {
    let pipeline, env;
    try {
      ({ pipeline, env } = await import('@huggingface/transformers'));
      if (_configuredCacheDir) env.cacheDir = _configuredCacheDir;
    } catch (err) {
      throw new Error(
        'Transcription engine is not installed. Run `npm install` to add @huggingface/transformers.'
      );
    }
    try {
      return await pipeline('automatic-speech-recognition', model, {
        progress_callback: (p) => {
          if (onProgress && p && p.status) {
            onProgress({ status: p.status, progress: p.progress });
          }
        },
      });
    } catch (err) {
      _pipelinePromise = null; // allow retry
      throw new Error(
        `Could not load Whisper model "${model}". ` +
          'A one-time download is required on first use and needs a network connection. ' +
          `Underlying error: ${err && err.message ? err.message : err}`
      );
    }
  })();

  return _pipelinePromise;
}

/**
 * Transcribe mono 16 kHz PCM audio into text + timestamped segments.
 * @param {Float32Array} pcm - mono PCM samples at TARGET_SAMPLE_RATE
 * @param {Object} [opts]
 * @param {string} [opts.model]
 * @param {string} [opts.language] - spoken language (e.g. "english"); omit or "auto" to detect
 * @param {(p: {status: string, progress?: number}) => void} [opts.onProgress]
 * @returns {Promise<import('../../shared/types').Transcript>}
 */
async function transcribe(pcm, opts = {}) {
  if (!pcm || pcm.length === 0) {
    throw new Error('No audio to transcribe (empty or missing PCM data).');
  }
  const model = opts.model || DEFAULT_MODEL;
  const asr = await getPipeline(model, opts.onProgress);

  if (opts.onProgress) opts.onProgress({ status: 'transcribing' });

  // When no language is given, Whisper auto-detects it from the audio.
  // A forced language is passed through to constrain decoding.
  const language = opts.language && opts.language !== 'auto' ? opts.language : null;
  const generateOpts = {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    task: 'transcribe',
  };
  if (language) generateOpts.language = language;

  let output;
  try {
    output = await asr(pcm, generateOpts);
  } catch (err) {
    throw new Error(
      `Transcription failed: ${err && err.message ? err.message : err}`
    );
  }

  const chunks = Array.isArray(output && output.chunks) ? output.chunks : [];
  /** @type {import('../../shared/types').TranscriptSegment[]} */
  const segments = chunks.map((c) => ({
    start: c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0,
    end: c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : 0,
    text: (c.text || '').trim(),
  }));

  const text = (output && output.text ? output.text : segments.map((s) => s.text).join(' ')).trim();

  if (!text) {
    throw new Error('Transcription produced no text — the audio may be silent or unsupported.');
  }

  // Report which language was used. For a forced language, that's the choice.
  // For auto, attempt to surface what the engine detected (best-effort).
  let reportedLanguage = language;
  let detected = false;
  if (!language) {
    const guess = await detectLanguage(asr, pcm);
    if (guess) {
      reportedLanguage = guess;
      detected = true;
    }
  }

  return { text, segments, model, language: reportedLanguage || 'auto', detected };
}

// Whisper language-token code -> display name (common subset; unknown codes
// fall through to the raw code).
const LANG_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', tr: 'Turkish', pl: 'Polish',
  uk: 'Ukrainian', sv: 'Swedish', id: 'Indonesian', vi: 'Vietnamese',
  he: 'Hebrew', el: 'Greek', cs: 'Czech', ro: 'Romanian', fa: 'Persian',
  th: 'Thai', da: 'Danish', fi: 'Finnish', no: 'Norwegian', hu: 'Hungarian',
};

/**
 * Best-effort detection of the spoken language using the already-loaded model.
 * Generates a single token (the language token Whisper emits first) and parses
 * the `<|xx|>` code from it. Returns null on any failure so the caller can fall
 * back gracefully — this never throws and never affects the transcript.
 * @param {any} asr - the loaded ASR pipeline (exposes processor/model/tokenizer)
 * @param {Float32Array} pcm
 * @returns {Promise<string|null>}
 */
async function detectLanguage(asr, pcm) {
  try {
    if (!asr || !asr.processor || !asr.model || !asr.tokenizer) return null;
    // Use up to the first 30s — enough for the model to pick a language.
    const clip = pcm.length > TARGET_SAMPLE_RATE * 30 ? pcm.subarray(0, TARGET_SAMPLE_RATE * 30) : pcm;
    const inputs = await asr.processor(clip);
    const generated = await asr.model.generate({ ...inputs, max_new_tokens: 1 });
    const ids = typeof generated.tolist === 'function'
      ? generated.tolist()[0]
      : Array.isArray(generated) ? generated[0] : null;
    if (!ids) return null;
    const decoded = asr.tokenizer.decode(ids, { skip_special_tokens: false });
    const match = decoded.match(/<\|([a-z]{2,3})\|>/);
    if (!match) return null;
    const code = match[1];
    return LANG_NAMES[code] || code;
  } catch {
    return null;
  }
}

module.exports = { transcribe, getPipeline, detectLanguage, listModels, setCacheDir, DEFAULT_MODEL, TARGET_SAMPLE_RATE };
