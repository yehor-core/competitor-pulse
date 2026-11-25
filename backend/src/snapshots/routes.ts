import { desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { competitors, snapshots } from '../db/schema.js';

const paramsSchema = z.object({ id: z.string().min(1).max(100) });

export function registerSnapshotRoutes(app: FastifyInstance, db: NodePgDatabase): void {
  app.get('/api/competitors/:id/snapshots', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_request', message: 'invalid competitor id' });
    }
    const { id } = params.data;
    const [competitor] = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(eq(competitors.id, id));
    if (!competitor) {
      return reply.code(404).send({ error: 'not_found', message: `"${id}" is not tracked.` });
    }

    const rows = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.competitorId, id))
      .orderBy(desc(snapshots.fetchedAt), desc(snapshots.id));
    return rows.map((row) => ({
      fetchedAt: row.fetchedAt.toISOString(),
      title: row.title,
      tagline: row.tagline,
      price: row.price,
      priceParts:
        row.priceAmount === null
          ? null
          : {
              amount: Number(row.priceAmount),
              currency: row.priceCurrency,
              period: row.pricePeriod,
            },
      description: row.description,
      changed: row.changed,
      summary: row.summary,
      summaryStatus: row.summaryStatus,
      pollStatus: row.pollStatus,
      failureReason: row.failureReason,
    }));
  });
}
