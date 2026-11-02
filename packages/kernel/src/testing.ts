import { InMemoryCooldownStore } from "./cooldowns";
import { createSilentLogger } from "./logger";
import type {
  CommandCatalogEntry,
  CommandContext,
  HealthProbe,
  HealthReport,
  InteractionLike,
  JobQueue,
  Logger,
  ModerationPort,
  ModuleSettings,
  ReplyInput,
} from "./types";

export interface FakeInteractionInit {
  id?: string;
  commandName?: string;
  commandType?: import("./types").CommandType;
  targetId?: string;
  targetUserId?: string;
  targetContent?: string;
  guildId?: string | null;
  userId?: string;
  channelId?: string | null;
  options?: Record<string, string | number | boolean | null>;
  permissions?: string[];
  subcommand?: string;
  subcommandGroup?: string;
}

/**
 * A token-free stand-in for a Discord interaction. This is what lets a
 * contributor write and run tests for a command in under a second, with no
 * bot, no gateway and no guild.
 */
export class FakeInteraction implements InteractionLike {
  readonly id: string;
  readonly commandName: string;
  readonly commandType?: import("./types").CommandType;
  readonly targetId?: string;
  readonly targetUserId?: string;
  readonly targetContent?: string;
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly userId: string;
  readonly options: Readonly<Record<string, string | number | boolean | null>>;
  readonly subcommand?: string;
  readonly subcommandGroup?: string;
  readonly permissions: readonly string[];
  readonly replies: ReplyInput[] = [];

  #replied = false;
  #deferred = false;

  constructor(init: FakeInteractionInit = {}) {
    this.id = init.id ?? "interaction-1";
    this.commandName = init.commandName ?? "test";
    this.commandType = init.commandType;
    this.targetId = init.targetId;
    this.targetUserId = init.targetUserId;
    this.targetContent = init.targetContent;
    this.guildId = init.guildId === undefined ? "1" : init.guildId;
    this.channelId = init.channelId === undefined ? "99" : init.channelId;
    this.userId = init.userId ?? "42";
    this.options = { ...(init.options ?? {}) };
    this.subcommand = init.subcommand;
    this.subcommandGroup = init.subcommandGroup;
    this.permissions = init.permissions ?? [];
  }

  get replied(): boolean {
    return this.#replied;
  }

  get deferred(): boolean {
    return this.#deferred;
  }

  get lastReply(): ReplyInput | undefined {
    return this.replies.at(-1);
  }

  async reply(input: ReplyInput): Promise<unknown> {
    this.#replied = true;
    this.replies.push(input);
    return undefined;
  }

  async deferReply(): Promise<unknown> {
    this.#deferred = true;
    return undefined;
  }

  async editReply(input: ReplyInput): Promise<unknown> {
    this.replies.push(input);
    return undefined;
  }

  async followUp(input: ReplyInput): Promise<unknown> {
    this.replies.push(input);
    return undefined;
  }
}

export interface TestSettings extends ModuleSettings {
  readonly store: Record<string, unknown>;
}

export function createTestSettings(initial: Record<string, unknown> = {}): TestSettings {
  const store: Record<string, unknown> = { ...initial };
  return {
    store,
    get: async () => ({ ...store }),
    update: async (_guildId, patch) => {
      Object.assign(store, patch);
      return { ...store };
    },
  };
}

/** A queue that accepts everything and does nothing, for command tests. */
export const noopQueue: JobQueue = {
  async enqueue() {
    return "noop";
  },
  async close() {
    /* nothing to close */
  },
};

/** A queue that records enqueues. Tests assert what was scheduled, not timing. */
export class RecordingJobQueue implements JobQueue {
  readonly enqueued: {
    name: string;
    payload: unknown;
    options?: import("./types").JobOptions;
  }[] = [];

  async enqueue(
    name: string,
    payload: unknown,
    options?: import("./types").JobOptions,
  ): Promise<string> {
    this.enqueued.push({ name, payload, options });
    return options?.idempotencyKey ?? `job-${this.enqueued.length}`;
  }

  async close(): Promise<void> {
    /* no resources */
  }
}

export function staticHealth(report?: Partial<HealthReport>): HealthProbe {
  const base: HealthReport = {
    database: { configured: false, reachable: false, migrated: false },
    cache: { configured: false, reachable: false, detail: "memory" },
  };
  return {
    async probe() {
      return { ...base, ...report, database: { ...base.database, ...report?.database } };
    },
  };
}

export interface TestContextOptions {
  interaction?: FakeInteraction;
  moduleId?: string;
  settings?: Record<string, unknown>;
  logger?: Logger;
  now?: () => number;
  queue?: JobQueue;
  timers?: JobQueue;
  health?: HealthProbe;
  moderation?: ModerationPort;
  community?: import("./community").CommunityPort;
  invites?: import("./invites").InvitePort;
  ai?: import("./ai").AiPort;
  logging?: import("./logging").LoggingPort;
  config?: import("./config").ConfigPort;
  export?: import("./export").ExportPort;
  exportFacts?: import("./export").ExportFacts;
  attachments?: import("./export").AttachmentReader;
  music?: import("./music").MusicPort;
  forms?: import("./forms").FormStore;
  events?: import("./events").EventStore;
  modmail?: import("./modmail").ModmailStore;
  catalog?: readonly CommandCatalogEntry[];
}

export type TestContext = CommandContext & { interaction: FakeInteraction };

export function createTestContext(options: TestContextOptions = {}): TestContext {
  const interaction =
    options.interaction ?? new FakeInteraction({ commandName: options.moduleId ?? "test" });
  return {
    interaction,
    moduleId: options.moduleId ?? "test",
    guildId: interaction.guildId,
    userId: interaction.userId,
    commandPath: [interaction.subcommandGroup, interaction.subcommand].filter(
      (part): part is string => Boolean(part),
    ),
    catalog: options.catalog ?? [],
    settings: createTestSettings(options.settings),
    logger: options.logger ?? createSilentLogger(),
    now: options.now ?? (() => 1_700_000_000_000),
    cooldowns: new InMemoryCooldownStore(),
    queue: options.queue ?? noopQueue,
    timers: options.timers ?? noopQueue,
    health: options.health ?? staticHealth(),
    moderation: options.moderation,
    community: options.community,
    invites: options.invites,
    ai: options.ai,
    logging: options.logging,
    config: options.config,
    export: options.export,
    exportFacts: options.exportFacts,
    attachments: options.attachments,
    music: options.music,
    forms: options.forms,
    events: options.events,
    modmail: options.modmail,
  };
}
