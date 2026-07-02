// Summarization provider registry (the strategy pattern's lookup table).
// Swapping providers (cloud Claude, local Ollama, a future one) only requires
// implementing the SummarizationProvider port and registering here.

import type { SummarizationProvider } from '../../core/ports';
import { ClaudeProvider } from './claude';
import { OllamaProvider } from './ollama';

const PROVIDERS: Record<string, () => SummarizationProvider> = {
  claude: () => new ClaudeProvider(),
  ollama: () => new OllamaProvider(),
};

// Providers that run on-device and need no credential.
const LOCAL_PROVIDERS = new Set(['ollama']);

export function isLocal(id: string): boolean {
  return LOCAL_PROVIDERS.has(id);
}

export const DEFAULT_PROVIDER = 'claude';

export function getProvider(id: string = DEFAULT_PROVIDER): SummarizationProvider {
  const factory = PROVIDERS[id];
  if (!factory) {
    throw new Error(`Unknown summarization provider "${id}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return factory();
}
