// Renderer: UI logic + in-browser audio decode/resample.
// Decoding uses the Web Audio API (Chromium), which natively handles mp3/m4a/
// wav/ogg/etc., so we need no ffmpeg dependency. We resample to mono 16 kHz —
// the format the local Whisper transcriber expects — and hand the PCM to main.

const TARGET_SAMPLE_RATE = 16000;
const SUPPORTED_EXTS = ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'webm'];

const el = (id) => document.getElementById(id);
const state = { pcm: null, sourceName: null, transcript: null };

// ---- Tabs ----
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    tab.classList.add('active');
    el(`view-${tab.dataset.view}`).classList.add('active');
    // Re-check model cache status whenever settings tab is opened.
    if (tab.dataset.view === 'settings') {
      window.api.listWhisperModels().then((models) => {
        populateWhisperSelect(models, el('set-whisper').value);
      }).catch(() => {});
    }
  });
});

// ---- Status helper ----
function setStatus(msg, isError = false) {
  const s = el('status');
  if (!msg) { s.hidden = true; return; }
  s.hidden = false;
  s.textContent = msg;
  s.classList.toggle('error', isError);
}

// ---- File import: validate, decode, resample ----
el('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  if (!SUPPORTED_EXTS.includes(ext)) {
    setStatus(`Unsupported file type ".${ext}". Supported: ${SUPPORTED_EXTS.join(', ')}`, true);
    return;
  }

  state.sourceName = file.name;
  el('source-name').textContent = file.name;
  el('transcribe-btn').disabled = true;
  setStatus('Decoding audio…');

  try {
    state.pcm = await decodeAndResample(file);
    setStatus(`Ready: ${file.name} (${(state.pcm.length / TARGET_SAMPLE_RATE).toFixed(1)}s).`);
    el('transcribe-btn').disabled = false;
  } catch (err) {
    state.pcm = null;
    setStatus(`Could not decode "${file.name}": ${err.message}`, true);
  }
});

async function decodeAndResample(file) {
  const arrayBuf = await file.arrayBuffer();
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuf;
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

// ---- Microphone recording ----
let mediaRecorder = null;
let recordedChunks = [];
let recordStream = null;
let recordTimer = null;
let recordSeconds = 0;

async function listInputDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return;
  }
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const sel = el('mic-select');
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

el('record-btn').addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  // macOS permission gate (no-op elsewhere); getUserMedia still triggers the
  // browser prompt and is the real authority.
  try { await window.api.requestMicAccess(); } catch {}

  const deviceId = el('mic-select').value;
  const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
  try {
    recordStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    const why = err && err.name === 'NotAllowedError'
      ? 'permission denied — grant microphone access in system settings'
      : (err && err.message) || 'no microphone available';
    setStatus(`Cannot record: ${why}.`, true);
    recordStream = null;
    return;
  }

  await listInputDevices(); // labels are available now that permission is granted

  recordedChunks = [];
  const mime = pickRecorderMime();
  try {
    mediaRecorder = mime ? new MediaRecorder(recordStream, { mimeType: mime }) : new MediaRecorder(recordStream);
  } catch (err) {
    setStatus(`Cannot start recorder: ${err.message}`, true);
    stopStream();
    return;
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start();

  el('record-btn').textContent = '■ Stop';
  el('record-btn').classList.add('recording');
  el('transcribe-btn').disabled = true;
  recordSeconds = 0;
  setStatus('Recording… 00:00');
  recordTimer = setInterval(() => {
    recordSeconds += 1;
    setStatus(`Recording… ${fmtTime(recordSeconds)}`);
  }, 1000);
}

function pickRecorderMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function stopStream() {
  if (recordStream) {
    recordStream.getTracks().forEach((t) => t.stop());
    recordStream = null;
  }
}

async function onRecordingStop() {
  if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
  el('record-btn').textContent = '● Record';
  el('record-btn').classList.remove('recording');
  stopStream();

  if (recordedChunks.length === 0) {
    setStatus('No audio was captured.', true);
    return;
  }
  const blob = new Blob(recordedChunks, { type: recordedChunks[0].type || 'audio/webm' });
  if (blob.size === 0) {
    setStatus('Recording was empty — nothing to transcribe.', true);
    return;
  }

  setStatus('Processing recording…');
  try {
    state.pcm = await decodeAndResample(blob);
    if (!state.pcm || state.pcm.length === 0) throw new Error('decoded to empty audio');
    state.sourceName = 'recording';
    const secs = (state.pcm.length / TARGET_SAMPLE_RATE).toFixed(1);
    el('source-name').textContent = `Recording (${secs}s)`;
    el('transcribe-btn').disabled = false;
    setStatus(`Recording ready (${secs}s). Press Transcribe.`);
  } catch (err) {
    state.pcm = null;
    setStatus(`Could not process recording: ${err.message}`, true);
  }
}

// Refresh the device list if it changes (plug/unplug).
if (navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener?.('devicechange', listInputDevices);
}

// ---- Transcribe ----
let unsubscribeProgress = null;
el('transcribe-btn').addEventListener('click', async () => {
  if (!state.pcm) return;
  el('transcribe-btn').disabled = true;
  el('summarize-btn').disabled = true;
  setStatus('Transcribing… (first run downloads the model)');

  if (unsubscribeProgress) unsubscribeProgress();
  unsubscribeProgress = window.api.onTranscribeProgress((p) => {
    const pct = p.progress != null ? ` ${Math.round(p.progress)}%` : '';
    setStatus(`Transcribing — ${p.status}${pct}`);
  });

  try {
    const language = el('lang-select').value;
    const transcript = await window.api.transcribe(state.pcm, { language });
    state.transcript = transcript;
    renderTranscript(transcript);
    let langLabel;
    if (transcript.detected) langLabel = `${transcript.language} (detected)`;
    else if (transcript.language && transcript.language !== 'auto') langLabel = transcript.language;
    else langLabel = 'auto-detected';
    setStatus(`Transcribed ${transcript.segments.length} segment(s) — language: ${langLabel}.`);
    el('summarize-btn').disabled = false;
    el('export-transcript').disabled = false;
  } catch (err) {
    setStatus(`Transcription failed: ${err.message}`, true);
  } finally {
    el('transcribe-btn').disabled = false;
    if (unsubscribeProgress) { unsubscribeProgress(); unsubscribeProgress = null; }
  }
});

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function renderTranscript(t) {
  const box = el('transcript');
  box.innerHTML = '';
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

// ---- Summarize ----
el('summarize-btn').addEventListener('click', async () => {
  if (!state.transcript) return;
  el('summarize-btn').disabled = true;
  el('summary').innerHTML = '<p class="muted">Summarizing…</p>';
  try {
    const summary = await window.api.summarize(state.transcript.text);
    renderSummary(summary);
  } catch (err) {
    el('summary').innerHTML = `<p class="muted">Summary failed: ${escapeHtml(err.message)}</p>`;
  } finally {
    el('summarize-btn').disabled = false;
  }
});

function renderSummary(s) {
  const box = el('summary');
  box.innerHTML = '';
  const add = (title, items) => {
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

// ---- Export transcript ----
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

// ---- Settings ----
let _cachedModels = [];

function populateWhisperSelect(models, selectedId) {
  _cachedModels = models;
  const sel = el('set-whisper');
  sel.innerHTML = '';

  const cached = models.filter((m) => m.cached);
  const notCached = models.filter((m) => !m.cached);

  const addGroup = (label, items) => {
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

function updateWhisperNote() {
  const sel = el('set-whisper');
  const note = el('whisper-model-note');
  const model = _cachedModels.find((m) => m.value === sel.value) || _cachedModels.find((m) => m.id === sel.value);
  if (model && model.cached) {
    note.textContent = '✓ Downloaded and ready to use. Transcription runs fully offline.';
  } else if (model) {
    note.textContent = `First use will download ${model.size} (needs network). Transcription itself runs offline.`;
  } else {
    note.textContent = 'First use downloads the model (one-time, needs network). Transcription itself runs offline.';
  }
}

async function loadSettings() {
  const [s, models] = await Promise.all([
    window.api.getSettings(),
    window.api.listWhisperModels(),
  ]);
  el('set-provider').value = s.provider;
  el('set-model').value = s.summaryModel;
  el('set-ollama-url').value = s.ollamaBaseUrl || 'http://localhost:11434';
  el('set-ollama-model').value = s.ollamaModel || 'llama3.1';
  populateWhisperSelect(models, s.transcriptionModel);
  if (s.language) el('lang-select').value = s.language;
  el('key-status').textContent = s.hasApiKey ? 'API key is set ✓' : 'No API key set — summarization is disabled.';
  applyProviderUI(s.provider);
}

// Show only the active provider's fields and set the right privacy notice.
function applyProviderUI(provider) {
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

el('set-provider').addEventListener('change', () => applyProviderUI(el('set-provider').value));
el('set-whisper').addEventListener('change', updateWhisperNote);

// Remember the language choice across sessions.
el('lang-select').addEventListener('change', () => {
  window.api.saveSettings({ language: el('lang-select').value });
});
el('save-settings').addEventListener('click', async () => {
  await window.api.saveSettings({
    provider: el('set-provider').value,
    summaryModel: el('set-model').value.trim() || 'claude-opus-4-8',
    ollamaBaseUrl: el('set-ollama-url').value.trim() || 'http://localhost:11434',
    ollamaModel: el('set-ollama-model').value.trim() || 'llama3.1',
    transcriptionModel: el('set-whisper').value.trim() || 'onnx-community/whisper-base',
  });
  const key = el('set-apikey').value.trim();
  if (key) {
    await window.api.saveApiKey(key);
    el('set-apikey').value = '';
  }
  await loadSettings();
  const saved = el('settings-saved');
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1500);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

loadSettings();
listInputDevices();
