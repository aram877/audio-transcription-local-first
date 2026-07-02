// Audio player + waveform for the work view.

import { el, setStatus } from '../shared/dom';
import { fmtTime } from '../shared/format';
import { TARGET_SAMPLE_RATE } from '../shared/audio';

let audioEl: HTMLAudioElement | null = null;
let rafId: number | null = null;
let waveformPeaks: Float32Array | null = null;
let playerDuration = 0; // known duration (s); recorded WebM reports Infinity, so we track it ourselves

/** The current playback element (used by transcript seek links). */
export function getAudioEl(): HTMLAudioElement | null {
  return audioEl;
}

// Real media duration when finite, else the known PCM-derived duration.
function effectiveDuration(): number {
  if (audioEl && isFinite(audioEl.duration) && audioEl.duration > 0) return audioEl.duration;
  return playerDuration;
}

function computePeaks(pcm: Float32Array, count: number): Float32Array {
  const peaks = new Float32Array(count);
  const step = pcm.length / count;
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const s = Math.floor(i * step);
    const e = Math.floor((i + 1) * step);
    for (let j = s; j < e; j++) {
      const v = pcm[j] < 0 ? -pcm[j] : pcm[j];
      if (v > peak) peak = v;
    }
    peaks[i] = peak;
  }
  return peaks;
}

export function drawWaveform(): void {
  if (!waveformPeaks) return;
  const canvas = el<HTMLCanvasElement>('waveform');
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 800;
  const H = 72;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const dur = effectiveDuration();
  const progress = audioEl && dur ? Math.min(1, audioEl.currentTime / dur) : 0;
  const playedX = progress * W;
  const barW = 2, gap = 1, step = barW + gap;
  const numBars = Math.floor(W / step);

  for (let i = 0; i < numBars; i++) {
    const peak = waveformPeaks[Math.floor((i / numBars) * waveformPeaks.length)];
    const barH = Math.max(2, peak * H * 0.9);
    const x = i * step;
    ctx.fillStyle = x < playedX ? '#5b9dd9' : 'rgba(91,157,217,0.3)';
    ctx.fillRect(x, (H - barH) / 2, barW, barH);
  }

  if (audioEl && audioEl.duration) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(Math.floor(playedX), 0, 1, H);
  }
}

function updateTimeDisplay(): void {
  if (!audioEl) return;
  el('play-time').textContent = `${fmtTime(audioEl.currentTime)} / ${fmtTime(effectiveDuration())}`;
}

function startAnimation(): void {
  const tick = () => { drawWaveform(); updateTimeDisplay(); rafId = requestAnimationFrame(tick); };
  rafId = requestAnimationFrame(tick);
}
function stopAnimation(): void {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

export function setupAudioPlayer(blob: Blob, pcm: Float32Array): void {
  stopAnimation();
  if (audioEl) { URL.revokeObjectURL(audioEl.src); audioEl.pause(); }
  audioEl = new Audio(URL.createObjectURL(blob));
  audioEl.addEventListener('play', () => { el('play-btn').textContent = '⏸'; startAnimation(); });
  audioEl.addEventListener('pause', () => { el('play-btn').textContent = '▶'; stopAnimation(); drawWaveform(); });
  audioEl.addEventListener('ended', () => { el('play-btn').textContent = '▶'; stopAnimation(); drawWaveform(); });
  audioEl.addEventListener('loadedmetadata', updateTimeDisplay);
  playerDuration = pcm.length / TARGET_SAMPLE_RATE;
  waveformPeaks = computePeaks(pcm, 1000);
  el('audio-player').hidden = false;
  updateTimeDisplay();
  requestAnimationFrame(drawWaveform);
}

export function initPlayer(): void {
  el('play-btn').addEventListener('click', () => {
    if (!audioEl) return;
    if (audioEl.paused) audioEl.play().catch((err) => setStatus(`Playback failed: ${err.message}`, true));
    else audioEl.pause();
  });

  el('waveform').addEventListener('click', (e) => {
    const dur = effectiveDuration();
    if (!audioEl || !dur || !isFinite(dur)) return;
    const rect = el('waveform').getBoundingClientRect();
    const target = ((e.clientX - rect.left) / rect.width) * dur;
    if (!isFinite(target)) return;
    try { audioEl.currentTime = target; } catch {}
    drawWaveform();
    updateTimeDisplay();
  });

  window.addEventListener('resize', () => { if (waveformPeaks) drawWaveform(); });
}
