/**
 * Structural types the kernel speaks in.
 *
 * Deliberately NOT discord.js types: the kernel must be testable without a
 * token, a gateway, or a live guild. `apps/bot/src/adapt.ts` is the single
 * place that casts a real interaction into an `InteractionLike`.
 */

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(scope: string): Logger;
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedPayload {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface ReplyFile {
  /** File name shown in Discord; keep it boring and stable. */
  readonly name: string;
  /** UTF-8 content. Exports are JSON text, not binaries. */
  readonly content: string;
  readonly description?: string;
}

export interface ReplyInput {
  content?: string;
  embeds?: EmbedPayload[];
  ephemeral?: boolean;
  components?: ActionRow[];
  /** Optional attachments; the adapter turns each one into a file upload. */
  files?: ReplyFile[];
}

export type ButtonStyle = "primary" | "secondary" | "success" | "danger" | "link";

/** A structural button; the Discord adapter turns this into a ButtonBuilder. */
export interface ButtonComponent {
  type: "button";
  customId: string;
  label: string;
  style: ButtonStyle;
  disabled?: boolean;
  url?: string;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  default?: boolean;
}

/** A string select menu; the Discord adapter turns this into a SelectMenuBuilder. */
export interface SelectComponent {
  type: "select";
  customId: string;
  placeholder: string;
  minValues?: number;
  maxValues?: number;
  options: SelectOption[];
  disabled?: boolean;
}

export type MessageComponent = ButtonComponent | SelectComponent;

export interface ActionRow {
  type: "action-row";
  components: MessageComponent[];
}

/** The narrow slice of a Discord interaction that commands are allowed to use. */
export interface InteractionLike {
  /** Discord interaction id; stable across retries and the economy idempotency key. */
  readonly id: string;
  readonly commandName: string;
  /** Defaults to chat-input for every existing adapter and fixture. */
  readonly commandType?: CommandType;
  /** User id for a user menu; message id for a message menu. */
  readonly targetId?: string;
  /** Author of the target message, when the interaction carries one. */
  readonly targetUserId?: string;
  /** Target message content; empty when MessageContent is not granted. */
  readonly targetContent?: string;
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly userId: string;
  /** Parsed slash-command option values; user/channel/role values are IDs. */
  readonly options: Readonly<Record<string, string | number | boolean | null>>;
  /** The selected subcommand, when the root is a hub. */
  readonly subcommand?: string;
  /** The selected subcommand group, when the root uses Discord groups. */
  readonly subcommandGroup?: string;
  /** Permission names the invoking member holds, e.g. `["ManageGuild"]`. */
  readonly permissions: readonly string[];
  readonly replied: boolean;
  readonly deferred: boolean;
  reply(input: ReplyInput): Promise<unknown>;
  deferReply(input?: { ephemeral?: boolean }): Promise<unknown>;
  editReply(input: ReplyInput): Promise<unknown>;
  followUp(input: ReplyInput): Promise<unknown>;
}

/** Settings handle scoped to one module, handed to commands at dispatch time. */
export interface ModuleSettings {
  get(guildId: string): Promise<Record<string, unknown>>;
  update(guildId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface CooldownResult {
  readonly allowed: boolean;
  /** Milliseconds until the caller may try again. Zero when allowed. */
  readonly retryAfterMs: number;
}

/**
 * The cooldown port. P0 shipped a process-local Map; P1 swaps in Redis without
 * changing a single guard or module.
 */
export interface CooldownStore {
  hit(key: string, ttlMs: number, now?: number): Promise<CooldownResult>;
}

export interface JobOptions {
  /** Stable key so a retried enqueue cannot duplicate the side effect. */
  idempotencyKey?: string;
  delayMs?: number;
}

/**
 * The queue port. Modules enqueue by name (`queue.enqueue("levels.sync", …)`);
 * they never import BullMQ, Redis or a worker.
 */
export interface JobQueue {
  enqueue(name: string, payload: unknown, options?: JobOptions): Promise<string>;
  close(): Promise<void>;
}

export interface HealthArea {
  configured: boolean;
  reachable: boolean;
  detail?: string;
}

/** How a deployment requests gateway intents. `minimal` never asks for a privileged one. */
export type IntentProfile = "minimal" | "full";

export interface IntentCapability {
  readonly name: string;
  readonly kind: "required" | "optional";
  readonly requested: boolean;
  /** Modules that declare this intent. */
  readonly modules: readonly string[];
  /** What a user loses when an optional intent is not requested. */
  readonly fallback?: string;
}

/**
 * What the gateway will actually be able to see. This is deliberately part of
 * the health report: `/setup` can name a disabled feature instead of leaving an
 * operator to discover it during a raid.
 */
export interface CapabilityReport {
  readonly profile: IntentProfile;
  readonly intents: readonly IntentCapability[];
  readonly disabledFeatures: readonly string[];
}

export interface HealthReport {
  database: HealthArea & { migrated: boolean };
  cache: HealthArea;
  capabilities?: CapabilityReport;
}

/** What `/setup` reads. Implemented by the composition root, not by a module. */
export interface HealthProbe {
  probe(): Promise<HealthReport>;
}

export type IdempotencyClaim = "run" | "done";

/** The response an idempotent HTTP request replays. */
export interface StoredHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * What an `Idempotency-Key` claim means.
 *
 * `execute` is the first use (or a retry after a failed attempt); `replay`
 * carries the stored response for the same key and body; `conflict` is the same
 * key with a different body; `in-flight` is a concurrent retry while the first
 * request still holds the lease.
 */
export type RequestClaim =
  | { readonly outcome: "execute" }
  | { readonly outcome: "replay"; readonly response: StoredHttpResponse }
  | { readonly outcome: "conflict" }
  | { readonly outcome: "in-flight" };

/**
 * Receipts that make a retried job or HTTP write safe. Postgres implements this
 * in `@keystone/db`; the queue calls `claim/complete/fail` around every handler
 * and the API calls `claimRequest/completeRequest` around a keyed write.
 *
 * The same rows serve both: a job key and an HTTP key are namespaced by the
 * caller, so neither can collide with the other.
 */
export interface IdempotencyStore {
  claim(key: string, jobName: string): Promise<IdempotencyClaim>;
  complete(key: string): Promise<void>;
  fail(key: string, error: string): Promise<void>;
  /**
   * Claim an HTTP request key. A key that was completed with the same
   * fingerprint replays; a different fingerprint is a conflict; a fresh claim
   * older than the lease is allowed to run again so a crash cannot wedge it.
   */
  claimRequest(
    key: string,
    jobName: string,
    fingerprint: string,
    now?: number,
  ): Promise<RequestClaim>;
  /** Store the response so a retry of the same key and body can replay it. */
  completeRequest(key: string, fingerprint: string, response: StoredHttpResponse): Promise<void>;
  /** Drop an unfinished claim so a corrected retry is not stuck behind the lease. */
  releaseRequest(key: string): Promise<void>;
}

/**
 * Tracing port. The real implementation lives in `@keystone/telemetry`; the
 * kernel only needs these four methods, so it never depends on OpenTelemetry.
 */
export interface Telemetry {
  withSpan<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Starts a span whose parent is a W3C `traceparent` carried in a job. */
  withRemoteParent<T>(name: string, traceparent: string | undefined, fn: () => Promise<T>): Promise<T>;
  /** The active W3C `traceparent`, or undefined when tracing is off. */
  traceparent(): string | undefined;
  shutdown(): Promise<void>;
}

export interface CommandContext {
  readonly interaction: InteractionLike;
  readonly moduleId: string;
  readonly guildId: string | null;
  readonly userId: string;
  /** `[group, subcommand]` or `[subcommand]`; empty for a root-only command. */
  readonly commandPath: readonly string[];
  /** Every registered root and subcommand, injected by dispatch for /help. */
  readonly catalog: readonly CommandCatalogEntry[];
  readonly settings: ModuleSettings;
  /** Present when the composition root wired the shared settings service. */
  readonly config?: import("./config").ConfigPort;
  readonly logger: Logger;
  /** Injected clock so cooldowns and latency are deterministic in tests. */
  readonly now: () => number;
  readonly cooldowns: CooldownStore;
  readonly queue: JobQueue;
  /**
   * Delayed jobs that need the gateway (expiry, reminders, scheduled posts).
   * The worker queue cannot perform Discord side effects, so these run in the
   * bot process. Tests may omit it; the no-op queue is the default.
   */
  readonly timers?: JobQueue;
  readonly health: HealthProbe;
  /** Present when the composition root wired the moderation adapters. */
  readonly moderation?: ModerationPort;
  /** Present when the composition root wired the P3 community adapters. */
  readonly community?: import("./community").CommunityPort;
  /** Present when the composition root wired the invite-tracking adapters. */
  readonly invites?: import("./invites").InvitePort;
  /** Present when the composition root wired the P4 AI provider. */
  readonly ai?: import("./ai").AiPort;
  /** Present when the composition root wired the P7 audit-log adapters. */
  readonly logging?: import("./logging").LoggingPort;
  /** Present when the composition root wired the read-only analytics store. */
  readonly analytics?: import("./analytics").AnalyticsStore;
  /** Present when the composition root wired the portability adapters. */
  readonly export?: import("./export").ExportPort;
  /** Reads the live guild facts drift compares against. */
  readonly exportFacts?: import("./export").ExportFacts;
  /** Downloads a bundle the operator attached to an import command. */
  readonly attachments?: import("./export").AttachmentReader;
  /** Present when the composition root wired the saved queue and playback status. */
  readonly music?: import("./music").MusicPort;
  /** Present when the composition root wired the form store. */
  readonly forms?: import("./forms").FormStore;
  /** Present when the composition root wired the event store. */
  readonly events?: import("./events").EventStore;
  /** Present when the composition root wired the private modmail store. */
  readonly modmail?: import("./modmail").ModmailStore;
}

/**
 * Discord application command kinds. Chat-input commands are the 100-slot
 * budget; user and message context menus live in their own 15 + 15 budgets.
 */
export type CommandType = "chat-input" | "user" | "message";

export type GuardResult = { ok: true } | { ok: false; message: string };
export type Guard = (ctx: CommandContext) => GuardResult | Promise<GuardResult>;

export type OptionType =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "user"
  | "channel"
  | "role"
  | "mentionable"
  | "attachment";

export interface CommandChoice {
  name: string;
  value: string | number;
}

export interface CommandOption {
  type: OptionType;
  name: string;
  description: string;
  required?: boolean;
  choices?: CommandChoice[];
  minValue?: number;
  maxValue?: number;
  autocomplete?: boolean;
}

export interface CommandHelp {
  /** Permissions the command needs, for discovery copy. Guards remain the source of truth. */
  permissions?: string[];
  /** Ready-to-paste examples. */
  examples?: string[];
  /** Optional grouping for /help browse. Defaults to the owning module name. */
  category?: string;
}

export interface SubcommandDefinition {
  name: string;
  description: string;
  options?: CommandOption[];
  help?: CommandHelp;
}

export interface CommandGroupDefinition {
  name: string;
  description: string;
  subcommands: SubcommandDefinition[];
}

export interface CommandDefinition {
  name: string;
  description: string;
  /** Chat-input root by default; user/message add a right-click menu. */
  type?: CommandType;
  /** Root options. Discord forbids root options when subcommands exist. */
  options?: CommandOption[];
  /** One level of subcommands under the root. */
  subcommands?: SubcommandDefinition[];
  /** One level of groups, each containing subcommands. */
  groups?: CommandGroupDefinition[];
  /** Guards run in order, before `execute`. First failure stops dispatch. */
  guards?: Guard[];
  /** Root execute runs for every subcommand; `ctx.commandPath` says which one. */
  execute(ctx: CommandContext): Promise<void>;
  /** Teaching note surfaced in docs, never sent to Discord. */
  notes?: string;
  help?: CommandHelp;
}

export interface CommandCatalogSubcommand {
  readonly name: string;
  readonly description: string;
  readonly group?: string;
  readonly options: readonly CommandOption[];
  readonly help?: CommandHelp;
}

export interface CommandCatalogEntry {
  readonly name: string;
  /** Absent in older fixtures, which means chat-input. */
  readonly type?: CommandType;
  readonly moduleId: string;
  readonly description: string;
  readonly options: readonly CommandOption[];
  readonly subcommands: readonly CommandCatalogSubcommand[];
  readonly help?: CommandHelp;
}

/** The accountability record shared by moderation, security and appeals. */
export type ModerationCaseState =
  | "pending"
  | "open"
  | "alerted"
  | "reviewed"
  | "appealed"
  | "reversed"
  | "closed";

export interface ModerationCase {
  readonly id: string;
  readonly guildId: string;
  readonly caseNumber: number;
  readonly actorId: string;
  readonly targetId: string;
  readonly action: string;
  readonly reason: string;
  readonly rule?: string;
  readonly state: ModerationCaseState;
  readonly evidence?: unknown;
  /**
   * When a temporary ban or role grant should be released. Present only on a
   * case that scheduled an expiry; the case itself remains the record of what
   * happened, and the timer is disposable.
   */
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CaseEvent {
  readonly id: string;
  readonly caseId: string;
  readonly type: string;
  readonly actorId?: string;
  readonly data?: unknown;
  readonly createdAt: string;
}

export interface NewModerationCase {
  readonly guildId: string;
  readonly caseNumber: number;
  readonly actorId: string;
  readonly targetId: string;
  readonly action: string;
  readonly reason: string;
  readonly rule?: string;
  readonly state?: ModerationCaseState;
  readonly evidence?: unknown;
  readonly expiresAt?: string;
}

/** The narrow persistence port the moderation module owns. */
export interface CaseStore {
  nextCaseNumber(guildId: string): Promise<number>;
  create(input: NewModerationCase): Promise<ModerationCase>;
  get(guildId: string, caseNumber: number): Promise<ModerationCase | undefined>;
  getById(caseId: string): Promise<ModerationCase | undefined>;
  list(
    guildId: string,
    filter?: { targetId?: string; state?: ModerationCaseState; limit?: number },
  ): Promise<ModerationCase[]>;
  appendEvent(caseId: string, type: string, actorId?: string, data?: unknown): Promise<CaseEvent>;
  /** Append-only history, oldest first. Used by appeal status, never by edits. */
  listEvents(caseId: string): Promise<CaseEvent[]>;
  updateState(caseId: string, state: ModerationCaseState): Promise<void>;
  /** Set or clear the release time on an existing temporary case. */
  updateExpiry(caseId: string, expiresAt: string | null): Promise<ModerationCase | undefined>;
  /**
   * Atomically take ownership of a due release by clearing `expires_at`.
   * Only the worker that clears it may perform the Discord action; a failure
   * restores the timestamp so the case can be retried.
   */
  claimExpiry(caseId: string): Promise<ModerationCase | undefined>;
  /**
   * Open temporary cases whose release time has arrived. This is the recovery
   * path: a timer may be lost, but the case row is the durable source of truth.
   */
  listDueExpiries(guildId: string, at: string, limit?: number): Promise<ModerationCase[]>;
  /** Open temporary cases still in the future, for re-scheduling after a restart. */
  listPendingExpiries(guildId: string, after: string, limit?: number): Promise<ModerationCase[]>;
}

/**
 * Persisted member state for the join gate. `members` is deliberately small:
 * whether the member is quarantined and when verification last happened. It is
 * not a gateway presence cache and must not be rebuilt from roles on read.
 */
export interface MemberVerification {
  readonly guildId: string;
  readonly userId: string;
  readonly joinedAt?: string;
  readonly quarantined: boolean;
  readonly verifiedAt?: string;
  readonly updatedAt?: string;
}

export interface MemberStore {
  get(guildId: string, userId: string): Promise<MemberVerification | undefined>;
  /**
   * Upsert a held member after an enforced quarantine. Clears any previous
   * verification and preserves the original join time when a row exists.
   */
  markQuarantined(guildId: string, userId: string): Promise<MemberVerification>;
  /** Upsert a completed verification; clears the persisted quarantine flag. */
  markVerified(guildId: string, userId: string, verifiedAt: string): Promise<MemberVerification>;
}

export interface ModerationActionResult {
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * One channel's @everyone SendMessages state before panic mode changed it.
 *
 * Panic only touches that one flag, so the snapshot records only that flag.
 * `existed` distinguishes "neutral" from "no overwrite at all"; restoring an
 * absent overwrite deletes it instead of writing an empty one.
 */
export interface ChannelLock {
  readonly channelId: string;
  readonly existed: boolean;
  readonly previous: "allow" | "deny" | "neutral";
}

export interface LockdownResult extends ModerationActionResult {
  /** Channels actually changed, even when another channel failed. */
  readonly locks?: readonly ChannelLock[];
}

export interface RestoreLockdownResult extends ModerationActionResult {
  readonly restored?: readonly string[];
  readonly failed?: readonly string[];
}

/** One durable panic snapshot per guild; absent means panic mode is off. */
export interface PanicState {
  readonly active: true;
  readonly startedAt: string;
  readonly startedBy: string;
  readonly reason: string;
  readonly channels: readonly ChannelLock[];
}

export interface PanicStore {
  get(guildId: string): Promise<PanicState | undefined>;
  save(guildId: string, state: PanicState): Promise<void>;
  clear(guildId: string): Promise<void>;
}

export interface ModerationNotice {
  readonly embeds: EmbedPayload[];
  readonly components?: ActionRow[];
}

/** The narrow direct-message shape moderation owns, without the community port. */
export interface ModerationDirectMessage {
  readonly content: string;
  readonly components?: ActionRow[];
}

/**
 * The external actions moderation needs. Discord implements this in `apps/bot`;
 * tests implement it with a recorder, so no command or rule needs a gateway.
 */
export interface ModerationActions {
  ban(guildId: string, userId: string, reason: string): Promise<ModerationActionResult>;
  kick(guildId: string, userId: string, reason: string): Promise<ModerationActionResult>;
  timeout(guildId: string, userId: string, seconds: number, reason: string): Promise<ModerationActionResult>;
  purge(guildId: string, channelId: string, limit: number, reason: string): Promise<ModerationActionResult>;
  lock(guildId: string, channelId: string, locked: boolean, reason: string): Promise<ModerationActionResult>;
  slowmode(guildId: string, channelId: string, seconds: number, reason: string): Promise<ModerationActionResult>;
  deleteMessage(guildId: string, channelId: string, messageId: string, reason: string): Promise<ModerationActionResult>;
  deleteWebhook(guildId: string, webhookId: string, reason: string): Promise<ModerationActionResult>;
  quarantine(guildId: string, userId: string, reason: string, roleId?: string): Promise<ModerationActionResult>;
  unquarantine(
    guildId: string,
    userId: string,
    reason: string,
    roleId?: string,
  ): Promise<ModerationActionResult>;
  /** Lift a ban. The expiry job calls this; it never deletes the case. */
  unban(guildId: string, userId: string, reason: string): Promise<ModerationActionResult>;
  /** Grant a role for a temporary-role case. */
  addRole(
    guildId: string,
    userId: string,
    roleId: string,
    reason: string,
  ): Promise<ModerationActionResult>;
  /** Remove the role when a temporary-role case expires. */
  removeRole(
    guildId: string,
    userId: string,
    roleId: string,
    reason: string,
  ): Promise<ModerationActionResult>;
  /** Deny SendMessages for @everyone in every text channel and return a snapshot. */
  lockdown(guildId: string, reason: string): Promise<LockdownResult>;
  /** Restore exactly the overwrites captured by `lockdown`. */
  restoreLockdown(
    guildId: string,
    locks: readonly ChannelLock[],
    reason: string,
  ): Promise<RestoreLockdownResult>;
  notify(guildId: string, channelId: string | null | undefined, notice: ModerationNotice): Promise<void>;
  /**
   * DM one member, e.g. the join-gate verification button. `ok: false` carries
   * the provider detail so the caller can name a closed DM instead of guessing.
   */
  directMessage(userId: string, message: ModerationDirectMessage): Promise<ModerationActionResult>;
}

export interface ModerationPort {
  readonly cases: CaseServicePort;
  readonly actions: ModerationActions;
  readonly members: MemberStore;
  /** Present when the composition root wired the panic snapshot store. */
  readonly panic?: PanicStore;
}

/** The case operations commands, security rules and appeals share. */
export interface CaseServicePort {
  open(input: Omit<NewModerationCase, "caseNumber">): Promise<ModerationCase>;
  get(guildId: string, caseNumber: number): Promise<ModerationCase | undefined>;
  getById(caseId: string): Promise<ModerationCase | undefined>;
  list(
    guildId: string,
    filter?: { targetId?: string; state?: ModerationCaseState; limit?: number },
  ): Promise<ModerationCase[]>;
  note(caseId: string, actorId: string, note: string): Promise<CaseEvent>;
  review(caseId: string, actorId: string): Promise<ModerationCase>;
  appealByNumber(
    guildId: string,
    caseNumber: number,
    actorId: string,
    message: string,
  ): Promise<ModerationCase>;
  appealById(caseId: string, actorId: string, message: string): Promise<ModerationCase>;
  /** The append-only record behind an appeal; state alone cannot prove one. */
  listEvents(caseId: string): Promise<CaseEvent[]>;
  setState(caseId: string, state: ModerationCaseState): Promise<void>;
  /** Attach a release time after the action succeeded. */
  setExpiry(caseId: string, expiresAt: string): Promise<ModerationCase | undefined>;
  /** Atomic ownership of one release; see `CaseStore.claimExpiry`. */
  claimExpiry(caseId: string): Promise<ModerationCase | undefined>;
  /**
   * Close a temporary case after its release action succeeded. Append the
   * `expired` event first, then move the state, so history explains the state.
   */
  expire(caseId: string, actorId: string, detail: string): Promise<ModerationCase | undefined>;
  /** Overdue temporary cases; the startup recovery sweep consumes this. */
  listDueExpiries(guildId: string, at: string, limit?: number): Promise<ModerationCase[]>;
  /** Future temporary cases; startup re-schedules these in memory mode. */
  listPendingExpiries(guildId: string, after: string, limit?: number): Promise<ModerationCase[]>;
}
