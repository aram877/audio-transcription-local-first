// Transcription worker: runs Whisper inference in an Electron utilityProcess,
// isolated from the main process. Heavy ONNX work here can neither freeze the
// UI nor take the app down — if this process dies, main reports a friendly
// error and respawns it on the next request.
//
// Protocol (over process.parentPort):
//   in : { id, type: 'init',       cacheDir }
//   in : { id, type: 'transcribe', pcm, opts: {model, dtype, language} }
//   in : { id, type: 'preload',    model, dtype }
//   out: { id, type: 'progress', payload }
//   out: { id, type: 'result',   payload }
//   out: { id, type: 'error',    message }

const core = require('./whisper-core');

function send(msg) {
  try { process.parentPort.postMessage(msg); } catch (err) {
    console.error('[whisper-worker] postMessage failed:', err);
  }
}

process.parentPort.on('message', async (e) => {
  const { id, type } = e.data || {};
  try {
    if (type === 'init') {
      if (e.data.cacheDir) core.setCacheDir(e.data.cacheDir);
      send({ id, type: 'result', payload: true });
      return;
    }

    const onProgress = (payload) => send({ id, type: 'progress', payload });

    if (type === 'preload') {
      await core.getPipeline(e.data.model, onProgress, e.data.dtype);
      send({ id, type: 'result', payload: true });
      return;
    }

    if (type === 'transcribe') {
      // pcm survives structured clone as a Float32Array, but be defensive.
      let pcm = e.data.pcm;
      if (!(pcm instanceof Float32Array)) {
        pcm = new Float32Array(pcm && pcm.buffer ? pcm.buffer : pcm);
      }
      const result = await core.transcribe(pcm, { ...e.data.opts, onProgress });
      send({ id, type: 'result', payload: result });
      return;
    }

    send({ id, type: 'error', message: `Unknown request type "${type}"` });
  } catch (err) {
    send({ id, type: 'error', message: err && err.message ? err.message : String(err) });
  }
});
