// The settings view: provider config, API key, Whisper model selection.

import type { WhisperModelInfo } from '../../core/types';
import { el } from '../shared/dom';

let cachedModels: WhisperModelInfo[] = [];

export function populateWhisperSelect(models: WhisperModelInfo[], selectedId: string): void {
  cachedModels = models;
  const sel = el<HTMLSelectElement>('set-whisper');
  sel.innerHTML = '';

  const cached = models.filter((m) => m.cached);
  const notCached = models.filter((m) => !m.cached);

  const addGroup = (label: string, items: WhisperModelInfo[]) => {
    if (!items.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    items.forEach((m) => {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = `${m.label} — ${m.note} (${m.size})`;
      group.appendChild(o);
    });
    sel.appendChild(group);
  };

  addGroup('Downloaded — ready to use', cached);
  addGroup('Available — requires download', notCached);

  // If the saved model isn't in the known list, add it as a fallback option.
  if (selectedId && !models.some((m) => m.id === selectedId)) {
    const o = document.createElement('option');
    o.value = selectedId;
    o.textContent = selectedId;
    sel.prepend(o);
  }

  sel.value = selectedId || '';
  updateWhisperNote();
}

function updateWhisperNote(): void {
  const sel = el<HTMLSelectElement>('set-whisper');
  const note = el('whisper-model-note');
  const model = cachedModels.find((m) => m.id === sel.value);
  if (model && model.cached) {
    note.textContent = '✓ Downloaded and ready to use. Transcription runs fully offline.';
  } else if (model) {
    note.textContent = `First use will download ${model.size} (needs network). Transcription itself runs offline.`;
  } else {
    note.textContent = 'First use downloads the model (one-time, needs network). Transcription itself runs offline.';
  }
}

export async function loadSettings(): Promise<void> {
  const [s, models] = await Promise.all([
    window.api.getSettings(),
    window.api.listWhisperModels(),
  ]);
  el<HTMLSelectElement>('set-provider').value = s.provider;
  el<HTMLInputElement>('set-model').value = s.summaryModel;
  el<HTMLInputElement>('set-ollama-url').value = s.ollamaBaseUrl || 'http://localhost:11434';
  el<HTMLInputElement>('set-ollama-model').value = s.ollamaModel || 'llama3.1';
  populateWhisperSelect(models, s.transcriptionModel);
  if (s.language) el<HTMLSelectElement>('lang-select').value = s.language;
  el('key-status').textContent = s.hasApiKey ? 'API key is set ✓' : 'No API key set — summarization is disabled.';
  applyProviderUI(s.provider);
}

/** Re-check model cache status whenever the settings tab is opened. */
export async function refreshModelList(): Promise<void> {
  try {
    const models = await window.api.listWhisperModels();
    populateWhisperSelect(models, el<HTMLSelectElement>('set-whisper').value);
  } catch {}
}

// Show only the active provider's fields and set the right privacy notice.
function applyProviderUI(provider: string): void {
  const local = provider === 'ollama';
  el('claude-fields').style.display = local ? 'none' : 'block';
  el('ollama-fields').style.display = local ? 'block' : 'none';
  const note = el('privacy-note');
  if (local) {
    note.classList.add('local');
    note.innerHTML = '✅ Fully local: transcription <strong>and</strong> summarization run on your machine — nothing is sent to the cloud.';
  } else {
    note.classList.remove('local');
    note.innerHTML = '⚠️ Transcription runs locally. <strong>Summarizing sends the transcript text to your configured cloud provider.</strong>';
  }
}

export function initSettingsView(): void {
  el('set-provider').addEventListener('change', () => applyProviderUI(el<HTMLSelectElement>('set-provider').value));
  el('set-whisper').addEventListener('change', updateWhisperNote);

  // Remember the language choice across sessions.
  el('lang-select').addEventListener('change', () => {
    window.api.saveSettings({ language: el<HTMLSelectElement>('lang-select').value });
  });

  el('save-settings').addEventListener('click', async () => {
    await window.api.saveSettings({
      provider: el<HTMLSelectElement>('set-provider').value,
      summaryModel: el<HTMLInputElement>('set-model').value.trim() || 'claude-opus-4-8',
      ollamaBaseUrl: el<HTMLInputElement>('set-ollama-url').value.trim() || 'http://localhost:11434',
      ollamaModel: el<HTMLInputElement>('set-ollama-model').value.trim() || 'llama3.1',
      transcriptionModel: el<HTMLSelectElement>('set-whisper').value.trim() || 'onnx-community/whisper-base',
    });
    const key = el<HTMLInputElement>('set-apikey').value.trim();
    if (key) {
      await window.api.saveApiKey(key);
      el<HTMLInputElement>('set-apikey').value = '';
    }
    await loadSettings();
    const saved = el('settings-saved');
    saved.hidden = false;
    setTimeout(() => (saved.hidden = true), 1500);
  });
}
