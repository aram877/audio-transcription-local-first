## ADDED Requirements

### Requirement: Summarize a completed transcript
The system SHALL generate a concise summary of a completed transcript using a configured LLM provider.

#### Scenario: Summarize an available transcript
- **WHEN** a transcript exists and the user requests a summary
- **THEN** the system SHALL send the transcript to the configured LLM and display the returned summary

#### Scenario: No transcript to summarize
- **WHEN** the user requests a summary but no transcript is available
- **THEN** the system SHALL disable or reject the request with a clear message

### Requirement: Surface key points and action items
In addition to a prose summary, the system SHALL extract key points and any action items from the transcript when present.

#### Scenario: Meeting with action items
- **WHEN** a transcript contains decisions or tasks
- **THEN** the summary output SHALL include a distinct list of key points and action items

### Requirement: Support a local on-device LLM provider
The system SHALL support summarizing with a local LLM that runs on the user's own machine (e.g. via Ollama), with no API key and without sending the transcript to any external service.

#### Scenario: Summarize with a local model
- **WHEN** the user selects the local provider and a transcript exists
- **THEN** the system SHALL send the transcript only to the local LLM endpoint and display the returned summary, with no cloud request

#### Scenario: Local LLM is unreachable
- **WHEN** the local provider is selected but the local LLM service is not running or the model is not available
- **THEN** the system SHALL report an actionable error (how to start the service / pull the model) and SHALL preserve the transcript

#### Scenario: Indicate where data is sent
- **WHEN** the user views the summarization area
- **THEN** the system SHALL indicate whether summarizing stays on-device (local provider) or sends the transcript to a cloud provider

### Requirement: Configurable LLM provider and credentials
The system SHALL allow the user to configure the LLM provider, model, and (for cloud providers) API key, and SHALL store credentials securely rather than in plain application code. Local providers SHALL NOT require a credential.

#### Scenario: Configure provider credentials
- **WHEN** the user enters an API key and selects a model in settings
- **THEN** the system SHALL persist them securely and use them for subsequent summarization requests

#### Scenario: Missing or invalid credentials
- **WHEN** summarization is requested without a valid API key
- **THEN** the system SHALL prompt the user to configure credentials and SHALL NOT crash

### Requirement: Handle summarization failures gracefully
The system SHALL handle LLM request failures (network errors, rate limits, oversized input) without losing the underlying transcript.

#### Scenario: Provider request fails
- **WHEN** the LLM request fails or times out
- **THEN** the system SHALL report the error, preserve the transcript, and allow the user to retry

#### Scenario: Transcript exceeds provider limits
- **WHEN** the transcript is too large for a single request
- **THEN** the system SHALL chunk or condense the input so summarization can still complete
