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
    const locale = await guildLocale(ctx.config, guildId);
    const selected = ctx.commandPath[0] ?? text(ctx, "action");

    if (selected === "panel") {
      requirePermission(ctx, "ManageGuild", locale);
      const parent = channelId(ctx, "channel");
      if (!parent) throw new UserError(t(locale, "ticket.panel.noChannel"));
      const signer = ctx.componentSigner;
      if (!signer) throw new UserError(t(locale, "ticket.panel.noSigner"));
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
      await ctx.interaction.reply({
        content: t(locale, "ticket.panel.posted", result.messageId),
        ephemeral: true,
      });
      return;
    }

    if (selected === "open") {
      const parent = ctx.interaction.channelId;
      if (!parent) throw new UserError(t(locale, "ticket.open.noChannelHere"));
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
      requirePermission(ctx, "ManageGuild", locale);
      const stats = await service.stats(guildId);
      await ctx.interaction.reply({
        embeds: [
          {
            title: t(locale, "ticket.stats.title"),
            description: t(
              locale,
              "ticket.stats.body",
              stats.open,
              stats.claimed,
              stats.closed,
              // A language-neutral dash beats "n/a Minuten" in German.
              String(stats.averageCloseMinutes ?? "–"),
            ),
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
    if (!ticketId) throw new UserError(t(locale, "ticket.missingThread"));

    if (selected === "claim") {
      const record = await service.claim(guildId, ticketId, ctx.userId);
      await ctx.interaction.reply({ content: t(locale, "ticket.claim.done", record.id), ephemeral: true });
      return;
    }

    if (selected === "close") {
      const current = await store.getTicket(guildId, ticketId);
      if (!current) throw new UserError(t(locale, "ticket.close.missing"));
      const support =
        current.openerId === ctx.userId ||
        ctx.interaction.permissions.includes("ManageChannels");
      if (!support) throw new UserError(t(locale, "ticket.close.notAllowed"));
      const record = await service.close(guildId, ticketId, ctx.userId);
      await ctx.interaction.reply({ content: t(locale, "ticket.close.done", record.id), ephemeral: true });
      return;
    }

    if (selected === "add") {
      const target = userId(ctx, "user");
      if (!target) throw new UserError(t(locale, "ticket.add.missing"));
      await service.addParticipant(guildId, ticketId, ctx.userId, target);
      await ctx.interaction.reply({ content: t(locale, "ticket.add.done", target), ephemeral: true });
      return;
    }

    if (selected === "transcript") {
      requirePermission(ctx, "ManageGuild", locale);
      const result = await service.transcript(guildId, ticketId);
      await ctx.interaction.reply({
        // i18n-exempt: stored ticket text inside a code fence, not our copy.
        content: `\`\`\`\n${result.text.slice(0, 1_900)}\n\`\`\``,
        ephemeral: true,
      });
      return;
    }

    if (selected === "summary") {
      requirePermission(ctx, "ManageGuild", locale);
      if (!ctx.ai) throw new UserError(t(locale, "ticket.summary.noAi"));
      const result = await service.transcript(guildId, ticketId);
      const summary = await ctx.ai.summarize(guildId, result.text);
      await ctx.interaction.reply({
        embeds: [
          {
            title: t(locale, "ticket.summary.title"),
            description: t(locale, "ticket.summary.body", summary.text.slice(0, 3_500)),
            color: 0x5865f2,
            footer: { text: t(locale, "ticket.summary.model", summary.model) },
          },
        ],
        ephemeral: true,
      });
      return;
    }

  },
  notes: "Threads avoid the 50-channel cap; transcripts are records, not exported files.",
});

