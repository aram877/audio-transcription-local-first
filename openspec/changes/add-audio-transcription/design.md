## Context

Greenfield desktop app. The user wants to record or import audio, transcribe it locally (private, offline, no per-minute cost), and summarize the transcript with an LLM. Decisions already made: **desktop app**, **local Whisper** transcription. Summarization needs an LLM, so it calls out to a configurable cloud provider (default Claude API) — this is the only step that touches the network. Capturing all system input/output audio (loopback) is deferred to a future change.

The three capabilities map to a pipeline: `audio-capture` → `transcription` → `ai-summarization`. Each stage hands a well-defined artifact to the next (audio file → transcript → summary).

## Goals / Non-Goals

**Goals:**
- Single bundled desktop app that runs the full record/import → transcribe → summarize flow.
- Local, offline, free transcription via a Whisper model.
- Configurable, swappable LLM provider for summarization with securely stored credentials.
- Responsive UI: progress while transcribing, transcript + summary viewable side by side, export to text/markdown.

**Non-Goals:**
- System-audio loopback / capturing all machine input+output (deferred).
- Real-time / streaming live transcription (batch on a completed recording or file is enough for MVP).
- Speaker diarization, multi-language UI, cloud sync, or accounts.

## Decisions

### Desktop shell: Tauri (Rust core + web frontend)
- **Why**: Native access to audio devices and the filesystem, can spawn/bundle a native Whisper binary, small footprint, and a familiar web UI layer. Rust side owns audio capture and orchestration; web side owns UI.
- **Alternatives**: Electron (heavier, but more mature audio ecosystem and easier if the team prefers all-JS) — acceptable fallback. A plain Python app/CLI (fastest prototype, but weaker as a distributable desktop product).
- **Note**: If Rust is a blocker for the team, Electron + Node is a drop-in substitute without changing the capability specs.

### Transcription engine: whisper.cpp with a local model file
- **Why**: Runs Whisper locally with no Python runtime dependency, ships as a native binary, supports multiple model sizes, and produces segment timestamps — satisfying the local/offline and timestamp requirements.
- **Alternatives**: `openai-whisper` (PyTorch) — heavier install, GPU/Python friction; faster-whisper (CTranslate2) — good, but adds a Python dependency.
- **Models**: downloaded on demand by size (tiny/base/small/medium); selection persisted in settings.

### Summarization: provider abstraction, local-first (Ollama) with cloud option
- **Why**: Summarization needs an LLM, but the project goal is fully local/private. A thin provider interface supports a **local on-device provider (Ollama, default)** that keeps the transcript on the machine, plus an optional **cloud Claude** provider for users who prefer it.
- **Local provider**: talks to a local Ollama server (`http://localhost:11434`) over HTTP; no credential; configurable base URL and model. Requires the user to run Ollama and pull a model.
- **Large transcripts**: chunk-then-combine (map-reduce summarization) when input exceeds the model's context window.
- **Credentials**: only cloud providers need a key; it is stored in the OS secure store, never hardcoded. Local providers need no credential.

### Audio normalization
- Decode imported files and recordings, then resample to the mono 16 kHz PCM that Whisper expects before transcription. Handled in the core layer so the UI and the transcriber stay format-agnostic.

### Data flow & persistence
- A "session" bundles: source audio path, transcript (text + segments), and summary. Stored locally (e.g. app data dir, JSON + audio file) so users can revisit results. No remote storage.

## Risks / Trade-offs

- **Transcription is CPU-intensive / slow on large model sizes** → default to a small model, expose model-size selection, run off the UI thread, show progress.
- **First-run model download requires network** (one-time) → make it explicit in UI; transcription itself stays offline afterward.
- **LLM API key handling** → store in OS secure store, never log transcript or key; make the network step clearly opt-in via settings.
- **Format/codec coverage for imports** → rely on a robust decode/transcode step; reject unsupported files with a clear message rather than failing mid-transcription.
- **Rust learning curve (if using Tauri)** → Electron fallback documented; capability specs are shell-agnostic so the choice can change without reworking requirements.
- **Privacy expectation mismatch** (user assumes everything is local) → clearly label that summarization sends transcript text to the configured provider.

## Migration Plan

Greenfield — no migration. Rollout is iterative by capability: (1) audio-capture (record + import + normalize), (2) local transcription with progress + timestamps, (3) summarization with provider config. Each can be demoed independently. No rollback concerns beyond not shipping an incomplete stage.

## Open Questions

- ~~Tauri vs Electron~~ — **Resolved: Electron + Node.** Rust toolchain is not installed; Electron uses the existing Node 24 toolchain with no extra install. Transcription runs locally via a Node Whisper binding (transformers.js / ONNX), audio decode + resample to 16 kHz mono is done in the renderer via the Web Audio API (no ffmpeg dependency). Capability specs are shell-agnostic, so this does not change requirements.
- Default summarization model/provider details (default: Claude API) and whether a local-LLM summarizer is wanted later.
- Whether to persist sessions/history in MVP or keep results ephemeral until export.
