// The library view: browse, play, re-summarize, export, delete saved recordings.

import type { RecordingMeta, StoredRecording } from '../../core/types';
import { el, escapeHtml, setStatus } from '../shared/dom';
import { fmtBytes, fmtDate, fmtTime } from '../shared/format';
import { renderSummaryInto, renderTranscriptInto } from '../shared/render';
import { detachRecording } from '../record';

interface LibraryState {
  items: RecordingMeta[];
  selectedId: string | null;
  audioUrl: string | null;
  current: StoredRecording | null;
}

const lib: LibraryState = { items: [], selectedId: null, audioUrl: null, current: null };

export async function loadLibrary(): Promise<void> {
  const listEl = el('lib-items');
  try {
    lib.items = await window.api.listRecordings();
  } catch (err: any) {
    listEl.innerHTML = `<li class="muted">Could not load recordings: ${escapeHtml(err.message)}</li>`;
    return;
  }
  if (lib.items.length === 0) {
    listEl.innerHTML = '<li class="muted">No saved recordings yet.</li>';
    return;
  }
  listEl.innerHTML = '';
  for (const m of lib.items) {
    const li = document.createElement('li');
    li.className = 'lib-item' + (m.id === lib.selectedId ? ' active' : '');
    li.dataset.id = m.id;
    const dur = fmtTime(m.durationSec || 0);
    const badges = [
      m.detected ? `${escapeHtml(m.language || '')} (detected)` : (m.language && m.language !== 'auto' ? escapeHtml(m.language) : ''),
      m.hasSummary ? '📝 summary' : '',
    ].filter(Boolean).join(' · ');
    li.innerHTML = `
      <div class="lib-item-title">${escapeHtml(m.source?.name || 'Recording')}</div>
      <div class="lib-item-sub muted">${fmtDate(m.createdAt)} · ${dur}${badges ? ' · ' + badges : ''}</div>`;
    li.addEventListener('click', () => openRecording(m.id));
    listEl.appendChild(li);
  }
}

function clearAudioUrl(): void {
  if (lib.audioUrl) { URL.revokeObjectURL(lib.audioUrl); lib.audioUrl = null; }
}

async function openRecording(id: string): Promise<void> {
  lib.selectedId = id;
  // Highlight the active item.
  document.querySelectorAll('#lib-items .lib-item').forEach((li) => {
    li.classList.toggle('active', (li as HTMLElement).dataset.id === id);
  });

  let record: StoredRecording;
  try {
    record = await window.api.getRecording(id);
  } catch (err: any) {
    setStatus(`Could not open recording: ${err.message}`, true);
    return;
  }
  lib.current = record;

  el('lib-empty').hidden = true;
  el('lib-detail-body').hidden = false;
  el('lib-title').textContent = record.source?.name || 'Recording';

  const t = record.transcript;
  const langLabel = t?.detected ? `${t.language} (detected)` : (t?.language && t.language !== 'auto' ? t.language : 'auto');
  el('lib-meta').textContent =
    `${fmtDate(record.createdAt)} · ${fmtTime(record.durationSec || 0)} · ${langLabel}` +
    (record.audio?.bytes ? ` · ${fmtBytes(record.audio.bytes)}` : '');

  renderTranscriptInto(el('lib-transcript'), record.transcript);
  renderSummaryInto(el('lib-summary'), record.summary);
  el('lib-summarize').textContent = record.summary ? 'Re-summarize' : 'Summarize';

  // Load audio bytes and wire up the player.
  clearAudioUrl();
  const audio = el<HTMLAudioElement>('lib-audio');
  audio.removeAttribute('src');
  try {
    const { bytes, mime } = await window.api.getRecordingAudio(id);
    lib.audioUrl = URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/webm' }));
    audio.src = lib.audioUrl;
  } catch (err: any) {
    setStatus(`Audio unavailable: ${err.message}`, true);
  }
}

export function initLibraryView(): void {
  el('lib-refresh').addEventListener('click', loadLibrary);

  el('lib-delete').addEventListener('click', async () => {
    if (!lib.selectedId) return;
    const name = lib.current?.source?.name || 'this recording';
    if (!window.confirm(`Delete "${name}"? This removes its audio, transcript, and summary from disk.`)) return;
    const id = lib.selectedId;
    try {
      await window.api.deleteRecording(id);
    } catch (err: any) {
      setStatus(`Delete failed: ${err.message}`, true);
      return;
    }
    // If the work view is showing this same record, detach so re-summarize
    // won't resurrect a deleted record.
    detachRecording(id);
    clearAudioUrl();
    el('lib-detail-body').hidden = true;
    el('lib-empty').hidden = false;
    lib.selectedId = null;
    lib.current = null;
    await loadLibrary();
  });

  el('lib-summarize').addEventListener('click', async () => {
    if (!lib.current?.transcript?.text) return;
    const btn = el<HTMLButtonElement>('lib-summarize');
    btn.disabled = true;
    el('lib-summary').innerHTML = '<p class="muted">Summarizing…</p>';
    try {
      const summary = await window.api.summarize(lib.current.transcript.text);
      lib.current.summary = summary;
      renderSummaryInto(el('lib-summary'), summary);
      btn.textContent = 'Re-summarize';
      try { await window.api.updateRecordingSummary(lib.current.id, summary); } catch {}
      await loadLibrary(); // refresh the "📝 summary" badge
    } catch (err: any) {
      el('lib-summary').innerHTML = `<p class="muted">Summary failed: ${escapeHtml(err.message)}</p>`;
    } finally {
      btn.disabled = false;
    }
  });

  el('lib-export').addEventListener('click', () => {
    const t = lib.current?.transcript;
    if (!t) return;
    const lines = (t.segments || []).map((seg) => `[${fmtTime(seg.start)}] ${seg.text}`);
    const blob = new Blob([lines.join('\n') || t.text || ''], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (lib.current!.source?.name || 'transcript').replace(/\.[^.]+$/, '') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
