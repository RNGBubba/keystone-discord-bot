import {
  UserError,
  defineCommand,
  type CommandCatalogEntry,
  type CommandContext,
  type EmbedField,
} from "@keystone/kernel";
import { DEFAULT_LOCALE, guildLocale, lookupMessage, t } from "@keystone/i18n";
import { CHANGELOG, VERSION } from "../changelog";

function catalog(ctx: CommandContext, locale: string): readonly CommandCatalogEntry[] {
  if (ctx.catalog.length === 0) {
    throw new UserError(t(locale, "help.catalogMissing"));
  }
  // Context menus are discovered by right-clicking, not by typing `/`.
  return ctx.catalog.filter((entry) => (entry.type ?? "chat-input") === "chat-input");
}

function moduleGroups(entries: readonly CommandCatalogEntry[]): Map<string, CommandCatalogEntry[]> {
  const groups = new Map<string, CommandCatalogEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.moduleId) ?? [];
    list.push(entry);
    groups.set(entry.moduleId, list);
  }
  return groups;
}

function rootField(entry: CommandCatalogEntry): EmbedField {
  const names = entry.subcommands.map((subcommand) =>
    subcommand.group ? `${subcommand.group} ${subcommand.name}` : subcommand.name,
  );
  return {
    name: `/${entry.name} · ${entry.subcommands.length} subcommands`,
    value: names.length > 0 ? names.map((name) => `\`${name}\``).join(" ") : "—",
  };
}

/**
 * A command's own description, translated when the locale has one. The search
 * matches both languages, so a German word finds the command whose German
 * description contains it and an English word still works.
 */
function describe(locale: string, key: string, fallback: string): string {
  return lookupMessage(locale, key) ?? fallback;
}

function searchLines(
  entries: readonly CommandCatalogEntry[],
  query: string,
  locale: string,
): string[] {
  const needle = query.toLowerCase();
  const lines: string[] = [];
  for (const entry of entries) {
    const description = describe(locale, `command.${entry.name}.description`, entry.description);
    if (
      entry.name.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle) ||
      description.toLowerCase().includes(needle) ||
      entry.moduleId.toLowerCase().includes(needle)
    ) {
      lines.push(`**/${entry.name}** — ${description}`);
    }
    for (const subcommand of entry.subcommands) {
      const path = [entry.name, subcommand.group, subcommand.name].filter(Boolean).join(" ");
      const localized = describe(
        locale,
        `command.${entry.name}.${subcommand.name}.description`,
        subcommand.description,
      );
      if (
        path.toLowerCase().includes(needle) ||
        subcommand.description.toLowerCase().includes(needle) ||
        localized.toLowerCase().includes(needle)
      ) {
        lines.push(`\`/${path}\` — ${localized}`);
      }
    }
  }
  return lines;
}

export const help = defineCommand({
  name: "help",
  description: "Browse every Keystone command, search the catalog and check data retention.",
  subcommands: [
    {
      name: "browse",
      description: "List the command roots, grouped by module.",
      options: [{ type: "string", name: "module", description: "Only show one module id" }],
    },
    {
      name: "commands",
      description: "Show every root and its subcommands.",
      options: [{ type: "string", name: "module", description: "Only show one module id" }],
    },
    {
      name: "search",
      description: "Find a command by name, description or module.",
      options: [{ type: "string", name: "query", description: "Word to search for", required: true }],
    },
    { name: "privacy", description: "Explain what Keystone stores and what it does not." },
    { name: "changelog", description: "Show the current version and the latest pass." },
  ],
  async execute(ctx: CommandContext): Promise<void> {
    const selected = ctx.commandPath[0] ?? "browse";
    const locale = ctx.guildId ? await guildLocale(ctx.config, ctx.guildId) : DEFAULT_LOCALE;
    // `privacy` and `changelog` describe the bot, not the registry, so they must
    // answer even in a process where no catalog was injected.
    const needsCatalog = selected === "browse" || selected === "commands" || selected === "search";
    const entries = needsCatalog ? catalog(ctx, locale) : [];
    const moduleFilter = String(ctx.interaction.options.module ?? "").toLowerCase();
    const visible = moduleFilter
      ? entries.filter((entry) => entry.moduleId === moduleFilter)
      : entries;

    if (selected === "browse") {
      if (visible.length === 0) {
        await ctx.interaction.reply({
          content: t(locale, "help.noModule", moduleFilter),
          ephemeral: true,
        });
        return;
      }
      const contextMenus = ctx.catalog.some(
        (entry) => (entry.type ?? "chat-input") !== "chat-input",
      );
      const fields = [...moduleGroups(visible)].map(([moduleId, roots]) => ({
        name: moduleId,
        value: roots.map((entry) => `\`/${entry.name}\``).join(" · ").slice(0, 1_024),
        inline: true,
      }));
      const subcommands = visible.reduce((sum, entry) => sum + entry.subcommands.length, 0);
      await ctx.interaction.reply({
        ephemeral: true,
        embeds: [
          {
            title: t(locale, "help.browse.title"),
            description:
              t(locale, "help.browse.description", visible.length, subcommands) +
              (contextMenus ? t(locale, "help.browse.contextHint") : ""),
            color: 0x5865f2,
            fields,
          },
        ],
      });
      return;
    }

    if (selected === "commands") {
      if (visible.length === 0) {
        await ctx.interaction.reply({
          content: t(locale, "help.noModule", moduleFilter),
          ephemeral: true,
        });
        return;
      }
      const fields = visible.slice(0, 25).map(rootField);
      const total = visible.reduce((sum, entry) => sum + entry.subcommands.length, 0);
      await ctx.interaction.reply({
        ephemeral: true,
        embeds: [
          {
            title: t(locale, "help.commands.title"),
            description: t(locale, "help.commands.description", visible.length, total),
            color: 0x5865f2,
            fields,
            footer: {
              text:
                visible.length > 25
                  ? t(locale, "help.commands.footer.limit", 25, visible.length)
                  : t(locale, "help.commands.footer.generated"),
            },
          },
        ],
      });
      return;
    }

    if (selected === "search") {
      const query = String(ctx.interaction.options.query ?? "").trim();
      if (!query) throw new UserError(t(locale, "help.search.noQuery"));
      const lines = searchLines(entries, query, locale);
      if (lines.length === 0) {
        await ctx.interaction.reply({
          content: t(locale, "help.search.empty", query),
          ephemeral: true,
        });
        return;
      }
      await ctx.interaction.reply({
        content: t(locale, "help.search.matches", query, lines.slice(0, 20).join("\n")).slice(
          0,
          1_900,
        ),
        ephemeral: true,
      });
      return;
    }

    if (selected === "privacy") {
      await ctx.interaction.reply({
        ephemeral: true,
        embeds: [
          {
            title: t(locale, "help.privacy.title"),
            description: t(locale, "help.privacy.body"),
            color: 0x57f287,
          },
        ],
      });
      return;
    }

    if (selected === "changelog") {
      await ctx.interaction.reply({
        ephemeral: true,
        embeds: [
          {
            title: t(locale, "help.changelog.title"),
            description: [
              t(locale, "help.changelog.latest", VERSION, CHANGELOG[0]?.pass ?? "unknown"),
              ...CHANGELOG.slice(0, 3).map((entry) =>
                t(locale, "help.changelog.entry", entry.pass, entry.date, entry.summary),
              ),
            ].join("\n"),
            color: 0x5865f2,
            footer: { text: CHANGELOG[0]?.journal ?? "memory/journal" },
          },
        ],
      });
      return;
    }

    throw new UserError(t(locale, "help.unknown"));
  },
  help: {
    category: "Getting started",
    examples: ["/help browse", "/help search query:ban", "/help privacy"],
  },
  notes:
    "The catalog is injected by dispatch from the live registry. There is no second list to maintain, which is why /help cannot advertise a command Discord does not have.",
});
