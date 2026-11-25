import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { competitors } from '../db/schema.js';
import type { SourceClient } from '../source/client.js';

const competitorId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, ".", "_" and "-" only');

const addBodySchema = z.object({ id: competitorId });
const idParamsSchema = z.object({ id: competitorId });

function invalidRequest(error: z.ZodError) {
  return {
    error: 'invalid_request',
    message: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
  };
}

// Raw SQL subselects come back from pg as strings or Dates depending on the driver path.
function toIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function registerCompetitorRoutes(
  app: FastifyInstance,
  db: NodePgDatabase,
  source: SourceClient,
): void {
  app.get('/api/competitors', async () => {
    const rows = await db
      .select({
        id: competitors.id,
        awaitingFirstPollReason: competitors.awaitingFirstPollReason,
        lastChangedAt: sql<Date | null>`(
          select max(s.fetched_at) from snapshots s
          where s.competitor_id = competitors.id and s.changed
        )`,
        lastPolledAt: sql<Date | null>`(
          select max(s.fetched_at) from snapshots s where s.competitor_id = competitors.id
        )`,
        lastPollStatus: sql<string | null>`(
          select s.poll_status from snapshots s where s.competitor_id = competitors.id
          order by s.fetched_at desc, s.id desc limit 1
        )`,
      })
      .from(competitors)
      .where(isNull(competitors.removedAt))
      .orderBy(asc(competitors.id));
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return rows.map((row) => ({
      ...row,
      lastChangedAt: toIso(row.lastChangedAt),
      lastPolledAt: toIso(row.lastPolledAt),
      changedInLast24h:
        row.lastChangedAt !== null && new Date(row.lastChangedAt).getTime() >= dayAgo,
    }));
  });

  app.post('/api/competitors', async (request, reply) => {
    const body = addBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send(invalidRequest(body.error));
    }
    const { id } = body.data;

    // A Competitor we already know keeps its history and Baseline, so the Source is not asked again.
    const [existing] = await db.select().from(competitors).where(eq(competitors.id, id));
    if (existing) {
      if (existing.removedAt !== null) {
        await db.update(competitors).set({ removedAt: null }).where(eq(competitors.id, id));
      }
      return reply
        .code(201)
        .send({ id, awaitingFirstPollReason: existing.awaitingFirstPollReason });
    }

    const lookup = await source.lookup(id);
    if (lookup.kind === 'unknown') {
      return reply
        .code(422)
        .send({ error: 'unknown_competitor', message: `The source does not know "${id}".` });
    }
    const awaitingFirstPollReason = lookup.kind === 'unavailable' ? lookup.reason : null;
    if (lookup.kind === 'unavailable') {
      request.log.warn({ competitorId: id, reason: lookup.reason }, 'source unavailable on add');
    }
    await db
      .insert(competitors)
      .values({ id, awaitingFirstPollReason })
      // A concurrent add of the same id wins; this one must not undo a removal that followed it.
      .onConflictDoNothing();
    return reply.code(201).send({ id, awaitingFirstPollReason });
  });

  app.delete('/api/competitors/:id', async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidRequest(params.error));
    const { id } = params.data;
    const [row] = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(eq(competitors.id, id));
    if (!row) {
      return reply.code(404).send({ error: 'not_found', message: `"${id}" is not tracked.` });
    }
    await db
      .update(competitors)
      .set({ removedAt: new Date() })
      .where(and(eq(competitors.id, id), isNull(competitors.removedAt)));
    return reply.code(204).send();
  });
}
