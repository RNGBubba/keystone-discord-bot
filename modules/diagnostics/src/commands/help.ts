import {
  UserError,
  defineCommand,
  type CommandCatalogEntry,
  type CommandContext,
  type EmbedField,
} from "@keystone/kernel";
import { CHANGELOG, VERSION } from "../changelog";

function catalog(ctx: CommandContext): readonly CommandCatalogEntry[] {
  if (ctx.catalog.length === 0) {
    throw new UserError("The command catalog is not wired in this process.");
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

function searchLines(entries: readonly CommandCatalogEntry[], query: string): string[] {
  const needle = query.toLowerCase();
  const lines: string[] = [];
  for (const entry of entries) {
    if (
      entry.name.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle) ||
      entry.moduleId.toLowerCase().includes(needle)
    ) {
      lines.push(`**/${entry.name}** — ${entry.description}`);
    }
    for (const subcommand of entry.subcommands) {
      const path = [entry.name, subcommand.group, subcommand.name].filter(Boolean).join(" ");
      if (
        path.toLowerCase().includes(needle) ||
        subcommand.description.toLowerCase().includes(needle)
      ) {
        lines.push(`\`/${path}\` — ${subcommand.description}`);
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
    // `privacy` and `changelog` describe the bot, not the registry, so they must
    // answer even in a process where no catalog was injected.
    const needsCatalog = selected === "browse" || selected === "commands" || selected === "search";
    const entries = needsCatalog ? catalog(ctx) : [];
    const moduleFilter = String(ctx.interaction.options.module ?? "").toLowerCase();
    const visible = moduleFilter
      ? entries.filter((entry) => entry.moduleId === moduleFilter)
      : entries;

    if (selected === "browse") {
      if (visible.length === 0) {
        await ctx.interaction.reply({
          content: `No module named \`${moduleFilter}\` is registered.`,
          ephemeral: true,
        });
        return;
      }
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
            title: "Keystone commands",
            description: `${visible.length} roots · ${subcommands} subcommands. Pick a root, then a subcommand. Use \`/help commands\` for the full list.${ctx.catalog.some((entry) => (entry.type ?? "chat-input") !== "chat-input") ? " Context menus live under right-click → Apps." : ""}`,
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
          content: `No module named \`${moduleFilter}\` is registered.`,
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
            title: "Command catalog",
            description: `${visible.length} roots · ${total} subcommands. Type \`/\` and choose a root to see these actions.`,
            color: 0x5865f2,
            fields,
            footer: {
              text:
                visible.length > 25
                  ? `Showing 25 of ${visible.length} roots; filter with /help browse module:id.`
                  : "Generated from the live registry, never a hand-edited list.",
            },
          },
        ],
      });
      return;
    }

    if (selected === "search") {
      const query = String(ctx.interaction.options.query ?? "").trim();
      if (!query) throw new UserError("Give a word to search for.");
      const lines = searchLines(entries, query);
      if (lines.length === 0) {
        await ctx.interaction.reply({
          content: `No command matches \`${query}\`. Try \`/help browse\`.`,
          ephemeral: true,
        });
        return;
      }
      await ctx.interaction.reply({
        content: `Matches for \`${query}\`:\n${lines.slice(0, 20).join("\n")}`.slice(0, 1_900),
        ephemeral: true,
      });
      return;
    }

    if (selected === "privacy") {
      await ctx.interaction.reply({
        ephemeral: true,
        embeds: [
          {
            title: "Data and privacy",
            description: [
              "Keystone stores guild configuration, cases, tickets, levels, ledger entries, invite joins and AI usage counters.",
              "Prompts and completions are **not** stored by default. Message content is only stored when a feature cannot work without it, such as a ticket transcript.",
              "Every stored domain has a retention window in `memory/vault/01-Mission/Master-Plan.md`.",
              "`/export guild` and `/export delete` are the data-portability path; a deletion receipt keeps counts, not content.",
            ].join("\n\n"),
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
            title: "Keystone changelog",
            description: [
              `**${VERSION}** · latest: ${CHANGELOG[0]?.pass ?? "unknown"}`,
              ...CHANGELOG.slice(0, 3).map(
                (entry) => `**${entry.pass}** (${entry.date}) — ${entry.summary}`,
              ),
            ].join("\n"),
            color: 0x5865f2,
            footer: { text: CHANGELOG[0]?.journal ?? "memory/journal" },
          },
        ],
      });
      return;
    }

    throw new UserError("Unknown help action. Use /help browse.");
  },
  help: {
    category: "Getting started",
    examples: ["/help browse", "/help search query:ban", "/help privacy"],
  },
  notes:
    "The catalog is injected by dispatch from the live registry. There is no second list to maintain, which is why /help cannot advertise a command Discord does not have.",
});
