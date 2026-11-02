import type {
  JobQueue,
  ModerationPort,
  CommunityPort,
  SettingsService,
  Telemetry,
  Logger,
  IdempotencyStore,
} from "@keystone/kernel";
import {
  BullJobQueue,
  InProcessJobQueue,
  createBullWorker,
  type JobHandler,
} from "@keystone/queue";
import {
  ContentService,
  communitySettingsSchema,
} from "@keystone/module-community";
import {
  TemporaryActionService,
  moderationSettingsSchema,
} from "@keystone/module-moderation";

export interface TimerRuntime {
  readonly queue: JobQueue;
  close(): Promise<void>;
}

export interface TimerRuntimeOptions {
  readonly redisUrl: string | undefined;
  readonly queueName: string;
  readonly idempotency: IdempotencyStore;
  readonly settings: SettingsService;
  readonly moderation: ModerationPort;
  readonly community: CommunityPort;
  readonly logger: Logger;
  readonly telemetry: Telemetry;
}

/**
 * One consumer for delayed work that needs the gateway.
 *
 * The worker process owns database-only jobs. It has no Discord client, so a
 * ban expiry or a scheduled message cannot run there without a second Discord
 * adapter. This queue is the same BullMQ mechanism on a separate name; the
 * bot is its only consumer, and the module services are shared, not copied.
 */
export async function createTimerRuntime(options: TimerRuntimeOptions): Promise<TimerRuntime> {
  const moderationSettings = options.settings.forModule("moderation");
  const communitySettings = options.settings.forModule("community");

  const handlers: Record<string, JobHandler> = {
    "moderation.expire": async (payload) => {
      const { caseId, guildId } = payloadCaseId(payload);
      const service = new TemporaryActionService(
        options.moderation.cases,
        options.moderation.actions,
        moderationSettingsSchema.parse(await moderationSettings.get(guildId)),
        Date.now,
      );
      const result = await service.expire(caseId);
      if (result.status === "failed") throw new Error(result.detail);
      if (result.status === "not-due") {
        throw new Error(`case ${caseId} is not due for ${result.remainingMs}ms`);
      }
      if (result.status === "unsupported") {
        options.logger.warn("unsupported temporary action", {
          caseId,
          action: result.action,
        });
      }
    },

    "content.deliver": async (payload) => {
      const data = payloadDelivery(payload);
      const config = communitySettingsSchema.parse(await communitySettings.get(data.guildId));
      const service = new ContentService(
        options.community.store,
        options.community.actions,
        config,
      );
      const result = await service.deliver(data.guildId, data.kind, data.id);
      if (result.status === "failed") throw new Error(result.detail);
      if (result.status === "not-due") {
        throw new Error(`${data.kind}:${data.id} is not due for ${result.remainingMs}ms`);
      }
    },
  };

  if (options.redisUrl) {
    const queue = BullJobQueue.create({
      redisUrl: options.redisUrl,
      queueName: `${options.queueName}.bot`,
      telemetry: options.telemetry,
    });
    const worker = createBullWorker({
      redisUrl: options.redisUrl,
      queueName: `${options.queueName}.bot`,
      handlers,
      idempotency: options.idempotency,
      logger: options.logger,
      telemetry: options.telemetry,
    });
    return {
      queue,
      async close() {
        await worker.close();
        await queue.close();
      },
    };
  }

  const queue = new InProcessJobQueue({
    idempotency: options.idempotency,
    telemetry: options.telemetry,
    logger: options.logger,
  });
  for (const [name, handler] of Object.entries(handlers)) queue.register(name, handler);
  return {
    queue,
    async close() {
      await queue.close();
    },
  };
}

function payloadCaseId(payload: unknown): { caseId: string; guildId: string } {
  const data = payload as { caseId?: unknown; guildId?: unknown } | undefined;
  if (typeof data?.caseId !== "string" || !data.caseId) {
    throw new Error("moderation.expire needs { caseId }");
  }
  if (typeof data.guildId !== "string" || !data.guildId) {
    throw new Error("moderation.expire needs { guildId }");
  }
  return { caseId: data.caseId, guildId: data.guildId };
}

function payloadDelivery(payload: unknown): {
  guildId: string;
  kind: "reminder" | "scheduled_message";
  id: string;
} {
  const data = payload as
    | { guildId?: unknown; kind?: unknown; id?: unknown }
    | undefined;
  if (typeof data?.guildId !== "string" || !data.guildId) {
    throw new Error("content.deliver needs { guildId }");
  }
  if (data.kind !== "reminder" && data.kind !== "scheduled_message") {
    throw new Error("content.deliver needs a known kind");
  }
  if (typeof data.id !== "string" || !data.id) {
    throw new Error("content.deliver needs { id }");
  }
  return { guildId: data.guildId, kind: data.kind, id: data.id };
}
