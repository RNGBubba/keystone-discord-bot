import { randomUUID } from "node:crypto";
import {
  UserError,
  type ActionRow,
  type CaseEvent,
  type CaseStore,
  type PanelSigner,
  type ModerationCase,
  type ModerationCaseState,
  type NewModerationCase,
} from "@keystone/kernel";

/** The module mints ids; it never parses or verifies them. */
/** A case panel is pinned configuration; a month matches the ticket panel. */
export const APPEAL_PANEL_TTL_MS = 30 * 24 * 60 * 60_000;
/** A DM verification link is a step, not a pinned panel. */
export const VERIFY_PANEL_TTL_MS = 24 * 60 * 60_000;

/**
 * In-memory case store for module tests and local development.
 *
 * It is a real implementation of the same port as Postgres, not a stub: case
 * numbers are allocated, events are append-only, and filters work. A test can
 * therefore prove a command's case/event behaviour without a database.
 */
export class InMemoryCaseStore implements CaseStore {
  readonly #cases = new Map<string, ModerationCase>();
  readonly #events = new Map<string, CaseEvent[]>();
  readonly #counters = new Map<string, number>();

  async nextCaseNumber(guildId: string): Promise<number> {
    const next = this.#counters.get(guildId) ?? 1;
    this.#counters.set(guildId, next + 1);
    return next;
  }

  async create(input: NewModerationCase): Promise<ModerationCase> {
    const now = new Date().toISOString();
    const record: ModerationCase = {
      id: randomUUID(),
      guildId: input.guildId,
      caseNumber: input.caseNumber,
      actorId: input.actorId,
      targetId: input.targetId,
      action: input.action,
      reason: input.reason,
      rule: input.rule,
      state: input.state ?? "open",
      evidence: input.evidence,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.#cases.set(record.id, record);
    return record;
  }

  async get(guildId: string, caseNumber: number): Promise<ModerationCase | undefined> {
    return [...this.#cases.values()].find(
      (record) => record.guildId === guildId && record.caseNumber === caseNumber,
    );
  }

  async getById(caseId: string): Promise<ModerationCase | undefined> {
    return this.#cases.get(caseId);
  }

  async list(
    guildId: string,
    filter: { targetId?: string; state?: ModerationCaseState; limit?: number } = {},
  ): Promise<ModerationCase[]> {
    return [...this.#cases.values()]
      .filter((record) => record.guildId === guildId)
      .filter((record) => !filter.targetId || record.targetId === filter.targetId)
      .filter((record) => !filter.state || record.state === filter.state)
      .sort((a, b) => b.caseNumber - a.caseNumber)
      .slice(0, Math.min(Math.max(filter.limit ?? 50, 1), 100));
  }

  async appendEvent(
    caseId: string,
    type: string,
    actorId?: string,
    data?: unknown,
  ): Promise<CaseEvent> {
    const event: CaseEvent = {
      id: randomUUID(),
      caseId,
      type,
      actorId,
      data,
      createdAt: new Date().toISOString(),
    };
    const existing = this.#events.get(caseId) ?? [];
    this.#events.set(caseId, [...existing, event]);
    return event;
  }

  async listEvents(caseId: string): Promise<CaseEvent[]> {
    return [...(this.#events.get(caseId) ?? [])];
  }

  async updateState(caseId: string, state: ModerationCaseState): Promise<void> {
    const existing = this.#cases.get(caseId);
    if (!existing) return;
    this.#cases.set(caseId, {
      ...existing,
      state,
      updatedAt: new Date().toISOString(),
    });
  }

  async updateExpiry(
    caseId: string,
    expiresAt: string | null,
  ): Promise<ModerationCase | undefined> {
    const existing = this.#cases.get(caseId);
    if (!existing) return undefined;
    const updated: ModerationCase = {
      ...existing,
      expiresAt: expiresAt ?? undefined,
      updatedAt: new Date().toISOString(),
    };
    this.#cases.set(caseId, updated);
    return updated;
  }

  async claimExpiry(caseId: string): Promise<ModerationCase | undefined> {
    const existing = this.#cases.get(caseId);
    if (!existing || !existing.expiresAt) return undefined;
    if (existing.state === "closed" || existing.state === "reversed") return undefined;
    const claimed: ModerationCase = {
      ...existing,
      expiresAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    this.#cases.set(caseId, claimed);
    return claimed;
  }

  async listDueExpiries(
    guildId: string,
    at: string,
    limit = 100,
  ): Promise<ModerationCase[]> {
    const dueAt = new Date(at).getTime();
    return [...this.#cases.values()]
      .filter((record) => record.guildId === guildId)
      .filter((record) => record.expiresAt !== undefined)
      .filter((record) => new Date(record.expiresAt!).getTime() <= dueAt)
      .filter((record) => record.state !== "closed" && record.state !== "reversed")
      .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime())
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }

  async listPendingExpiries(
    guildId: string,
    after: string,
    limit = 100,
  ): Promise<ModerationCase[]> {
    const afterMs = new Date(after).getTime();
    return [...this.#cases.values()]
      .filter((record) => record.guildId === guildId)
      .filter((record) => record.expiresAt !== undefined)
      .filter((record) => new Date(record.expiresAt!).getTime() > afterMs)
      .filter((record) => record.state !== "closed" && record.state !== "reversed")
      .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime())
      .slice(0, Math.min(Math.max(limit, 1), 100));
  }

  /** Read-only helper for the in-memory analytics adapter; not part of the port. */
  records(guildId: string): readonly ModerationCase[] {
    return [...this.#cases.values()].filter((record) => record.guildId === guildId);
  }

  /** Test/read-only helper; the production store reads the same table. */
  events(caseId: string): readonly CaseEvent[] {
    return this.#events.get(caseId) ?? [];
  }
}

export function appealCustomId(caseId: string, signer: PanelSigner, now = Date.now()): string {
  return signer.sign(
    { namespace: "appeal", action: "open", payload: caseId, ttlMs: APPEAL_PANEL_TTL_MS },
    now,
  );
}

/**
 * A DM verification has no interaction guild, so the id itself must name the
 * guild and the member it belongs to. The signed payload is `<guild>_<user>`:
 * 39 characters for two 19-digit snowflakes, inside the signer's 40-character
 * budget, and `_` is used because the id format itself splits on `:`.
 */
export function verifyCustomId(
  guildId: string,
  userId: string,
  signer: PanelSigner,
  now = Date.now(),
): string {
  const payload = `${guildId}_${userId}`;
  return signer.sign(
    { namespace: "verify", action: "complete", payload, ttlMs: VERIFY_PANEL_TTL_MS },
    now,
  );
}

/** Decode the signed pair; anything that is not exactly two parts is invalid. */
export function parseVerifyPayload(
  payload: string,
): { readonly guildId: string; readonly userId: string } | undefined {
  const parts = payload.split("_");
  if (parts.length !== 2) return undefined;
  const [guildId, userId] = parts;
  if (!guildId || !userId) return undefined;
  return { guildId, userId };
}

export function appealButton(
  caseId: string,
  signer: PanelSigner,
  now = Date.now(),
): ActionRow {
  return {
    type: "action-row",
    components: [
      {
        type: "button",
        customId: appealCustomId(caseId, signer, now),
        label: "Appeal this case",
        style: "primary",
      },
    ],
  };
}

export function verifyButton(
  guildId: string,
  userId: string,
  signer: PanelSigner,
  now = Date.now(),
): ActionRow {
  return {
    type: "action-row",
    components: [
      {
        type: "button",
        customId: verifyCustomId(guildId, userId, signer, now),
        label: "Verify and join",
        style: "success",
      },
    ],
  };
}

/**
 * Case operations, independent of Discord and SQL.
 *
 * Every punitive action goes through `open`, so no action can exist without a
 * case number, a reason and an append-only `created` event. Appeals are new
 * events, never edits to history.
 */
export interface CaseServiceOptions {
  /** Best-effort observer. It must not be able to block case creation. */
  readonly onOpened?: (record: ModerationCase) => void;
}

export class CaseService {
  constructor(
    private readonly store: CaseStore,
    private readonly options: CaseServiceOptions = {},
  ) {}

  async open(input: Omit<NewModerationCase, "caseNumber">): Promise<ModerationCase> {
    const caseNumber = await this.store.nextCaseNumber(input.guildId);
    const record = await this.store.create({ ...input, caseNumber });
    await this.store.appendEvent(record.id, "created", input.actorId, {
      action: record.action,
      reason: record.reason,
      rule: record.rule,
      evidence: record.evidence,
    });
    try {
      this.options.onOpened?.(record);
    } catch {
      // An audit observer is not part of the case transaction. A broken log
      // destination must not make moderation fail.
    }
    return record;
  }

  get(guildId: string, caseNumber: number): Promise<ModerationCase | undefined> {
    return this.store.get(guildId, caseNumber);
  }

  getById(caseId: string): Promise<ModerationCase | undefined> {
    return this.store.getById(caseId);
  }

  list(
    guildId: string,
    filter?: { targetId?: string; state?: ModerationCaseState; limit?: number },
  ): Promise<ModerationCase[]> {
    return this.store.list(guildId, filter);
  }

  async note(caseId: string, actorId: string, note: string): Promise<CaseEvent> {
    if (!note.trim()) throw new UserError("A note cannot be empty.");
    const record = await this.store.getById(caseId);
    if (!record) throw new UserError("That case does not exist.");
    return this.store.appendEvent(caseId, "note", actorId, { note: note.slice(0, 2_000) });
  }

  async review(caseId: string, actorId: string): Promise<ModerationCase> {
    const record = await this.store.getById(caseId);
    if (!record) throw new UserError("That case does not exist.");
    await this.store.appendEvent(caseId, "reviewed", actorId);
    await this.store.updateState(caseId, "reviewed");
    return { ...record, state: "reviewed" };
  }

  listEvents(caseId: string): Promise<CaseEvent[]> {
    return this.store.listEvents(caseId);
  }

  async setState(caseId: string, state: ModerationCaseState): Promise<void> {
    await this.store.updateState(caseId, state);
  }

  async setExpiry(caseId: string, expiresAt: string): Promise<ModerationCase | undefined> {
    return this.store.updateExpiry(caseId, expiresAt);
  }

  async claimExpiry(caseId: string): Promise<ModerationCase | undefined> {
    return this.store.claimExpiry(caseId);
  }

  async expire(caseId: string, actorId: string, detail: string): Promise<ModerationCase | undefined> {
    const record = await this.store.getById(caseId);
    if (!record) return undefined;
    if (record.state === "closed" || record.state === "reversed") return record;
    await this.store.appendEvent(caseId, "expired", actorId, { detail });
    await this.store.updateState(caseId, "closed");
    return { ...record, state: "closed", updatedAt: new Date().toISOString() };
  }

  listDueExpiries(guildId: string, at: string, limit?: number): Promise<ModerationCase[]> {
    return this.store.listDueExpiries(guildId, at, limit);
  }

  listPendingExpiries(guildId: string, after: string, limit?: number): Promise<ModerationCase[]> {
    return this.store.listPendingExpiries(guildId, after, limit);
  }

  async appealByNumber(
    guildId: string,
    caseNumber: number,
    actorId: string,
    message: string,
  ): Promise<ModerationCase> {
    const record = await this.store.get(guildId, caseNumber);
    if (!record) throw new UserError("That case does not exist.");
    return this.appeal(record, actorId, message);
  }

  async appealById(caseId: string, actorId: string, message: string): Promise<ModerationCase> {
    const record = await this.store.getById(caseId);
    if (!record) throw new UserError("That case does not exist.");
    return this.appeal(record, actorId, message);
  }

  private async appeal(
    record: ModerationCase,
    actorId: string,
    message: string,
  ): Promise<ModerationCase> {
    if (record.targetId !== actorId) {
      throw new UserError("You can only appeal a case against you.");
    }
    if (record.state === "reversed" || record.state === "closed") {
      throw new UserError("That case is already final and cannot be appealed.");
    }

    await this.store.appendEvent(record.id, "appealed", actorId, {
      message: message.trim().slice(0, 2_000),
    });
    await this.store.updateState(record.id, "appealed");
    return { ...record, state: "appealed" };
  }
}
