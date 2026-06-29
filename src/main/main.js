// Electron main process: window lifecycle + IPC orchestration of the
// capture -> transcribe -> summarize pipeline.

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, session, systemPreferences } = require('electron');

const { isSupportedExtension, SUPPORTED_EXTENSIONS } = require('../shared/formats');
const whisper = require('./transcription/whisper');
const { getProvider, isLocal } = require('./summarization/provider');
const settings = require('./settings');

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
}
