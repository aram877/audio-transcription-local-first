// Microphone + system-audio capture for the work view.
// System audio comes from Chromium's loopback path (ScreenCaptureKit under
// the hood — set up in the main process), so recording both sides of an
// online meeting needs no virtual audio driver.

import { el, setStatus } from '../shared/dom';
import { fmtTime } from '../shared/format';

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordStream: MediaStream | null = null;   // microphone stream
let systemStream: MediaStream | null = null;   // optional system-audio loopback stream
let mixContext: AudioContext | null = null;    // Web Audio graph that mixes mic + system into one
let recordTimer: ReturnType<typeof setInterval> | null = null;
let recordSeconds = 0;

export function isRecording(): boolean {
  return !!mediaRecorder && mediaRecorder.state === 'recording';
}

export async function listInputDevices(): Promise<void> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  let devices: MediaDeviceInfo[] = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return;
  }
  const inputs = devices.filter((d) => d.kind === 'audioinput');

  // Mic picker.
  const sel = el<HTMLSelectElement>('mic-select');
  const current = sel.value;
  sel.innerHTML = '<option value="">System default</option>';
  inputs.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Microphone ${i + 1}`;
    sel.appendChild(o);
  });
  if (current) sel.value = current;
}

// Capture the Mac's output audio via the loopback path. Returns audio-only.
async function getSystemAudioStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  // We only want the audio; drop the mandatory video track right away.
  stream.getVideoTracks().forEach((t) => { try { t.stop(); stream.removeTrack(t); } catch {} });
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('system returned no audio track');
  }
  return stream;
}

// Human guidance when macOS blocks system-audio capture.
async function systemAudioDeniedHint(): Promise<string> {
  try {
    const status = await window.api.systemAudioStatus();
    if (status !== 'granted') {
      return ' Enable it in System Settings → Privacy & Security → Screen & System Audio Recording, then restart the app.';
    }
  } catch {}
  return '';
}

function pickRecorderMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

function closeMix(): void {
  if (mixContext) {
    try { mixContext.close(); } catch {}
    mixContext = null;
  }
}

function stopStream(): void {
  if (recordStream) {
    recordStream.getTracks().forEach((t) => t.stop());
    recordStream = null;
  }
  if (systemStream) {
    systemStream.getTracks().forEach((t) => t.stop());
    systemStream = null;
  }
  closeMix();
}

export function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

export interface RecordingResult {
  blob: Blob;
}

/**
 * Start capturing. Resolves via onDone with the recorded blob once the user
 * stops (or null when nothing was captured — a status message is shown).
 */
export async function startRecording(onDone: (result: RecordingResult | null) => void): Promise<void> {
  // macOS permission gate (no-op elsewhere); getUserMedia still triggers the
  // browser prompt and is the real authority.
  try { await window.api.requestMicAccess(); } catch {}

  const deviceId = el<HTMLSelectElement>('mic-select').value;
  const constraints: MediaStreamConstraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
  try {
    recordStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err: any) {
    const why = err && err.name === 'NotAllowedError'
      ? 'permission denied — grant microphone access in system settings'
      : (err && err.message) || 'no microphone available';
    setStatus(`Cannot record: ${why}.`, true);
    recordStream = null;
    onDone(null);
    return;
  }

  // Optional second source: the Mac's own output audio (the other side of an
  // online meeting), captured natively via loopback — no virtual device needed.
  if (el<HTMLInputElement>('sys-audio-check').checked) {
    try {
      systemStream = await getSystemAudioStream();
    } catch (err: any) {
      systemStream = null;
      const hint = await systemAudioDeniedHint();
      setStatus(`Recording mic only — system audio unavailable: ${(err && err.message) || err}.${hint}`, true);
    }
  }

  await listInputDevices(); // labels are available now that permission is granted

  // The stream MediaRecorder records: either the mic alone, or mic + system
  // mixed together via a Web Audio graph.
  let captureStream = recordStream;
  if (systemStream) {
    try {
      mixContext = new AudioContext();
      const dest = mixContext.createMediaStreamDestination();
      mixContext.createMediaStreamSource(recordStream).connect(dest);
      mixContext.createMediaStreamSource(systemStream).connect(dest);
      captureStream = dest.stream;
    } catch (err: any) {
      // Fall back to mic-only if mixing fails for any reason.
      closeMix();
      try { systemStream.getTracks().forEach((t) => t.stop()); } catch {}
      systemStream = null;
      captureStream = recordStream;
      setStatus(`Recording mic only — could not mix system audio: ${(err && err.message) || err}`, true);
    }
  }

  recordedChunks = [];
  const mime = pickRecorderMime();
  try {
    mediaRecorder = mime ? new MediaRecorder(captureStream, { mimeType: mime }) : new MediaRecorder(captureStream);
  } catch (err: any) {
    setStatus(`Cannot start recorder: ${err.message}`, true);
    stopStream();
    onDone(null);
    return;
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
    el('record-btn').textContent = '● Record';
    el('record-btn').classList.remove('recording');
    stopStream();

    if (recordedChunks.length === 0) {
      setStatus('No audio was captured.', true);
      onDone(null);
      return;
    }
    const blob = new Blob(recordedChunks, { type: recordedChunks[0].type || 'audio/webm' });
    if (blob.size === 0) {
      setStatus('Recording was empty — nothing to transcribe.', true);
      onDone(null);
      return;
    }
    onDone({ blob });
  };
  mediaRecorder.onerror = (e: any) => {
    setStatus(`Recorder error: ${(e.error && e.error.message) || 'unknown'} — stopping.`, true);
    stopRecording();
  };
  // If the mic goes away mid-recording (device unplugged), stop cleanly and
  // keep what we captured instead of hanging.
  recordStream.getAudioTracks().forEach((t) => t.addEventListener('ended', stopRecording));
  // Emit data every second so a long recording never sits in one giant
  // in-memory buffer (and a crash loses at most the final second).
  mediaRecorder.start(1000);

  el('record-btn').textContent = '■ Stop';
  el('record-btn').classList.add('recording');
  el<HTMLButtonElement>('transcribe-btn').disabled = true;
  recordSeconds = 0;
  const modeLabel = systemStream ? ' (mic + system audio)' : '';
  setStatus(`Recording${modeLabel}… 00:00`);
  recordTimer = setInterval(() => {
    recordSeconds += 1;
    setStatus(`Recording${modeLabel}… ${fmtTime(recordSeconds)}`);
  }, 1000);
}

export function initDeviceListRefresh(): void {
  // Refresh the device list if it changes (plug/unplug).
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener?.('devicechange', listInputDevices);
  }
}
