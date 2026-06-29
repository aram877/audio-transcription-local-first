// Shared data shapes for the audio-transcription pipeline.
// Plain JS + JSDoc typedefs — the pipeline is: audio source -> transcript -> summary.

/**
 * A single timestamped segment of transcribed speech.
 * @typedef {Object} TranscriptSegment
 * @property {number} start - segment start time in seconds
 * @property {number} end   - segment end time in seconds
 * @property {string} text  - transcribed text for this segment
 */

/**
 * A completed transcript.
 * @typedef {Object} Transcript
 * @property {string} text                  - full transcript text
 * @property {TranscriptSegment[]} segments - per-segment text with timestamps
 * @property {string} [model]               - model id used to produce it
 * @property {string} [language]            - language used, or auto-detected name ("auto" if unknown)
 * @property {boolean} [detected]           - true when the language was auto-detected
 */

/**
 * An AI-generated summary of a transcript.
 * @typedef {Object} Summary
 * @property {string} text          - prose summary
 * @property {string[]} keyPoints   - bullet key points
 * @property {string[]} actionItems - extracted action items (may be empty)
 * @property {string} [provider]    - provider id that produced it
 */

/**
 * The source audio for a session.
 * @typedef {Object} AudioSource
 * @property {'import'|'record'} kind - how the audio was acquired
 * @property {string} [path]          - original file path (for imports)
 * @property {string} [name]          - display name
 */

/**
 * A unit of work bundling source audio, its transcript, and its summary.
 * @typedef {Object} Session
 * @property {string} id
 * @property {AudioSource} source
 * @property {Transcript} [transcript]
 * @property {Summary} [summary]
 */

module.exports = {};
