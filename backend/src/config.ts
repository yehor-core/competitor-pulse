import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  SOURCE_BASE_URL: z.url(),
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().positive(),
});

export interface Config {
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  databaseUrl: string;
  sourceBaseUrl: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  pollIntervalSeconds: number;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfigOrExit(env: Record<string, string | undefined>): Config {
  try {
    return loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Only the variable name and the rule are reported, never the value, so a secret cannot leak into logs.
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    sourceBaseUrl: e.SOURCE_BASE_URL,
    llmBaseUrl: e.LLM_BASE_URL,
    llmApiKey: e.LLM_API_KEY,
    llmModel: e.LLM_MODEL,
    pollIntervalSeconds: e.POLL_INTERVAL_SECONDS,
  };
}
