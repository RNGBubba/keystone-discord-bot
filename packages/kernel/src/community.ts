/** Structural community types. No discord.js, no Drizzle, no network. */

export interface LevelProfile {
  readonly guildId: string;
  readonly userId: string;
  readonly xp: number;
  readonly level: number;
  readonly updatedAt: string;
}

export interface XpAwardInput {
  readonly guildId: string;
  readonly userId: string;
  readonly amount: number;
  readonly source: string;
  readonly idempotencyKey: string;
}

export interface XpAwardResult {
  readonly inserted: boolean;
  readonly profile: LevelProfile;
}

export interface ResetLevelsResult {
  readonly archived: number;
  readonly alreadyReset: boolean;
}

export interface LedgerEntry {
  readonly id: string;
  readonly guildId: string;
  readonly userId: string;
  readonly amount: number;
  readonly reason: string;
  readonly actorId?: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface LedgerInput {
  readonly guildId: string;
  readonly userId: string;
  readonly amount: number;
  readonly reason: string;
  readonly actorId?: string;
  readonly idempotencyKey: string;
}

export interface LedgerResult {
  readonly inserted: boolean;
  readonly balance: number;
}

export interface TransferInput {
  readonly guildId: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly amount: number;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface TransferResult {
  readonly ok: boolean;
  readonly fromBalance: number;
  readonly toBalance: number;
  readonly reason?: string;
}

/** A checked debit. The store, not the command, decides whether funds exist. */
export interface SpendInput {
  readonly guildId: string;
  readonly userId: string;
  readonly amount: number;
  readonly reason: string;
  readonly actorId?: string;
  readonly idempotencyKey: string;
}

export interface SpendResult {
  readonly ok: boolean;
  readonly inserted: boolean;
  readonly balance: number;
  readonly reason?: string;
}

export type TicketState = "open" | "claimed" | "closed";

export interface TicketRecord {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly openerId: string;
  readonly claimerId?: string;
  readonly state: TicketState;
  readonly subject: string;
  readonly slaDueAt?: string;
  readonly closedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewTicket {
  readonly guildId: string;
  readonly channelId: string;
  readonly openerId: string;
  readonly subject: string;
  readonly slaDueAt?: string;
}

export interface TicketEventRecord {
  readonly id: string;
  readonly ticketId: string;
  readonly type: string;
  readonly actorId?: string;
  readonly data?: unknown;
  readonly createdAt: string;
}

export interface CommunityRecord<T = unknown> {
  readonly guildId: string;
  readonly kind: string;
  readonly key: string;
  readonly data: T;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The persistence surface P3 services own; no module sees a SQL table. */
export interface CommunityStore {
  getLevel(guildId: string, userId: string): Promise<LevelProfile | undefined>;
  awardXp(input: XpAwardInput): Promise<XpAwardResult>;
  setLevel(guildId: string, userId: string, level: number, xp: number): Promise<LevelProfile>;
  /** Archive the current XP projection under a season key, then clear it. */
  resetLevels(guildId: string, seasonKey: string): Promise<ResetLevelsResult>;
  topLevels(guildId: string, limit: number): Promise<LevelProfile[]>;
  getBalance(guildId: string, userId: string): Promise<number>;
  addLedger(input: LedgerInput): Promise<LedgerResult>;
  spend(input: SpendInput): Promise<SpendResult>;
  transfer(input: TransferInput): Promise<TransferResult>;
  listLedger(guildId: string, userId: string, limit: number): Promise<LedgerEntry[]>;
  topBalances(guildId: string, limit: number): Promise<{ userId: string; balance: number }[]>;
  createTicket(input: NewTicket): Promise<TicketRecord>;
  getTicket(guildId: string, ticketId: string): Promise<TicketRecord | undefined>;
  listTickets(
    guildId: string,
    filter?: { openerId?: string; state?: TicketState; limit?: number },
  ): Promise<TicketRecord[]>;
  updateTicket(
    guildId: string,
    ticketId: string,
    patch: { claimerId?: string | null; state?: TicketState; closedAt?: string | null },
  ): Promise<TicketRecord | undefined>;
  appendTicketEvent(
    guildId: string,
    ticketId: string,
    type: string,
    actorId?: string,
    data?: unknown,
  ): Promise<TicketEventRecord>;
  listTicketEvents(guildId: string, ticketId: string): Promise<TicketEventRecord[]>;
  getRecord<T>(guildId: string, kind: string, key: string): Promise<CommunityRecord<T> | undefined>;
  putRecord<T>(guildId: string, kind: string, key: string, data: T): Promise<CommunityRecord<T>>;
  /**
   * Atomically set `data.sent = true` unless it already is. Only the caller
   * that receives the record may send; this is what stops the timer and the
   * reconciliation sweep from delivering the same reminder twice.
   */
  claimSent<T>(guildId: string, kind: string, key: string): Promise<CommunityRecord<T> | undefined>;
  listRecords<T>(guildId: string, kind: string, limit?: number): Promise<CommunityRecord<T>[]>;
  deleteRecord(guildId: string, kind: string, key: string): Promise<void>;
}

export interface CommunityActionResult {
  readonly ok: boolean;
  readonly id?: string;
  readonly detail?: string;
}

export interface CommunityMessage {
  readonly content?: string;
  readonly embeds?: import("./types").EmbedPayload[];
  readonly components?: import("./types").ActionRow[];
  readonly ephemeral?: boolean;
  /** Optional mention policy; auto-responders use `{ parse: [] }`. */
  readonly allowedMentions?: { readonly parse: readonly string[] };
}

/** Discord side of community; tests record these calls instead of using a gateway. */
export interface CommunityActions {
  sendMessage(guildId: string, channelId: string, message: CommunityMessage): Promise<CommunityActionResult>;
  editMessage(
    guildId: string,
    channelId: string,
    messageId: string,
    message: CommunityMessage,
  ): Promise<CommunityActionResult>;
  sendDM(userId: string, message: CommunityMessage): Promise<CommunityActionResult>;
  deleteMessage(guildId: string, channelId: string, messageId: string): Promise<CommunityActionResult>;
  /** True when the target is a Discord bot account. */
  isBot(guildId: string, userId: string): Promise<boolean>;
  addRole(guildId: string, userId: string, roleId: string, reason?: string): Promise<CommunityActionResult>;
  removeRole(guildId: string, userId: string, roleId: string, reason?: string): Promise<CommunityActionResult>;
  toggleRole(guildId: string, userId: string, roleId: string): Promise<CommunityActionResult & { added?: boolean }>;
  hasRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  createThread(
    guildId: string,
    channelId: string,
    name: string,
    message?: string,
  ): Promise<CommunityActionResult>;
  closeThread(guildId: string, threadId: string, reason?: string): Promise<CommunityActionResult>;
  createVoiceChannel(
    guildId: string,
    name: string,
    options?: { parentId?: string; userLimit?: number },
  ): Promise<CommunityActionResult>;
  deleteChannel(guildId: string, channelId: string, reason?: string): Promise<CommunityActionResult>;
  setChannelName(guildId: string, channelId: string, name: string): Promise<CommunityActionResult>;
  countMembers(guildId: string, channelId: string): Promise<number>;
}

export interface CommunityPort {
  readonly store: CommunityStore;
  readonly actions: CommunityActions;
}
