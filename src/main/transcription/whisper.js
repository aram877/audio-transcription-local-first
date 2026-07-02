// Main-process facade for local Whisper transcription.
//
// Inference itself runs in a separate utilityProcess (see worker.js) so that
// heavy ONNX work can't block the main event loop and an inference crash
// (e.g. an oversized allocation on a huge model) can't take the whole app
// down. This module spawns/supervises that worker and exposes the same API
// the IPC layer always used.

const fs = require('fs');
const path = require('path');
const { utilityProcess } = require('electron');
const { TARGET_SAMPLE_RATE } = require('../../shared/formats');
const { DEFAULT_MODEL, DEFAULT_DTYPE } = require('./whisper-core');

const KNOWN_MODELS = [
  { id: 'onnx-community/whisper-tiny',                       label: 'Whisper Tiny',                         size: '~78 MB',  note: 'fastest, least accurate' },
  { id: 'onnx-community/whisper-base',                       label: 'Whisper Base',                         size: '~145 MB', note: 'fast, decent accuracy' },
  { id: 'onnx-community/whisper-small',                      label: 'Whisper Small',                        size: '~466 MB', note: 'balanced speed/accuracy' },
  { id: 'onnx-community/whisper-large-v3-turbo',             label: 'Whisper Large v3 Turbo',               size: '~1.6 GB', note: 'high accuracy, fast' },
  { id: 'onnx-community/whisper-large-v3-turbo_timestamped', label: 'Whisper Large v3 Turbo (timestamped)', size: '~1.9 GB', note: 'high accuracy, fast, word-level timestamps' },
  { id: 'onnx-community/whisper-large-v3',                   label: 'Whisper Large v3',                     size: '~3.1 GB', note: 'best accuracy, slow' },
];

let _cacheDir = null;
let _log = (msg) => console.error(msg);

function setCacheDir(dir) {
  _cacheDir = dir;
}

// Let main.js route worker chatter into its crash log.
function setLogger(fn) {
  if (typeof fn === 'function') _log = fn;
}

// ---- Model cache inspection (cheap fs checks; stays in main) ----

function isModelCached(modelId) {
  if (!_cacheDir) return false;
  const modelDir = path.join(_cacheDir, modelId);
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

// ---- Worker supervision ----

let _worker = null;        // UtilityProcess | null
let _workerReady = null;   // Promise resolved once 'init' is acked
let _nextId = 1;
const _pending = new Map(); // id -> { resolve, reject, onProgress }

function _spawnWorker() {
  const worker = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], {
    serviceName: 'whisper-transcription',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  worker.stdout?.on('data', (d) => _log(`[whisper-worker] ${String(d).trimEnd()}`));
  worker.stderr?.on('data', (d) => _log(`[whisper-worker:err] ${String(d).trimEnd()}`));

  worker.on('message', (msg) => {
    if (!msg || !_pending.has(msg.id)) return;
    const req = _pending.get(msg.id);
    if (msg.type === 'progress') {
      try { req.onProgress && req.onProgress(msg.payload); } catch {}
      return;
    }
    _pending.delete(msg.id);
    if (msg.type === 'result') req.resolve(msg.payload);
    else req.reject(new Error(msg.message || 'Transcription worker reported an error.'));
  });

  worker.on('exit', (code) => {
    _log(`[whisper] worker exited with code ${code} (${_pending.size} request(s) in flight)`);
    if (_worker === worker) { _worker = null; _workerReady = null; }
    // Fail anything in flight with an actionable message instead of hanging.
    for (const [id, req] of _pending) {
      _pending.delete(id);
      req.reject(new Error(
        'The transcription engine stopped unexpectedly (it likely ran out of memory). ' +
        'The app is still running — try again, or pick a smaller Whisper model in Settings.'
      ));
    }
  });

  return worker;
}

function _ensureWorker() {
  if (_worker && _workerReady) return _workerReady;
  _worker = _spawnWorker();
  _workerReady = _request({ type: 'init', cacheDir: _cacheDir }, null, _worker).then(() => _worker);
  return _workerReady;
}

function _request(body, onProgress, worker) {
  const id = _nextId++;
  const w = worker || _worker;
  return new Promise((resolve, reject) => {
    if (!w) return reject(new Error('Transcription worker is not running.'));
    _pending.set(id, { resolve, reject, onProgress });
    try {
      w.postMessage({ id, ...body });
    } catch (err) {
      _pending.delete(id);
      reject(err);
    }
  });
}

// ---- Public API (same shape the IPC layer always used) ----

/**
 * Transcribe mono 16 kHz PCM audio in the worker process.
 * @param {Float32Array} pcm
 * @param {{model?: string, dtype?: string, language?: string, onProgress?: Function}} [opts]
 */
async function transcribe(pcm, opts = {}) {
  if (!pcm || pcm.length === 0) {
    throw new Error('No audio to transcribe (empty or missing PCM data).');
  }
  await _ensureWorker();
  const { onProgress, ...rest } = opts;
  return _request({ type: 'transcribe', pcm, opts: rest }, onProgress);
}

/**
 * Pre-download/load a model in the worker (setup wizard).
 */
async function preload(model, onProgress, dtype = DEFAULT_DTYPE) {
  await _ensureWorker();
  return _request({ type: 'preload', model, dtype }, onProgress);
}

// Back-compat alias: main.js historically called getPipeline() to preload.
const getPipeline = preload;

module.exports = {
  transcribe,
  preload,
  getPipeline,
  listModels,
  setCacheDir,
  setLogger,
  DEFAULT_MODEL,
  DEFAULT_DTYPE,
  TARGET_SAMPLE_RATE,
};
