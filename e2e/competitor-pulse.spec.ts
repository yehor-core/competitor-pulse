import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  advanceSource,
  calmSource,
  failNextLlmCalls,
  findAdvanceableCompetitor,
  removeCompetitor,
  resetLlm,
  resetSource,
  versionsAhead,
} from './helpers.js';

let id: string;

test.setTimeout(180_000);

test.beforeEach(async ({ request }) => {
  await calmSource(request);
  await resetLlm(request);
  id = await findAdvanceableCompetitor(request);
  await removeCompetitor(request, id);
});

test.afterEach(async ({ request }) => {
  await removeCompetitor(request, id);
  await resetSource(request);
  await resetLlm(request);
});

// The list loads once per visit, so waiting for the scheduler means reloading until the row shows it.
async function expectRowToContain(
  page: Page,
  competitorId: string,
  text: string,
  timeout = 30_000,
): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: competitorId })).toContainText(text, {
      timeout: 2_000,
    });
  }).toPass({ timeout });
}

async function addAndWaitForFirstPoll(page: Page, competitorId: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Competitor id').fill(competitorId);
  await page.getByRole('button', { name: 'Add' }).click();
  await expectRowToContain(page, competitorId, '(ok)');
}

// A new version of a listing can differ only by noise (banner, spacing), which is not a Change, and
// the fixtures are not ours to rely on. So advance one version at a time until the Competitor reports one.
async function advanceUntilChanged(
  page: Page,
  request: APIRequestContext,
  competitorId: string,
): Promise<void> {
  const maxVersions = await versionsAhead(request, competitorId);
  for (let step = 1; step <= maxVersions; step++) {
    await advanceSource(request, competitorId);
    try {
      await expectRowToContain(page, competitorId, 'Changed in the last 24 hours', 10_000);
      return;
    } catch (error) {
      if (step === maxVersions) throw error;
    }
  }
}

async function openTimeline(page: Page, competitorId: string): Promise<void> {
  await page.getByRole('button', { name: competitorId, exact: true }).click();
  await expect(page.getByRole('heading', { name: competitorId })).toBeVisible();
}

test('a Change in the Source shows up in the timeline with its Summary', async ({
  page,
  request,
}) => {
  await addAndWaitForFirstPoll(page, id);
  await advanceUntilChanged(page, request, id);
  await openTimeline(page, id);
  await expect(page.getByText('Mock AI summary')).toBeVisible();
});

test('when the LLM fails the timeline still shows the Change and says why there is no Summary', async ({
  page,
  request,
}) => {
  await failNextLlmCalls(request, 1000);
  await addAndWaitForFirstPoll(page, id);
  await advanceUntilChanged(page, request, id);
  await openTimeline(page, id);
  await expect(
    page.getByText('Summary not available: the language model could not be reached'),
  ).toBeVisible();
});

test('an id the Source does not know is rejected', async ({ page }) => {
  await page.goto('/');
  const unknownId = `no-such-competitor-${String(Date.now())}`;
  await page.getByLabel('Competitor id').fill(unknownId);
  await page.getByRole('button', { name: 'Add' }).click();

  await expect(page.getByRole('alert')).toContainText('The source does not know');
  await expect(page.getByRole('button', { name: unknownId })).toHaveCount(0);
});
