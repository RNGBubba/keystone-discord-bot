import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  type Client,
  type Guild,
} from "discord.js";
import type {
  ActionRow,
  ModerationActions,
  ModerationActionResult,
  ModerationNotice,
} from "@keystone/kernel";
import { resolveChannel } from "./channels";

function failure(detail: string): ModerationActionResult {
  return { ok: false, detail };
}

function fromError(error: unknown): ModerationActionResult {
  return failure(error instanceof Error ? error.message : String(error));
}

/**
 * Discord implementation of the moderation action port.
 *
 * Every method checks the bot's permissions before the API call. Discord's
 * 10,000-invalid-requests-per-10-minutes ban is the reason: a 403 is already
 * too late, and a raid is exactly when the bot must not spend that budget.
 */
export function createDiscordModerationActions(client: Client): ModerationActions {
  async function guild(guildId: string): Promise<Guild | undefined> {
    return client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => undefined));
  }

  async function has(guildId: string, permission: bigint): Promise<Guild | ModerationActionResult> {
    const target = await guild(guildId);
    if (!target) return failure("Guild is not available to the bot.");
    if (!target.members.me?.permissions.has(permission)) {
      return failure("The bot lacks the Discord permission required for that action.");
    }
    return target;
  }

  async function quarantineRole(guildId: string, roleId?: string) {
    const target = await guild(guildId);
    if (!target) return undefined;
    if (roleId) return target.roles.cache.get(roleId) ?? (await target.roles.fetch(roleId).catch(() => null));
    return target.roles.cache.find((role) => role.name.toLowerCase() === "quarantined") ?? null;
  }

  return {
    async ban(guildId, userId, reason) {
      const target = await has(guildId, PermissionFlagsBits.BanMembers);
      if ("ok" in target) return target;
      try {
        await target.bans.create(userId, { reason });
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async unban(guildId, userId, reason) {
      const target = await has(guildId, PermissionFlagsBits.BanMembers);
      if ("ok" in target) return target;
      try {
        await target.bans.remove(userId, reason);
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async addRole(guildId, userId, roleId, reason) {
      const target = await has(guildId, PermissionFlagsBits.ManageRoles);
      if ("ok" in target) return target;
      try {
        const member = await target.members.fetch(userId);
        await member.roles.add(roleId, reason);
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async removeRole(guildId, userId, roleId, reason) {
      const target = await has(guildId, PermissionFlagsBits.ManageRoles);
      if ("ok" in target) return target;
      try {
        const member = await target.members.fetch(userId);
        if (!member.roles.cache.has(roleId)) return { ok: true };
        await member.roles.remove(roleId, reason);
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async kick(guildId, userId, reason) {
      const target = await has(guildId, PermissionFlagsBits.KickMembers);
      if ("ok" in target) return target;
      try {
        const member = await target.members.fetch(userId);
        await member.kick(reason);
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async timeout(guildId, userId, seconds, reason) {
      const target = await has(guildId, PermissionFlagsBits.ModerateMembers);
      if ("ok" in target) return target;
      try {
        const member = await target.members.fetch(userId);
        await member.timeout(Math.max(1, seconds) * 1_000, reason);
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async purge(guildId, channelId, limit, reason) {
      const target = await has(guildId, PermissionFlagsBits.ManageMessages);
      if ("ok" in target) return target;
      try {
        const resolved = await resolveChannel(
          () => target.channels.fetch(channelId),
          channelId,
        );
        if (resolved.status !== "ok") return failure(resolved.reason);
        const channel = resolved.channel;
        if (!("bulkDelete" in channel) || typeof channel.bulkDelete !== "function") {
          return failure("That channel does not support bulk deletion.");
        }
        await channel.bulkDelete(Math.min(Math.max(limit, 1), 100), true);
        return { ok: true, detail: reason };
      } catch (error) {
        return fromError(error);
      }
    },

    async lock(guildId, channelId, locked, reason) {
      const target = await has(guildId, PermissionFlagsBits.ManageChannels);
      if ("ok" in target) return target;
      try {
        const resolved = await resolveChannel(
          () => target.channels.fetch(channelId),
          channelId,
        );
        if (resolved.status !== "ok") return failure(resolved.reason);
        const channel = resolved.channel;
        if (!("permissionOverwrites" in channel)) {
          return failure("That channel does not support permission overwrites.");
        }
        await channel.permissionOverwrites.edit(
          target.roles.everyone,
          { SendMessages: locked ? false : null },
          { reason },
        );
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async slowmode(guildId, channelId, seconds, reason) {
      const target = await has(guildId, PermissionFlagsBits.ManageChannels);
      if ("ok" in target) return target;
      try {
        const resolved = await resolveChannel(
          () => target.channels.fetch(channelId),
          channelId,
        );
        if (resolved.status !== "ok") return failure(resolved.reason);
        const channel = resolved.channel;
        if (!("setRateLimitPerUser" in channel)) {
          return failure("That channel does not support slowmode.");
        }
        await channel.setRateLimitPerUser(Math.min(Math.max(seconds, 0), 21_600), reason);
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async deleteMessage(guildId, channelId, messageId, reason) {
      const target = await has(guildId, PermissionFlagsBits.ManageMessages);
      if ("ok" in target) return target;
      try {
        const resolved = await resolveChannel(
          () => target.channels.fetch(channelId),
          channelId,
        );
        if (resolved.status !== "ok") return failure(resolved.reason);
        const channel = resolved.channel;
        if (!("messages" in channel)) return failure("That channel has no messages.");
        const message = await channel.messages.fetch(messageId);
        await message.delete();
        return { ok: true, detail: reason };
      } catch (error) {
        return fromError(error);
      }
    },

    async deleteWebhook(guildId, webhookId, reason) {
      const target = await has(guildId, PermissionFlagsBits.ManageWebhooks);
      if ("ok" in target) return target;
      try {
        const webhooks = await target.fetchWebhooks();
        const webhook = webhooks.get(webhookId);
        if (!webhook) return failure("That webhook no longer exists.");
        await webhook.delete(reason);
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async quarantine(guildId, userId, reason, roleId) {
      const target = await has(guildId, PermissionFlagsBits.ManageRoles);
      if ("ok" in target) return target;
      const role = await quarantineRole(guildId, roleId);
      if (!role) return failure("Set `quarantineRoleId` or create a role named Quarantined.");
      try {
        const member = await target.members.fetch(userId);
        await member.roles.add(role, reason);
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async unquarantine(guildId, userId, reason, roleId) {
      const target = await has(guildId, PermissionFlagsBits.ManageRoles);
      if ("ok" in target) return target;
      const role = await quarantineRole(guildId, roleId);
      if (!role) return failure("Set `quarantineRoleId` or create a role named Quarantined.");
      try {
        const member = await target.members.fetch(userId);
        if (member.roles.cache.has(role.id)) await member.roles.remove(role, reason);
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },

    async notify(guildId, channelId, notice) {
      if (!channelId) return;
      const target = await guild(guildId);
      if (!target) return;
      const resolved = await resolveChannel(
        () => target.channels.fetch(channelId),
        channelId,
      );
      if (resolved.status !== "ok") return;
      const channel = resolved.channel;
      if (!channel.isTextBased() || !("send" in channel)) return;
      await channel.send({
        embeds: notice.embeds as never,
        components: notice.components ? toComponents(notice.components) : [],
      });
    },

    async directMessage(userId, message) {
      try {
        const user = await client.users.fetch(userId);
        await user.send({
          content: message.content,
          components: message.components ? toComponents(message.components) : [],
        });
        return { ok: true };
      } catch (error) {
        return fromError(error);
      }
    },
  };
}

function toComponents(rows: ActionRow[]): ActionRowBuilder<ButtonBuilder>[] {
  return rows.map((row) => {
    const builder = new ActionRowBuilder<ButtonBuilder>();
    builder.addComponents(
      row.components.map((component) => {
        if (component.type !== "button") {
          throw new Error("Moderation messages only accept buttons.");
        }
        const button = new ButtonBuilder().setLabel(component.label);
        if (component.style === "link") {
          button.setStyle(ButtonStyle.Link);
          if (component.url) button.setURL(component.url);
        } else {
          button.setStyle(STYLES[component.style]).setCustomId(component.customId);
        }
        if (component.disabled) button.setDisabled(true);
        return button;
      }),
    );
    return builder;
  });
}

const STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
} as const;
