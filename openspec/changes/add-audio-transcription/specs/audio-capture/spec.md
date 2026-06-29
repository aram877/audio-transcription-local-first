## ADDED Requirements

### Requirement: Record audio from an input device
The system SHALL allow the user to record audio from a selected system input device (e.g. microphone) and persist the recording in a format accepted by the transcription engine.

#### Scenario: Start and stop a recording
- **WHEN** the user selects an input device and presses Record, then presses Stop
- **THEN** the system captures audio for that interval and produces a saved audio file ready for transcription

#### Scenario: No input device available
- **WHEN** the user attempts to record but no input device is available or permission is denied
- **THEN** the system SHALL display an actionable error and SHALL NOT create an empty or corrupt recording

### Requirement: Select among available input devices
The system SHALL enumerate available audio input devices and let the user choose which one to record from, defaulting to the system default device.

#### Scenario: Choose a non-default microphone
- **WHEN** more than one input device is present and the user selects a specific device
- **THEN** subsequent recordings SHALL use the selected device

### Requirement: Import an existing audio file
The system SHALL allow the user to import/upload an existing audio file and accept common formats (at minimum `.wav`, `.mp3`, and `.m4a`).

#### Scenario: Import a supported file
- **WHEN** the user selects a supported audio file
- **THEN** the system SHALL load it and make it available for transcription

#### Scenario: Reject an unsupported or unreadable file
- **WHEN** the user selects a file that is not a supported audio format or cannot be decoded
- **THEN** the system SHALL reject it with a clear message and SHALL NOT start transcription

### Requirement: Normalize captured audio for transcription
The system SHALL convert recorded or imported audio into the sample rate and channel layout required by the transcription engine before transcription begins.

#### Scenario: Resample mismatched audio
- **WHEN** captured audio does not match the transcriber's required format (e.g. wrong sample rate or stereo input)
- **THEN** the system SHALL transcode it to the required format without requiring user intervention
