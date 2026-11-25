import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  SOURCE_BASE_URL: 'http://localhost:4002',
  LLM_BASE_URL: 'http://localhost:4001/v1',
  LLM_API_KEY: 'secret',
  LLM_MODEL: 'mock-llm',
  POLL_INTERVAL_SECONDS: '900',
};

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = loadConfig(valid);

    expect(config).toMatchObject({
      port: 3000,
      logLevel: 'info',
      databaseUrl: valid.DATABASE_URL,
      sourceBaseUrl: valid.SOURCE_BASE_URL,
      llmBaseUrl: valid.LLM_BASE_URL,
      llmApiKey: 'secret',
      llmModel: 'mock-llm',
      pollIntervalSeconds: 900,
    });
  });

  it('defaults the Source request rate to 4 per second and lets it be changed', () => {
    expect(loadConfig(valid).sourceRequestsPerSecond).toBe(4);
    expect(
      loadConfig({ ...valid, SOURCE_REQUESTS_PER_SECOND: '2.5' }).sourceRequestsPerSecond,
    ).toBe(2.5);
    expect(() => loadConfig({ ...valid, SOURCE_REQUESTS_PER_SECOND: '0' })).toThrow(
      /SOURCE_REQUESTS_PER_SECOND/,
    );
  });

  it('defaults the LLM timeout to 20 seconds and lets it be changed', () => {
    expect(loadConfig(valid).llmTimeoutMs).toBe(20_000);
    expect(loadConfig({ ...valid, LLM_TIMEOUT_MS: '5000' }).llmTimeoutMs).toBe(5000);
    expect(() => loadConfig({ ...valid, LLM_TIMEOUT_MS: '0' })).toThrow(/LLM_TIMEOUT_MS/);
  });

  it('names every missing variable in one error', () => {
    const { DATABASE_URL: _db, SOURCE_BASE_URL: _src, ...rest } = valid;

    expect(() => loadConfig(rest)).toThrow(ConfigError);
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig(rest)).toThrow(/SOURCE_BASE_URL/);
  });

  it('rejects a URL that is not a URL', () => {
    expect(() => loadConfig({ ...valid, SOURCE_BASE_URL: 'not a url' })).toThrow(/SOURCE_BASE_URL/);
  });

  it('rejects a URL that is not http or https', () => {
    expect(() => loadConfig({ ...valid, SOURCE_BASE_URL: 'ftp://example.com' })).toThrow(
      /SOURCE_BASE_URL/,
    );
  });

  it('rejects a poll interval that is not a positive integer', () => {
    expect(() => loadConfig({ ...valid, POLL_INTERVAL_SECONDS: '0' })).toThrow(
      /POLL_INTERVAL_SECONDS/,
    );
    expect(() => loadConfig({ ...valid, POLL_INTERVAL_SECONDS: 'soon' })).toThrow(
      /POLL_INTERVAL_SECONDS/,
    );
  });

  it('does not echo rejected values in the error message', () => {
    expect(() => loadConfig({ ...valid, POLL_INTERVAL_SECONDS: 'hunter2-not-a-number' })).toThrow(
      /^((?!hunter2).)*$/s,
    );
  });
});
