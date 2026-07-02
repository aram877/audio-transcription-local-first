# Audio Transcription

Desktop app (Electron): record or import audio, transcribe it **locally** with Whisper, and summarize the transcript with a **local LLM** (Ollama) or, optionally, the cloud Claude API.

- **Transcription** runs on-device via `@huggingface/transformers` (Whisper / ONNX). The first run downloads the model once; after that it works offline.
- **Summarization** defaults to a **local** LLM through Ollama (`http://localhost:11434`) — nothing leaves your machine. Cloud Claude is an optional, explicitly-selected fallback.
- **Language**: auto-detect or pick a specific spoken language before transcribing.
- **Input**: import an audio file (`.wav/.mp3/.m4a/.ogg/.flac/.webm`) or record from the microphone —
  optionally **mixed with the Mac's system audio** (both sides of an online meeting), captured natively
  via ScreenCaptureKit loopback. No virtual audio driver needed; macOS asks once for
  *Screen & System Audio Recording* permission.

## Requirements

- Node.js 18+ (developed on Node 24)
- For local summarization: [Ollama](https://ollama.com) running, with a model pulled:
  ```bash
  ollama pull qwen2.5:7b   # or another model; set the name in Settings
  ```

## Setup & run

```bash
npm install      # installs Electron + dependencies (downloads the Electron binary)
npm run dev      # development: builds + launches with hot reload
```

Other scripts:

```bash
npm run build      # compile TypeScript bundles into out/
npm start          # preview the production build (runs `build` output)
npm run typecheck  # tsc --noEmit
npm test           # vitest unit tests
```

> If Electron fails to start with "Electron failed to install correctly", run:
> `node node_modules/electron/install.js` (needs network access), then try again.

## Using it

1. **Import audio file** or pick a **Mic** and press **● Record** → **■ Stop**.
2. (Optional) choose the **Language** (default: Auto-detect).
3. Press **Transcribe** (first run downloads the Whisper model).
4. Press **Summarize**.
   - **Settings → Provider = Ollama** (default): set the local model name; fully offline.
   - **Settings → Provider = Claude**: paste an Anthropic API key (stored encrypted via the OS keychain).
5. Export the transcript to `.txt`.

## Architecture

TypeScript throughout, organized as **ports & adapters** (hexagonal-lite): the domain core defines
the pipeline's types and interfaces; adapters provide swappable implementations; the app layer is
Electron glue; the UI is sliced by feature.

```
src/
  core/            pure domain — types, ports (TranscriptionEngine, SummarizationProvider,
                   RecordingStore), audio formats. No Electron, no DOM.
  adapters/
    transcription/ Whisper via @huggingface/transformers, run in an isolated utilityProcess
                   (a crash or OOM in inference cannot take the app down)
    summarization/ provider registry + Ollama (local) + Claude (cloud)
    storage/       recordings library (filesystem) + settings/encrypted API-key store
  app/
    ipc/           the typed IPC contract — channels, payload shapes, and the window.api type
    main/          composition root: wires adapters into IPC, window + crash diagnostics
    preload/       contextBridge facade implementing the contract's Api type
  ui/              feature-sliced renderer (record/, library/, settings/, setup/, shared/)
test/              vitest unit tests
openspec/          spec-driven change docs (proposal, design, specs, tasks)
```

## Library (local persistence)

Every transcription is **saved automatically** to a local library on your machine — no
cloud, no account. Each recording lives under the app's `userData/recordings/<id>/`
folder as the original audio plus a `record.json` holding its transcript and summary.

- Open the **Library** tab to browse past recordings (newest first).
- Select one to **play the audio**, read its **transcript**, and view (or generate) its **summary**.
- **Delete** removes that recording's audio, transcript, and summary from disk.

Summaries you generate later are written back onto the saved recording.

## Notes / not yet implemented

- No chunking for very long transcripts that exceed a small local model's context window.
- See `openspec/changes/add-audio-transcription/tasks.md` for full status.
