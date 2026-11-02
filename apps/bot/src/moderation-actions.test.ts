import { ChannelType, PermissionFlagsBits, type Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createDiscordModerationActions } from "./moderation-actions";

const everyone = { id: "everyone" };

function overwrite(options: { allow?: bigint[]; deny?: bigint[] } = {}) {
  return {
    allow: new Set(options.allow ?? []),
    deny: new Set(options.deny ?? []),
  };
}

function channel(input: {
  id: string;
  type?: ChannelType;
  name?: string;
  existing?: ReturnType<typeof overwrite>;
}) {
  const cache = new Map<string, ReturnType<typeof overwrite>>();
  if (input.existing) cache.set(everyone.id, input.existing);
  return {
    id: input.id,
    name: input.name ?? input.id,
    type: input.type ?? ChannelType.GuildText,
    permissionOverwrites: {
      cache,
      edit: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function clientWith(channels: ReturnType<typeof channel>[], canManage = true) {
  const byId = new Map(channels.map((entry) => [entry.id, entry]));
  const guild = {
    id: "guild-1",
    members: { me: { permissions: { has: () => canManage } } },
    roles: { everyone, cache: new Map([["everyone", everyone]]) },
    channels: {
      fetch: vi.fn(async (id?: string) => (id ? (byId.get(id) ?? null) : byId)),
    },
  };
  const client = {
    guilds: {
      cache: new Map([["guild-1", guild]]),
      fetch: vi.fn(),
    },
  };
  return { client: client as unknown as Client, guild, channels };
}

describe("Discord panic actions", () => {
  it("snapshots only channels it changes and skips one already denied", async () => {
    const neutral = channel({ id: "neutral" });
    const allowed = channel({
      id: "allowed",
      existing: overwrite({ allow: [PermissionFlagsBits.SendMessages] }),
    });
    const denied = channel({
      id: "denied",
      existing: overwrite({ deny: [PermissionFlagsBits.SendMessages] }),
    });
    const voice = channel({ id: "voice", type: ChannelType.GuildVoice });
    const { client, channels } = clientWith([neutral, allowed, denied, voice]);

    const result = await createDiscordModerationActions(client).lockdown(
      "guild-1",
      "raid in progress",
    );

    expect(result).toEqual({
      ok: true,
      detail: undefined,
      locks: [
        { channelId: "neutral", existed: false, previous: "neutral" },
        { channelId: "allowed", existed: true, previous: "allow" },
      ],
    });
    expect(channels[0]?.permissionOverwrites.edit).toHaveBeenCalledWith(
      everyone,
      { SendMessages: false },
      { reason: "raid in progress" },
    );
    expect(channels[1]?.permissionOverwrites.edit).toHaveBeenCalledTimes(1);
    expect(channels[2]?.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(channels[3]?.permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  it("restores a pre-existing allow, deletes an absent overwrite and keeps a missing channel as failed", async () => {
    const existed = channel({
      id: "existed",
      existing: overwrite({ allow: [PermissionFlagsBits.SendMessages] }),
    });
    const absent = channel({ id: "absent" });
    const { client, channels } = clientWith([existed, absent]);

    const result = await createDiscordModerationActions(client).restoreLockdown(
      "guild-1",
      [
        { channelId: "existed", existed: true, previous: "allow" },
        { channelId: "absent", existed: false, previous: "neutral" },
        { channelId: "gone", existed: true, previous: "neutral" },
      ],
      "all clear",
    );

    expect(result).toMatchObject({
      ok: false,
      restored: ["existed", "absent"],
      failed: ["gone"],
    });
    expect(channels[0]?.permissionOverwrites.edit).toHaveBeenCalledWith(
      everyone,
      { SendMessages: true },
      { reason: "all clear" },
    );
    expect(channels[1]?.permissionOverwrites.delete).toHaveBeenCalledWith(
      everyone,
      "all clear",
    );
  });

  it("refuses both calls before touching a channel when the bot lacks ManageChannels", async () => {
    const target = channel({ id: "channel-1" });
    const { client, channels } = clientWith([target], false);
    const actions = createDiscordModerationActions(client);

    expect(await actions.lockdown("guild-1", "raid")).toMatchObject({
      ok: false,
      detail: expect.stringContaining("permission"),
    });
    expect(await actions.restoreLockdown("guild-1", [], "clear")).toMatchObject({
      ok: false,
      detail: expect.stringContaining("permission"),
    });
    expect(channels[0]?.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(channels[0]?.permissionOverwrites.delete).not.toHaveBeenCalled();
  });
});
