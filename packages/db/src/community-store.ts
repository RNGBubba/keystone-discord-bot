import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type {
  CommunityRecord,
  CommunityStore,
  LedgerEntry,
  LedgerInput,
  LedgerResult,
  LevelProfile,
  NewTicket,
  ResetLevelsResult,
  TicketEventRecord,
  TicketRecord,
  TicketState,
  SpendInput,
  SpendResult,
  TransferInput,
  TransferResult,
  XpAwardInput,
  XpAwardResult,
} from "@keystone/kernel";
import {
  communityRecords,
  economyLedger,
  guilds,
  levels,
  tickets,
  xpEvents,
} from "./schema";
import type { schema } from "./schema";

type ProfileRow = typeof levels.$inferSelect;
type LedgerRow = typeof economyLedger.$inferSelect;
type TicketRow = typeof tickets.$inferSelect;
type RecordRow = typeof communityRecords.$inferSelect;

const nowIso = (): string => new Date().toISOString();

function toProfile(row: ProfileRow): LevelProfile {
  return {
    guildId: row.guildId,
    userId: row.userId,
    xp: Number(row.xp),
    level: row.level,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function emptyProfile(guildId: string, userId: string): LevelProfile {
  return { guildId, userId, xp: 0, level: 0, updatedAt: nowIso() };
}

function toLedger(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    guildId: row.guildId,
    userId: row.userId,
    amount: Number(row.amount),
    reason: row.reason,
    actorId: row.actorId ?? undefined,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTicket(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    channelId: row.channelId,
    openerId: row.openerId,
    claimerId: row.claimerId ?? undefined,
    state: row.state as TicketState,
    subject: row.subject ?? "",
    slaDueAt: row.slaDueAt?.toISOString(),
    closedAt: row.closedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRecord<T>(row: RecordRow): CommunityRecord<T> {
  return {
    guildId: row.guildId,
    kind: row.kind,
    key: row.key,
    data: row.data as T,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Postgres adapter for the P3 community port. Modules never import this file. */
export class DrizzleCommunityStore implements CommunityStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async getLevel(guildId: string, userId: string): Promise<LevelProfile | undefined> {
    const [row] = await this.db
      .select()
      .from(levels)
      .where(and(eq(levels.guildId, guildId), eq(levels.userId, userId)))
      .limit(1);
    return row ? toProfile(row) : undefined;
  }

  async awardXp(input: XpAwardInput): Promise<XpAwardResult> {
    return this.db.transaction(async (tx) => {
      const [event] = await tx
        .insert(xpEvents)
        .values({
          guildId: input.guildId,
          userId: input.userId,
          amount: input.amount,
          source: input.source,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing({ target: xpEvents.idempotencyKey })
        .returning({ id: xpEvents.id });

      const [existing] = await tx
        .select()
        .from(levels)
        .where(and(eq(levels.guildId, input.guildId), eq(levels.userId, input.userId)))
        .limit(1);

      if (!event) {
        return {
          inserted: false,
          profile: existing ? toProfile(existing) : emptyProfile(input.guildId, input.userId),
        };
      }

      const [row] = await tx
        .insert(levels)
        .values({
          guildId: input.guildId,
          userId: input.userId,
          xp: input.amount,
          level: 0,
        })
        .onConflictDoUpdate({
          target: [levels.guildId, levels.userId],
          set: {
            xp: sql`${levels.xp} + ${input.amount}`,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!row) throw new Error("Could not project XP");
      return { inserted: true, profile: toProfile(row) };
    });
  }

  async setLevel(
    guildId: string,
    userId: string,
    level: number,
    xp: number,
  ): Promise<LevelProfile> {
    const [row] = await this.db
      .insert(levels)
      .values({ guildId, userId, level, xp })
      .onConflictDoUpdate({
        target: [levels.guildId, levels.userId],
        set: { level, xp, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("Could not set level");
    return toProfile(row);
  }

  async resetLevels(guildId: string, seasonKey: string): Promise<ResetLevelsResult> {
    return this.db.transaction(async (tx) => {
      const [marker] = await tx
        .select({ key: communityRecords.key })
        .from(communityRecords)
        .where(
          and(
            eq(communityRecords.guildId, guildId),
            eq(communityRecords.kind, "xp_season_marker"),
            eq(communityRecords.key, seasonKey),
          ),
        )
        .limit(1);
      if (marker) return { archived: 0, alreadyReset: true };

      const profiles = await tx.select().from(levels).where(eq(levels.guildId, guildId));
      for (const profile of profiles) {
        await tx.insert(communityRecords).values({
          guildId,
          kind: "xp_season_archive",
          key: `${seasonKey}:${profile.userId}`,
          data: { seasonKey, ...toProfile(profile), archivedAt: nowIso() },
        });
      }
      await tx.insert(communityRecords).values({
        guildId,
        kind: "xp_season_marker",
        key: seasonKey,
        data: { seasonKey, archived: profiles.length, archivedAt: nowIso() },
      });
      if (profiles.length > 0) {
        await tx.delete(levels).where(eq(levels.guildId, guildId));
      }
      return { archived: profiles.length, alreadyReset: false };
    });
  }

  async topLevels(guildId: string, limit: number): Promise<LevelProfile[]> {
    const rows = await this.db
      .select()
      .from(levels)
      .where(eq(levels.guildId, guildId))
      .orderBy(desc(levels.xp))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map(toProfile);
  }

  async getBalance(guildId: string, userId: string): Promise<number> {
    const [row] = await this.db
      .select({ balance: sql<number>`coalesce(sum(${economyLedger.amount}), 0)` })
      .from(economyLedger)
      .where(and(eq(economyLedger.guildId, guildId), eq(economyLedger.userId, userId)));
    return Number(row?.balance ?? 0);
  }

  async addLedger(input: LedgerInput): Promise<LedgerResult> {
    const [row] = await this.db
      .insert(economyLedger)
      .values({
        guildId: input.guildId,
        userId: input.userId,
        amount: input.amount,
        reason: input.reason,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({ target: economyLedger.idempotencyKey })
      .returning({ id: economyLedger.id });
    const balance = await this.getBalance(input.guildId, input.userId);
    return { inserted: Boolean(row), balance };
  }

  async spend(input: SpendInput): Promise<SpendResult> {
    return this.db.transaction(async (tx) => {
      await this.lockGuild(tx, input.guildId);
      const [existing] = await tx
        .select({ id: economyLedger.id })
        .from(economyLedger)
        .where(eq(economyLedger.idempotencyKey, input.idempotencyKey))
        .limit(1);
      const balance = await this.balanceIn(tx, input.guildId, input.userId);
      if (existing) return { ok: true, inserted: false, balance };
      if (!Number.isInteger(input.amount) || input.amount <= 0) {
        return {
          ok: false,
          inserted: false,
          balance,
          reason: "Amount must be a positive whole number.",
        };
      }
      if (balance < input.amount) {
        return { ok: false, inserted: false, balance, reason: "Not enough currency." };
      }
      await tx.insert(economyLedger).values({
        guildId: input.guildId,
        userId: input.userId,
        amount: -input.amount,
        reason: input.reason,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
      });
      return { ok: true, inserted: true, balance: balance - input.amount };
    });
  }

  async transfer(input: TransferInput): Promise<TransferResult> {
    return this.db.transaction(async (tx) => {
      await this.lockGuild(tx, input.guildId);
      const [fromRow] = await tx
        .select({ balance: sql<number>`coalesce(sum(${economyLedger.amount}), 0)` })
        .from(economyLedger)
        .where(
          and(
            eq(economyLedger.guildId, input.guildId),
            eq(economyLedger.userId, input.fromUserId),
          ),
        );
      const fromBalance = Number(fromRow?.balance ?? 0);

      const [existing] = await tx
        .select({ id: economyLedger.id })
        .from(economyLedger)
        .where(eq(economyLedger.idempotencyKey, `${input.idempotencyKey}:out`))
        .limit(1);
      if (existing) {
        const [toRow] = await tx
          .select({ balance: sql<number>`coalesce(sum(${economyLedger.amount}), 0)` })
          .from(economyLedger)
          .where(
            and(
              eq(economyLedger.guildId, input.guildId),
              eq(economyLedger.userId, input.toUserId),
            ),
          );
        return {
          ok: true,
          fromBalance,
          toBalance: Number(toRow?.balance ?? 0),
        };
      }

      if (fromBalance < input.amount) {
        return {
          ok: false,
          fromBalance,
          toBalance: await this.balanceIn(tx, input.guildId, input.toUserId),
          reason: "Not enough currency for that transfer.",
        };
      }

      await tx.insert(economyLedger).values([
        {
          guildId: input.guildId,
          userId: input.fromUserId,
          amount: -input.amount,
          reason: input.reason,
          idempotencyKey: `${input.idempotencyKey}:out`,
        },
        {
          guildId: input.guildId,
          userId: input.toUserId,
          amount: input.amount,
          reason: input.reason,
          idempotencyKey: `${input.idempotencyKey}:in`,
        },
      ]);

      return {
        ok: true,
        fromBalance: fromBalance - input.amount,
        toBalance: await this.balanceIn(tx, input.guildId, input.toUserId),
      };
    });
  }

  private async balanceIn(
    tx: PgDatabase<any, typeof schema>,
    guildId: string,
    userId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ balance: sql<number>`coalesce(sum(${economyLedger.amount}), 0)` })
      .from(economyLedger)
      .where(and(eq(economyLedger.guildId, guildId), eq(economyLedger.userId, userId)));
    return Number(row?.balance ?? 0);
  }

  /** Serialize balance checks and writes for one guild across concurrent calls. */
  private async lockGuild(tx: PgDatabase<any, typeof schema>, guildId: string): Promise<void> {
    await tx.insert(guilds).values({ id: guildId }).onConflictDoNothing();
    await tx.select({ id: guilds.id }).from(guilds).where(eq(guilds.id, guildId)).for("update");
  }

  async listLedger(guildId: string, userId: string, limit: number): Promise<LedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(economyLedger)
      .where(and(eq(economyLedger.guildId, guildId), eq(economyLedger.userId, userId)))
      .orderBy(desc(economyLedger.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map(toLedger);
  }

  async topBalances(
    guildId: string,
    limit: number,
  ): Promise<{ userId: string; balance: number }[]> {
    const rows = await this.db
      .select({
        userId: economyLedger.userId,
        balance: sql<number>`sum(${economyLedger.amount})`,
      })
      .from(economyLedger)
      .where(eq(economyLedger.guildId, guildId))
      .groupBy(economyLedger.userId)
      .orderBy(desc(sql`sum(${economyLedger.amount})`))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map((row) => ({ userId: row.userId, balance: Number(row.balance) }));
  }

  async createTicket(input: NewTicket): Promise<TicketRecord> {
    const [row] = await this.db
      .insert(tickets)
      .values({
        guildId: input.guildId,
        channelId: input.channelId,
        openerId: input.openerId,
        subject: input.subject,
        slaDueAt: input.slaDueAt ? new Date(input.slaDueAt) : undefined,
      })
      .returning();
    if (!row) throw new Error("Could not create a ticket");
    return toTicket(row);
  }

  async getTicket(guildId: string, ticketId: string): Promise<TicketRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, ticketId)))
      .limit(1);
    return row ? toTicket(row) : undefined;
  }

  async listTickets(
    guildId: string,
    filter: { openerId?: string; state?: TicketState; limit?: number } = {},
  ): Promise<TicketRecord[]> {
    const conditions = [eq(tickets.guildId, guildId)];
    if (filter.openerId) conditions.push(eq(tickets.openerId, filter.openerId));
    if (filter.state) conditions.push(eq(tickets.state, filter.state));
    const rows = await this.db
      .select()
      .from(tickets)
      .where(and(...conditions))
      .orderBy(desc(tickets.createdAt))
      .limit(Math.min(Math.max(filter.limit ?? 50, 1), 100));
    return rows.map(toTicket);
  }

  async updateTicket(
    guildId: string,
    ticketId: string,
    patch: { claimerId?: string | null; state?: TicketState; closedAt?: string | null },
  ): Promise<TicketRecord | undefined> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.claimerId !== undefined) values.claimerId = patch.claimerId;
    if (patch.state !== undefined) values.state = patch.state;
    if (patch.closedAt !== undefined) {
      values.closedAt = patch.closedAt ? new Date(patch.closedAt) : null;
    }
    const [row] = await this.db
      .update(tickets)
      .set(values)
      .where(and(eq(tickets.guildId, guildId), eq(tickets.id, ticketId)))
      .returning();
    return row ? toTicket(row) : undefined;
  }

  async appendTicketEvent(
    guildId: string,
    ticketId: string,
    type: string,
    actorId?: string,
    data?: unknown,
  ): Promise<TicketEventRecord> {
    const id = randomUUID();
    await this.db.insert(communityRecords).values({
      guildId,
      kind: "ticket_event",
      key: id,
      data: { ticketId, type, actorId, data },
    });
    return {
      id,
      ticketId,
      type,
      actorId,
      data,
      createdAt: nowIso(),
    };
  }

  async listTicketEvents(guildId: string, ticketId: string): Promise<TicketEventRecord[]> {
    const rows = await this.db
      .select()
      .from(communityRecords)
      .where(
        and(
          eq(communityRecords.guildId, guildId),
          eq(communityRecords.kind, "ticket_event"),
          sql`${communityRecords.data}->>'ticketId' = ${ticketId}`,
        ),
      )
      .orderBy(communityRecords.createdAt);
    return rows.map((row) => {
      const data = row.data as {
        ticketId: string;
        type: string;
        actorId?: string;
        data?: unknown;
      };
      return {
        id: row.key,
        ticketId: data.ticketId,
        type: data.type,
        actorId: data.actorId,
        data: data.data,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async getRecord<T>(
    guildId: string,
    kind: string,
    key: string,
  ): Promise<CommunityRecord<T> | undefined> {
    const [row] = await this.db
      .select()
      .from(communityRecords)
      .where(
        and(
          eq(communityRecords.guildId, guildId),
          eq(communityRecords.kind, kind),
          eq(communityRecords.key, key),
        ),
      )
      .limit(1);
    return row ? toRecord<T>(row) : undefined;
  }

  async putRecord<T>(
    guildId: string,
    kind: string,
    key: string,
    data: T,
  ): Promise<CommunityRecord<T>> {
    const [row] = await this.db
      .insert(communityRecords)
      .values({ guildId, kind, key, data })
      .onConflictDoUpdate({
        target: [communityRecords.guildId, communityRecords.kind, communityRecords.key],
        set: { data, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("Could not write a community record");
    return toRecord<T>(row);
  }

  async claimSent<T>(
    guildId: string,
    kind: string,
    key: string,
  ): Promise<CommunityRecord<T> | undefined> {
    // The predicate is part of the UPDATE, not a read followed by a write, so
    // the timer and the 60-second sweep cannot both win and send twice.
    const [row] = await this.db
      .update(communityRecords)
      .set({
        data: sql`jsonb_set(${communityRecords.data}, '{sent}', 'true'::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(communityRecords.guildId, guildId),
          eq(communityRecords.kind, kind),
          eq(communityRecords.key, key),
          sql`coalesce(${communityRecords.data} ->> 'sent', 'false') <> 'true'`,
        ),
      )
      .returning();
    return row ? toRecord<T>(row) : undefined;
  }

  async listRecords<T>(
    guildId: string,
    kind: string,
    limit = 50,
  ): Promise<CommunityRecord<T>[]> {
    const rows = await this.db
      .select()
      .from(communityRecords)
      .where(and(eq(communityRecords.guildId, guildId), eq(communityRecords.kind, kind)))
      .orderBy(desc(communityRecords.updatedAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map((row) => toRecord<T>(row));
  }

  async deleteRecord(guildId: string, kind: string, key: string): Promise<void> {
    await this.db
      .delete(communityRecords)
      .where(
        and(
          eq(communityRecords.guildId, guildId),
          eq(communityRecords.kind, kind),
          eq(communityRecords.key, key),
        ),
      );
  }
}
