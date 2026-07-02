// Whisper inference engine (model load + transcribe + language detection).
// Pure Node — no Electron imports — so it can run inside the transcription
// worker process. Everything on-device: the model is downloaded once to a
// local cache and inference happens in-process.

const fs = require('fs');
const path = require('path');
const { TARGET_SAMPLE_RATE } = require('../../shared/formats');

let _cacheDir = null;

function setCacheDir(dir) {
  _cacheDir = dir;
}

// A truncated/partial download leaves an .onnx file that parses as invalid
// protobuf. transformers.js reuses whatever is on disk without re-validating,
// so the same corrupt file fails on every retry. These signatures identify that
// case so we can clear the cache and let the next attempt re-download cleanly.
function _isCorruptModelError(message) {
  return /Protobuf parsing failed|failed to load external data|Deserialize tensor|tensor proto|unexpected end|corrupt|ProtoBuf/i.test(
    String(message || '')
  );
}

// Delete a model's cached files so the next load re-downloads it from scratch.
function clearModelCache(modelId) {
  if (!_cacheDir) return false;
  const modelDir = path.join(_cacheDir, modelId);
  // Guard against an empty/odd id wiping the whole cache root.
  if (!modelId || path.resolve(modelDir) === path.resolve(_cacheDir)) return false;
  try {
    fs.rmSync(modelDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_MODEL = 'onnx-community/whisper-base';

// Default weight precision. int8 ("q8") keeps allocations small (a large fp32
// model can exceed what the process allocator tolerates in one block) and runs
// faster on CPU.
const DEFAULT_DTYPE = 'q8';

let _pipelinePromise = null;
let _loadedKey = null;

/**
 * Lazily load the ASR pipeline. Throws an actionable error if the model
 * cannot be loaded/downloaded (e.g. offline first run).
 */
async function getPipeline(model, onProgress, dtype = DEFAULT_DTYPE) {
  const key = `${model}@${dtype || 'default'}`;
  if (_pipelinePromise && _loadedKey === key) return _pipelinePromise;

  _loadedKey = key;
  _pipelinePromise = (async () => {
    let pipeline, env;
    try {
      ({ pipeline, env } = await import('@huggingface/transformers'));
      if (_cacheDir) env.cacheDir = _cacheDir;
    } catch (err) {
      throw new Error(
        'Transcription engine is not installed. Run `npm install` to add @huggingface/transformers.'
      );
    }
    try {
      const opts = {
        progress_callback: (p) => {
          if (onProgress && p && p.status) {
            onProgress({ status: p.status, progress: p.progress, file: p.file });
          }
        },
      };
      if (dtype) opts.dtype = dtype;
      return await pipeline('automatic-speech-recognition', model, opts);
    } catch (err) {
      _pipelinePromise = null; // allow retry
      const underlying = err && err.message ? err.message : String(err);
      // Self-heal a corrupt/partial download: clear the cached model so the next
      // attempt re-downloads it instead of failing on the same bad file forever.
      if (_isCorruptModelError(underlying)) {
        const cleared = clearModelCache(model);
        throw new Error(
          `The cached Whisper model "${model}" was incomplete or corrupted ` +
            '(likely an interrupted download). ' +
            (cleared
              ? 'It has been removed — press Transcribe again to re-download it (needs a network connection).'
              : 'Please delete it from the model cache and try again.') +
            ` Underlying error: ${underlying}`
        );
      }
      throw new Error(
        `Could not load Whisper model "${model}". ` +
          'A one-time download is required on first use and needs a network connection. ' +
          `Underlying error: ${underlying}`
      );
    }
  })();

  return _pipelinePromise;
}

/**
 * Transcribe mono 16 kHz PCM audio into text + timestamped segments.
 * @param {Float32Array} pcm
 * @returns {Promise<import('../../shared/types').Transcript>}
 */
async function transcribe(pcm, opts = {}) {
  if (!pcm || pcm.length === 0) {
    throw new Error('No audio to transcribe (empty or missing PCM data).');
  }
  const model = opts.model || DEFAULT_MODEL;
  const dtype = opts.dtype || DEFAULT_DTYPE;
  const asr = await getPipeline(model, opts.onProgress, dtype);

  if (opts.onProgress) opts.onProgress({ status: 'transcribing' });

  // When no language is given, Whisper auto-detects it from the audio.
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
 * Returns null on any failure so the caller can fall back gracefully.
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

module.exports = {
  setCacheDir,
  getPipeline,
  transcribe,
  detectLanguage,
  clearModelCache,
  DEFAULT_MODEL,
  DEFAULT_DTYPE,
  TARGET_SAMPLE_RATE,
};
