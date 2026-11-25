import { z } from 'zod';
import { parseSummaryText } from '../domain/summary-text.js';

export type LlmResult =
  | { kind: 'ok'; text: string }
  | { kind: 'timeout' }
  | { kind: 'failed'; reason: string }
  /** The request provably never left, so the Daily LLM budget slot can be given back. */
  | { kind: 'not_sent'; reason: string }
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

// Errors raised before any bytes reach the provider: the name did not resolve or the connection was refused.
const NEVER_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

const neverSent = (error: unknown): boolean =>
  error instanceof Error &&
  error.cause instanceof Error &&
  'code' in error.cause &&
  typeof error.cause.code === 'string' &&
  NEVER_SENT_CODES.has(error.cause.code);

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
      let request: Request;
      try {
        request = new Request(new URL('chat/completions', base), {
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
      } catch {
        return { kind: 'not_sent', reason: 'LLM request could not be built' };
      }
      let response: Response;
      try {
        response = await fetch(request);
      } catch (error) {
        if (isTimeout(error)) return { kind: 'timeout' };
        if (neverSent(error)) return { kind: 'not_sent', reason: 'LLM is unreachable' };
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
