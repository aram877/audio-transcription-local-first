# Audio Transcription

Desktop app (Electron): record or import audio, transcribe it **locally** with Whisper, and summarize the transcript with a **local LLM** (Ollama) or, optionally, the cloud Claude API.

- **Transcription** runs on-device via `@huggingface/transformers` (Whisper / ONNX). The first run downloads the model once; after that it works offline.
- **Summarization** defaults to a **local** LLM through Ollama (`http://localhost:11434`) — nothing leaves your machine. Cloud Claude is an optional, explicitly-selected fallback.
- **Language**: auto-detect or pick a specific spoken language before transcribing.
- **Input**: import an audio file (`.wav/.mp3/.m4a/.ogg/.flac/.webm`) or record from the microphone.

## Requirements

- Node.js 18+ (developed on Node 24)
- For local summarization: [Ollama](https://ollama.com) running, with a model pulled:
  ```bash
  ollama pull qwen2.5:7b   # or another model; set the name in Settings
  ```

## Setup & run

```bash
npm install      # installs Electron + dependencies (downloads the Electron binary)
npm start        # launches the app
```

> If `npm start` reports "Electron failed to install correctly", run:
> `node node_modules/electron/install.js` (needs network access), then `npm start` again.

## Using it

1. **Import audio file** or pick a **Mic** and press **● Record** → **■ Stop**.
2. (Optional) choose the **Language** (default: Auto-detect).
3. Press **Transcribe** (first run downloads the Whisper model).
4. Press **Summarize**.
   - **Settings → Provider = Ollama** (default): set the local model name; fully offline.
   - **Settings → Provider = Claude**: paste an Anthropic API key (stored encrypted via the OS keychain).
5. Export the transcript to `.txt`.

## Project layout

```
src/
  main/            Electron main process (window, IPC)
    transcription/ local Whisper engine
    summarization/ provider interface + Ollama (local) + Claude (cloud)
    settings.js    preferences + encrypted API-key storage
    main.js, preload.js
  renderer/        UI (decode/resample audio, record, views)
  shared/          types + supported formats
openspec/          spec-driven change docs (proposal, design, specs, tasks)
```

## Notes / not yet implemented

- Recordings and results are **not persisted to disk** yet (in-memory per session).
- No chunking for very long transcripts that exceed a small local model's context window.
- See `openspec/changes/add-audio-transcription/tasks.md` for full status.
