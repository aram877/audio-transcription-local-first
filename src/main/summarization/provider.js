// Summarization provider abstraction.
// A provider takes transcript text and returns a structured Summary. Swapping
// providers (cloud Claude, a future local LLM, etc.) only requires implementing
// summarize() and registering here. Default provider is Claude.

const { ClaudeProvider } = require('./claude');
const { OllamaProvider } = require('./ollama');

/**
 * @typedef {Object} SummarizeOptions
 * @property {string} [apiKey]   - provider credential (cloud providers)
 * @property {string} [model]    - provider model id
 * @property {string} [baseUrl]  - endpoint for local providers (e.g. Ollama)
 */

/**
 * @typedef {Object} SummarizationProvider
 * @property {string} id
 * @property {(transcript: string, opts: SummarizeOptions) => Promise<import('../../shared/types').Summary>} summarize
 */

/** @type {Record<string, () => SummarizationProvider>} */
const PROVIDERS = {
  claude: () => new ClaudeProvider(),
  ollama: () => new OllamaProvider(),
};

// Providers that run on-device and need no credential.
const LOCAL_PROVIDERS = new Set(['ollama']);

function isLocal(id) {
  return LOCAL_PROVIDERS.has(id);
}

const DEFAULT_PROVIDER = 'claude';

/**
 * @param {string} [id]
 * @returns {SummarizationProvider}
 */
function getProvider(id = DEFAULT_PROVIDER) {
  const factory = PROVIDERS[id];
  if (!factory) {
    throw new Error(`Unknown summarization provider "${id}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return factory();
}

module.exports = { getProvider, isLocal, DEFAULT_PROVIDER, PROVIDERS };
