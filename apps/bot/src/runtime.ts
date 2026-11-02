import {
  InMemoryIdempotencyStore,
  InMemorySettingsRepository,
  SettingsService,
  type CooldownStore,
  type HealthProbe,
  type HealthReport,
  type IdempotencyStore,
  type IntentProfile,
  type JobQueue,
  type Logger,
  type ModuleRegistry,
  type SettingsRepository,
  type Telemetry,
  type ModerationActions,
  type ModerationPort,
  type CommunityActions,
  type CommunityPort,
  type InviteActions,
  type InvitePort,
  type AiPort,
  type LoggingActions,
  type LoggingPort,
  type AnalyticsStore,
  type CommandUsageStore,
  type ExportPort,
  type MusicPort,
  type MusicStore,
  type FormStore,
  type EventStore,
  type ModmailStore,
  type CaseStore,
  type MemberStore,
  type CommunityStore,
  type InviteStore,
  type PanicStore,
} from "@keystone/kernel";
import type { Env } from "@keystone/config";
import {
  createIdempotencyStore,
  createCaseStore,
  createMemberStore,
  createCommunityStore,
  createAiStore,
  createInviteStore,
  createLoggingStore,
  createAnalyticsStore,
  createCommandUsageStore,
  createPostgresDatabase,
  createPortabilityStore,
  createMusicStore,
  createFormStore,
  createEventStore,
  createModmailStore,
  createPanicStore,
  createSettingsRepository,
  probeDatabase,
  type PostgresHandle,
} from "@keystone/db";
import {
  CaseService,
  InMemoryCaseStore,
  InMemoryMemberStore,
  InMemoryPanicStore,
  SecurityCoordinator,
  SecurityEngine,
} from "@keystone/module-moderation";
import { InMemoryCommunityStore } from "@keystone/module-community";
import { InMemoryInviteStore } from "@keystone/module-invites";
import { InMemoryLoggingStore, LoggingService } from "@keystone/module-logging";
import {
  InMemoryCommandUsageStore,
  MemoryAnalyticsStore,
} from "@keystone/module-analytics";
import { AiService, InMemoryAiStore, createAiProvider } from "@keystone/module-ai";
import { InMemoryMusicStore, UnavailableMusicPlayback } from "@keystone/module-music";
import { InMemoryFormStore } from "@keystone/module-forms";
import { InMemoryEventStore } from "@keystone/module-events";
import { InMemoryModmailStore } from "@keystone/module-modmail";
import { createMemoryExportPort, createSqlExportPort } from "./export-port";
import { createCooldownStore, type CooldownHandle } from "@keystone/cache";
import { BullJobQueue, InProcessJobQueue } from "@keystone/queue";
import { createOtlpTelemetry, createTelemetry } from "@keystone/telemetry";
import { createTimerRuntime } from "./timers";

export type DatabaseMode = "postgres" | "memory";
export type CacheMode = "redis" | "memory";
export type QueueMode = "bullmq" | "in-process";

export interface Runtime {
  settings: SettingsService;
  cooldowns: CooldownStore;
  queue: JobQueue;
  /** Delayed gateway work: expiry, reminders and scheduled messages. */
  timers: JobQueue;
  health: HealthProbe;
  telemetry: Telemetry;
  moderation: ModerationPort;
  community: CommunityPort;
  invites: InvitePort;
  ai: AiPort;
  logging: LoggingPort;
  analytics: AnalyticsStore;
  export: ExportPort;
  music: MusicPort;
  forms: FormStore;
  events: EventStore;
  modmail: ModmailStore;
  usage: CommandUsageStore;
  security: SecurityCoordinator;
  mode: { database: DatabaseMode; cache: CacheMode; queue: QueueMode };
  close(): Promise<void>;
}

class RuntimeHealth implements HealthProbe {
  constructor(
    private readonly database: PostgresHandle | undefined,
    private readonly cache: CooldownHandle,
    private readonly registry: ModuleRegistry,
    private readonly intentProfile: IntentProfile,
  ) {}

  async probe(): Promise<HealthReport> {
    const cache =
      this.cache.mode === "redis"
        ? { configured: true, reachable: await this.cache.ping(), detail: "redis" }
        : { configured: false, reachable: false, detail: "memory" };

    return {
      database: await probeDatabase(this.database?.runner),
      cache,
      capabilities: this.registry.capabilityReport(this.intentProfile),
    };
  }
}

/**
 * The composition root. This is the only function that decides *which*
 * implementation of each port a deployment gets; modules and the kernel keep
 * seeing interfaces.
 *
 * Every fallback is explicit and logged. A missing variable is a supported
 * local-development mode; a configured-but-broken service is an error.
 */
export async function createRuntime(
  env: Env,
  registry: ModuleRegistry,
  logger: Logger,
  moderationActions: ModerationActions,
  communityActions: CommunityActions,
  inviteActions: InviteActions,
  loggingActions: LoggingActions,
): Promise<Runtime> {
  const telemetry = env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? await createOtlpTelemetry(env.OTEL_EXPORTER_OTLP_ENDPOINT, "keystone-bot")
    : createTelemetry({ enabled: env.OTEL_ENABLED, serviceName: "keystone-bot" });

  let database: PostgresHandle | undefined;
  let repository: SettingsRepository;
  let idempotency: IdempotencyStore;

  if (env.DATABASE_URL) {
    database = createPostgresDatabase(env.DATABASE_URL);
    repository = createSettingsRepository(database, telemetry);
    idempotency = createIdempotencyStore(database);
    logger.info("settings: postgres");
  } else {
    logger.warn(
      "DATABASE_URL is not set — settings are process-local and will reset on restart. Run docker compose up for the real thing.",
    );
    repository = new InMemorySettingsRepository();
    idempotency = new InMemoryIdempotencyStore();
  }

  const cache = await createCooldownStore({ redisUrl: env.REDIS_URL, logger });

  const settings = new SettingsService(repository, registry);
  if (env.DEV_GUILD_ID && env.NODE_ENV !== "production" && !database) {
    await settings.update(env.DEV_GUILD_ID, "ai", { enabled: true, chat: true });
    await settings.update(env.DEV_GUILD_ID, "moderation", {
      automod: {
        links: "alert",
        linkBlocklist: ["phish.test"],
        profanity: "alert",
        bannedWords: ["pineapple"],
        zalgo: "alert",
      },
    });
    logger.warn("DEV_GUILD_ID: AI chat and the content filters are enabled in process memory", {
      guildId: env.DEV_GUILD_ID,
    });
  }
  const loggingStore = database ? createLoggingStore(database) : new InMemoryLoggingStore();
  const logging: LoggingPort = { store: loggingStore, actions: loggingActions };
  const loggingService = new LoggingService(
    logging.store,
    logging.actions,
    settings.forModule("logging"),
  );
  const caseStore: CaseStore = database ? createCaseStore(database) : new InMemoryCaseStore();
  const cases = new CaseService(
    caseStore,
    {
      onOpened: (record) => {
        void loggingService.recordCase(record).catch((error: unknown) => {
          logger.warn("logging case event failed", {
            guild: record.guildId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
    },
  );
  const memberStore: MemberStore = database
    ? createMemberStore(database)
    : new InMemoryMemberStore();
  const panicStore: PanicStore = database
    ? createPanicStore(database)
    : new InMemoryPanicStore();
  const moderation: ModerationPort = {
    cases,
    actions: moderationActions,
    members: memberStore,
    panic: panicStore,
  };
  const communityStore: CommunityStore = database
    ? createCommunityStore(database)
    : new InMemoryCommunityStore();
  const community: CommunityPort = { store: communityStore, actions: communityActions };
  if (env.DEV_GUILD_ID && env.NODE_ENV !== "production" && !database) {
    await settings.update(env.DEV_GUILD_ID, "community", {
      responders: { enabled: true },
    });
    await community.store.putRecord(env.DEV_GUILD_ID, "responder", "dev-hello", {
      id: "dev-hello",
      trigger: "hello keystone",
      match: "exact",
      response: "Hi from Keystone's auto-responder.",
      cooldownSeconds: 60,
      createdBy: "dev-seed",
    });
    logger.warn("DEV_GUILD_ID: auto-responder fixture enabled in process memory", {
      guildId: env.DEV_GUILD_ID,
    });
  }
  const inviteStore: InviteStore = database ? createInviteStore(database) : new InMemoryInviteStore();
  const invites: InvitePort = { store: inviteStore, actions: inviteActions };
  const usage: CommandUsageStore = database
    ? createCommandUsageStore(database)
    : new InMemoryCommandUsageStore();
  const analytics: AnalyticsStore = database
    ? createAnalyticsStore(database)
    : new MemoryAnalyticsStore({
        logs: async (guildId) =>
          loggingStore instanceof InMemoryLoggingStore ? loggingStore.records(guildId) : [],
        cases: async (guildId) =>
          caseStore instanceof InMemoryCaseStore ? caseStore.records(guildId) : [],
        invites: async (guildId) =>
          inviteStore instanceof InMemoryInviteStore ? inviteStore.records(guildId) : [],
        tickets: async (guildId) =>
          communityStore instanceof InMemoryCommunityStore ? communityStore.tickets(guildId) : [],
        commands: async (guildId) =>
          usage instanceof InMemoryCommandUsageStore ? usage.records(guildId) : [],
      });
  const aiStore = database ? createAiStore(database) : new InMemoryAiStore();
  const ai = new AiService(
    aiStore,
    createAiProvider({
      apiKey: env.AI_API_KEY,
      baseUrl: env.AI_BASE_URL,
      model: env.AI_MODEL,
      embeddingModel: env.AI_EMBEDDING_MODEL,
      inputUsdPerMillion: env.AI_INPUT_USD_PER_MILLION,
      outputUsdPerMillion: env.AI_OUTPUT_USD_PER_MILLION,
      disableThinking: env.AI_DISABLE_THINKING,
    }),
    settings.forModule("ai"),
  );
  const security = new SecurityCoordinator({
    engine: new SecurityEngine(),
    cases,
    actions: moderationActions,
    members: memberStore,
    settings: settings.forModule("moderation"),
    logger: logger.child("security"),
  });

  const musicStore: MusicStore = database ? createMusicStore(database) : new InMemoryMusicStore();
  const music: MusicPort = {
    store: musicStore,
    playback: new UnavailableMusicPlayback(),
  };
  const formStore: FormStore = database ? createFormStore(database) : new InMemoryFormStore();
  const eventStore: EventStore = database ? createEventStore(database) : new InMemoryEventStore();
  const modmailStore: ModmailStore = database
    ? createModmailStore(database)
    : new InMemoryModmailStore();

  let exportPort: ExportPort;
  if (database) {
    exportPort = createSqlExportPort(createPortabilityStore(database));
  } else {
    if (
      !(caseStore instanceof InMemoryCaseStore) ||
      !(communityStore instanceof InMemoryCommunityStore) ||
      !(aiStore instanceof InMemoryAiStore)
    ) {
      throw new Error("Memory export requires the in-memory stores; the composition root is inconsistent.");
    }
    exportPort = createMemoryExportPort({
      config: settings,
      cases: caseStore,
      community: communityStore,
      ai: aiStore,
    });
  }

  const timerRuntime = await createTimerRuntime({
    redisUrl: env.REDIS_URL,
    queueName: env.QUEUE_NAME,
    idempotency,
    settings,
    moderation,
    community,
    logger: logger.child("timers"),
    telemetry,
  });

  let queue: JobQueue;
  if (env.REDIS_URL) {
    queue = BullJobQueue.create({
      redisUrl: env.REDIS_URL,
      queueName: env.QUEUE_NAME,
      telemetry,
    });
    logger.info("queue: bullmq", { queue: env.QUEUE_NAME });
  } else {
    logger.warn(
      "REDIS_URL is not set — jobs run in this process and are lost on restart. The worker requires Redis.",
    );
    queue = new InProcessJobQueue({ idempotency, telemetry, logger });
  }

  return {
    settings,
    cooldowns: cache.store,
    queue,
    timers: timerRuntime.queue,
    health: new RuntimeHealth(database, cache, registry, env.INTENT_PROFILE),
    telemetry,
    moderation,
    community,
    invites,
    ai,
    logging,
    analytics,
    export: exportPort,
    music,
    forms: formStore,
    events: eventStore,
    modmail: modmailStore,
    usage,
    security,
    mode: {
      database: database ? "postgres" : "memory",
      cache: cache.mode,
      queue: env.REDIS_URL ? "bullmq" : "in-process",
    },
    async close() {
      await timerRuntime.close();
      await queue.close();
      await cache.close();
      await database?.close();
      await telemetry.shutdown();
    },
  };
}
