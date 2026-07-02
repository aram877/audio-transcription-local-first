// Claude summarization provider (Anthropic API).
// Transcript text is the only data sent to the provider; this is the single
// network step in the app. Credentials are supplied per call (never hardcoded).

import type { SummarizationProvider, SummarizeOptions } from '../../core/ports';
import type { Summary } from '../../core/types';

export const DEFAULT_MODEL = 'claude-opus-4-8';

// JSON Schema for the structured summary the model must return.
export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'A concise prose summary of the transcript.' },
    keyPoints: {
      type: 'array',
      items: { type: 'string' },
      description: 'The main points, one per item.',
    },
    actionItems: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete action items or decisions; empty if none.',
    },
  },
  required: ['text', 'keyPoints', 'actionItems'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT =
  'You summarize transcripts of spoken audio (meetings, interviews, lectures, voice memos). ' +
  'Produce a faithful, concise summary plus the key points and any concrete action items. ' +
  'If there are no action items, return an empty list. Do not invent content not present in the transcript.';

export class ClaudeProvider implements SummarizationProvider {
  readonly id = 'claude';

  async summarize(transcript: string, opts: SummarizeOptions = {}): Promise<Summary> {
    const apiKey = opts.apiKey;
    if (!apiKey) {
      throw new Error('Summarization requires an API key. Configure it in Settings.');
    }
    if (!transcript || !transcript.trim()) {
      throw new Error('There is no transcript to summarize.');
    }

    let Anthropic: any;
    try {
      ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
    } catch {
      throw new Error('Anthropic SDK is not installed. Run `npm install` to add @anthropic-ai/sdk.');
    }

    const client = new Anthropic({ apiKey });
    const model = opts.model || DEFAULT_MODEL;

    let response: any;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: SUMMARY_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: `Summarize the following transcript.\n\n<transcript>\n${transcript}\n</transcript>`,
          },
        ],
      });
    } catch (err) {
      // Surface a clean message; the transcript itself is preserved by the caller.
      const status = err && err.status ? ` (HTTP ${err.status})` : '';
      throw new Error(`Summarization request failed${status}: ${err && err.message ? err.message : err}`);
    }

    if (response.stop_reason === 'refusal') {
      throw new Error('The model declined to summarize this transcript.');
    }

    const textBlock = (response.content || []).find((b: any) => b.type === 'text');
    const raw = textBlock && textBlock.text ? textBlock.text : '';
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Could not parse the summary returned by the model.');
    }

    return {
      text: parsed.text || '',
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      provider: this.id,
    };
  }
}
