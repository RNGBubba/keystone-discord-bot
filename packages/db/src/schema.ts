import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  customType,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * JSONB that round-trips exactly.
 *
 * Drizzle's built-in jsonb mapping has two sharp edges: drivers that already
 * parsed JSON get their string values parsed a second time ("123" becomes 123),
 * and `null` is short-circuited to SQL NULL before any mapper runs. This type
 * writes JSON text and only parses when the driver handed back a string; the
 * settings column is nullable so a JSON null survives as SQL NULL, with the
 * row's presence marking that the key exists.
 */
const jsonValue = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return "jsonb";
  },
  toDriver(value: unknown): string {
    const json = JSON.stringify(value);
    return json === undefined ? "null" : json;
  },
  fromDriver(value: unknown): unknown {
    return typeof value === "string" ? JSON.parse(value) : value;
  },
});

/**
 * The data spine.
 *
 * One schema, not four bots' worth of partial records. Modules never import
 * these tables directly: they go through a repository or service that the
 * composition root wires to a port. That rule is what makes the database
 * swappable in tests and the export feature possible later.
 */

// Fresh builders per table: Drizzle column builders are stateful, so sharing one
// instance between tables is a subtle bug waiting to happen.
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(),
  name: text("name"),
  locale: text("locale").notNull().default("en"),
  plan: text("plan").notNull().default("free"),
  // The migration names this column joined_at; Drizzle must match it exactly.
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
});

/** `(guild, module, key)` is the unique settings unit — never a JSON blob. */
export const settings = pgTable(
  "settings",
  {
    guildId: text("guild_id").notNull(),
    module: text("module").notNull(),
    key: text("key").notNull(),
    value: jsonValue("value"),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.module, table.key] }),
    index("settings_guild_module_idx").on(table.guildId, table.module),
  ],
);

export const members = pgTable(
  "members",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    quarantined: boolean("quarantined").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

/**
 * A case is the accountability record every later module references: an
 * anti-nuke action, a warning, a ticket resolution and an AI flag all produce
 * one. `case_events` is append-only, so a reversal is a new row, not an edit.
 */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    caseNumber: integer("case_number").notNull(),
    actorId: text("actor_id").notNull(),
    targetId: text("target_id").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    rule: text("rule"),
    state: text("state").notNull().default("open"),
    evidence: jsonValue("evidence"),
    /** Set only on a temporary ban/role; the timer is recoverable from this. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("cases_guild_number_idx").on(table.guildId, table.caseNumber),
    index("cases_guild_target_idx").on(table.guildId, table.targetId),
    index("cases_guild_state_idx").on(table.guildId, table.state),
    index("cases_guild_created_idx").on(table.guildId, table.createdAt),
    index("cases_expiry_idx")
      .on(table.guildId, table.expiresAt)
      .where(sql`${table.expiresAt} is not null`),
  ],
);

export const caseEvents = pgTable(
  "case_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: text("actor_id"),
    data: jsonValue("data"),
    createdAt: createdAt(),
  },
  (table) => [index("case_events_case_idx").on(table.caseId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    openerId: text("opener_id").notNull(),
    claimerId: text("claimer_id"),
    state: text("state").notNull().default("open"),
    subject: text("subject"),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("tickets_guild_state_idx").on(table.guildId, table.state),
    index("tickets_guild_created_idx").on(table.guildId, table.createdAt),
    index("tickets_guild_closed_idx")
      .on(table.guildId, table.closedAt)
      .where(sql`${table.closedAt} is not null`),
  ],
);

export const levels = pgTable(
  "levels",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    xp: bigint("xp", { mode: "number" }).notNull().default(0),
    level: integer("level").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

/** XP is a projection; this ledger is the truth and can be replayed. */
export const xpEvents = pgTable(
  "xp_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    amount: integer("amount").notNull(),
    source: text("source").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("xp_events_idempotency_idx").on(table.idempotencyKey),
    index("xp_events_guild_user_idx").on(table.guildId, table.userId),
  ],
);

/** Append-only money. A balance is a SUM, never a mutable counter. */
export const economyLedger = pgTable(
  "economy_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("economy_ledger_idempotency_idx").on(table.idempotencyKey),
    index("economy_ledger_guild_user_idx").on(table.guildId, table.userId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetId: text("target_id"),
    data: jsonValue("data"),
    createdAt: createdAt(),
  },
  (table) => [index("audit_events_guild_idx").on(table.guildId, table.createdAt)],
);

/**
 * The last config bundle a guild applied or stored. One row per guild: applying
 * again replaces the bundle but keeps `created_at`, so drift always compares
 * against the most recent intent. The live settings stay in `settings`.
 */
export const configBaselines = pgTable("config_baselines", {
  guildId: text("guild_id").primaryKey(),
  source: text("source").notNull(),
  bundle: jsonValue("bundle").notNull(),
  checksum: text("checksum").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * A saved configuration template: one guild's snapshot of every module's
 * effective settings. `lower(name)` is unique per guild in the migration, not
 * a primary key, so a rename can keep the id.
 */
export const configTemplates = pgTable("config_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  modules: jsonValue("modules").notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * P3 community-owned records: panels, giveaways, tags, feeds and transcript
 * events. The typed level/economy/ticket tables stay the spine; this table is
 * for feature records that do not warrant a new SQL shape yet.
 */
export const communityRecords = pgTable(
  "community_records",
  {
    guildId: text("guild_id").notNull(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    data: jsonValue("data"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.kind, table.key] }),
    index("community_records_guild_kind_idx").on(table.guildId, table.kind),
  ],
);

/** Admin-supplied server knowledge. Chunks keep their portable vectors. */
export const aiDocuments = pgTable(
  "ai_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    content: text("content").notNull(),
    chunks: jsonValue("chunks"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("ai_documents_guild_idx").on(table.guildId, table.updatedAt)],
);

/** Aggregated counters only. There is deliberately no prompt/completion column. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    guildId: text("guild_id").notNull(),
    period: text("period").notNull(),
    requests: integer("requests").notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.period] })],
);

/**
 * One row per attributed member join. `(guild, member, joined_at)` is unique, so
 * a repeated gateway delivery cannot double-count an invite. The inviter is
 * nullable: vanity URLs and invites Keystone never saw still produce a row, and
 * a later "who invited me" answer is better than a silent gap.
 */
export const inviteJoins = pgTable(
  "invite_joins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    inviterId: text("inviter_id"),
    code: text("code"),
    fakeReasons: jsonValue("fake_reasons").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("invite_joins_guild_user_joined_idx").on(
      table.guildId,
      table.userId,
      table.joinedAt,
    ),
    index("invite_joins_guild_inviter_idx").on(table.guildId, table.inviterId),
    index("invite_joins_guild_joined_idx").on(table.guildId, table.joinedAt),
  ],
);

/** Append-only audit log. Delivery is best-effort; this table is the truth. */
export const loggingEvents = pgTable(
  "logging_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    kind: text("kind").notNull(),
    actorId: text("actor_id"),
    targetId: text("target_id"),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    summary: text("summary").notNull(),
    data: jsonValue("data"),
    createdAt: createdAt(),
  },
  (table) => [index("logging_events_guild_created_idx").on(table.guildId, table.createdAt)],
);

/** One row per dispatched guild command. Aggregates are queries, not counters. */
export const commandUsage = pgTable(
  "command_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    command: text("command").notNull(),
    path: text("path").notNull().default(""),
    status: text("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("command_usage_guild_created_idx").on(table.guildId, table.createdAt),
    index("command_usage_guild_command_idx").on(table.guildId, table.command),
  ],
);

/**
 * One row per operator-owned application form.
 *
 * A form is configuration, but it is not a settings key: every submission
 * references it by id, so deleting a form must be a deliberate operation that
 * the store can refuse while submissions exist. `(guild_id, key)` is unique so
 * `/form submit form:staff` can never mean two different forms.
 */
export const forms = pgTable(
  "forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    fields: jsonValue("fields").notNull(),
    state: text("state").notNull().default("draft"),
    panelChannelId: text("panel_channel_id"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("forms_guild_key_idx").on(table.guildId, table.key),
    index("forms_guild_state_idx").on(table.guildId, table.state),
  ],
);

/**
 * One row per member submission. Answers are JSONB keyed by field key; the
 * partial unique index in migration 0011 allows at most one pending
 * submission per member per form, so a double click cannot create two review
 * items, while a denied applicant can apply again later.
 */
export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    answers: jsonValue("answers").notNull(),
    state: text("state").notNull().default("submitted"),
    reviewedBy: text("reviewed_by"),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("form_submissions_guild_form_idx").on(
      table.guildId,
      table.formId,
      table.createdAt,
    ),
    index("form_submissions_guild_user_idx").on(table.guildId, table.userId),
  ],
);

/**
 * One row per operator-owned guild event.
 *
 * An event is configuration, but it has a lifecycle and a stable id that RSVPs
 * reference. `(guild_id, key)` is unique so `/event rsvp event:launch` can never
 * mean two different events. `capacity` is nullable: null means unlimited.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    state: text("state").notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location").notNull().default(""),
    capacity: integer("capacity"),
    createdBy: text("created_by").notNull(),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    remindedBy: text("reminded_by"),
    reminderCount: integer("reminder_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("events_guild_key_idx").on(table.guildId, table.key),
    index("events_guild_state_idx").on(table.guildId, table.state),
    index("events_guild_starts_idx").on(table.guildId, table.startsAt),
  ],
);

/**
 * One RSVP row per member per event.
 *
 * The unique index is the ownership rule made structural: a member can change
 * only their own row, and no path can create a second membership. `going` rows
 * are what capacity counts; `not_going` is kept as a real answer rather than a
 * silent delete, so a reminder can name who declined.
 */
export const eventRsvps = pgTable(
  "event_rsvps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    state: text("state").notNull().default("going"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("event_rsvps_event_user_idx").on(table.eventId, table.userId),
    index("event_rsvps_guild_event_state_idx").on(
      table.guildId,
      table.eventId,
      table.state,
    ),
  ],
);

/**
 * One private mail thread per member at a time.
 *
 * The partial unique index on `(guild_id, owner_id) WHERE state <> 'closed'`
 * is the structural version of "one active thread per member": a closed thread
 * frees the member to open a new one. The transcript is stored on the row by
 * the same conditional update that closes it, so it cannot be archived twice.
 */
export const modmailThreads = pgTable(
  "modmail_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    ownerId: text("owner_id").notNull(),
    subject: text("subject").notNull(),
    state: text("state").notNull().default("open"),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    closedBy: text("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    resolution: text("resolution"),
    memberUnread: integer("member_unread").notNull().default(0),
    staffUnread: integer("staff_unread").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    transcript: text("transcript"),
    transcriptChecksum: text("transcript_checksum"),
    transcriptMessageCount: integer("transcript_message_count"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("modmail_threads_active_owner_idx")
      .on(table.guildId, table.ownerId)
      .where(sql`${table.state} <> 'closed'`),
    index("modmail_threads_guild_state_idx").on(
      table.guildId,
      table.state,
      table.updatedAt,
    ),
    index("modmail_threads_guild_owner_idx").on(table.guildId, table.ownerId),
  ],
);

/**
 * Append-only conversation rows. The thread owns the lifecycle; a message only
 * records who spoke on which side, so the transcript can be rebuilt from rows
 * and archived verbatim on close.
 */
export const modmailMessages = pgTable(
  "modmail_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => modmailThreads.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    side: text("side").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("modmail_messages_thread_idx").on(table.threadId, table.createdAt),
  ],
);

/** Monotonic per-guild case numbers; the unique index on cases is the backstop. */
export const caseCounters = pgTable("case_counters", {
  guildId: text("guild_id").primaryKey(),
  nextCaseNumber: integer("next_case_number").notNull().default(2),
});

/** Idempotency receipts for queue work. See `packages/queue`. */
export const jobReceipts = pgTable("job_receipts", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  jobName: text("job_name").notNull(),
  status: text("status").notNull(), // claimed | completed | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: text("guild_id").notNull(),
  source: text("source").notNull(),
  state: text("state").notNull().default("pending"),
  receipt: jsonValue("receipt"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const backups = pgTable("backups", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: text("guild_id").notNull(),
  kind: text("kind").notNull(),
  state: text("state").notNull().default("pending"),
  payload: jsonValue("payload"),
  createdAt: createdAt(),
});

export const webSessions = pgTable(
  "web_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    accessToken: text("access_token").notNull(),
    csrfHash: text("csrf_hash").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("web_sessions_expires_idx").on(table.expiresAt)],
);

export const schema = {
  guilds,
  settings,
  members,
  cases,
  caseEvents,
  tickets,
  levels,
  xpEvents,
  economyLedger,
  auditEvents,
  configBaselines,
  configTemplates,
  communityRecords,
  aiDocuments,
  aiUsage,
  inviteJoins,
  loggingEvents,
  commandUsage,
  forms,
  formSubmissions,
  events,
  eventRsvps,
  caseCounters,
  jobReceipts,
  imports,
  backups,
  webSessions,
};

export type Schema = typeof schema;
