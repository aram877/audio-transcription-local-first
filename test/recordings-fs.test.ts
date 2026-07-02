import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsRecordingStore } from '../src/adapters/storage/recordings-fs';
import type { Transcript } from '../src/core/types';

const transcript: Transcript = {
  text: 'hello world',
  segments: [{ start: 0, end: 1.5, text: 'hello world' }],
  language: 'English',
  detected: true,
};

describe('FsRecordingStore', () => {
  let root: string;
  let store: FsRecordingStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'recstore-'));
    store = new FsRecordingStore(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('saves a recording and lists it back as metadata', () => {
    const meta = store.save({
      audioBytes: new Uint8Array([1, 2, 3, 4]),
      mime: 'audio/webm',
      ext: 'webm',
      source: { kind: 'record', name: 'Meeting' },
      durationSec: 12.5,
      transcript,
    });

    expect(meta.id).toMatch(/^rec_[0-9a-f]+$/);
    expect(meta.hasSummary).toBe(false);
    expect(meta.language).toBe('English');
    expect(meta.segmentCount).toBe(1);

    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(meta.id);
  });

  it('round-trips audio bytes', () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const meta = store.save({ audioBytes: bytes, mime: 'audio/webm', transcript });
    const audio = store.getAudio(meta.id);
    expect(new Uint8Array(audio.bytes)).toEqual(bytes);
    expect(audio.mime).toBe('audio/webm');
  });

  it('updates summary and reflects it in metadata', () => {
    const meta = store.save({ audioBytes: new Uint8Array([1]), transcript });
    const updated = store.updateSummary(meta.id, { text: 's', keyPoints: [], actionItems: [] });
    expect(updated.hasSummary).toBe(true);
    expect(store.get(meta.id).summary?.text).toBe('s');
  });

  it('deletes a recording', () => {
    const meta = store.save({ audioBytes: new Uint8Array([1]), transcript });
    store.remove(meta.id);
    expect(store.list()).toHaveLength(0);
  });

  it('rejects ids it did not generate (path traversal guard)', () => {
    expect(() => store.get('../../etc/passwd')).toThrow(/Invalid recording id/);
    expect(() => store.remove('rec_$(rm -rf)')).toThrow(/Invalid recording id/);
  });

  it('sanitizes hostile file extensions', () => {
    const meta = store.save({ audioBytes: new Uint8Array([1]), ext: '../../evil', transcript });
    const record = store.get(meta.id);
    expect(record.audio.file).toBe('audio.evil');
  });
});
