import { EventEmitter } from "node:events";
import { Events, type Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createSilentLogger } from "@keystone/kernel";
import { InMemoryCommunityStore, communitySettingsSchema } from "@keystone/module-community";
import { BOT_TEST_MARKER } from "./dev-fixture";
import { registerCommunityEvents } from "./community-events";

class FakeClient extends EventEmitter {}

interface MessageFixture {
  guildId?: string;
  authorId?: string;
  bot?: boolean;
  content?: string;
}

function message(input: MessageFixture = {}) {
  return {
    inGuild: () => true,
    guild: { id: input.guildId ?? "guild-1" },
    guildId: input.guildId ?? "guild-1",
    channelId: "channel-1",
    id: "message-1",
    author: { id: input.authorId ?? "author-1", bot: input.bot ?? false },
    content: input.content ?? "hello",
  };
}

async function setup(overrides: Record<string, unknown> = { responders: { enabled: true } }) {
  const store = new InMemoryCommunityStore();
  await store.putRecord("dev-guild", "responder", "dev-hello", {
    id: "dev-hello",
    trigger: "hello keystone",
    match: "exact",
    response: "Hi from the fixture.",
    cooldownSeconds: 0,
    createdBy: "dev-seed",
  });
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, id: "sent-1" });
  const settings = {
    get: async () => communitySettingsSchema.parse(overrides),
  } as never;
  const client = new FakeClient();
  const stop = registerCommunityEvents(
    client as unknown as Client,
    { store, actions: { sendMessage } as never },
    settings,
    createSilentLogger(),
    { botTestGuildId: "dev-guild" },
  );
  return { store, sendMessage, client, stop };
}

describe("community event adapter", () => {
  it("lets a marker-prefixed bot message drive auto-responders in the dev guild", async () => {
    const { store, sendMessage, client, stop } = await setup();
    client.emit(
      Events.MessageCreate,
      message({
        guildId: "dev-guild",
        authorId: "mcp-bot",
        bot: true,
        content: `${BOT_TEST_MARKER} hello keystone`,
      }),
    );

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith("dev-guild", "channel-1", {
      content: "Hi from the fixture.",
      allowedMentions: { parse: [] },
    });
    // A fixture message exercises the responder only; it never awards XP.
    expect(await store.getLevel("dev-guild", "mcp-bot")).toBeUndefined();
    stop();
  });

  it("ignores a bot message without the marker and the marker in another guild", async () => {
    const { sendMessage, client, stop } = await setup();
    client.emit(
      Events.MessageCreate,
      message({ guildId: "dev-guild", bot: true, content: "hello keystone" }),
    );
    client.emit(
      Events.MessageCreate,
      message({
        guildId: "other-guild",
        bot: true,
        content: `${BOT_TEST_MARKER} hello keystone`,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sendMessage).not.toHaveBeenCalled();
    stop();
  });

  it("sends the configured goodbye when the member-leave event fires", async () => {
    const { sendMessage, client, stop } = await setup({
      goodbye: { enabled: true, channelId: "farewell", message: "Bye {user} from {server}" },
    });
    client.emit(Events.GuildMemberRemove, {
      id: "leaver-1",
      guild: { id: "dev-guild", name: "Keystone" },
    });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith("dev-guild", "farewell", {
      content: "Bye <@leaver-1> from Keystone",
    });
    stop();
  });

  it("still runs auto-responders for an ordinary member message", async () => {
    const { sendMessage, client, stop } = await setup();
    client.emit(Events.MessageCreate, message({ guildId: "dev-guild", content: "HELLO KEYSTONE" }));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]?.[2]).toMatchObject({ content: "Hi from the fixture." });
    stop();
  });
});
