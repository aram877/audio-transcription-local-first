// Supported audio import formats and the format the transcriber expects.

// Extensions we accept for import. Decoding happens via the Web Audio API
// (Chromium) in the renderer, which supports these natively.
export const SUPPORTED_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.webm'];

// Whisper expects mono PCM at this sample rate.
export const TARGET_SAMPLE_RATE = 16000;
export const TARGET_CHANNELS = 1;

export function isSupportedExtension(filename: string): boolean {
  const lower = String(filename).toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return SUPPORTED_EXTENSIONS.includes(lower.slice(dot));
}

/** Map a recorder/import MIME type to a file extension for on-disk storage. */
export function extFromMime(mime: string | undefined | null): string {
  if (!mime) return 'webm';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('flac')) return 'flac';
  return 'webm';
}
