// Electron main process: the composition root. Builds the adapters, wires
// them into the IPC controller layer, and owns window lifecycle + crash
// diagnostics. No business logic lives here.

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, desktopCapturer, session } from 'electron';
import { WhisperClient } from '../../adapters/transcription/client';
import { getProvider, isLocal } from '../../adapters/summarization';
import { FsRecordingStore } from '../../adapters/storage/recordings-fs';
import { SettingsStore } from '../../adapters/storage/settings';
import { registerIpc } from './ipc';

let mainWindow: BrowserWindow | null = null;

// macOS system-audio loopback: Chromium can capture the Mac's output via
// ScreenCaptureKit, but only behind these feature flags. Must be set before
// app is ready. This is what lets us record both sides of an online meeting
// without a virtual audio driver (BlackHole etc.).
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch(
    'enable-features',
    'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride'
  );
}

// --- Crash diagnostics ---------------------------------------------------
// When the app "just closes", the reason is usually a renderer/GPU/utility
// child-process crash or an uncaught error. Log all of those (with reasons) to
// userData/crash.log AND stderr so we can see exactly what happened.
function diagLogPath(): string | null {
  try { return path.join(app.getPath('userData'), 'crash.log'); } catch { return null; }
}
function diag(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.error(line);
  const p = diagLogPath();
  if (p) { try { fs.appendFileSync(p, line + '\n'); } catch {} }
}
function installCrashDiagnostics(): void {
  process.on('uncaughtException', (err) => diag(`uncaughtException: ${err && err.stack ? err.stack : err}`));
  process.on('unhandledRejection', (reason: any) => diag(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`));
  // GPU / utility / renderer child processes dying (this is what silently closes the window).
  app.on('child-process-gone', (_e, details) => diag(`child-process-gone: ${JSON.stringify(details)}`));
  app.on('render-process-gone', (_e, _wc, details) => diag(`render-process-gone: ${JSON.stringify(details)}`));
  diag(`--- app start (pid ${process.pid}, electron ${process.versions.electron}, ${process.platform}/${process.arch}) ---`);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Audio Transcription',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Dev: electron-vite serves the renderer over HTTP with HMR.
  // Prod/preview: load the built file.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Surface renderer-side errors and crashes to the same log.
  const wc = mainWindow.webContents;
  wc.on('render-process-gone', (_e, details) => diag(`renderer gone: ${JSON.stringify(details)}`));
  wc.on('unresponsive', () => diag('renderer unresponsive'));
  wc.on('console-message', (e: any, ...legacy: any[]) => {
    // Electron >=32 passes a single event object; older versions passed
    // positional (event, level, message, line, sourceId). Support both.
    const level = e && e.level !== undefined ? e.level : legacy[0];
    const message = e && e.message !== undefined ? e.message : legacy[1];
    const line = e && e.lineNumber !== undefined ? e.lineNumber : legacy[2];
    const sourceId = e && e.sourceId !== undefined ? e.sourceId : legacy[3];
    const severe = level === 'warning' || level === 'error' || (typeof level === 'number' && level >= 2);
    if (severe) diag(`renderer console[${level}]: ${message} (${sourceId}:${line})`);
  });
}

app.whenReady().then(() => {
  installCrashDiagnostics();

  // --- Composition root: build adapters, inject them into the IPC layer ---
  const userData = app.getPath('userData');
  const engine = new WhisperClient(
    path.join(__dirname, 'worker.js'),
    // Model cache lives in userData so it works in both dev and packaged
    // builds (inside an ASAR archive node_modules is read-only).
    path.join(userData, 'models'),
    diag
  );
  const store = new FsRecordingStore(path.join(userData, 'recordings'));
  const settings = new SettingsStore(userData);

  // Allow the renderer's getUserMedia (microphone) and system-audio requests.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    // 'audioCapture' predates the current union type but still arrives at runtime.
    callback(['media', 'audioCapture', 'display-capture'].includes(permission as string));
  });

  // System-audio capture: when the renderer calls getDisplayMedia we hand it
  // the primary screen with loopback audio (no picker UI). The renderer drops
  // the video track immediately — we only want the Mac's output audio.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (!sources.length) throw new Error('no screen sources');
      callback({ video: sources[0], audio: 'loopback' });
    }).catch((err) => {
      diag(`display-media handler failed: ${err && err.message ? err.message : err}`);
      try { (callback as any)({}); } catch {}
    });
  });

  registerIpc({
    engine,
    store,
    settings,
    getSummarizer: getProvider,
    isLocalProvider: isLocal,
    getWindow: () => mainWindow,
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
