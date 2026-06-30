// Electron main process: window lifecycle + IPC orchestration of the
// capture -> transcribe -> summarize pipeline.

const path = require('path');
const os = require('os');
const { app, BrowserWindow, ipcMain, dialog, session, shell, systemPreferences } = require('electron');

const { isSupportedExtension, SUPPORTED_EXTENSIONS } = require('../shared/formats');
const whisper = require('./transcription/whisper');
const { getProvider, isLocal } = require('./summarization/provider');
const settings = require('./settings');
const recordings = require('./storage/recordings');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Audio Transcription',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Point the model cache at userData so it works in both dev and packaged builds.
  // Inside an ASAR archive node_modules is read-only; userData is always writable.
  whisper.setCacheDir(path.join(app.getPath('userData'), 'models'));

  // Allow the renderer's getUserMedia (microphone) requests.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture');
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function registerIpc() {
  // --- Audio: pick & validate a file ---
  ipcMain.handle('audio:pickFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an audio file',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: SUPPORTED_EXTENSIONS.map((e) => e.replace('.', '')) },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    if (!isSupportedExtension(filePath)) {
      throw new Error(`Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    }
    return { path: filePath, name: path.basename(filePath) };
  });

  // --- Microphone access (macOS gate; no-op elsewhere) ---
  ipcMain.handle('audio:requestMicAccess', async () => {
    if (process.platform !== 'darwin') return true;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    try {
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return false;
    }
  });

  // --- Transcription: run local Whisper on mono 16kHz PCM ---
  ipcMain.handle('transcribe:run', async (event, pcm, opts = {}) => {
    const prefs = settings.loadPrefs();
    const onProgress = (payload) => {
      if (!event.sender.isDestroyed()) event.sender.send('transcribe:progress', payload);
    };
    // pcm arrives as a Float32Array (structured clone); ensure the right view.
    const samples = pcm instanceof Float32Array ? pcm : new Float32Array(pcm);
    return whisper.transcribe(samples, {
      model: opts.model || prefs.transcriptionModel,
      language: opts.language || prefs.language,
      onProgress,
    });
  });

  // --- Summarization: send transcript text to the configured provider ---
  ipcMain.handle('summarize:run', async (_event, transcriptText) => {
    const prefs = settings.loadPrefs();
    const provider = getProvider(prefs.provider);

    if (isLocal(prefs.provider)) {
      // Local LLM (e.g. Ollama) — no credential, stays on the machine.
      return provider.summarize(transcriptText, {
        baseUrl: prefs.ollamaBaseUrl,
        model: prefs.ollamaModel,
      });
    }

    // Cloud provider — needs an API key.
    const apiKey = settings.loadApiKey();
    if (!apiKey) {
      throw new Error('No API key configured. Add one in Settings, or switch to a local provider.');
    }
    return provider.summarize(transcriptText, { apiKey, model: prefs.summaryModel });
  });

  // --- System info for setup wizard ---
  ipcMain.handle('system:info', () => ({
    ramGb: Math.round(os.totalmem() / 1073741824),
    platform: process.platform,
    arch: process.arch,
  }));

  // --- Ollama connectivity check ---
  ipcMain.handle('ollama:check', async (_e, baseUrl) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${baseUrl || 'http://localhost:11434'}/api/version`, { signal: ctrl.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  });

  // --- Whisper model pre-download for setup wizard ---
  ipcMain.handle('whisper:preload', async (event, model) => {
    const onProgress = (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('whisper:preload-progress', p);
    };
    await whisper.getPipeline(model, onProgress);
  });

  // --- Open URL in system browser ---
  ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

  // --- Whisper model list with cache status ---
  ipcMain.handle('whisper:listModels', () => whisper.listModels());

  // --- Settings ---
  ipcMain.handle('settings:get', async () => ({
    ...settings.loadPrefs(),
    hasApiKey: settings.hasApiKey(),
  }));
  ipcMain.handle('settings:save', async (_e, partial) => settings.savePrefs(partial || {}));
  ipcMain.handle('settings:saveKey', async (_e, apiKey) => {
    settings.saveApiKey(apiKey);
    return { hasApiKey: settings.hasApiKey() };
  });

  // --- Recordings library (local persistence) ---
  ipcMain.handle('recordings:save', async (_e, input) => recordings.save(input));
  ipcMain.handle('recordings:updateTranscript', async (_e, id, transcript) =>
    recordings.updateTranscript(id, transcript));
  ipcMain.handle('recordings:updateSummary', async (_e, id, summary) =>
    recordings.updateSummary(id, summary));
  ipcMain.handle('recordings:list', async () => recordings.list());
  ipcMain.handle('recordings:get', async (_e, id) => recordings.get(id));
  ipcMain.handle('recordings:getAudio', async (_e, id) => recordings.getAudio(id));
  ipcMain.handle('recordings:delete', async (_e, id) => recordings.remove(id));
}
