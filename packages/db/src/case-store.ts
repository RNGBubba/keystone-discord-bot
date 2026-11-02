import { and, desc, eq, gt, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type {
  CaseEvent,
  CaseStore,
  ModerationCase,
  ModerationCaseState,
  NewModerationCase,
} from "@keystone/kernel";
import { caseCounters, caseEvents, cases } from "./schema";
import type { schema } from "./schema";

type CaseRow = typeof cases.$inferSelect;
type EventRow = typeof caseEvents.$inferSelect;

function toCase(row: CaseRow): ModerationCase {
  return {
    id: row.id,
    guildId: row.guildId,
    caseNumber: row.caseNumber,
    actorId: row.actorId,
    targetId: row.targetId,
    action: row.action,
    reason: row.reason ?? "",
    rule: row.rule ?? undefined,
    state: row.state as ModerationCaseState,
    evidence: row.evidence,
    expiresAt: row.expiresAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEvent(row: EventRow): CaseEvent {
  return {
    id: row.id,
    caseId: row.caseId,
    type: row.type,
    actorId: row.actorId ?? undefined,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Postgres implementation of the moderation module's case port.
 *
 * The module never imports these tables. This adapter is the only place that
 * knows how a case is stored, which is what keeps `/mod`, anti-raid and later
 * ticket/AI code sharing one accountability record without sharing SQL.
 */
export class DrizzleCaseStore implements CaseStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async nextCaseNumber(guildId: string): Promise<number> {
    const [row] = await this.db
      .insert(caseCounters)
      .values({ guildId, nextCaseNumber: 2 })
      .onConflictDoUpdate({
        target: caseCounters.guildId,
        set: { nextCaseNumber: sql`${caseCounters.nextCaseNumber} + 1` },
      })
      .returning({ next: caseCounters.nextCaseNumber });

    if (!row) throw new Error("Could not allocate a case number");
    return row.next - 1;
  }

  async create(input: NewModerationCase): Promise<ModerationCase> {
    const [row] = await this.db
      .insert(cases)
      .values({
        guildId: input.guildId,
        caseNumber: input.caseNumber,
        actorId: input.actorId,
        targetId: input.targetId,
        action: input.action,
        reason: input.reason,
        rule: input.rule,
        state: input.state ?? "open",
        evidence: input.evidence,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      })
      .returning();

    if (!row) throw new Error("Could not create a case");
    return toCase(row);
  }

  async get(guildId: string, caseNumber: number): Promise<ModerationCase | undefined> {
    const [row] = await this.db
      .select()
      .from(cases)
      .where(and(eq(cases.guildId, guildId), eq(cases.caseNumber, caseNumber)))
      .limit(1);
    return row ? toCase(row) : undefined;
  }

  async getById(caseId: string): Promise<ModerationCase | undefined> {
    const [row] = await this.db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    return row ? toCase(row) : undefined;
  }

  async list(
    guildId: string,
    filter: { targetId?: string; state?: ModerationCaseState; limit?: number } = {},
  ): Promise<ModerationCase[]> {
    const conditions = [eq(cases.guildId, guildId)];
    if (filter.targetId) conditions.push(eq(cases.targetId, filter.targetId));
    if (filter.state) conditions.push(eq(cases.state, filter.state));

    const rows = await this.db
      .select()
      .from(cases)
      .where(and(...conditions))
      .orderBy(desc(cases.caseNumber))
      .limit(Math.min(Math.max(filter.limit ?? 50, 1), 100));
    return rows.map(toCase);
  }

  async appendEvent(
    caseId: string,
    type: string,
    actorId?: string,
    data?: unknown,
  ): Promise<CaseEvent> {
    const [row] = await this.db
      .insert(caseEvents)
      .values({ caseId, type, actorId, data })
      .returning();

    if (!row) throw new Error("Could not append a case event");
    return toEvent(row);
  }

  async listEvents(caseId: string): Promise<CaseEvent[]> {
    const rows = await this.db
      .select()
      .from(caseEvents)
      .where(eq(caseEvents.caseId, caseId))
      .orderBy(caseEvents.createdAt, caseEvents.id);
    return rows.map(toEvent);
  }

  async updateState(caseId: string, state: ModerationCaseState): Promise<void> {
    await this.db
      .update(cases)
      .set({ state, updatedAt: new Date() })
      .where(eq(cases.id, caseId));
  }

  async updateExpiry(caseId: string, expiresAt: string | null): Promise<ModerationCase | undefined> {
    const [row] = await this.db
      .update(cases)
      .set({ expiresAt: expiresAt ? new Date(expiresAt) : null, updatedAt: new Date() })
      .where(eq(cases.id, caseId))
      .returning();
    return row ? toCase(row) : undefined;
  }

  async claimExpiry(caseId: string): Promise<ModerationCase | undefined> {
    const [row] = await this.db
      .update(cases)
      .set({ expiresAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(cases.id, caseId),
          isNotNull(cases.expiresAt),
          notInArray(cases.state, ["closed", "reversed"]),
        ),
      )
      .returning();
    return row ? toCase(row) : undefined;
  }

  async listDueExpiries(
    guildId: string,
    at: string,
    limit = 100,
  ): Promise<ModerationCase[]> {
    const rows = await this.db
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.guildId, guildId),
          isNotNull(cases.expiresAt),
          lte(cases.expiresAt, new Date(at)),
          notInArray(cases.state, ["closed", "reversed"]),
        ),
      )
      .orderBy(cases.expiresAt)
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map(toCase);
  }

  async listPendingExpiries(
    guildId: string,
    after: string,
    limit = 100,
  ): Promise<ModerationCase[]> {
    const rows = await this.db
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.guildId, guildId),
          isNotNull(cases.expiresAt),
          gt(cases.expiresAt, new Date(after)),
          notInArray(cases.state, ["closed", "reversed"]),
        ),
      )
      .orderBy(cases.expiresAt)
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map(toCase);
  }
}
