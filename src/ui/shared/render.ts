// Read-only transcript/summary rendering shared by the library view.
// (The work view has its own transcript renderer with clickable seek links.)

import type { Summary, Transcript } from '../../core/types';
import { escapeHtml } from './dom';
import { fmtTime } from './format';

export function renderTranscriptInto(box: HTMLElement, t: Transcript | null | undefined): void {
  box.innerHTML = '';
  if (!t || (!t.segments?.length && !t.text)) {
    box.innerHTML = '<p class="muted">No transcript.</p>';
    return;
  }
  if (!t.segments || t.segments.length === 0) {
    box.innerHTML = `<p>${escapeHtml(t.text || '')}</p>`;
    return;
  }
  for (const seg of t.segments) {
    const div = document.createElement('div');
    div.className = 'segment';
    div.innerHTML = `<span class="ts">[${fmtTime(seg.start)}]</span>${escapeHtml(seg.text)}`;
    box.appendChild(div);
  }
}

export function renderSummaryInto(box: HTMLElement, s: Summary | null | undefined): void {
  box.innerHTML = '';
  if (!s) {
    box.innerHTML = '<p class="muted">No summary yet. Press Summarize.</p>';
    return;
  }
  const add = (title: string, items: string[] | undefined) => {
    if (!items || items.length === 0) return;
    const sec = document.createElement('div');
    sec.className = 'summary-section';
    sec.innerHTML = `<h3>${title}</h3><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    box.appendChild(sec);
  };
  const intro = document.createElement('p');
  intro.textContent = s.text || '';
  box.appendChild(intro);
  add('Key points', s.keyPoints);
  add('Action items', s.actionItems);
}
