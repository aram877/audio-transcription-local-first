// First-run setup wizard: pick a Whisper model sized to the hardware,
// optionally configure summarization, pre-download the model.

import type { WhisperModelInfo } from '../../core/types';
import { el } from '../shared/dom';
import { loadSettings } from '../settings';

let setupModels: WhisperModelInfo[] = [];
let selectedModel: string | null = null;
let currentStep = 0;

function recommendedModel(ramGb: number): string {
  if (ramGb < 8)  return 'onnx-community/whisper-tiny';
  if (ramGb < 16) return 'onnx-community/whisper-base';
  if (ramGb < 32) return 'onnx-community/whisper-small';
  return 'onnx-community/whisper-large-v3-turbo';
}

function goToStep(step: number): void {
  currentStep = step;
  document.querySelectorAll('.setup-pane').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.setup-pane')[step].classList.add('active');
  document.querySelectorAll('.setup-dot').forEach((d, i) => {
    d.classList.toggle('active', i === step);
    d.classList.toggle('done', i < step);
  });
}

function renderSetupModels(recommendedId: string): void {
  const container = el('setup-model-list');
  container.innerHTML = '';
  for (const m of setupModels) {
    const isRec = m.id === recommendedId;
    const label = document.createElement('label');
    label.className = 'setup-model-option' + (m.id === selectedModel ? ' selected' : '');
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'setup-model'; radio.value = m.id;
    radio.checked = m.id === selectedModel;
    radio.style.accentColor = 'var(--accent)';
    const body = document.createElement('div');
    body.className = 'model-opt-body';
    const nameLine = document.createElement('div');
    nameLine.className = 'model-opt-name';
    nameLine.textContent = m.label;
    if (isRec) { const b = document.createElement('span'); b.className = 'badge-recommended'; b.textContent = 'Recommended'; nameLine.appendChild(b); }
    if (m.cached) { const b = document.createElement('span'); b.className = 'badge-cached'; b.textContent = '✓ Downloaded'; nameLine.appendChild(b); }
    const meta = document.createElement('div');
    meta.className = 'model-opt-meta';
    meta.textContent = `${m.note} · ${m.size}`;
    body.appendChild(nameLine); body.appendChild(meta);
    label.appendChild(radio); label.appendChild(body);
    label.addEventListener('click', () => {
      selectedModel = m.id;
      container.querySelectorAll('.setup-model-option').forEach((o) => o.classList.remove('selected'));
      label.classList.add('selected');
    });
    container.appendChild(label);
  }
}

async function startModelDownload(): Promise<void> {
  const modelInfo = setupModels.find((m) => m.id === selectedModel);
  if (modelInfo && modelInfo.cached) {
    el('dl-title').textContent = 'Model already downloaded';
    el('dl-sub').textContent = 'Your selected model is ready to use.';
    el('dl-bar').style.width = '100%';
    el('dl-label').textContent = 'Ready.';
    setTimeout(() => goToStep(4), 800);
    return;
  }

  const unsub = window.api.onWhisperPreloadProgress((p) => {
    if (p.status === 'initiate') {
      const f = p.file ? p.file.split('/').pop() : 'model';
      el('dl-label').textContent = `Preparing ${f}…`;
    } else if (p.status === 'download' && p.progress != null) {
      el('dl-bar').style.width = `${p.progress.toFixed(1)}%`;
      el('dl-bar').classList.remove('dl-indeterminate');
      const f = p.file ? p.file.split('/').pop() : 'model';
      el('dl-label').textContent = `${f} — ${p.progress.toFixed(0)}%`;
    } else if (p.status === 'done') {
      el('dl-bar').style.width = '100%';
    } else if (p.status === 'ready') {
      el('dl-title').textContent = 'Loading model…';
      el('dl-sub').textContent = 'Files downloaded. Loading into memory — this can take a minute for large models.';
      el('dl-bar').classList.add('dl-indeterminate');
      el('dl-label').textContent = 'Initialising ONNX runtime…';
    }
  });

  try {
    await window.api.preloadWhisper(selectedModel!);
    unsub();
    goToStep(4);
  } catch (err: any) {
    unsub();
    el('dl-title').textContent = 'Setup failed';
    el('dl-bar').classList.remove('dl-indeterminate');
    el('dl-error').textContent = err.message || 'Check your network connection and try again.';
    el('dl-error').hidden = false;
    el('dl-retry-wrap').hidden = false;
  }
}

export function initSetupWizard(): void {
  el('btn-dl-retry').addEventListener('click', () => {
    el('dl-title').textContent = 'Downloading model…';
    el('dl-sub').textContent = 'One-time download. Transcription runs fully offline after this.';
    el('dl-bar').style.width = '0%';
    el('dl-bar').classList.remove('dl-indeterminate');
    el('dl-label').textContent = 'Starting…';
    el('dl-error').hidden = true;
    el('dl-retry-wrap').hidden = true;
    startModelDownload();
  });

  el('btn-welcome-next').addEventListener('click', () => goToStep(1));

  el('btn-model-next').addEventListener('click', () => {
    const checked = document.querySelector<HTMLInputElement>('input[name="setup-model"]:checked');
    if (checked) selectedModel = checked.value;
    goToStep(2);
  });

  document.querySelectorAll('.setup-back').forEach((btn) => {
    btn.addEventListener('click', () => goToStep(currentStep - 1));
  });

  el('btn-ollama-check').addEventListener('click', async () => {
    const url = el<HTMLInputElement>('ollama-url-input').value.trim() || 'http://localhost:11434';
    el('ollama-status').textContent = '…'; el('ollama-status').style.color = '';
    const ok = await window.api.checkOllama(url);
    el('ollama-status').textContent = ok ? '✓ Connected' : '✗ Not found';
    el('ollama-status').style.color = ok ? '#6cc070' : '#f0a39c';
    el('ollama-install-hint').hidden = ok;
  });

  document.querySelectorAll<HTMLInputElement>('input[name="summ-provider"]').forEach((r) => {
    r.addEventListener('change', () => {
      el('ollama-detail').style.display = r.value === 'ollama' ? 'block' : 'none';
      el('claude-detail').hidden = r.value !== 'claude';
    });
  });

  el('btn-summ-next').addEventListener('click', async () => {
    const provider = document.querySelector<HTMLInputElement>('input[name="summ-provider"]:checked')?.value || 'skip';
    const patch: Record<string, unknown> = { transcriptionModel: selectedModel };
    if (provider === 'ollama') {
      patch.provider = 'ollama';
      patch.ollamaBaseUrl = el<HTMLInputElement>('ollama-url-input').value.trim() || 'http://localhost:11434';
      patch.ollamaModel = el<HTMLInputElement>('ollama-model-input').value.trim() || 'llama3.1';
    } else if (provider === 'claude') {
      patch.provider = 'claude';
      const key = el<HTMLInputElement>('claude-key-input').value.trim();
      if (key) await window.api.saveApiKey(key);
    }
    await window.api.saveSettings(patch);
    goToStep(3);
    startModelDownload();
  });

  el('btn-done').addEventListener('click', async () => {
    await window.api.saveSettings({ setupComplete: true });
    el('setup-overlay').hidden = true;
    await loadSettings();
  });

  el('ollama-link').addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://ollama.ai');
  });

  void runWizardIfNeeded();
}

async function runWizardIfNeeded(): Promise<void> {
  const prefs = await window.api.getSettings();
  if (prefs.setupComplete) { el('setup-overlay').hidden = true; return; }

  const [sysInfo, models] = await Promise.all([
    window.api.getSystemInfo(),
    window.api.listWhisperModels(),
  ]);
  setupModels = models;

  const platformLabel = ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' } as Record<string, string>)[sysInfo.platform] || sysInfo.platform;
  el('sys-info-badge').textContent = `${sysInfo.ramGb} GB RAM · ${platformLabel} · ${sysInfo.arch}`;

  const recommended = recommendedModel(sysInfo.ramGb);
  selectedModel = recommended;

  // Build step dots
  const dots = el('setup-dots');
  dots.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('span');
    d.className = 'setup-dot';
    dots.appendChild(d);
  }

  renderSetupModels(recommended);
  goToStep(0);
}
