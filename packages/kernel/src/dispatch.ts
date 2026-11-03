import { UserError } from "./errors";
import type { ModuleRegistry } from "./registry";
import type { SettingsService } from "./settings";
import { noopTelemetry } from "./telemetry";
import type {
  CommandContext,
  CooldownStore,
  HealthProbe,
  InteractionLike,
  JobQueue,
  Logger,
  ReplyInput,
  Telemetry,
} from "./types";

export interface DispatchDeps {
  registry: ModuleRegistry;
  settings: SettingsService;
  /** Same service, exposed to `/config` through the narrow ConfigPort. */
  config?: import("./config").ConfigPort;
  logger: Logger;
  /** Injected so the guard and the store cannot drift apart. */
  cooldowns: CooldownStore;
  queue: JobQueue;
  /** Delayed gateway work; see `CommandContext.timers`. */
  timers?: JobQueue;
  health: HealthProbe;
  /** Optional: absent in tests that do not exercise moderation. */
  moderation?: import("./types").ModerationPort;
  community?: import("./community").CommunityPort;
  invites?: import("./invites").InvitePort;
  ai?: import("./ai").AiPort;
  logging?: import("./logging").LoggingPort;
  analytics?: import("./analytics").AnalyticsStore;
  export?: import("./export").ExportPort;
  exportFacts?: import("./export").ExportFacts;
  attachments?: import("./export").AttachmentReader;
  music?: import("./music").MusicPort;
  forms?: import("./forms").FormStore;
  events?: import("./events").EventStore;
  modmail?: import("./modmail").ModmailStore;
  /** Optional: records one real row per dispatched guild command. */
  usage?: import("./analytics").CommandUsageStore;
  /** Optional: components render without buttons when it is absent. */
  componentSigner?: import("./components").ComponentSigner;
  /** Optional: when absent, tracing is a no-op and costs nothing. */
  telemetry?: Telemetry;
  /** Injectable clock; defaults to the real one. */
  now?: () => number;
}

export type DispatchStatus = "ok" | "unknown-command" | "blocked" | "error";

export interface DispatchOutcome {
  status: DispatchStatus;
  message?: string;
}

async function respond(ctx: CommandContext, payload: ReplyInput): Promise<void> {
  const { interaction } = ctx;
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (error) {
    ctx.logger.error("failed to deliver response", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The one and only command pipeline: resolve → guard → execute → respond.
 *
 * Every feature goes through here, which is why cooldowns, permission checks
 * and error redaction cannot be forgotten by a module author. The whole run is
 * one span, so a trace can show the command, the database call inside it and
 * the job it enqueued under a single trace id.
 */
function validPath(
  definition: import("./types").CommandDefinition,
  group: string | undefined,
  subcommand: string | undefined,
): boolean {
  if (!group && !subcommand) return true;
  if (group) {
    const found = definition.groups?.find((entry) => entry.name === group);
    return Boolean(found?.subcommands.some((entry) => entry.name === subcommand));
  }
  return Boolean(definition.subcommands?.some((entry) => entry.name === subcommand));
}

export async function dispatchCommand(
  deps: DispatchDeps,
  interaction: InteractionLike,
): Promise<DispatchOutcome> {
  const registered = deps.registry.getCommand(interaction.commandName, interaction.commandType);
  if (!registered) {
    deps.logger.warn("unknown command", { command: interaction.commandName });
    return { status: "unknown-command" };
  }
  if (!validPath(registered.definition, interaction.subcommandGroup, interaction.subcommand)) {
    deps.logger.warn("unknown subcommand", {
      command: interaction.commandName,
      group: interaction.subcommandGroup,
      subcommand: interaction.subcommand,
    });
    return { status: "unknown-command" };
  }

  const commandPath = [interaction.subcommandGroup, interaction.subcommand].filter(
    (part): part is string => Boolean(part),
  );
  const telemetry = deps.telemetry ?? noopTelemetry;
  const ctx: CommandContext = {
    interaction,
    moduleId: registered.moduleId,
    guildId: interaction.guildId,
    userId: interaction.userId,
    commandPath,
    catalog: deps.registry.catalog(),
    settings: deps.settings.forModule(registered.moduleId),
    config: deps.config,
    logger: deps.logger.child(registered.moduleId),
    now: deps.now ?? Date.now,
    cooldowns: deps.cooldowns,
    queue: deps.queue,
    timers: deps.timers,
    health: deps.health,
    moderation: deps.moderation,
    community: deps.community,
    invites: deps.invites,
    ai: deps.ai,
    logging: deps.logging,
    analytics: deps.analytics,
    export: deps.export,
    exportFacts: deps.exportFacts,
    attachments: deps.attachments,
    music: deps.music,
    forms: deps.forms,
    events: deps.events,
    modmail: deps.modmail,
    componentSigner: deps.componentSigner,
  };

  const startedAt = deps.now?.() ?? Date.now();
  const recordUsage = async (status: DispatchStatus): Promise<void> => {
    if (!deps.usage || !interaction.guildId) return;
    try {
      await deps.usage.record({
        guildId: interaction.guildId,
        command: interaction.commandName,
        path: commandPath.join(" "),
        status: status === "ok" ? "ok" : status === "blocked" ? "blocked" : "error",
        durationMs: Math.max(0, (deps.now?.() ?? Date.now()) - startedAt),
        at: new Date(deps.now?.() ?? Date.now()).toISOString(),
      });
    } catch (error) {
      // Analytics is an observer. A failed write must never turn a successful
      // command into an error, and the warning is the only side effect.
      deps.logger.warn("command usage record failed", {
        command: interaction.commandName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  try {
    const spanName = ["command", interaction.commandName, ...commandPath].join(" ");
    const result = await telemetry.withSpan(spanName, async () => {
      for (const guard of registered.definition.guards ?? []) {
        const guardResult = await guard(ctx);
        if (!guardResult.ok) {
          await respond(ctx, { content: guardResult.message, ephemeral: true });
          return { status: "blocked", message: guardResult.message } as DispatchOutcome;
        }
      }

      await registered.definition.execute(ctx);
      return { status: "ok" } as DispatchOutcome;
    });
    await recordUsage(result.status);
    return result;
  } catch (error) {
    const userMessage =
      error instanceof UserError
        ? error.message
        : "Something went wrong. The error has been logged.";

    deps.logger.error("command failed", {
      command: interaction.commandName,
      module: registered.moduleId,
      guildId: interaction.guildId,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });

    await respond(ctx, { content: userMessage, ephemeral: true });
    await recordUsage("error");
    return { status: "error", message: userMessage };
  }
}
