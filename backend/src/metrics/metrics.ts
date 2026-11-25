import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Counter, Gauge, Registry } from 'prom-client';
import type { LlmBudget } from '../llm/budget.js';
import { pollLagSeconds } from '../scheduler/poll-lag.js';

/** What the rest of the code calls; it knows nothing about prom-client. */
export interface MetricsRecorder {
  /** An HTTP status such as `429`, or `timeout`, `unreachable`, `unusable` when the Source gave no usable response. */
  sourceResponse: (outcome: string) => void;
  pollFinished: (pollStatus: string) => void;
  /** Every Summary status a Change settles on, including the ones where no LLM call was made. */
  summarySettled: (summaryStatus: string) => void;
}

export interface Metrics extends MetricsRecorder {
  render(): Promise<string>;
  contentType: string;
}

export interface MetricsOptions {
  db: NodePgDatabase;
  budget: LlmBudget;
}

export function createMetrics({ db, budget }: MetricsOptions): Metrics {
  const registry = new Registry();

  // Gauges are read from the database at scrape time, so they stay correct across restarts.
  new Gauge({
    name: 'competitor_pulse_poll_lag_seconds',
    help: 'How long the most overdue Competitor has been waiting for its Poll.',
    registers: [registry],
    async collect() {
      this.set(await pollLagSeconds(db));
    },
  });
  new Gauge({
    name: 'competitor_pulse_llm_budget_remaining',
    help: 'LLM calls left in today’s Daily LLM budget.',
    registers: [registry],
    async collect() {
      this.set((await budget.status()).remainingToday);
    },
  });

  const polls = new Counter({
    name: 'competitor_pulse_polls_total',
    help: 'Finished Polls by Poll status.',
    labelNames: ['poll_status'],
    registers: [registry],
  });
  const sourceResponses = new Counter({
    name: 'competitor_pulse_source_responses_total',
    help: 'Requests to the Source by HTTP status or failure outcome.',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const llmCalls = new Counter({
    name: 'competitor_pulse_llm_calls_total',
    help: 'Settled Summaries by Summary status.',
    labelNames: ['summary_status'],
    registers: [registry],
  });

  return {
    sourceResponse: (outcome) => {
      sourceResponses.inc({ outcome });
    },
    pollFinished: (pollStatus) => {
      polls.inc({ poll_status: pollStatus });
    },
    summarySettled: (summaryStatus) => {
      llmCalls.inc({ summary_status: summaryStatus });
    },
    render: () => registry.metrics(),
    contentType: registry.contentType,
  };
}
