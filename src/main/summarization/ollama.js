// Local LLM summarization provider via Ollama (http://localhost:11434).
// Fully on-device: the transcript never leaves the machine. Requires Ollama to
// be running locally with the chosen model pulled (`ollama pull <model>`).

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.1';

const SYSTEM_PROMPT =
  'You summarize transcripts of spoken audio (meetings, interviews, lectures, voice memos). ' +
  'Produce a faithful, concise summary plus the key points and any concrete action items. ' +
  'If there are no action items, return an empty list. Do not invent content not present in the transcript. ' +
  'Respond ONLY with a JSON object of the form ' +
  '{"text": string, "keyPoints": string[], "actionItems": string[]}.';

class OllamaProvider {
  constructor() {
    this.id = 'ollama';
  }

  /**
   * @param {string} transcript
   * @param {import('./provider').SummarizeOptions} opts
   * @returns {Promise<import('../../shared/types').Summary>}
   */
  async summarize(transcript, opts = {}) {
    if (!transcript || !transcript.trim()) {
      throw new Error('There is no transcript to summarize.');
    }
    const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = opts.model || DEFAULT_MODEL;

    let res;
    try {
      res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json', // ask Ollama to constrain output to valid JSON
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content:
                'Summarize the following transcript as the JSON object described.\n\n' +
                `<transcript>\n${transcript}\n</transcript>`,
            },
          ],
        }),
      });
    } catch (err) {
      throw new Error(
        `Could not reach the local LLM at ${baseUrl}. Is Ollama running? ` +
          `Start it and try again. (${err && err.message ? err.message : err})`
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new Error(`Model "${model}" is not available in Ollama. Pull it first: \`ollama pull ${model}\`.`);
      }
      throw new Error(`Local LLM request failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data && data.message && data.message.content ? data.message.content : '';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Could not parse the summary returned by the local model.');
    }

    return {
      text: parsed.text || '',
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      provider: this.id,
    };
  }
}

module.exports = { OllamaProvider, DEFAULT_BASE_URL, DEFAULT_MODEL };
