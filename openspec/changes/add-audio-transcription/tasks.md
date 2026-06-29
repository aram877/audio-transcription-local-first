## 1. Project setup

- [x] 1.1 Scaffold the desktop app shell (Tauri by default; Electron as documented fallback) with a web frontend and a native core layer
- [x] 1.2 Establish project structure: `audio-capture`, `transcription`, `ai-summarization` modules plus shared types for Session/Transcript/Summary
- [x] 1.3 Add base dependencies (audio decode/resample, Whisper engine binding, LLM client) and a settings/secure-store mechanism
- [x] 1.4 Wire a minimal app window with navigation between Capture, Transcript, and Summary views

## 2. Audio capture

- [x] 2.1 Enumerate available input devices and expose a device picker defaulting to the system default
- [x] 2.2 Implement record start/stop from the selected device, producing audio ready for transcription
- [x] 2.3 Implement file import with format validation (accept at least `.wav`, `.mp3`, `.m4a`; reject unsupported/unreadable files with a clear message)
- [x] 2.4 Implement normalization: decode + resample to mono 16 kHz PCM expected by the transcriber
- [x] 2.5 Handle capture errors (no device / permission denied) without producing empty or corrupt files

## 3. Transcription

- [x] 3.1 Integrate the local Whisper engine and load a model from the app data dir
- [ ] 3.2 Add model-size selection in settings with on-demand download and persistence
- [x] 3.3 Run transcription off the UI thread and emit progress events to the frontend
- [x] 3.4 Produce a transcript with text and per-segment timestamps
- [ ] 3.5 Verify offline transcription works with no network connection
- [x] 3.6 Handle model load/download failures with actionable errors (never mark failed transcriptions as successful)
- [x] 3.7 Let the user pick the spoken language or auto-detect before transcribing, pass it to the engine, and persist the choice

## 4. AI summarization

- [x] 4.1 Define a provider interface and implement the default Claude API provider
- [x] 4.2 Add settings UI to configure provider, model, and API key; store credentials in the OS secure store
- [x] 4.3 Generate a prose summary plus extracted key points and action items from a transcript
- [ ] 4.4 Implement chunk-then-combine (map-reduce) for transcripts exceeding the provider's context limit
- [x] 4.5 Handle missing/invalid credentials and request failures gracefully, preserving the transcript and allowing retry
- [x] 4.6 Add a local on-device LLM provider (Ollama) — selectable, no credential, transcript stays local; indicate local vs cloud in the UI

## 5. UI, persistence & export

- [x] 5.1 Build the transcript + summary side-by-side view with progress indicators
- [ ] 5.2 Persist sessions (source audio + transcript + summary) locally so results can be revisited
- [ ] 5.3 Add export of transcript and summary to text and markdown
- [x] 5.4 Clearly label that summarization sends transcript text to the configured provider (privacy notice)

## 6. Verification

- [ ] 6.1 End-to-end test: record → transcribe → summarize produces a transcript and summary
- [ ] 6.2 End-to-end test: import a file → transcribe → summarize
- [ ] 6.3 Validate each spec scenario (offline transcription, unsupported file rejection, missing credentials, oversized transcript, provider failure)
