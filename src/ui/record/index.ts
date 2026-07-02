// The work view: import or record audio, transcribe, summarize, export.
// Owns the current session state (pcm + source + transcript) and the
// auto-save-to-library behavior.

import { SUPPORTED_EXTENSIONS, extFromMime } from '../../core/formats';
import type { Transcript } from '../../core/types';
import { decodeAndResample, TARGET_SAMPLE_RATE } from '../shared/audio';
import { el, escapeHtml, setStatus } from '../shared/dom';
import { fmtTime } from '../shared/format';
import { renderSummaryInto } from '../shared/render';
import * as capture from './capture';
import { drawWaveform, getAudioEl, initPlayer, setupAudioPlayer } from './player';

const SUPPORTED_EXTS = SUPPORTED_EXTENSIONS.map((e) => e.replace('.', ''));

interface SessionState {
  pcm: Float32Array | null;
  sourceName: string | null;
  sourceKind: 'import' | 'record' | null;
  transcript: Transcript | null;
  sourceBlob: Blob | null;   // original audio (powers the waveform + persistence)
  recordingId: string | null; // id of the persisted record once saved
}

export const state: SessionState = {
  pcm: null,
  sourceName: null,
  sourceKind: null,
  transcript: null,
  sourceBlob: null,
  recordingId: null,
};

/** Called by the library view when it deletes the record shown here. */
export function detachRecording(id: string): void {
  if (state.recordingId === id) state.recordingId = null;
}

// ---- File import: validate, decode, resample ----
function initImport(): void {
  el<HTMLInputElement>('file-input').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()!.toLowerCase();
    if (!SUPPORTED_EXTS.includes(ext)) {
      setStatus(`Unsupported file type ".${ext}". Supported: ${SUPPORTED_EXTS.join(', ')}`, true);
      return;
    }

    state.sourceName = file.name;
    state.sourceKind = 'import';
    state.recordingId = null; // a new piece of audio — not yet saved
    el('source-name').textContent = file.name;
    el<HTMLButtonElement>('transcribe-btn').disabled = true;
    setStatus('Decoding audio…');

    try {
      state.pcm = await decodeAndResample(file);
      state.sourceBlob = file;
      setupAudioPlayer(file, state.pcm);
      setStatus(`Ready: ${file.name} (${(state.pcm.length / TARGET_SAMPLE_RATE).toFixed(1)}s).`);
      el<HTMLButtonElement>('transcribe-btn').disabled = false;
    } catch (err: any) {
      state.pcm = null;
      state.sourceBlob = null;
      setStatus(`Could not decode "${file.name}": ${err.message}`, true);
    }
  });
}

// ---- Recording ----
function initRecording(): void {
  el('record-btn').addEventListener('click', async () => {
    if (capture.isRecording()) {
      capture.stopRecording();
      return;
    }
    await capture.startRecording(async (result) => {
      if (!result) return;
      setStatus('Processing recording…');
      try {
        state.pcm = await decodeAndResample(result.blob);
        if (!state.pcm || state.pcm.length === 0) throw new Error('decoded to empty audio');
        state.sourceName = 'Recording';
        state.sourceKind = 'record';
        state.recordingId = null; // a new piece of audio — not yet saved
        state.sourceBlob = result.blob;
        setupAudioPlayer(result.blob, state.pcm);
        const secs = (state.pcm.length / TARGET_SAMPLE_RATE).toFixed(1);
        el('source-name').textContent = `Recording (${secs}s)`;
        el<HTMLButtonElement>('transcribe-btn').disabled = false;
        setStatus(`Recording ready (${secs}s). Press Transcribe.`);
      } catch (err: any) {
        state.pcm = null;
        state.sourceBlob = null;
        setStatus(`Could not process recording: ${err.message}`, true);
      }
    });
  });
  capture.initDeviceListRefresh();
}

// ---- Transcribe ----
let unsubscribeProgress: (() => void) | null = null;

function initTranscribe(): void {
  el('transcribe-btn').addEventListener('click', async () => {
    if (!state.pcm) return;
    el<HTMLButtonElement>('transcribe-btn').disabled = true;
    el<HTMLButtonElement>('summarize-btn').disabled = true;
    setStatus('Transcribing…');

    if (unsubscribeProgress) unsubscribeProgress();
    unsubscribeProgress = window.api.onTranscribeProgress((p) => {
      if (p.status === 'transcribing') {
        setStatus('Transcribing…');
      } else if (p.status === 'initiate') {
        setStatus('Loading model…');
      } else if (p.status === 'download' && p.progress != null) {
        setStatus(`Downloading model — ${Math.round(p.progress)}%`);
      } else if (p.status === 'ready') {
        setStatus('Starting transcription…');
      }
    });

    try {
      const language = el<HTMLSelectElement>('lang-select').value;
      const transcript = await window.api.transcribe(state.pcm, { language });
      state.transcript = transcript;
      renderTranscript(transcript);
      let langLabel: string;
      if (transcript.detected) langLabel = `${transcript.language} (detected)`;
      else if (transcript.language && transcript.language !== 'auto') langLabel = transcript.language;
      else langLabel = 'auto-detected';
      setStatus(`Transcribed ${transcript.segments.length} segment(s) — language: ${langLabel}.`);
      el<HTMLButtonElement>('summarize-btn').disabled = false;
      el<HTMLButtonElement>('export-transcript').disabled = false;
      await persistAfterTranscribe(langLabel);
    } catch (err: any) {
      setStatus(`Transcription failed: ${err.message}`, true);
    } finally {
      el<HTMLButtonElement>('transcribe-btn').disabled = false;
      if (unsubscribeProgress) { unsubscribeProgress(); unsubscribeProgress = null; }
    }
  });
}

// Auto-save the recording to the local library once we have a transcript.
// Saves audio + transcript on first transcribe; updates the transcript on
// re-transcribe of the same audio.
async function persistAfterTranscribe(langLabel: string): Promise<void> {
  if (!state.transcript) return;
  const durationSec = state.pcm ? state.pcm.length / TARGET_SAMPLE_RATE : 0;
  try {
    if (state.recordingId) {
      await window.api.updateRecordingTranscript(state.recordingId, state.transcript);
    } else if (state.sourceBlob) {
      const mime = state.sourceBlob.type || (state.sourceKind === 'record' ? 'audio/webm' : '');
      // Prefer the imported file's real extension; fall back to one derived from the MIME type.
      const ext = (state.sourceKind === 'import' && state.sourceName && state.sourceName.includes('.'))
        ? state.sourceName.split('.').pop()!.toLowerCase()
        : extFromMime(mime);
      const audioBytes = await state.sourceBlob.arrayBuffer();
      const meta = await window.api.saveRecording({
        audioBytes,
        mime,
        ext,
        source: { kind: state.sourceKind || 'record', name: state.sourceName || 'Recording' },
        durationSec,
        transcript: state.transcript,
      });
      state.recordingId = meta.id;
      setStatus(`Transcribed ${state.transcript.segments.length} segment(s) — language: ${langLabel}. Saved to Library ✓`);
    }
  } catch (err: any) {
    // Persistence is best-effort; don't block the user's transcript on it.
    setStatus(`Transcribed, but saving to Library failed: ${err.message}`, true);
  }
}

function renderTranscript(t: Transcript): void {
  const box = el('transcript');
  box.innerHTML = '';
  if (!t.segments || t.segments.length === 0) {
    box.innerHTML = `<p>${escapeHtml(t.text || '')}</p>`;
    return;
  }
  const audioEl = getAudioEl();
  for (const seg of t.segments) {
    const div = document.createElement('div');
    div.className = 'segment';
    const ts = document.createElement('span');
    ts.className = audioEl ? 'ts ts-link' : 'ts';
    ts.textContent = `[${fmtTime(seg.start)}]`;
    if (audioEl) {
      ts.title = 'Jump to this position';
      ts.addEventListener('click', () => {
        const audio = getAudioEl();
        if (!audio || !isFinite(seg.start)) return;
        try { audio.currentTime = seg.start; } catch {}
        if (audio.paused) audio.play().catch(() => {});
        drawWaveform();
      });
    }
    div.appendChild(ts);
    div.appendChild(document.createTextNode(seg.text));
    box.appendChild(div);
  }
}

// ---- Summarize ----
function initSummarize(): void {
  el('summarize-btn').addEventListener('click', async () => {
    if (!state.transcript) return;
    el<HTMLButtonElement>('summarize-btn').disabled = true;
    el('summary').innerHTML = '<p class="muted">Summarizing…</p>';
    try {
      const summary = await window.api.summarize(state.transcript.text);
      renderSummaryInto(el('summary'), summary);
      if (state.recordingId) {
        try { await window.api.updateRecordingSummary(state.recordingId, summary); } catch {}
      }
    } catch (err: any) {
      el('summary').innerHTML = `<p class="muted">Summary failed: ${escapeHtml(err.message)}</p>`;
    } finally {
      el<HTMLButtonElement>('summarize-btn').disabled = false;
    }
  });
}

// ---- Export transcript ----
function initExport(): void {
  el('export-transcript').addEventListener('click', () => {
    if (!state.transcript) return;
    const lines = state.transcript.segments.map((seg) => `[${fmtTime(seg.start)}] ${seg.text}`);
    const blob = new Blob([lines.join('\n') || state.transcript.text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.sourceName || 'transcript').replace(/\.[^.]+$/, '') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

export function initRecordView(): void {
  initPlayer();
  initImport();
  initRecording();
  initTranscribe();
  initSummarize();
  initExport();
  capture.listInputDevices();
}
