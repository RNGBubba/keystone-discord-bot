import {
  UserError,
  cooldown,
  defineCommand,
  requireGuild,
  requirePermissions,
  type CommandContext,
  type ConfigModuleView,
  type ConfigPort,
} from "@keystone/kernel";

function mark(ready: boolean): string {
  return ready ? "ready" : "not ready";
}

function stringOption(ctx: CommandContext, name: string): string | undefined {
  const value = ctx.interaction.options[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanOption(ctx: CommandContext, name: string): boolean | undefined {
  const value = ctx.interaction.options[name];
  return typeof value === "boolean" ? value : undefined;
}

function configPort(ctx: CommandContext): ConfigPort {
  if (!ctx.config) throw new UserError("Configuration is not wired in this process.");
  return ctx.config;
}

function findModule(modules: readonly ConfigModuleView[], id: string): ConfigModuleView {
  const found = modules.find((module) => module.id === id);
  if (!found) {
    throw new UserError(
      `Unknown module "${id}". Use one of: ${modules.map((module) => module.id).join(", ")}.`,
    );
  }
  return found;
}

function countSummary(counts: Readonly<Record<string, number>> | undefined): string {
  const parts = Object.entries(counts ?? {})
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${value} ${key.replace(/([A-Z])/g, " $1").toLowerCase()}`);
  return parts.length > 0 ? parts.join(" · ") : "no rows in this scope";
}

/**
 * `/setup status` answers one question: is this deployment actually ready?
 *
 * It reads the health port and this module's own settings, and never touches
 * another module's configuration. Every failing line names the fix.
 */
async function statusAction(ctx: CommandContext): Promise<void> {
  const guildId = ctx.guildId;
  if (!guildId) return; // requireGuild guarantees it; keeps TypeScript honest.

  const [health, settings] = await Promise.all([
    ctx.health.probe(),
    ctx.settings.get(guildId),
  ]);

  const databaseReady = health.database.reachable && health.database.migrated;
  const cacheReady = health.cache.configured && health.cache.reachable;
  const moduleEnabled = settings.enabled === true;
  const capabilities = health.capabilities;
  const disabled = capabilities?.disabledFeatures ?? [];

  const intentValue = capabilities
    ? [
        `profile: ${capabilities.profile}`,
        disabled.length > 0 ? `disabled: ${disabled.join("; ")}` : "every declared intent requested",
      ].join("\n")
    : "not reported";

  const databaseValue = health.database.configured
    ? [
        `${mark(databaseReady)} · migrations ${health.database.migrated ? "applied" : "pending"}`,
        health.database.detail,
      ]
        .filter(Boolean)
        .join("\n")
    : "not configured · settings are in memory and reset on restart";

  const cacheValue = health.cache.configured
    ? `${mark(cacheReady)}${health.cache.detail ? ` · ${health.cache.detail}` : ""}`
    : "not configured · cooldowns are process-local";

  const next = !health.database.configured
    ? "Set `DATABASE_URL` in `.env`, then run `pnpm db:migrate`."
    : !health.database.reachable
      ? "The database is configured but unreachable. Check the URL and that Postgres is running."
      : !health.database.migrated
        ? "Run `pnpm db:migrate` — migrations are an explicit step, never run on boot."
        : !health.cache.configured
          ? "Optional: set `REDIS_URL` to share cooldowns and run jobs in the worker."
          : disabled.length > 0
            ? "Core is ready. Set `INTENT_PROFILE=full` and enable the optional intents in the Developer Portal to turn on the features named above."
            : "Everything needed is ready. Try `/ping`, then `/about`.";

  await ctx.interaction.reply({
    ephemeral: true,
    embeds: [
      {
        title: "Keystone setup — readiness",
        description: "This command only reads state. Nothing was changed.",
        color: databaseReady ? 0x57f287 : 0xfee75c,
        fields: [
          { name: "Database", value: databaseValue },
          { name: "Redis / cooldowns", value: cacheValue },
          { name: "Gateway intents", value: intentValue },
          { name: "Setup module", value: moduleEnabled ? "enabled here" : "disabled here", inline: true },
          { name: "Next step", value: next },
        ],
        footer: { text: "Settings are per guild; secrets never appear in this output." },
      },
    ],
  });
}

async function moduleAction(ctx: CommandContext): Promise<void> {
  const config = configPort(ctx);
  const guildId = ctx.guildId as string;
  const modules = await config.list(guildId);
  const id = stringOption(ctx, "module");

  if (!id) {
    await ctx.interaction.reply({
      ephemeral: true,
      content: `Setup · ${modules.length} modules · ${modules.filter((module) => module.settings.enabled === false).length} disabled here`,
      embeds: [
        {
          title: "Module switchboard",
          description:
            "Use `/setup module module:<id> enabled:<true|false>` to change one. Values are validated by the module's own schema.",
          color: 0x5865f2,
          fields: modules.map((module) => ({
            name: module.id,
            value: `${module.name} · ${module.settings.enabled === false ? "disabled" : "enabled"} · ${Object.keys(module.settings).length} keys`,
            inline: true,
          })),
          footer: { text: "No environment secret is stored in module settings." },
        },
      ],
    });
    return;
  }

  const selected = findModule(modules, id);
  if (typeof selected.settings.enabled !== "boolean") {
    throw new UserError(`Module "${id}" does not expose an enabled setting.`);
  }
  const enabled = booleanOption(ctx, "enabled");
  if (enabled === undefined) {
    await ctx.interaction.reply({
      ephemeral: true,
      content: `\`${id}\` is ${selected.settings.enabled ? "enabled" : "disabled"} here · ${Object.keys(selected.settings).length} settings. Use \`enabled:<true|false>\` to change it.`,
    });
    return;
  }

  const updated = await config.update(guildId, id, { enabled }, {
    actorId: ctx.userId,
    source: "command",
  });
  await ctx.interaction.reply({
    ephemeral: true,
    content: `\`${id}\` is now ${updated.enabled === false ? "disabled" : "enabled"}.`,
    embeds: [
      {
        title: "Module updated",
        description: `The \`${id}\` schema accepted the change and stored the validated settings.`,
        color: updated.enabled === false ? 0xfee75c : 0x57f287,
        fields: [
          { name: "Module", value: id, inline: true },
          { name: "Enabled", value: updated.enabled === false ? "false" : "true", inline: true },
        ],
        footer: { text: "Commands remain registered; disabling a module refuses its actions." },
      },
    ],
  });
}

async function verifyAction(ctx: CommandContext): Promise<void> {
  const config = configPort(ctx);
  const guildId = ctx.guildId as string;
  const health = await ctx.health.probe();

  let modules: ConfigModuleView[] = [];
  let settingsError: string | undefined;
  try {
    modules = await config.list(guildId);
  } catch (error) {
    settingsError = error instanceof Error ? error.message : String(error);
  }

  const databaseReady = health.database.configured && health.database.reachable && health.database.migrated;
  const cacheReady = health.cache.configured ? health.cache.reachable : undefined;
  const chatInput = ctx.catalog.filter((entry) => (entry.type ?? "chat-input") === "chat-input");
  const subcommands = chatInput.reduce((sum, entry) => sum + entry.subcommands.length, 0);
  const commandsReady = chatInput.length > 0;
  const disabled = health.capabilities?.disabledFeatures ?? [];
  const ready = databaseReady && !settingsError && commandsReady;

  const problems = [
    !databaseReady ? "database" : undefined,
    settingsError ? "settings" : undefined,
    !commandsReady ? "command catalog" : undefined,
  ].filter(Boolean);

  await ctx.interaction.reply({
    ephemeral: true,
    embeds: [
      {
        title: "Keystone setup — verification",
        description: ready
          ? "Every check passed. This command read state only."
          : `Not ready: ${problems.join(", ")}. Nothing was changed.`,
        color: ready ? 0x57f287 : 0xfee75c,
        fields: [
          {
            name: "Database",
            value: databaseReady
              ? `ready · migrations applied${health.database.detail ? ` · ${health.database.detail}` : ""}`
              : `not ready${health.database.configured ? " · check the URL and Postgres" : " · DATABASE_URL is not configured"}`,
            inline: false,
          },
          {
            name: "Settings",
            value: settingsError
              ? `failed · ${settingsError.slice(0, 900)}`
              : `${modules.length} modules parsed by their own schemas`,
            inline: false,
          },
          {
            name: "Commands",
            value: commandsReady
              ? `${chatInput.length} roots · ${subcommands} subcommands in the catalog`
              : "the command catalog is empty",
            inline: false,
          },
          {
            name: "Cache and intents",
            value: [
              cacheReady === undefined
                ? "cache: not configured (cooldowns are process-local)"
                : `cache: ${mark(cacheReady)}`,
              health.capabilities
                ? `intents: ${health.capabilities.profile}${disabled.length > 0 ? ` · ${disabled.length} feature group(s) disabled` : ""}`
                : "intents: not reported",
            ].join("\n"),
            inline: false,
          },
          {
            name: "Next step",
            value: ready
              ? "Use `/setup module` to review enablement, or `/config` to change one setting."
              : "Fix the named check, then run `/setup verify` again.",
            inline: false,
          },
        ],
        footer: { text: "Read-only verification; no setting, case or ledger row is written." },
      },
    ],
  });
}

async function importAction(ctx: CommandContext): Promise<void> {
  const exportPort = ctx.export;
  const attachments = ctx.attachments;
  if (!exportPort || !attachments) {
    throw new UserError("Import preview is not wired in this process.");
  }
  const bundle = stringOption(ctx, "bundle");
  if (!bundle) throw new UserError("Attach a .json keystone.export bundle.");
  const mode = stringOption(ctx, "mode") === "merge" ? "merge" : "replace";
  const text = await attachments.read(bundle);
  const result = await exportPort.importBundle(ctx.guildId as string, text, {
    mode,
    dryRun: true,
    actorId: ctx.userId,
  });

  await ctx.interaction.reply({
    ephemeral: true,
    content: `Import preview · ${result.state} · ${countSummary(result.counts)}`,
    embeds: [
      {
        title: "Bundle preview",
        description:
          "This is a dry run; no rows were written. Use `/export import` with `dry_run:false` and the same bundle to apply it.",
        color: 0x5865f2,
        fields: [
          { name: "Mode", value: mode, inline: true },
          { name: "State", value: result.state, inline: true },
          { name: "Counts", value: countSummary(result.counts), inline: false },
          {
            name: "Warnings",
            value: result.warnings.length > 0 ? result.warnings.join("\n").slice(0, 1_024) : "None.",
            inline: false,
          },
        ],
        footer: { text: "Preview only. The applying importer is /export import." },
      },
    ],
  });
}

async function resetAction(ctx: CommandContext): Promise<void> {
  const config = configPort(ctx);
  const guildId = ctx.guildId as string;
  const id = stringOption(ctx, "module");
  if (!id) throw new UserError("Choose the module to reset.");

  const before = findModule(await config.list(guildId), id);
  await config.reset(guildId, id, { actorId: ctx.userId, source: "command" });
  const after = findModule(await config.list(guildId), id);

  await ctx.interaction.reply({
    ephemeral: true,
    content: `Reset \`${id}\` to schema defaults · ${Object.keys(after.settings).length} settings · ${after.settings.enabled === false ? "disabled" : "enabled"}.`,
    embeds: [
      {
        title: "Module reset",
        description: `The stored record for \`${id}\` was removed; the module's Zod defaults apply again.`,
        color: 0x57f287,
        fields: [
          { name: "Module", value: id, inline: true },
          {
            name: "Before",
            value: `${before.settings.enabled === false ? "disabled" : "enabled"} · ${Object.keys(before.settings).length} keys`,
            inline: true,
          },
          {
            name: "After",
            value: `${after.settings.enabled === false ? "disabled" : "enabled"} · ${Object.keys(after.settings).length} keys`,
            inline: true,
          },
        ],
        footer: { text: "Cases, levels and ledger rows are not touched; this resets settings only." },
      },
    ],
  });
}

export const setup = defineCommand({
  name: "setup",
  description: "Check readiness, manage modules, preview an import or reset settings.",
  subcommands: [
    { name: "status", description: "Check database, migrations, cache and module readiness." },
    {
      name: "module",
      description: "List modules, inspect one, or enable/disable it.",
      options: [
        { type: "string", name: "module", description: "Module id, for example music" },
        { type: "boolean", name: "enabled", description: "Set enablement; omit to inspect one module" },
      ],
    },
    { name: "verify", description: "Verify settings, schema parsing and the command catalog." },
    {
      name: "import",
      description: "Preview a keystone.export bundle before /export import applies it.",
      options: [
        {
          type: "attachment",
          name: "bundle",
          description: "A .json keystone.export bundle",
          required: true,
        },
        {
          type: "string",
          name: "mode",
          description: "How an apply would merge",
          choices: [
            { name: "replace", value: "replace" },
            { name: "merge", value: "merge" },
          ],
        },
      ],
    },
    {
      name: "reset",
      description: "Reset one module's stored settings to its schema defaults.",
      options: [
        { type: "string", name: "module", description: "Module id to reset", required: true },
      ],
    },
  ],
  guards: [requireGuild, requirePermissions("ManageGuild"), cooldown(2_000)],
  async execute(ctx: CommandContext): Promise<void> {
    const selected = ctx.commandPath[0] ?? "status";
    if (selected === "status") return statusAction(ctx);
    if (selected === "module") return moduleAction(ctx);
    if (selected === "verify") return verifyAction(ctx);
    if (selected === "import") return importAction(ctx);
    if (selected === "reset") return resetAction(ctx);
    throw new UserError("Unknown setup action.");
  },
  help: {
    category: "Operations",
    examples: [
      "/setup status",
      "/setup module",
      "/setup module module:music enabled:false",
      "/setup verify",
      "/setup import bundle:<file> mode:merge",
      "/setup reset module:moderation",
    ],
  },
  notes:
    "The first command a new operator runs. Status is read-only; module and reset change only this guild's settings through the same SettingsService and Zod schema as /config; import is a preview only and never writes. No command here can delete cases, levels or ledger rows.",
});
