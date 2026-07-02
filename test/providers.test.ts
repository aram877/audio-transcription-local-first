import { describe, expect, it } from 'vitest';
import { getProvider, isLocal } from '../src/adapters/summarization';

describe('summarization provider registry', () => {
  it('resolves registered providers', () => {
    expect(getProvider('claude').id).toBe('claude');
    expect(getProvider('ollama').id).toBe('ollama');
  });

  it('rejects unknown providers with the available list', () => {
    expect(() => getProvider('gpt9000')).toThrow(/Unknown summarization provider "gpt9000"/);
  });

  it('knows which providers stay on-device', () => {
    expect(isLocal('ollama')).toBe(true);
    expect(isLocal('claude')).toBe(false);
  });

  it('claude refuses to run without an API key', async () => {
    await expect(getProvider('claude').summarize('some text', {})).rejects.toThrow(/API key/);
  });

  it('providers refuse empty transcripts', async () => {
    await expect(getProvider('ollama').summarize('   ', {})).rejects.toThrow(/no transcript/i);
  });
});
