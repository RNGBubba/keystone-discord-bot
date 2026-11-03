import { ZodError } from "zod";
import {
  UserError,
  cooldown,
  defineCommand,
  requireGuild,
  requirePermissions,
  type CommandContext,
  type ConfigPort,
  type ConfigModuleView,
} from "@keystone/kernel";

const MODULE = {
  type: "string",
  name: "module",
  description: "Module id, for example ai or moderation",
  required: true,
} as const;

const KEY = {
  type: "string",
  name: "key",
  description: "Setting key; dotted paths such as automod.links are supported",
} as const;

const VALUE = {
  type: "string",
  name: "value",
  description: 'JSON value, for example true, 7, "text" or ["a","b"]',
  required: true,
} as const;

function port(ctx: CommandContext): ConfigPort {
  if (!ctx.config) throw new UserError("Configuration is not wired in this process.");
  return ctx.config;
}

function option(ctx: CommandContext, key: string): string | undefined {
  const value = ctx.interaction.options[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function parseValue(input: string): unknown {
  // Discord snowflakes exceed Number.MAX_SAFE_INTEGER; keep channel/user ids
  // as strings instead of silently rounding them through JSON.parse.
  if (/^\d{15,25}$/.test(input.trim())) return input.trim();
  try {
    return JSON.parse(input);
  } catch {
    // A bare word is the common case for a channel id, word list entry or
    // message. Treating it as a string is less surprising than refusing it.
    return input;
  }
}

function formatValue(value: unknown): string {
  const rendered = JSON.stringify(value) ?? String(value);
  return rendered.length > 900 ? `${rendered.slice(0, 900)}…` : rendered;
}

function assertSafePath(key: string): string[] {
  const parts = key.split(".");
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        !/^[A-Za-z][A-Za-z0-9_-]*$/.test(part) ||
        ["__proto__", "constructor", "prototype"].includes(part),
    )
  ) {
    throw new UserError("The key must be a dotted path such as automod.links.");
  }
  return parts;
}

function patchFor(current: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = assertSafePath(key);
  const patch: Record<string, unknown> = {};
  let target: Record<string, unknown> = patch;
  let source: unknown = current;

  for (const part of parts.slice(0, -1)) {
    const existing =
      source && typeof source === "object" && !Array.isArray(source)
        ? (source as Record<string, unknown>)[part]
        : undefined;
    const child =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    target[part] = child;
    target = child;
    source = existing;
  }

  target[parts[parts.length - 1] as string] = value;
  return patch;
}

function valueAt(settings: Record<string, unknown>, key: string): unknown {
  let cursor: unknown = settings;
  for (const part of assertSafePath(key)) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function moduleFields(modules: readonly ConfigModuleView[]) {
  return modules.map((module) => ({
    name: module.id,
    value: `${module.name}${module.settings.enabled === false ? " · disabled" : ""} · ${Object.keys(module.settings).length} keys`,
    inline: true,
  }));
}

export const config = defineCommand({
  name: "config",
  description: "Inspect and change any module's per-guild settings through the bot's own schema.",
  subcommands: [
    { name: "list", description: "List every module and whether it is enabled here." },
    {
      name: "get",
      description: "Show one module's effective settings, or one dotted key.",
      options: [MODULE, KEY],
    },
    {
      name: "set",
      description: "Validate and write one dotted key; the module's Zod schema is the gate.",
      // Discord requires required options before optional ones, so `set`
      // declares its own required key instead of reusing get's optional one.
      options: [MODULE, { ...KEY, required: true }, VALUE],
    },
    { name: "export", description: "Export every module's effective settings as JSON." },
  ],
  guards: [requireGuild, requirePermissions("ManageGuild"), cooldown(2_000)],
  async execute(ctx: CommandContext): Promise<void> {
    const settings = port(ctx);
    const guildId = ctx.guildId as string;
    const selected = ctx.commandPath[0] ?? "list";

    if (selected === "list") {
      const modules = await settings.list(guildId);
      await ctx.interaction.reply({
        ephemeral: true,
        content: `Configuration · ${modules.length} modules · ${modules.filter((module) => module.settings.enabled === false).length} disabled here`,
        embeds: [
          {
            title: "Module settings",
            description: "Use `/config get module:<id>` to inspect one module or `/config export` for JSON.",
            color: 0x5865f2,
            fields: moduleFields(modules),
            footer: { text: "Values are guild-scoped; no environment secrets are stored in module settings." },
          },
        ],
      });
      return;
    }

    if (selected === "export") {
      const modules = await settings.list(guildId);
      const payload = {
        version: 1,
        guildId,
        generatedAt: new Date(ctx.now()).toISOString(),
        modules: Object.fromEntries(modules.map((module) => [module.id, module.settings])),
      };
      let json = JSON.stringify(payload);
      if (json.length > 3_850) {
        json = JSON.stringify({ ...payload, modules: {}, truncated: true });
      }
      await ctx.interaction.reply({
        ephemeral: true,
        content: `Configuration export · ${modules.length} modules · JSON is in the embed.`,
        embeds: [
          {
            title: "Configuration export",
            description: `\`\`\`json\n${json}\n\`\`\``.slice(0, 4_096),
            color: 0x5865f2,
            footer: { text: "Effective settings after defaults; no token or environment value is included." },
          },
        ],
      });
      return;
    }

    const moduleId = option(ctx, "module");
    if (!moduleId) throw new UserError("Choose a module with the `module` option.");
    const modules = await settings.list(guildId);
    const selectedModule = findModule(modules, moduleId);
    const key = option(ctx, "key");

    if (selected === "get") {
      if (!key) {
        await ctx.interaction.reply({
          ephemeral: true,
          content: `Configuration · \`${moduleId}\` · ${Object.keys(selectedModule.settings).sort().join(", ")}`,
          embeds: [
            {
              title: `${selectedModule.name} settings`,
              description: `\`\`\`json\n${JSON.stringify(selectedModule.settings, null, 2)}\n\`\`\``.slice(0, 4_096),
              color: 0x5865f2,
              footer: { text: "Effective settings after defaults and schema validation." },
            },
          ],
        });
        return;
      }

      const value = valueAt(selectedModule.settings, key);
      if (value === undefined) {
        throw new UserError(`\`${moduleId}.${key}\` is not set. Use \`/config get module:${moduleId}\` to see the keys.`);
      }
      await ctx.interaction.reply({
        ephemeral: true,
        content: `\`${moduleId}.${key}\` = \`${formatValue(value)}\``,
      });
      return;
    }

    if (selected === "set") {
      if (!key) throw new UserError("Choose the dotted key to change.");
      const raw = option(ctx, "value");
      if (raw === undefined) throw new UserError("Provide a value. Bare words are strings; booleans and numbers are JSON literals.");

      const value = parseValue(raw);
      let updated: Record<string, unknown>;
      try {
        updated = await settings.update(guildId, moduleId, patchFor(selectedModule.settings, key, value), {
          actorId: ctx.userId,
          source: "command",
        });
      } catch (error) {
        if (error instanceof ZodError) {
          const issues = error.issues
            .map((issue) => `${issue.path.join(".") || key}: ${issue.message}`)
            .join("; ");
          throw new UserError(`The \`${moduleId}\` schema rejected that value — ${issues}`);
        }
        throw error;
      }
      const applied = valueAt(updated, key);
      await ctx.interaction.reply({
        ephemeral: true,
        content: `Set \`${moduleId}.${key}\` to \`${formatValue(applied)}\`.`,
        embeds: [
          {
            title: "Configuration updated",
            description: `The \`${moduleId}\` schema accepted the value and stored the validated settings.`,
            color: 0x57f287,
            fields: [
              { name: "Module", value: moduleId, inline: true },
              { name: "Key", value: key, inline: true },
            ],
            footer: { text: "Revert by setting the old value; /config export shows the effective record." },
          },
        ],
      });
      return;
    }

    throw new UserError("Unknown config action.");
  },
  help: {
    category: "Operations",
    examples: [
      "/config list",
      "/config get module:ai",
      "/config get module:moderation key:automod.links",
      "/config set module:moderation key:automod.links value:delete",
      "/config set module:ai key:monthlyBudgetUsd value:5",
      "/config export",
    ],
  },
  notes:
    "One settings path for every module. Values are parsed as JSON when possible and then validated by the owning module's Zod schema before anything is stored. The command never reads another module's table directly.",
});
