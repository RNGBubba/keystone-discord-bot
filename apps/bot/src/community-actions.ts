import {
  ChannelType,
  MessageFlags,
  type Client,
  type Guild,
  type TextChannel,
  type ThreadChannel,
  type VoiceChannel,
} from "discord.js";
import type {
  CommunityActions,
  CommunityActionResult,
  CommunityMessage,
} from "@keystone/kernel";
import { toComponents, toV2Components } from "./adapt";
import { resolveChannel } from "./channels";

/**
 * The Discord side of the P3 community port. This file is deliberately dumb:
 * it translates an action into a discord.js call and returns a result. Policy,
 * cooldowns, balances and records live in `modules/community`.
 */
export function createDiscordCommunityActions(client: Client): CommunityActions {
  async function guild(guildId: string): Promise<Guild> {
    return client.guilds.fetch(guildId);
  }

  function failure(error: unknown): CommunityActionResult {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  async function channel(channelId: string) {
    return resolveChannel(() => client.channels.fetch(channelId), channelId);
  }

  return {
    async sendMessage(guildId, channelId, message) {
      try {
        const resolved = await channel(channelId);
        if (resolved.status !== "ok") return { ok: false, detail: resolved.reason };
        const target = resolved.channel;
        if (!("send" in target)) {
          return { ok: false, detail: "Channel cannot receive messages." };
        }
        const sent = await (target as TextChannel).send(toPayload(message));
        return { ok: true, id: sent.id };
      } catch (error) {
        return failure(error);
      }
    },

    async editMessage(_guildId, channelId, messageId, message) {
      try {
        const resolved = await channel(channelId);
        if (resolved.status !== "ok") return { ok: false, detail: resolved.reason };
        const target = resolved.channel;
        if (!("messages" in target)) {
          return { ok: false, detail: "Channel cannot edit messages." };
        }
        const edited = await (target as TextChannel).messages.fetch(messageId);
        await edited.edit(toPayload(message));
        return { ok: true, id: messageId };
      } catch (error) {
        return failure(error);
      }
    },

    async sendDM(userId, message) {
      try {
        const user = await client.users.fetch(userId);
        const sent = await user.send(toPayload(message));
        return { ok: true, id: sent.id };
      } catch (error) {
        return failure(error);
      }
    },

    async deleteMessage(_guildId, channelId, messageId) {
      try {
        const resolved = await channel(channelId);
        if (resolved.status !== "ok") return { ok: false, detail: resolved.reason };
        const target = resolved.channel;
        if (!("messages" in target)) {
          return { ok: false, detail: "Channel cannot delete messages." };
        }
        const message = await (target as TextChannel).messages.fetch(messageId);
        await message.delete();
        return { ok: true, id: messageId };
      } catch (error) {
        return failure(error);
      }
    },

    async addRole(guildId, userId, roleId, reason) {
      try {
        const member = await (await guild(guildId)).members.fetch(userId);
        await member.roles.add(roleId, reason);
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },

    async removeRole(guildId, userId, roleId, reason) {
      try {
        const member = await (await guild(guildId)).members.fetch(userId);
        await member.roles.remove(roleId, reason);
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },

    async toggleRole(guildId, userId, roleId) {
      try {
        const member = await (await guild(guildId)).members.fetch(userId);
        if (!member.roles.cache.has(roleId)) {
          await member.roles.add(roleId, "Reaction role");
          return { ok: true, added: true };
        }
        await member.roles.remove(roleId, "Reaction role");
        return { ok: true, added: false };
      } catch (error) {
        return failure(error);
      }
    },

    async hasRole(guildId, userId, roleId) {
      try {
        const member = await (await guild(guildId)).members.fetch(userId);
        return member.roles.cache.has(roleId);
      } catch {
        return false;
      }
    },

    async isBot(_guildId, userId) {
      try {
        return (await client.users.fetch(userId)).bot;
      } catch {
        return false;
      }
    },

    async createThread(guildId, channelId, name, message) {
      try {
        const resolved = await channel(channelId);
        if (resolved.status !== "ok") return { ok: false, detail: resolved.reason };
        const target = resolved.channel;
        if (!("threads" in target)) {
          return { ok: false, detail: "Channel does not support threads." };
        }
        const thread = await (target as TextChannel).threads.create({
          name,
          type: ChannelType.PublicThread,
        });
        if (message) await thread.send(message);
        return { ok: true, id: thread.id };
      } catch (error) {
        return failure(error);
      }
    },

    async closeThread(_guildId, threadId, reason) {
      try {
        const resolved = await channel(threadId);
        if (resolved.status !== "ok") return { ok: false, detail: resolved.reason };
        const thread = resolved.channel;
        if (!thread.isThread()) return { ok: false, detail: "Not a thread." };
        await (thread as ThreadChannel).setArchived(true, reason);
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },

    async createVoiceChannel(guildId, name, options) {
      try {
        const channel = await (await guild(guildId)).channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent: options?.parentId,
          userLimit: options?.userLimit,
        });
        return { ok: true, id: channel.id };
      } catch (error) {
        return failure(error);
      }
    },

    async deleteChannel(guildId, channelId, reason) {
      try {
        const target = await guild(guildId);
        const resolved = await resolveChannel(() => target.channels.fetch(channelId), channelId);
        if (resolved.status !== "ok") return { ok: false, detail: resolved.reason };
        await resolved.channel.delete(reason);
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },

    async setChannelName(guildId, channelId, name) {
      try {
        const target = await guild(guildId);
        const resolved = await resolveChannel(() => target.channels.fetch(channelId), channelId);
        if (resolved.status !== "ok") return { ok: false, detail: resolved.reason };
        if (!("setName" in resolved.channel)) {
          return { ok: false, detail: "Channel cannot be renamed." };
        }
        await resolved.channel.setName(name);
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },

    async countMembers(guildId, channelId) {
      try {
        const target = await guild(guildId);
        const resolved = await resolveChannel(() => target.channels.fetch(channelId), channelId);
        if (resolved.status !== "ok") return 0;
        const channel = resolved.channel;
        if (channel.isVoiceBased()) return (channel as VoiceChannel).members.size;
        if (channel.isThread()) return (channel as ThreadChannel).members.cache.size;
        return 0;
      } catch {
        return 0;
      }
    },
  };
}

function toPayload(message: CommunityMessage) {
  if (message.v2) {
    // V2 is exclusive: Discord rejects a message that also carries content,
    // embeds or legacy action rows.
    return {
      components: toV2Components(message.v2),
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: message.allowedMentions,
    } as never;
  }
  return {
    content: message.content,
    embeds: message.embeds,
    components: message.components ? toComponents(message.components) : undefined,
    allowedMentions: message.allowedMentions,
  } as never;
}
