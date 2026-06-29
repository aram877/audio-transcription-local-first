## Why

People constantly produce spoken audio — meetings, interviews, lectures, voice memos — but turning it into searchable, skimmable text is manual and slow. We want a desktop app that records or ingests audio, transcribes it locally (private, offline, no per-minute cost), and then uses an LLM to summarize the result so users get the gist without reading the full transcript.

## What Changes

- Add a **desktop application** (single bundled app) that runs the whole flow locally.
- Add **audio input**: record from the microphone / a selected input device, OR upload an existing audio file (e.g. `.wav`, `.mp3`, `.m4a`).
- Add **local transcription** using a Whisper model (no audio leaves the machine for the transcription step), producing timestamped text.
- Add **AI summarization** of a completed transcript via a configurable LLM provider (default: cloud Claude API; provider/key are user-configurable and swappable).
- Add a basic **UI** to start/stop recording, pick a file, watch transcription progress, and view transcript + summary side by side, with export to text/markdown.
- **Out of scope for this MVP** (deferred to a later change): capturing all system input/output audio (loopback) — this is platform-specific and complex (requires virtual audio devices or OS screen-capture APIs). Noted as a future capability.

## Capabilities

### New Capabilities
- `audio-capture`: Acquire audio either by recording from a selected input device or by importing/uploading an existing audio file; normalize it into a format the transcriber accepts.
- `transcription`: Convert captured audio into text locally using a Whisper model, exposing progress and producing a (optionally timestamped) transcript.
- `ai-summarization`: Generate a concise AI summary (and key points / action items) of a completed transcript using a configurable LLM provider.

### Modified Capabilities
<!-- None — this is a greenfield project with no existing specs. -->

## Impact

- **New codebase**: greenfield desktop app (no existing code to modify).
- **Dependencies**: a Whisper engine (e.g. `whisper.cpp` / a Whisper binding) plus a downloadable model file; an audio capture/decoding library; an LLM client SDK for summarization.
- **External services**: outbound calls to the configured LLM provider for summarization only (transcription stays local). Requires a user-supplied API key.
- **Config/secrets**: storage for the LLM API key and user preferences (model size, default input device, output format).
- **Platform**: targets desktop OS audio device access; system-audio loopback capture is explicitly deferred.
