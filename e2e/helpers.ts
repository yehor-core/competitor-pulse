import { expect, type APIRequestContext } from '@playwright/test';

// The Source and the mock LLM are separate services; their control endpoints drive failures and changes.
export const sourceUrl = process.env.E2E_SOURCE_URL ?? 'http://localhost:4002';
export const llmControlUrl = process.env.E2E_LLM_CONTROL_URL ?? 'http://localhost:4001';

interface SourceStats {
  versions: Record<string, { index: number; of: number }>;
}

async function post(request: APIRequestContext, url: string, data: object): Promise<void> {
  const response = await request.post(url, { data });
  expect(response.ok(), `POST ${url} answered ${String(response.status())}`).toBe(true);
}

/** Puts the Source in a quiet, deterministic state: no random failures, no time-driven new versions. */
export async function calmSource(request: APIRequestContext): Promise<void> {
  await post(request, `${sourceUrl}/control/reset`, {});
  await post(request, `${sourceUrl}/control/configure`, {
    versionIntervalSeconds: 0,
    errorRate: 0,
    slowRate: 0,
    timeoutRate: 0,
    partialRate: 0,
    noise: false,
    formatVariants: false,
  });
}

export async function resetSource(request: APIRequestContext): Promise<void> {
  await post(request, `${sourceUrl}/control/reset`, {});
}

export async function resetLlm(request: APIRequestContext): Promise<void> {
  await post(request, `${llmControlUrl}/control/reset`, {});
}

export async function failNextLlmCalls(request: APIRequestContext, count: number): Promise<void> {
  await post(request, `${llmControlUrl}/control/configure`, { failNext: count });
}

/** Asks the Source itself which competitors it has and picks one that has a later version to advance to. */
async function sourceVersions(request: APIRequestContext): Promise<SourceStats['versions']> {
  const response = await request.get(`${sourceUrl}/control/stats`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as SourceStats).versions;
}

export async function versionsAhead(request: APIRequestContext, id: string): Promise<number> {
  const version = (await sourceVersions(request))[id];
  if (version === undefined) throw new Error(`The Source does not know "${id}"`);
  return version.of - 1 - version.index;
}

export async function findAdvanceableCompetitor(request: APIRequestContext): Promise<string> {
  const versions = await sourceVersions(request);
  const found = Object.entries(versions).find(([, v]) => v.index + 1 < v.of);
  if (found === undefined) throw new Error('The Source has no competitor with a later version');
  return found[0];
}

export async function advanceSource(request: APIRequestContext, id: string): Promise<void> {
  await post(request, `${sourceUrl}/control/advance`, { id, steps: 1 });
}

/** Removes a Competitor through the API so scenarios do not see each other's history. */
export async function removeCompetitor(request: APIRequestContext, id: string): Promise<void> {
  const response = await request.delete(`/api/competitors/${encodeURIComponent(id)}`);
  expect([204, 404]).toContain(response.status());
}
