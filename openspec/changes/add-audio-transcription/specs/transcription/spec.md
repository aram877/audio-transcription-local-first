## ADDED Requirements

### Requirement: Transcribe audio locally
The system SHALL transcribe captured audio into text using a Whisper model that runs locally on the user's machine, and audio data SHALL NOT be sent to any external service during transcription.

#### Scenario: Transcribe a completed recording or file
- **WHEN** the user requests transcription of a recorded or imported audio source
- **THEN** the system SHALL produce a text transcript of the spoken content using the local model

#### Scenario: Transcription runs offline
- **WHEN** the machine has no network connection
- **THEN** transcription SHALL still complete successfully

### Requirement: Report transcription progress
The system SHALL report transcription progress to the user and SHALL keep the interface responsive while transcription runs.

#### Scenario: Long audio shows progress
- **WHEN** transcribing audio that takes a noticeable amount of time
- **THEN** the system SHALL display progress or an in-progress indicator and SHALL allow the user to continue viewing the app

### Requirement: Produce a timestamped transcript
The system SHALL produce a transcript that includes timing information (segment start/end times) in addition to plain text.

#### Scenario: View transcript with timestamps
- **WHEN** transcription completes
- **THEN** the resulting transcript SHALL expose per-segment timestamps that can be displayed or exported

### Requirement: Select or auto-detect the spoken language
The system SHALL allow the user to choose the spoken language before transcribing, or choose automatic detection, and SHALL pass that choice to the transcription engine.

#### Scenario: Force a specific language
- **WHEN** the user selects a specific language and starts transcription
- **THEN** the system SHALL transcribe using that language rather than detecting it

#### Scenario: Auto-detect the language
- **WHEN** the user leaves the language set to automatic
- **THEN** the system SHALL let the engine detect the spoken language from the audio and transcribe accordingly

#### Scenario: Language choice is remembered
- **WHEN** the user changes the language selection
- **THEN** the system SHALL persist it and restore it on the next launch

### Requirement: Select transcription model size
The system SHALL allow the user to choose among available Whisper model sizes (trading speed for accuracy) and SHALL persist the selection.

#### Scenario: Switch to a larger model
- **WHEN** the user selects a different model size in settings
- **THEN** subsequent transcriptions SHALL use the selected model, downloading it first if it is not present

### Requirement: Handle transcription failure
The system SHALL surface transcription errors clearly and SHALL NOT silently produce an empty transcript on failure.

#### Scenario: Model missing or load failure
- **WHEN** the selected model cannot be loaded or downloaded
- **THEN** the system SHALL report an actionable error and SHALL NOT mark the transcription as successful
