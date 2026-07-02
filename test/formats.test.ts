import { describe, expect, it } from 'vitest';
import { extFromMime, isSupportedExtension, TARGET_SAMPLE_RATE } from '../src/core/formats';

describe('isSupportedExtension', () => {
  it('accepts every supported audio extension, case-insensitively', () => {
    for (const name of ['a.wav', 'b.MP3', 'c.m4a', 'd.OGG', 'e.flac', 'f.webm']) {
      expect(isSupportedExtension(name)).toBe(true);
    }
  });

  it('rejects unsupported or missing extensions', () => {
    expect(isSupportedExtension('notes.txt')).toBe(false);
    expect(isSupportedExtension('archive.mp3.zip')).toBe(false);
    expect(isSupportedExtension('noextension')).toBe(false);
    expect(isSupportedExtension('')).toBe(false);
  });
});

describe('extFromMime', () => {
  it('maps recorder MIME types to storage extensions', () => {
    expect(extFromMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extFromMime('audio/ogg')).toBe('ogg');
    expect(extFromMime('audio/mp4')).toBe('m4a');
    expect(extFromMime('audio/mpeg')).toBe('mp3');
    expect(extFromMime('audio/wav')).toBe('wav');
    expect(extFromMime('audio/flac')).toBe('flac');
  });

  it('falls back to webm for unknown or missing MIME types', () => {
    expect(extFromMime('')).toBe('webm');
    expect(extFromMime(null)).toBe('webm');
    expect(extFromMime('application/octet-stream')).toBe('webm');
  });
});

describe('TARGET_SAMPLE_RATE', () => {
  it('is the 16 kHz Whisper expects', () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000);
  });
});
