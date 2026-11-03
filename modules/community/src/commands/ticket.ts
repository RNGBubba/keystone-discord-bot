import { defineCommand, UserError, type CommandContext, type CommandOption } from "@keystone/kernel";
import { guildLocale, t } from "@keystone/i18n";
import { TICKET_PANEL_TTL_MS } from "../panels";
import { TicketService } from "../tickets";
import { channelId, port, requirePermission, settingsFor, text, userId } from "./helpers";

const OPTIONS = {
  subject: { type: "string", name: "subject", description: "Ticket subject" },
  user: { type: "user", name: "user", description: "Member to add" },
  channel: { type: "channel", name: "channel", description: "Panel or parent channel" },
  ticket: { type: "string", name: "ticket", description: "Ticket id (defaults to this thread)" },
  title: { type: "string", name: "title", description: "Panel title" },
} satisfies Record<string, CommandOption>;

function opts(...names: (keyof typeof OPTIONS)[]): CommandOption[] {
  return names.map((name) => OPTIONS[name]);
}

export const ticket = defineCommand({
  name: "ticket",
  description: "Open, claim, close and analyse private support threads.",
  subcommands: [
    { name: "panel", description: "Post a ticket panel in a channel.", options: opts("channel", "title") },
    { name: "open", description: "Open a private support thread.", options: opts("subject") },
    { name: "claim", description: "Claim a ticket for support.", options: opts("ticket") },
    { name: "close", description: "Close a ticket and archive its thread.", options: opts("ticket") },
    { name: "add", description: "Add a member to a ticket.", options: opts("user", "ticket") },
    { name: "transcript", description: "Show a ticket transcript as text.", options: opts("ticket") },
    { name: "summary", description: "Summarize a ticket with the AI port.", options: opts("ticket") },
    { name: "stats", description: "Show guild-wide ticket counts and close time." },
  ],
  guards: [
    (ctx) =>
      ctx.guildId
        ? { ok: true }
        : { ok: false, message: "This command only works in a server." },
  ],
  async execute(ctx: CommandContext): Promise<void> {
    const { store, actions } = port(ctx);
    const settings = await settingsFor(ctx);
    const service = new TicketService(store, actions, settings, ctx.now);
    const guildId = ctx.guildId as string;
    const selected = ctx.commandPath[0] ?? text(ctx, "action");

    if (selected === "panel") {
      requirePermission(ctx, "ManageGuild");
      const parent = channelId(ctx, "channel");
      if (!parent) throw new UserError("Choose a channel for the panel.");
      const signer = ctx.componentSigner;
      if (!signer) throw new UserError("Interactive panels are not configured on this bot.");
      const locale = await guildLocale(ctx.config, guildId);
      const openCustomId = signer.sign(
        {
          namespace: "ticket",
          action: "open",
          // The guild id travels in the signature, so a copied panel cannot
          // open a ticket in a different server.
          payload: guildId,
          ttlMs: TICKET_PANEL_TTL_MS,
        },
        ctx.now(),
      );
      const result = await service.panel(guildId, parent, openCustomId, text(ctx, "title"), locale);
      await ctx.interaction.reply({ content: `Ticket panel posted (${result.messageId}).`, ephemeral: true });
      return;
    }

    if (selected === "open") {
      const parent = ctx.interaction.channelId;
      if (!parent) throw new UserError("Open a ticket from a normal channel, not a DM.");
      const locale = await guildLocale(ctx.config, guildId);
      const record = await service.open(
        guildId,
        ctx.userId,
        parent,
        text(ctx, "subject") ?? t(locale, "ticket.open.subject"),
        locale,
      );
      await ctx.interaction.reply({
        content: t(locale, "ticket.open.reply", record.channelId),
        ephemeral: true,
      });
      return;
    }

    if (selected === "stats") {
      requirePermission(ctx, "ManageGuild");
      const stats = await service.stats(guildId);
      await ctx.interaction.reply({
        embeds: [
          {
            title: "Ticket statistics",
            description: `Open **${stats.open}** · Claimed **${stats.claimed}** · Closed **${stats.closed}**\nAverage close: **${stats.averageCloseMinutes ?? "n/a"} minutes**`,
            color: 0x5865f2,
          },
        ],
        ephemeral: true,
      });
      return;
    }

    const found = (await store.listTickets(guildId, { limit: 100 })).find(
      (entry) => entry.channelId === ctx.interaction.channelId,
    );
    const ticketId = text(ctx, "ticket") ?? found?.id;
    if (!ticketId) throw new UserError("Use this inside a ticket thread or pass a ticket id.");

    if (selected === "claim") {
      const record = await service.claim(guildId, ticketId, ctx.userId);
      await ctx.interaction.reply({ content: `Claimed ticket ${record.id}.`, ephemeral: true });
      return;
    }

    if (selected === "close") {
      const current = await store.getTicket(guildId, ticketId);
      if (!current) throw new UserError("That ticket does not exist.");
      const support =
        current.openerId === ctx.userId ||
        ctx.interaction.permissions.includes("ManageChannels");
      if (!support) throw new UserError("Only the opener or a support member can close this ticket.");
      const record = await service.close(guildId, ticketId, ctx.userId);
      await ctx.interaction.reply({ content: `Closed ticket ${record.id}.`, ephemeral: true });
      return;
    }

    if (selected === "add") {
      const target = userId(ctx, "user");
      if (!target) throw new UserError("Choose a member to add.");
      await service.addParticipant(guildId, ticketId, ctx.userId, target);
      await ctx.interaction.reply({ content: `Added <@${target}>.`, ephemeral: true });
      return;
    }

    if (selected === "transcript") {
      requirePermission(ctx, "ManageGuild");
      const result = await service.transcript(guildId, ticketId);
      await ctx.interaction.reply({
        content: `\`\`\`\n${result.text.slice(0, 1_900)}\n\`\`\``,
        ephemeral: true,
      });
      return;
    }

    if (selected === "summary") {
      requirePermission(ctx, "ManageGuild");
      if (!ctx.ai) throw new UserError("AI services are not wired.");
      const result = await service.transcript(guildId, ticketId);
      const summary = await ctx.ai.summarize(guildId, result.text);
      await ctx.interaction.reply({
        embeds: [
          {
            title: "Ticket summary",
            description: `${summary.text.slice(0, 3_500)}\n\nAI can be wrong. A human decides any action.`,
            color: 0x5865f2,
            footer: { text: `model ${summary.model}` },
          },
        ],
        ephemeral: true,
      });
      return;
    }

  },
  notes: "Threads avoid the 50-channel cap; transcripts are records, not exported files.",
});

