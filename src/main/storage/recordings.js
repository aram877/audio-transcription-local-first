// Local-first persistence for recordings.
// Each recording lives in its own folder under userData/recordings/<id>/:
//   audio.<ext>   — the original compressed audio (playable, kept on-device)
//   record.json   — metadata + transcript + summary
// Nothing here ever leaves the machine; this mirrors the privacy stance of the
// transcription/summarization pipeline.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const RECORD_FILE = 'record.json';

function rootDir() {
  return path.join(app.getPath('userData'), 'recordings');
}
function recordDir(id) {
  return path.join(rootDir(), id);
}
function ensureRoot() {
  fs.mkdirSync(rootDir(), { recursive: true });
}

// Reject ids that aren't ones we generated, so a crafted id can't escape the
// recordings root via path traversal.
function assertSafeId(id) {
  if (typeof id !== 'string' || !/^rec_[A-Za-z0-9]+$/.test(id)) {
    throw new Error('Invalid recording id.');
  }
}

function readRecord(id) {
  const raw = fs.readFileSync(path.join(recordDir(id), RECORD_FILE), 'utf8');
  return JSON.parse(raw);
}
function writeRecord(id, record) {
  fs.writeFileSync(path.join(recordDir(id), RECORD_FILE), JSON.stringify(record, null, 2), 'utf8');
}

/**
 * Persist a new recording: audio bytes + transcript (+ optional summary).
 * @param {Object} input
 * @param {ArrayBuffer|Uint8Array} input.audioBytes
 * @param {string} input.mime
 * @param {string} input.ext           - file extension without the dot (e.g. "webm")
 * @param {Object} input.source        - { kind: 'record'|'import', name }
 * @param {number} input.durationSec
 * @param {Object} input.transcript
 * @param {Object} [input.summary]
 * @returns {Object} the saved record's metadata (no transcript/summary payload)
 */
function save(input) {
  ensureRoot();
  const id = `rec_${crypto.randomBytes(12).toString('hex')}`;
  fs.mkdirSync(recordDir(id), { recursive: true });

  const ext = (input.ext || 'webm').replace(/[^a-z0-9]/gi, '') || 'webm';
  const audioFile = `audio.${ext}`;
  const buf = Buffer.from(input.audioBytes);
  fs.writeFileSync(path.join(recordDir(id), audioFile), buf);

  const record = {
    id,
    createdAt: new Date().toISOString(),
    source: input.source || { kind: 'record', name: 'Recording' },
    durationSec: input.durationSec || 0,
    audio: { file: audioFile, mime: input.mime || 'audio/webm', bytes: buf.length },
    transcript: input.transcript || null,
    summary: input.summary || null,
  };
  writeRecord(id, record);
  return toMeta(record);
}

/** Update the transcript of an existing recording (e.g. re-transcribe). */
function updateTranscript(id, transcript) {
  assertSafeId(id);
  const record = readRecord(id);
  record.transcript = transcript;
  writeRecord(id, record);
  return toMeta(record);
}

/** Attach/replace the summary of an existing recording. */
function updateSummary(id, summary) {
  assertSafeId(id);
  const record = readRecord(id);
  record.summary = summary;
  writeRecord(id, record);
  return toMeta(record);
}

/** Lightweight metadata for list views (no transcript/summary payload). */
function toMeta(record) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    source: record.source,
    durationSec: record.durationSec,
    audio: { mime: record.audio?.mime, bytes: record.audio?.bytes },
    hasSummary: !!record.summary,
    language: record.transcript?.language || null,
    detected: !!record.transcript?.detected,
    segmentCount: record.transcript?.segments?.length || 0,
  };
}

/** All recordings, newest first, metadata only. */
function list() {
  ensureRoot();
  let ids;
  try {
    ids = fs.readdirSync(rootDir(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('rec_'))
      .map((d) => d.name);
  } catch {
    return [];
  }
  const metas = [];
  for (const id of ids) {
    try {
      metas.push(toMeta(readRecord(id)));
    } catch {
      // Skip unreadable/corrupt records rather than failing the whole list.
    }
  }
  metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return metas;
}

/** Full record (metadata + transcript + summary) for the detail view. */
function get(id) {
  assertSafeId(id);
  return readRecord(id);
}

/** Raw audio bytes + mime for playback in the renderer. */
function getAudio(id) {
  assertSafeId(id);
  const record = readRecord(id);
  const bytes = fs.readFileSync(path.join(recordDir(id), record.audio.file));
  // Return an ArrayBuffer slice so it structured-clones cleanly over IPC.
  return { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), mime: record.audio.mime };
}

/** Delete a recording and all of its files. */
function remove(id) {
  assertSafeId(id);
  fs.rmSync(recordDir(id), { recursive: true, force: true });
  return { id, deleted: true };
}

module.exports = { save, updateTranscript, updateSummary, list, get, getAudio, remove };
