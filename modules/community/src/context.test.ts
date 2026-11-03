import { describe, expect, it } from "vitest";
import { createTestContext, FakeInteraction } from "@keystone/testing";
import { communitySettingsSchema } from "./settings";
import { InMemoryCommunityStore } from "./store";
import { RecordingCommunityActions } from "./testing";
import { rankCard } from "./commands/rank-card";

async function context() {
  const store = new InMemoryCommunityStore();
  await store.setLevel("guild-a", "author-1", 4, 400);
  const actions = new RecordingCommunityActions();
  const interaction = new FakeInteraction({
    commandName: "Rank card",
    commandType: "user",
    guildId: "guild-a",
    userId: "viewer",
    targetId: "author-1",
  });
  const ctx = createTestContext({
    interaction,
    moduleId: "community",
    settings: communitySettingsSchema.parse({}),
    community: { store, actions },
  });
  return { interaction, ctx };
}

describe("community context menu", () => {
  it("reads the selected member's real level and XP rows", async () => {
    const { interaction, ctx } = await context();
    await rankCard.execute(ctx);
    const card = JSON.stringify(interaction.lastReply?.v2);
    expect(card).toContain("<@author-1>");
    expect(card).toContain("Level **4**");
    expect(card).toContain("**400 XP**");
    expect(card).toContain("rank **#1**");
    expect(interaction.lastReply?.embeds).toBeUndefined();
  });

  it("does not send a message or mutate XP", async () => {
    const { ctx } = await context();
    await rankCard.execute(ctx);
    expect(ctx.interaction.replies).toHaveLength(1);
    expect(await ctx.community?.store.getLevel("guild-a", "author-1")).toMatchObject({
      level: 4,
      xp: 400,
    });
  });
});
