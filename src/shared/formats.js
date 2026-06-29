// Supported audio import formats and the format the transcriber expects.

// Extensions we accept for import. Decoding happens via the Web Audio API
// (Chromium) in the renderer, which supports these natively.
const SUPPORTED_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.webm'];

// Whisper expects mono PCM at this sample rate.
const TARGET_SAMPLE_RATE = 16000;
const TARGET_CHANNELS = 1;

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isSupportedExtension(filename) {
  const lower = String(filename).toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return SUPPORTED_EXTENSIONS.includes(lower.slice(dot));
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  TARGET_SAMPLE_RATE,
  TARGET_CHANNELS,
  isSupportedExtension,
};
