import { desc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { AuditEventInput, AuditEventRecord, AuditStore } from "@keystone/kernel";
import { auditEvents } from "./schema";
import type { schema } from "./schema";

/**
 * Postgres implementation of the audit port.
 *
 * `created_at` carries the event time supplied by the caller, not only the
 * insert time, so a retried or replayed action keeps its ordering. `data` uses
 * the same JSONB round-trip as settings; there is no second JSON shape.
 */
export class DrizzleAuditStore implements AuditStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async append(input: AuditEventInput): Promise<AuditEventRecord> {
    const [row] = await this.db
      .insert(auditEvents)
      .values({
        guildId: input.guildId,
        actorId: input.actorId ?? null,
        action: input.action,
        targetId: input.targetId ?? null,
        data: input.data ?? null,
        createdAt: new Date(input.at ?? Date.now()),
      })
      .returning();

    if (!row) throw new Error("The audit insert returned no row.");
    return {
      id: row.id,
      guildId: row.guildId,
      ...(row.actorId ? { actorId: row.actorId } : {}),
      action: row.action,
      ...(row.targetId ? { targetId: row.targetId } : {}),
      ...(row.data !== null && row.data !== undefined
        ? { data: row.data as Record<string, unknown> }
        : {}),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(guildId: string, limit: number): Promise<AuditEventRecord[]> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.guildId, guildId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));

    return rows.map((row) => ({
      id: row.id,
      guildId: row.guildId,
      ...(row.actorId ? { actorId: row.actorId } : {}),
      action: row.action,
      ...(row.targetId ? { targetId: row.targetId } : {}),
      ...(row.data !== null && row.data !== undefined
        ? { data: row.data as Record<string, unknown> }
        : {}),
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
