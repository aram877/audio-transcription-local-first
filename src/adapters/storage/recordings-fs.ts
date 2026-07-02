// Filesystem implementation of the RecordingStore port.
// Each recording lives in its own folder under <rootDir>/<id>/:
//   audio.<ext>   — the original compressed audio (playable, kept on-device)
//   record.json   — metadata + transcript + summary
// Nothing here ever leaves the machine; this mirrors the privacy stance of the
// transcription/summarization pipeline. Takes rootDir via constructor instead
// of importing Electron, so it unit-tests against a temp directory.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RecordingStore } from '../../core/ports';
import type {
  RecordingMeta,
  SaveRecordingInput,
  StoredRecording,
  Summary,
  Transcript,
} from '../../core/types';

const RECORD_FILE = 'record.json';

// Reject ids that aren't ones we generated, so a crafted id can't escape the
// recordings root via path traversal.
function assertSafeId(id: string): void {
  if (typeof id !== 'string' || !/^rec_[A-Za-z0-9]+$/.test(id)) {
    throw new Error('Invalid recording id.');
  }
}

/** Lightweight metadata for list views (no transcript/summary payload). */
function toMeta(record: StoredRecording): RecordingMeta {
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

export class FsRecordingStore implements RecordingStore {
  constructor(private readonly rootDir: string) {}

  private recordDir(id: string): string {
    return path.join(this.rootDir, id);
  }

  private ensureRoot(): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  private readRecord(id: string): StoredRecording {
    const raw = fs.readFileSync(path.join(this.recordDir(id), RECORD_FILE), 'utf8');
    return JSON.parse(raw);
  }

  private writeRecord(id: string, record: StoredRecording): void {
    fs.writeFileSync(path.join(this.recordDir(id), RECORD_FILE), JSON.stringify(record, null, 2), 'utf8');
  }

  /** Persist a new recording: audio bytes + transcript (+ optional summary). */
  save(input: SaveRecordingInput): RecordingMeta {
    this.ensureRoot();
    const id = `rec_${crypto.randomBytes(12).toString('hex')}`;
    fs.mkdirSync(this.recordDir(id), { recursive: true });

    const ext = (input.ext || 'webm').replace(/[^a-z0-9]/gi, '') || 'webm';
    const audioFile = `audio.${ext}`;
    const buf = Buffer.from(input.audioBytes as ArrayBuffer);
    fs.writeFileSync(path.join(this.recordDir(id), audioFile), buf);

    const record: StoredRecording = {
      id,
      createdAt: new Date().toISOString(),
      source: input.source || { kind: 'record', name: 'Recording' },
      durationSec: input.durationSec || 0,
      audio: { file: audioFile, mime: input.mime || 'audio/webm', bytes: buf.length },
      transcript: input.transcript || null,
      summary: input.summary || null,
    };
    this.writeRecord(id, record);
    return toMeta(record);
  }

  /** Update the transcript of an existing recording (e.g. re-transcribe). */
  updateTranscript(id: string, transcript: Transcript): RecordingMeta {
    assertSafeId(id);
    const record = this.readRecord(id);
    record.transcript = transcript;
    this.writeRecord(id, record);
    return toMeta(record);
  }

  /** Attach/replace the summary of an existing recording. */
  updateSummary(id: string, summary: Summary): RecordingMeta {
    assertSafeId(id);
    const record = this.readRecord(id);
    record.summary = summary;
    this.writeRecord(id, record);
    return toMeta(record);
  }

  /** All recordings, newest first, metadata only. */
  list(): RecordingMeta[] {
    this.ensureRoot();
    let ids: string[];
    try {
      ids = fs.readdirSync(this.rootDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith('rec_'))
        .map((d) => d.name);
    } catch {
      return [];
    }
    const metas: RecordingMeta[] = [];
    for (const id of ids) {
      try {
        metas.push(toMeta(this.readRecord(id)));
      } catch {
        // Skip unreadable/corrupt records rather than failing the whole list.
      }
    }
    metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return metas;
  }

  /** Full record (metadata + transcript + summary) for the detail view. */
  get(id: string): StoredRecording {
    assertSafeId(id);
    return this.readRecord(id);
  }

  /** Raw audio bytes + mime for playback in the renderer. */
  getAudio(id: string): { bytes: ArrayBuffer; mime: string } {
    assertSafeId(id);
    const record = this.readRecord(id);
    const bytes = fs.readFileSync(path.join(this.recordDir(id), record.audio.file));
    // Return an ArrayBuffer slice so it structured-clones cleanly over IPC.
    return {
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      mime: record.audio.mime,
    };
  }

  /** Delete a recording and all of its files. */
  remove(id: string): { id: string; deleted: boolean } {
    assertSafeId(id);
    fs.rmSync(this.recordDir(id), { recursive: true, force: true });
    return { id, deleted: true };
  }
}
