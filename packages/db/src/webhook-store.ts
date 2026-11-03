import { and, asc, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  isWebhookEvent,
  type WebhookDelivery,
  type WebhookDeliveryInput,
  type WebhookDeliveryResult,
  type WebhookEvent,
  type WebhookStore,
  type WebhookSubscription,
  type WebhookSubscriptionInput,
} from "@keystone/kernel";
import { webhookDeliveries, webhookSubscriptions } from "./schema";
import type { schema } from "./schema";

/**
 * Postgres implementation of the webhook outbox.
 *
 * Subscription deletion cascades its deliveries in one statement, so a receipt
 * never outlives the endpoint it describes. `due` is the only query the drainer
 * runs and it matches `webhook_deliveries_due_idx` exactly.
 */
export class DrizzleWebhookStore implements WebhookStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async createSubscription(input: WebhookSubscriptionInput): Promise<WebhookSubscription> {
    const [row] = await this.db
      .insert(webhookSubscriptions)
      .values({
        id: input.id,
        guildId: input.guildId,
        url: input.url,
        secret: input.secret,
        events: [...input.events],
        createdBy: input.createdBy ?? null,
        createdAt: new Date(input.createdAt ?? Date.now()),
      })
      .returning();
    if (!row) throw new Error("The webhook subscription insert returned no row.");
    return toSubscription(row);
  }

  async listSubscriptions(guildId: string): Promise<readonly WebhookSubscription[]> {
    const rows = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.guildId, guildId))
      .orderBy(desc(webhookSubscriptions.createdAt));
    return rows.map(toSubscription);
  }

  async getSubscription(guildId: string, id: string): Promise<WebhookSubscription | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookSubscriptions)
      .where(
        and(eq(webhookSubscriptions.guildId, guildId), eq(webhookSubscriptions.id, id)),
      )
      .limit(1);
    return row ? toSubscription(row) : undefined;
  }

  async removeSubscription(guildId: string, id: string): Promise<boolean> {
    const removed = await this.db
      .delete(webhookSubscriptions)
      .where(
        and(eq(webhookSubscriptions.guildId, guildId), eq(webhookSubscriptions.id, id)),
      )
      .returning({ id: webhookSubscriptions.id });
    return removed.length > 0;
  }

  async enqueue(inputs: readonly WebhookDeliveryInput[]): Promise<readonly WebhookDelivery[]> {
    if (inputs.length === 0) return [];
    const rows = await this.db
      .insert(webhookDeliveries)
      .values(
        inputs.map((input) => {
          const at = new Date(input.at ?? Date.now());
          return {
            guildId: input.guildId,
            subscriptionId: input.subscriptionId,
            event: input.event,
            payload: input.payload,
            status: "pending",
            attempts: 0,
            nextAttemptAt: at,
            createdAt: at,
            updatedAt: at,
          };
        }),
      )
      .returning();
    return rows.map(toDelivery);
  }

  async due(now: string, limit: number): Promise<readonly WebhookDelivery[]> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, "pending"),
          isNotNull(webhookDeliveries.nextAttemptAt),
          lte(webhookDeliveries.nextAttemptAt, new Date(now)),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map(toDelivery);
  }

  async completeDelivery(id: string, status: number, at: string): Promise<void> {
    const timestamp = new Date(at);
    await this.db
      .update(webhookDeliveries)
      .set({
        status: "delivered",
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        lastStatus: status,
        lastError: null,
        nextAttemptAt: null,
        deliveredAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(webhookDeliveries.id, id));
  }

  async failDelivery(id: string, result: WebhookDeliveryResult): Promise<void> {
    const timestamp = new Date(result.at);
    const nextAttemptAt = result.nextAttemptAt ? new Date(result.nextAttemptAt) : null;
    await this.db
      .update(webhookDeliveries)
      .set({
        status: nextAttemptAt ? "pending" : "failed",
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        lastStatus: result.status ?? null,
        lastError: result.error.slice(0, 1_000),
        nextAttemptAt,
        updatedAt: timestamp,
      })
      .where(eq(webhookDeliveries.id, id));
  }

  async listDeliveries(guildId: string, limit: number): Promise<readonly WebhookDelivery[]> {
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.guildId, guildId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map(toDelivery);
  }
}

function toSubscription(row: typeof webhookSubscriptions.$inferSelect): WebhookSubscription {
  const events = Array.isArray(row.events) ? row.events.filter(isWebhookEvent) : [];
  return {
    id: row.id,
    guildId: row.guildId,
    url: row.url,
    secret: row.secret,
    events: events as WebhookEvent[],
    ...(row.createdBy ? { createdBy: row.createdBy } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

function toDelivery(row: typeof webhookDeliveries.$inferSelect): WebhookDelivery {
  return {
    id: row.id,
    guildId: row.guildId,
    subscriptionId: row.subscriptionId,
    event: row.event as WebhookEvent,
    payload: (row.payload ?? {}) as Readonly<Record<string, unknown>>,
    status: row.status as WebhookDelivery["status"],
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    ...(row.lastStatus !== null ? { lastStatus: row.lastStatus } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.deliveredAt ? { deliveredAt: row.deliveredAt.toISOString() } : {}),
  };
}
