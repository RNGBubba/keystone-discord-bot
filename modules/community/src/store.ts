import { randomUUID } from "node:crypto";
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

const nowIso = (): string => new Date().toISOString();

/** The event that produced an XP projection. The in-memory store keeps it so
 * `/export` can be truthful in memory mode; Postgres already stores the row. */
export interface XpEventRecord {
  readonly id: string;
  readonly guildId: string;
  readonly userId: string;
  readonly amount: number;
  readonly source: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

/**
 * In-memory implementation of the community port. It is a real store, not a
 * mock: idempotency keys, balances, ticket events and record scoping behave the
 * same way as Postgres. Tests use it to prove command/service behaviour without
 * a database; production swaps the Postgres adapter behind the same port.
 */
export class InMemoryCommunityStore implements CommunityStore {
  readonly #levels = new Map<string, LevelProfile>();
  readonly #xpKeys = new Set<string>();
  readonly #xpEvents: XpEventRecord[] = [];
  readonly #ledger: LedgerEntry[] = [];
  readonly #ledgerKeys = new Map<string, string>();
  readonly #tickets = new Map<string, TicketRecord>();
  readonly #ticketEvents: TicketEventRecord[] = [];
  readonly #records = new Map<string, CommunityRecord<unknown>>();
  #economyQueue: Promise<void> = Promise.resolve();

  /** Serialize every money mutation in this store; PGlite/Postgres does it with a row lock. */
  #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#economyQueue.then(fn, fn);
    this.#economyQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async getLevel(guildId: string, userId: string): Promise<LevelProfile | undefined> {
    return this.#levels.get(`${guildId}:${userId}`);
  }

  async awardXp(input: XpAwardInput): Promise<XpAwardResult> {
    const existing = this.#levels.get(`${input.guildId}:${input.userId}`) ?? {
      guildId: input.guildId,
      userId: input.userId,
      xp: 0,
      level: 0,
      updatedAt: nowIso(),
    };
    if (this.#xpKeys.has(input.idempotencyKey)) {
      return { inserted: false, profile: existing };
    }
    this.#xpKeys.add(input.idempotencyKey);
    this.#xpEvents.push({
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      amount: input.amount,
      source: input.source,
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso(),
    });
    const profile: LevelProfile = {
      ...existing,
      xp: existing.xp + input.amount,
      updatedAt: nowIso(),
    };
    this.#levels.set(`${input.guildId}:${input.userId}`, profile);
    return { inserted: true, profile };
  }

  async setLevel(
    guildId: string,
    userId: string,
    level: number,
    xp: number,
  ): Promise<LevelProfile> {
    const profile = { guildId, userId, level, xp, updatedAt: nowIso() };
    this.#levels.set(`${guildId}:${userId}`, profile);
    return profile;
  }

  async resetLevels(guildId: string, seasonKey: string): Promise<ResetLevelsResult> {
    const marker = await this.getRecord(guildId, "xp_season_marker", seasonKey);
    if (marker) return { archived: 0, alreadyReset: true };
    const profiles = [...this.#levels.values()].filter((profile) => profile.guildId === guildId);
    for (const profile of profiles) {
      await this.putRecord(guildId, "xp_season_archive", `${seasonKey}:${profile.userId}`, {
        seasonKey,
        ...profile,
        archivedAt: nowIso(),
      });
      this.#levels.delete(`${guildId}:${profile.userId}`);
    }
    await this.putRecord(guildId, "xp_season_marker", seasonKey, {
      seasonKey,
      archived: profiles.length,
      archivedAt: nowIso(),
    });
    return { archived: profiles.length, alreadyReset: false };
  }

  async topLevels(guildId: string, limit: number): Promise<LevelProfile[]> {
    return [...this.#levels.values()]
      .filter((profile) => profile.guildId === guildId)
      .sort((a, b) => b.xp - a.xp)
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }

  async getBalance(guildId: string, userId: string): Promise<number> {
    return this.#ledger
      .filter((entry) => entry.guildId === guildId && entry.userId === userId)
      .reduce((sum, entry) => sum + entry.amount, 0);
  }

  async addLedger(input: LedgerInput): Promise<LedgerResult> {
    return this.#exclusive(() => this.#addLedger(input));
  }

  async #addLedger(input: LedgerInput): Promise<LedgerResult> {
    const existing = this.#ledgerKeys.get(input.idempotencyKey);
    if (existing) {
      return {
        inserted: false,
        balance: await this.getBalance(input.guildId, input.userId),
      };
    }
    const entry: LedgerEntry = {
      id: randomUUID(),
      ...input,
      createdAt: nowIso(),
    };
    this.#ledger.push(entry);
    this.#ledgerKeys.set(input.idempotencyKey, entry.id);
    return {
      inserted: true,
      balance: await this.getBalance(input.guildId, input.userId),
    };
  }

  async spend(input: SpendInput): Promise<SpendResult> {
    return this.#exclusive(async () => {
      const balance = await this.getBalance(input.guildId, input.userId);
      if (this.#ledgerKeys.has(input.idempotencyKey)) {
        return { ok: true, inserted: false, balance };
      }
      if (!Number.isInteger(input.amount) || input.amount <= 0) {
        return { ok: false, inserted: false, balance, reason: "Amount must be a positive whole number." };
      }
      if (balance < input.amount) {
        return { ok: false, inserted: false, balance, reason: "Not enough currency." };
      }
      await this.#addLedger({
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
    return this.#exclusive(async () => {
      const existing = this.#ledgerKeys.get(`${input.idempotencyKey}:out`);
      if (existing) {
        return {
          ok: true,
          fromBalance: await this.getBalance(input.guildId, input.fromUserId),
          toBalance: await this.getBalance(input.guildId, input.toUserId),
        };
      }
      const fromBalance = await this.getBalance(input.guildId, input.fromUserId);
      const toBalance = await this.getBalance(input.guildId, input.toUserId);
      if (fromBalance < input.amount) {
        return { ok: false, fromBalance, toBalance, reason: "Not enough currency." };
      }
      await this.#addLedger({
        guildId: input.guildId,
        userId: input.fromUserId,
        amount: -input.amount,
        reason: input.reason,
        idempotencyKey: `${input.idempotencyKey}:out`,
      });
      await this.#addLedger({
        guildId: input.guildId,
        userId: input.toUserId,
        amount: input.amount,
        reason: input.reason,
        idempotencyKey: `${input.idempotencyKey}:in`,
      });
      return {
        ok: true,
        fromBalance: fromBalance - input.amount,
        toBalance: toBalance + input.amount,
      };
    });
  }

  async listLedger(guildId: string, userId: string, limit: number): Promise<LedgerEntry[]> {
    return this.#ledger
      .filter((entry) => entry.guildId === guildId && entry.userId === userId)
      .slice(-Math.min(Math.max(limit, 1), 100))
      .reverse();
  }

  async topBalances(
    guildId: string,
    limit: number,
  ): Promise<{ userId: string; balance: number }[]> {
    const balances = new Map<string, number>();
    for (const entry of this.#ledger.filter((row) => row.guildId === guildId)) {
      balances.set(entry.userId, (balances.get(entry.userId) ?? 0) + entry.amount);
    }
    return [...balances.entries()]
      .map(([userId, balance]) => ({ userId, balance }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }

  async createTicket(input: NewTicket): Promise<TicketRecord> {
    const at = nowIso();
    const ticket: TicketRecord = {
      id: randomUUID(),
      guildId: input.guildId,
      channelId: input.channelId,
      openerId: input.openerId,
      state: "open",
      subject: input.subject,
      slaDueAt: input.slaDueAt,
      createdAt: at,
      updatedAt: at,
    };
    this.#tickets.set(ticket.id, ticket);
    return ticket;
  }

  async getTicket(guildId: string, ticketId: string): Promise<TicketRecord | undefined> {
    const ticket = this.#tickets.get(ticketId);
    return ticket?.guildId === guildId ? ticket : undefined;
  }

  async listTickets(
    guildId: string,
    filter: { openerId?: string; state?: TicketState; limit?: number } = {},
  ): Promise<TicketRecord[]> {
    return [...this.#tickets.values()]
      .filter((ticket) => ticket.guildId === guildId)
      .filter((ticket) => !filter.openerId || ticket.openerId === filter.openerId)
      .filter((ticket) => !filter.state || ticket.state === filter.state)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(Math.max(filter.limit ?? 50, 1), 100));
  }

  /** Read-only helper for the in-memory analytics adapter; not part of the port. */
  tickets(guildId: string): readonly TicketRecord[] {
    return [...this.#tickets.values()].filter((ticket) => ticket.guildId === guildId);
  }

  /** Read-only helpers for the in-memory export adapter; not part of the port. */
  allLevels(guildId: string): readonly LevelProfile[] {
    return [...this.#levels.values()].filter((profile) => profile.guildId === guildId);
  }

  allXpEvents(guildId: string): readonly XpEventRecord[] {
    return this.#xpEvents.filter((event) => event.guildId === guildId);
  }

  allLedger(guildId: string): readonly LedgerEntry[] {
    return this.#ledger.filter((entry) => entry.guildId === guildId);
  }

  allRecords(guildId: string): readonly CommunityRecord<unknown>[] {
    return [...this.#records.values()].filter((record) => record.guildId === guildId);
  }

  async updateTicket(
    guildId: string,
    ticketId: string,
    patch: { claimerId?: string | null; state?: TicketState; closedAt?: string | null },
  ): Promise<TicketRecord | undefined> {
    const existing = await this.getTicket(guildId, ticketId);
    if (!existing) return undefined;
    const updated: TicketRecord = {
      ...existing,
      claimerId: patch.claimerId === null ? undefined : (patch.claimerId ?? existing.claimerId),
      state: patch.state ?? existing.state,
      closedAt: patch.closedAt === null ? undefined : (patch.closedAt ?? existing.closedAt),
      updatedAt: nowIso(),
    };
    this.#tickets.set(ticketId, updated);
    return updated;
  }

  async appendTicketEvent(
    guildId: string,
    ticketId: string,
    type: string,
    actorId?: string,
    data?: unknown,
  ): Promise<TicketEventRecord> {
    const event: TicketEventRecord = {
      id: randomUUID(),
      ticketId,
      type,
      actorId,
      data,
      createdAt: nowIso(),
    };
    this.#ticketEvents.push(event);
    return event;
  }

  async listTicketEvents(guildId: string, ticketId: string): Promise<TicketEventRecord[]> {
    return this.#ticketEvents.filter((event) => event.ticketId === ticketId);
  }

  async getRecord<T>(
    guildId: string,
    kind: string,
    key: string,
  ): Promise<CommunityRecord<T> | undefined> {
    return this.#records.get(`${guildId}:${kind}:${key}`) as
      | CommunityRecord<T>
      | undefined;
  }

  async putRecord<T>(
    guildId: string,
    kind: string,
    key: string,
    data: T,
  ): Promise<CommunityRecord<T>> {
    const existing = this.#records.get(`${guildId}:${kind}:${key}`);
    const at = nowIso();
    const record: CommunityRecord<T> = {
      guildId,
      kind,
      key,
      data,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    this.#records.set(`${guildId}:${kind}:${key}`, record);
    return record;
  }

  async claimSent<T>(
    guildId: string,
    kind: string,
    key: string,
  ): Promise<CommunityRecord<T> | undefined> {
    const existing = this.#records.get(`${guildId}:${kind}:${key}`) as
      | CommunityRecord<T>
      | undefined;
    if (!existing) return undefined;
    const data = existing.data as { sent?: unknown } | null;
    if (typeof data !== "object" || data === null) return undefined;
    if (data.sent === true) return undefined;
    return this.putRecord(guildId, kind, key, { ...data, sent: true } as T);
  }

  async listRecords<T>(
    guildId: string,
    kind: string,
    limit = 50,
  ): Promise<CommunityRecord<T>[]> {
    return [...this.#records.values()]
      .filter((record) => record.guildId === guildId && record.kind === kind)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.min(Math.max(limit, 1), 100)) as CommunityRecord<T>[];
  }

  async deleteRecord(guildId: string, kind: string, key: string): Promise<void> {
    this.#records.delete(`${guildId}:${kind}:${key}`);
  }
}
