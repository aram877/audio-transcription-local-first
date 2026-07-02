// In-browser audio decode/resample.
// Decoding uses the Web Audio API (Chromium), which natively handles mp3/m4a/
// wav/ogg/etc., so we need no ffmpeg dependency. We resample to mono 16 kHz —
// the format the local Whisper transcriber expects — and hand the PCM to main.

import { TARGET_SAMPLE_RATE } from '../../core/formats';

export { TARGET_SAMPLE_RATE };

export async function decodeAndResample(file: Blob): Promise<Float32Array> {
  const arrayBuf = await file.arrayBuffer();
  const decodeCtx = new AudioContext();
  let audioBuf: AudioBuffer;
  try {
    audioBuf = await decodeCtx.decodeAudioData(arrayBuf);
  } finally {
    decodeCtx.close();
  }
  // Render to mono 16 kHz via an offline context.
  const frames = Math.ceil(audioBuf.duration * TARGET_SAMPLE_RATE);
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = audioBuf;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  // Copy out of the AudioBuffer so we own the Float32Array we send over IPC.
  return Float32Array.from(rendered.getChannelData(0));
}
