// Transcription worker: runs Whisper inference in an Electron utilityProcess,
// isolated from the main process. Heavy ONNX work here can neither freeze the
// UI nor take the app down — if this process dies, main reports a friendly
// error and respawns it on the next request.

import * as engine from './engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

// utilityProcess children talk to main over process.parentPort; the Electron
// type augmentation for it isn't exported, so declare the slice we use.
interface ParentPort {
  on(event: 'message', listener: (e: { data: WorkerRequest }) => void): void;
  postMessage(message: WorkerResponse): void;
}
const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

function send(msg: WorkerResponse): void {
  try {
    parentPort.postMessage(msg);
  } catch (err) {
    console.error('[whisper-worker] postMessage failed:', err);
  }
}

parentPort.on('message', async (e) => {
  const req = e.data;
  const id = req?.id;
  try {
    if (req.type === 'init') {
      if (req.cacheDir) engine.setCacheDir(req.cacheDir);
      send({ id, type: 'result', payload: true });
      return;
    }

    const onProgress = (payload: { status: string; progress?: number; file?: string }) =>
      send({ id, type: 'progress', payload });

    if (req.type === 'preload') {
      await engine.getPipeline(req.model, onProgress, req.dtype);
      send({ id, type: 'result', payload: true });
      return;
    }

    if (req.type === 'transcribe') {
      // pcm survives structured clone as a Float32Array, but be defensive.
      let pcm = req.pcm as Float32Array | ArrayBuffer;
      if (!(pcm instanceof Float32Array)) {
        pcm = new Float32Array((pcm as any)?.buffer ?? pcm);
      }
      const result = await engine.transcribe(pcm as Float32Array, { ...req.opts, onProgress });
      send({ id, type: 'result', payload: result });
      return;
    }

    send({ id, type: 'error', message: `Unknown request type "${(req as any).type}"` });
  } catch (err) {
    send({ id, type: 'error', message: err && err.message ? err.message : String(err) });
  }
});
