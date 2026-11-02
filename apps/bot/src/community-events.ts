import {
  Events,
  type Client,
  type GuildMember,
  type Message,
  type MessageReaction,
  type PartialGuildMember,
  type PartialMessageReaction,
  type User,
  type VoiceState,
} from "discord.js";
import type {
  CommunityPort,
  Logger,
  ModuleSettings,
} from "@keystone/kernel";
import {
  AutoResponderService,
  BirthdayService,
  ContentService,
  GiveawayService,
  ReactionRoleService,
  SeasonService,
  StarboardService,
  StickyService,
  SuggestionService,
  TempVoiceService,
  WelcomeService,
  communitySettingsSchema,
} from "@keystone/module-community";
import { botFixtureContent } from "./dev-fixture";

export interface CommunityEventOptions {
  /** Development-only guild where a bot marker may drive the real message path. */
  readonly botTestGuildId?: string;
}

/**
 * Gateway → structural service seam. It translates events, then delegates every
 * decision and write to the community module. No thresholds or balances live in
 * this file, which keeps the adapter replaceable when discord.js v15 lands.
 */
export function registerCommunityEvents(
  client: Client,
  port: CommunityPort,
  settings: ModuleSettings,
  logger: Logger,
  options: CommunityEventOptions = {},
): () => void {
  const config = async (guildId: string) =>
    communitySettingsSchema.parse(await settings.get(guildId));

  const onMessage = async (message: Message): Promise<void> => {
    if (!message.inGuild()) return;
    const fixture = botFixtureContent(message, options.botTestGuildId);
    if (message.author.bot && fixture === undefined) return;

    const current = await config(message.guildId);
    if (!current.enabled) return;

    if (fixture !== undefined) {
      try {
        await new AutoResponderService(port.store, port.actions, current).respond(
          message.guildId,
          message.channelId,
          fixture,
        );
      } catch (error) {
        logger.warn("auto-responder fixture failed", { error: messageOf(error) });
      }
      return;
    }

    try {
      await new AutoResponderService(port.store, port.actions, current).respond(
        message.guildId,
        message.channelId,
        message.content,
      );
    } catch (error) {
      logger.warn("auto-responder failed", { error: messageOf(error) });
    }

    try {
      await new ContentService(port.store, port.actions, current).tick(message.guildId);
      await new (await import("@keystone/module-community")).LevelingService(
        port.store,
        port.actions,
        current,
      ).awardMessageXp(message.guildId, message.author.id, message.id);
      await new StickyService(port.store, port.actions).onMessage(
        message.guildId,
        message.channelId,
        message.id,
      );
    } catch (error) {
      logger.warn("community message handling failed", { error: messageOf(error) });
    }

    try {
      const tickets = await port.store.listTickets(message.guildId, { limit: 100 });
      const ticket = tickets.find((entry) => entry.channelId === message.channelId);
      if (ticket && ticket.state !== "closed") {
        const { TicketService } = await import("@keystone/module-community");
        await new TicketService(port.store, port.actions, current).appendMessage(
          message.guildId,
          ticket.id,
          message.author.id,
          message.id,
          message.content,
        );
      }
    } catch (error) {
      logger.warn("ticket transcript append failed", { error: messageOf(error) });
    }
  };

  const onReaction = async (
    reaction: MessageReaction | PartialMessageReaction,
  ): Promise<void> => {
    try {
      if (reaction.partial) await reaction.fetch();
      const message = reaction.message.partial
        ? await reaction.message.fetch()
        : reaction.message;
      if (!message.guildId || message.author.bot) return;
      const current = await config(message.guildId);
      const service = new StarboardService(port.store, port.actions, current);
      await service.onReaction({
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        authorId: message.author.id,
        content: message.content,
        emoji: reaction.emoji.name ?? "",
        count: Math.max(0, (reaction.count ?? 1) - 1),
      });
    } catch (error) {
      logger.warn("starboard reaction failed", { error: messageOf(error) });
    }
  };

  const onMember = async (member: GuildMember): Promise<void> => {
    try {
      const current = await config(member.guild.id);
      await new WelcomeService(port.actions, current, port.store).handleJoin(
        member.guild.id,
        member.id,
        member.guild.name,
      );
    } catch (error) {
      logger.warn("welcome failed", { error: messageOf(error) });
    }
  };

  const onMemberLeave = async (
    member: GuildMember | PartialGuildMember,
  ): Promise<void> => {
    try {
      const current = await config(member.guild.id);
      await new WelcomeService(port.actions, current, port.store).handleLeave(
        member.guild.id,
        member.id,
        member.guild.name,
      );
    } catch (error) {
      logger.warn("goodbye failed", { error: messageOf(error) });
    }
  };

  const onVoice = async (oldState: VoiceState, newState: VoiceState): Promise<void> => {
    try {
      const guildId = newState.guild.id;
      const current = await config(guildId);
      await new TempVoiceService(port.store, port.actions, current).onVoice({
        guildId,
        userId: newState.id,
        channelId: newState.channelId ?? undefined,
        previousChannelId: oldState.channelId ?? undefined,
        displayName: newState.member?.displayName,
      });
    } catch (error) {
      logger.warn("temporary voice failed", { error: messageOf(error) });
    }
  };

  client.on(Events.MessageCreate, (message) => void onMessage(message));
  client.on(Events.MessageReactionAdd, (reaction) => void onReaction(reaction));
  client.on(Events.MessageReactionRemove, (reaction) => void onReaction(reaction));
  client.on(Events.GuildMemberAdd, (member) => void onMember(member));
  client.on(Events.GuildMemberRemove, (member) => void onMemberLeave(member));
  client.on(Events.VoiceStateUpdate, (oldState, newState) => void onVoice(oldState, newState));

  client.on(Events.InteractionCreate, (interaction) => {
    if ((!interaction.isButton() && !interaction.isStringSelectMenu()) || !interaction.guildId) return;
    void (async () => {
      try {
        const current = await config(interaction.guildId as string);
        const customId = interaction.customId;

        if (interaction.isStringSelectMenu() && customId.startsWith("keystone:roles:")) {
          const panelId = customId.slice("keystone:roles:".length);
          const result = await new ReactionRoleService(port.store, port.actions).applySelection(
            interaction.guildId as string,
            interaction.user.id,
            panelId,
            interaction.values,
          );
          await interaction.reply({
            content: `Roles updated: ${result.added} added, ${result.removed} removed.`,
            ephemeral: true,
          });
          return;
        }

        if (!interaction.isButton()) return;

        if (customId.startsWith("keystone:role:")) {
          const roleId = customId.slice("keystone:role:".length);
          const result = await new ReactionRoleService(port.store, port.actions).toggle(
            interaction.guildId as string,
            interaction.user.id,
            roleId,
          );
          await interaction.reply({
            content: `${result.added ? "Added" : "Removed"} **${result.label}**.`,
            ephemeral: true,
          });
          return;
        }

        if (customId.startsWith("keystone:giveaway:enter:")) {
          const giveawayId = customId.slice("keystone:giveaway:enter:".length);
          const result = await new GiveawayService(
            port.store,
            port.actions,
            current,
          ).enter(interaction.guildId as string, giveawayId, interaction.user.id);
          await interaction.reply({
            content: result.entered
              ? `Entered. ${result.entries} entry(ies) so far.`
              : (result.reason ?? "Could not enter."),
            ephemeral: true,
          });
          return;
        }

        if (customId.startsWith("keystone:suggest:")) {
          const [, , kind, suggestionId] = customId.split(":");
          if (!suggestionId || (kind !== "up" && kind !== "down")) return;
          const result = await new SuggestionService(
            port.store,
            port.actions,
            current,
          ).vote(interaction.guildId as string, suggestionId, interaction.user.id, kind);
          await interaction.reply({
            content: `Vote ${result.changed ? "recorded" : "already counted"}: 👍 ${result.up} · 👎 ${result.down}.`,
            ephemeral: true,
          });
          return;
        }

        if (customId === "keystone:ticket:open") {
          const { TicketService } = await import("@keystone/module-community");
          const parent = interaction.channelId;
          if (!parent) throw new Error("No parent channel.");
          const record = await new TicketService(
            port.store,
            port.actions,
            current,
          ).open(interaction.guildId as string, interaction.user.id, parent, "Support request");
          await interaction.reply({
            content: `Ticket opened in <#${record.channelId}>.`,
            ephemeral: true,
          });
          return;
        }

        if (customId.startsWith("keystone:poll:")) {
          const [, , pollId, rawIndex] = customId.split(":");
          if (!pollId || rawIndex === undefined) return;
          const result = await new ContentService(
            port.store,
            port.actions,
            current,
          ).vote(interaction.guildId as string, pollId, interaction.user.id, Number(rawIndex));
          await interaction.reply({
            content: `Vote recorded. Totals: ${result.counts.join(" / ")}.`,
            ephemeral: true,
          });
        }
      } catch (error) {
        if (interaction.replied || interaction.deferred) return;
        await interaction
          .reply({
            content: error instanceof Error ? error.message : "That interaction failed.",
            ephemeral: true,
          })
          .catch(() => undefined);
      }
    })();
  });

  let lastFeedPoll = 0;
  const interval = setInterval(() => {
    void (async () => {
      for (const guild of client.guilds.cache.values()) {
        try {
          const current = await config(guild.id);
          const content = new ContentService(port.store, port.actions, current);
          await content.tick(guild.id);
          await new GiveawayService(port.store, port.actions, current).endDue(guild.id);
          await new WelcomeService(port.actions, current, port.store).applyDueAutoroles(guild.id);
          await new BirthdayService(port.store, port.actions, current).announceDue(guild.id);
          await new SeasonService(port.store).rollover(guild.id);

          for (const record of await port.store.listRecords<{ metric: string }>(
            guild.id,
            "stat_channel",
            20,
          )) {
            const value =
              record.data.metric === "members" ? guild.memberCount : guild.memberCount;
            await content.refreshStat(guild.id, record.key, value);
          }

          if (Date.now() - lastFeedPoll > current.feeds.pollMinutes * 60_000) {
            for (const feed of await port.store.listRecords<{ url: string }>(
              guild.id,
              "feed",
              20,
            )) {
              try {
                const response = await fetch(feed.data.url, {
                  signal: AbortSignal.timeout(10_000),
                });
                if (!response.ok) continue;
                const xml = await response.text();
                await content.pollFeed(guild.id, feed.key, xml);
              } catch (error) {
                logger.warn("feed poll failed", {
                  guild: guild.id,
                  error: messageOf(error),
                });
              }
            }
          }
        } catch (error) {
          logger.warn("community tick failed", { guild: guild.id, error: messageOf(error) });
        }
      }
      lastFeedPoll = Date.now();
    })();
  }, 60_000);

  return () => clearInterval(interval);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
