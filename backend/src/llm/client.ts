import { z } from 'zod';
import { parseSummaryText } from '../domain/summary-text.js';

export type LlmResult =
  | { kind: 'ok'; text: string }
  | { kind: 'timeout' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unusable' };

export interface LlmPrompt {
  system: string;
  user: string;
}

export interface LlmClient {
  /** One attempt, never retried: a Change costs at most one call. Never throws. */
  complete(prompt: LlmPrompt): Promise<LlmResult>;
}

export interface LlmClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

// Only the one field we read is validated, so a provider adding fields cannot break us.
const chatCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.unknown() }) })).min(1),
});

const isTimeout = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'TimeoutError';

export function createLlmClient({
  baseUrl,
  apiKey,
  model,
  timeoutMs,
}: LlmClientOptions): LlmClient {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return {
    async complete({ system, user }) {
      // One signal covers connecting, waiting and reading the body, so a stalled body also times out.
      const signal = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetch(new URL('chat/completions', base), {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        });
      } catch (error) {
        if (isTimeout(error)) return { kind: 'timeout' };
        return { kind: 'failed', reason: 'LLM is unreachable' };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { kind: 'failed', reason: `LLM answered HTTP ${String(response.status)}` };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (isTimeout(error)) return { kind: 'timeout' };
        return { kind: 'unusable' };
      }
      const parsed = chatCompletionSchema.safeParse(body);
      const content = parsed.success ? parsed.data.choices[0]?.message.content : undefined;
      const summary = parseSummaryText(content);
      return summary.kind === 'ok' ? { kind: 'ok', text: summary.text } : { kind: 'unusable' };
    },
  };
}
