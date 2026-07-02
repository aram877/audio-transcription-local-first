// WhisperClient: the main-process implementation of the TranscriptionEngine
// port. Inference itself runs in a separate utilityProcess (worker.ts) so that
// heavy ONNX work can't block the main event loop and an inference crash
// (e.g. an oversized allocation on a huge model) can't take the whole app
// down. This class spawns and supervises that worker.

import { utilityProcess, type UtilityProcess } from 'electron';
import type { TranscribeOptions, TranscriptionEngine } from '../../core/ports';
import type { ProgressCallback, Transcript, WhisperModelInfo } from '../../core/types';
import { listModels } from './models';
import type { WorkerResponse } from './protocol';

type Logger = (msg: string) => void;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  onProgress?: ProgressCallback;
}

export class WhisperClient implements TranscriptionEngine {
  private worker: UtilityProcess | null = null;
  private workerReady: Promise<unknown> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(
    private readonly workerPath: string,
    private readonly cacheDir: string,
    private readonly log: Logger = (msg) => console.error(msg)
  ) {}

  listModels(): WhisperModelInfo[] {
    return listModels(this.cacheDir);
  }

  async transcribe(pcm: Float32Array, opts: TranscribeOptions = {}): Promise<Transcript> {
    if (!pcm || pcm.length === 0) {
      throw new Error('No audio to transcribe (empty or missing PCM data).');
    }
    await this.ensureWorker();
    const { onProgress, ...rest } = opts;
    return this.request({ type: 'transcribe', pcm, opts: rest }, onProgress);
  }

  async preload(model: string, onProgress?: ProgressCallback, dtype?: string): Promise<void> {
    await this.ensureWorker();
    await this.request({ type: 'preload', model, dtype }, onProgress);
  }

  private spawnWorker(): UtilityProcess {
    const worker = utilityProcess.fork(this.workerPath, [], {
      serviceName: 'whisper-transcription',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    worker.stdout?.on('data', (d) => this.log(`[whisper-worker] ${String(d).trimEnd()}`));
    worker.stderr?.on('data', (d) => this.log(`[whisper-worker:err] ${String(d).trimEnd()}`));

    worker.on('message', (msg: WorkerResponse) => {
      const req = msg && this.pending.get(msg.id);
      if (!req) return;
      if (msg.type === 'progress') {
        try { req.onProgress?.(msg.payload); } catch {}
        return;
      }
      this.pending.delete(msg.id);
      if (msg.type === 'result') req.resolve(msg.payload);
      else req.reject(new Error(msg.message || 'Transcription worker reported an error.'));
    });

    worker.on('exit', (code) => {
      this.log(`[whisper] worker exited with code ${code} (${this.pending.size} request(s) in flight)`);
      if (this.worker === worker) {
        this.worker = null;
        this.workerReady = null;
      }
      // Fail anything in flight with an actionable message instead of hanging.
      for (const [id, req] of this.pending) {
        this.pending.delete(id);
        req.reject(new Error(
          'The transcription engine stopped unexpectedly (it likely ran out of memory). ' +
          'The app is still running — try again, or pick a smaller Whisper model in Settings.'
        ));
      }
    });

    return worker;
  }

  private ensureWorker(): Promise<unknown> {
    if (this.worker && this.workerReady) return this.workerReady;
    this.worker = this.spawnWorker();
    this.workerReady = this.request({ type: 'init', cacheDir: this.cacheDir }, undefined, this.worker);
    return this.workerReady;
  }

  private request(
    body: Record<string, unknown>,
    onProgress?: ProgressCallback,
    worker?: UtilityProcess
  ): Promise<any> {
    const id = this.nextId++;
    const w = worker || this.worker;
    return new Promise((resolve, reject) => {
      if (!w) return reject(new Error('Transcription worker is not running.'));
      this.pending.set(id, { resolve, reject, onProgress });
      try {
        w.postMessage({ id, ...body });
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
