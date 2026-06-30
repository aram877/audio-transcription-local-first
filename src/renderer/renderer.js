// Renderer: UI logic + in-browser audio decode/resample.
// Decoding uses the Web Audio API (Chromium), which natively handles mp3/m4a/
// wav/ogg/etc., so we need no ffmpeg dependency. We resample to mono 16 kHz —
// the format the local Whisper transcriber expects — and hand the PCM to main.

const TARGET_SAMPLE_RATE = 16000;
const SUPPORTED_EXTS = ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'webm'];

const el = (id) => document.getElementById(id);
const state = { pcm: null, sourceName: null, transcript: null, sourceBlob: null };

// ---- Audio player ----
let audioEl = null;
let rafId = null;
let waveformPeaks = null;

function computePeaks(pcm, count) {
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

function drawWaveform() {
  if (!waveformPeaks) return;
  const canvas = el('waveform');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 800;
  const H = 72;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const progress = audioEl && audioEl.duration ? audioEl.currentTime / audioEl.duration : 0;
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

function updateTimeDisplay() {
  if (!audioEl) return;
  el('play-time').textContent = `${fmtTime(audioEl.currentTime)} / ${fmtTime(audioEl.duration || 0)}`;
}

function startAnimation() {
  const tick = () => { drawWaveform(); updateTimeDisplay(); rafId = requestAnimationFrame(tick); };
  rafId = requestAnimationFrame(tick);
}
function stopAnimation() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function setupAudioPlayer(blob) {
  stopAnimation();
  if (audioEl) { URL.revokeObjectURL(audioEl.src); audioEl.pause(); }
  audioEl = new Audio(URL.createObjectURL(blob));
  audioEl.addEventListener('play', () => { el('play-btn').textContent = '⏸'; startAnimation(); });
  audioEl.addEventListener('pause', () => { el('play-btn').textContent = '▶'; stopAnimation(); drawWaveform(); });
  audioEl.addEventListener('ended', () => { el('play-btn').textContent = '▶'; stopAnimation(); drawWaveform(); });
  audioEl.addEventListener('loadedmetadata', updateTimeDisplay);
  waveformPeaks = computePeaks(state.pcm, 1000);
  el('audio-player').hidden = false;
  requestAnimationFrame(drawWaveform);
}

el('play-btn').addEventListener('click', () => {
  if (!audioEl) return;
  if (audioEl.paused) audioEl.play(); else audioEl.pause();
});

el('waveform').addEventListener('click', (e) => {
  if (!audioEl || !audioEl.duration) return;
  const rect = el('waveform').getBoundingClientRect();
  audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * audioEl.duration;
  drawWaveform();
  updateTimeDisplay();
});

window.addEventListener('resize', () => { if (waveformPeaks) drawWaveform(); });

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
    state.sourceBlob = file;
    setupAudioPlayer(file);
    setStatus(`Ready: ${file.name} (${(state.pcm.length / TARGET_SAMPLE_RATE).toFixed(1)}s).`);
    el('transcribe-btn').disabled = false;
  } catch (err) {
    state.pcm = null;
    state.sourceBlob = null;
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
    state.sourceBlob = blob;
    setupAudioPlayer(blob);
    const secs = (state.pcm.length / TARGET_SAMPLE_RATE).toFixed(1);
    el('source-name').textContent = `Recording (${secs}s)`;
    el('transcribe-btn').disabled = false;
    setStatus(`Recording ready (${secs}s). Press Transcribe.`);
  } catch (err) {
    state.pcm = null;
    state.sourceBlob = null;
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
    const ts = document.createElement('span');
    ts.className = audioEl ? 'ts ts-link' : 'ts';
    ts.textContent = `[${fmtTime(seg.start)}]`;
    if (audioEl) {
      ts.title = 'Jump to this position';
      ts.addEventListener('click', () => {
        audioEl.currentTime = seg.start;
        if (audioEl.paused) audioEl.play();
        drawWaveform();
      });
    }
    div.appendChild(ts);
    div.appendChild(document.createTextNode(seg.text));
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

// ---- Setup wizard ----
let _setupModels = [];
let _setupSelectedModel = null;
let _setupStep = 0;

function _recommendedModel(ramGb) {
  if (ramGb < 8)  return 'onnx-community/whisper-tiny';
  if (ramGb < 16) return 'onnx-community/whisper-base';
  if (ramGb < 32) return 'onnx-community/whisper-small';
  return 'onnx-community/whisper-large-v3-turbo';
}

function _goToStep(step) {
  _setupStep = step;
  document.querySelectorAll('.setup-pane').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.setup-pane')[step].classList.add('active');
  document.querySelectorAll('.setup-dot').forEach((d, i) => {
    d.classList.toggle('active', i === step);
    d.classList.toggle('done', i < step);
  });
}

function _renderSetupModels(recommendedId) {
  const container = el('setup-model-list');
  container.innerHTML = '';
  for (const m of _setupModels) {
    const isRec = m.id === recommendedId;
    const label = document.createElement('label');
    label.className = 'setup-model-option' + (m.id === _setupSelectedModel ? ' selected' : '');
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'setup-model'; radio.value = m.id;
    radio.checked = m.id === _setupSelectedModel;
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
      _setupSelectedModel = m.id;
      container.querySelectorAll('.setup-model-option').forEach((o) => o.classList.remove('selected'));
      label.classList.add('selected');
    });
    container.appendChild(label);
  }
}

async function _startModelDownload() {
  const modelInfo = _setupModels.find((m) => m.id === _setupSelectedModel);
  if (modelInfo && modelInfo.cached) {
    el('dl-title').textContent = 'Model already downloaded';
    el('dl-sub').textContent = 'Your selected model is ready to use.';
    el('dl-bar').style.width = '100%';
    el('dl-label').textContent = 'Ready.';
    setTimeout(() => _goToStep(4), 800);
    return;
  }

  let unsub = window.api.onWhisperPreloadProgress((p) => {
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
    await window.api.preloadWhisper(_setupSelectedModel);
    if (unsub) unsub();
    _goToStep(4);
  } catch (err) {
    if (unsub) unsub();
    el('dl-title').textContent = 'Setup failed';
    el('dl-bar').classList.remove('dl-indeterminate');
    el('dl-error').textContent = err.message || 'Check your network connection and try again.';
    el('dl-error').hidden = false;
    el('dl-retry-wrap').hidden = false;
  }
}

el('btn-dl-retry').addEventListener('click', () => {
  el('dl-title').textContent = 'Downloading model…';
  el('dl-sub').textContent = 'One-time download. Transcription runs fully offline after this.';
  el('dl-bar').style.width = '0%';
  el('dl-bar').classList.remove('dl-indeterminate');
  el('dl-label').textContent = 'Starting…';
  el('dl-error').hidden = true;
  el('dl-retry-wrap').hidden = true;
  _startModelDownload();
});

// Wizard button wiring
el('btn-welcome-next').addEventListener('click', () => _goToStep(1));

el('btn-model-next').addEventListener('click', () => {
  const checked = document.querySelector('input[name="setup-model"]:checked');
  if (checked) _setupSelectedModel = checked.value;
  _goToStep(2);
});

document.querySelectorAll('.setup-back').forEach((btn) => {
  btn.addEventListener('click', () => _goToStep(_setupStep - 1));
});

el('btn-ollama-check').addEventListener('click', async () => {
  const url = el('ollama-url-input').value.trim() || 'http://localhost:11434';
  el('ollama-status').textContent = '…'; el('ollama-status').style.color = '';
  const ok = await window.api.checkOllama(url);
  el('ollama-status').textContent = ok ? '✓ Connected' : '✗ Not found';
  el('ollama-status').style.color = ok ? '#6cc070' : '#f0a39c';
  el('ollama-install-hint').hidden = ok;
});

document.querySelectorAll('input[name="summ-provider"]').forEach((r) => {
  r.addEventListener('change', () => {
    el('ollama-detail').style.display = r.value === 'ollama' ? 'block' : 'none';
    el('claude-detail').hidden = r.value !== 'claude';
  });
});

el('btn-summ-next').addEventListener('click', async () => {
  const provider = document.querySelector('input[name="summ-provider"]:checked')?.value || 'skip';
  const patch = { transcriptionModel: _setupSelectedModel };
  if (provider === 'ollama') {
    patch.provider = 'ollama';
    patch.ollamaBaseUrl = el('ollama-url-input').value.trim() || 'http://localhost:11434';
    patch.ollamaModel = el('ollama-model-input').value.trim() || 'llama3.1';
  } else if (provider === 'claude') {
    patch.provider = 'claude';
    const key = el('claude-key-input').value.trim();
    if (key) await window.api.saveApiKey(key);
  }
  await window.api.saveSettings(patch);
  _goToStep(3);
  _startModelDownload();
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

async function initSetupWizard() {
  const prefs = await window.api.getSettings();
  if (prefs.setupComplete) { el('setup-overlay').hidden = true; return; }

  const [sysInfo, models] = await Promise.all([
    window.api.getSystemInfo(),
    window.api.listWhisperModels(),
  ]);
  _setupModels = models;

  const platformLabel = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[sysInfo.platform] || sysInfo.platform;
  el('sys-info-badge').textContent = `${sysInfo.ramGb} GB RAM · ${platformLabel} · ${sysInfo.arch}`;

  const recommended = _recommendedModel(sysInfo.ramGb);
  _setupSelectedModel = recommended;

  // Build step dots
  const dots = el('setup-dots');
  dots.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('span');
    d.className = 'setup-dot';
    dots.appendChild(d);
  }

  _renderSetupModels(recommended);
  _goToStep(0);
}

loadSettings();
listInputDevices();
initSetupWizard();
