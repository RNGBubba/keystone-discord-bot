import { describe, expect, it } from "vitest";
import { ModuleRegistry, SettingsService, InMemorySettingsRepository, auditBudget, type AiPort } from "@keystone/kernel";
import { createTestContext, FakeInteraction, RecordingJobQueue } from "@keystone/testing";
import { communityModule } from "./manifest";
import { rank } from "./commands/rank";
import { ticket } from "./commands/ticket";
import { tools } from "./commands/tools";
import { InMemoryCommunityStore } from "./store";
import { RecordingCommunityActions } from "./testing";
import { communitySettingsSchema } from "./settings";

function context(
  options: Record<string, string | number | boolean | null>,
  permissions: string[] = [],
  economy: Record<string, unknown> = {},
) {
  const interaction = new FakeInteraction({
    commandName: "rank",
    guildId: "guild-a",
    userId: "user-a",
    permissions,
    options,
    subcommand: typeof options.action === "string" ? options.action : undefined,
  });
  const settings = communitySettingsSchema.parse({
    economy: {
      shop: [{ id: "vip", name: "VIP", price: 10, roleId: "role-vip" }],
      ...economy,
    },
  });
  const store = new InMemoryCommunityStore();
  const actions = new RecordingCommunityActions();
  const ctx = createTestContext({
    interaction,
    moduleId: "community",
    settings,
    community: { store, actions },
  });
  return { ctx, interaction, store, actions };
}

describe("community commands", () => {
  it("registers three roots and keeps the global budget below twenty", () => {
    const registry = new ModuleRegistry().register(communityModule);
    expect(registry.commandNames()).toEqual(["rank", "ticket", "tools"]);
    expect(auditBudget(registry).commands).toBe(3);
    expect(auditBudget(registry).status).toBe("ok");
  });

  it("renders a rank view and a leaderboard", async () => {
    const { ctx, interaction } = context({ action: "view" });
    await rank.execute(ctx);
    expect(interaction.lastReply?.embeds?.[0]?.description).toContain("Level **0**");
  });

  it("requires ManageGuild to configure rewards or a ticket panel", async () => {
    const { ctx } = context({ action: "rewards", value: "5:role-5" });
    await expect(rank.execute(ctx)).rejects.toThrow(/ManageGuild/i);

    const panel = context({ action: "panel", channel: "support" });
    await expect(ticket.execute(panel.ctx)).rejects.toThrow(/ManageGuild/i);
  });

  it("saves welcome settings through the module settings port", async () => {
    const { ctx } = context(
      { action: "welcome", channel: "welcome", value: "Hello {user}" },
      ["ManageGuild"],
    );
    await tools.execute(ctx);
    expect(await ctx.settings.get("guild-a")).toMatchObject({
      welcome: {
      enabled: true,
      channelId: "welcome",
      message: "Hello {user}",
      },
    });
  });

  it("saves goodbye settings through the same module settings port", async () => {
    const { ctx } = context(
      { action: "goodbye", channel: "farewell", value: "Bye {user}" },
      ["ManageGuild"],
    );
    await tools.execute(ctx);
    expect(await ctx.settings.get("guild-a")).toMatchObject({
      goodbye: { enabled: true, channelId: "farewell", message: "Bye {user}" },
    });
  });

  it("queues reminders and scheduled messages on the timer queue", async () => {
    const timers = new RecordingJobQueue();
    const reminder = context({ action: "reminder", value: "drink water", duration: 10 });
    await tools.execute({ ...reminder.ctx, timers });
    const scheduled = context(
      {
        action: "schedule",
        value: "Scheduled hello",
        duration: 10,
        channel: "general",
      },
      ["ManageGuild"],
    );
    await tools.execute({ ...scheduled.ctx, timers });

    expect(timers.enqueued.map((entry) => entry.name)).toEqual([
      "content.deliver",
      "content.deliver",
    ]);
    expect(timers.enqueued[0]?.payload).toMatchObject({ guildId: "guild-a", kind: "reminder" });
    expect(timers.enqueued[1]?.payload).toMatchObject({
      guildId: "guild-a",
      kind: "scheduled_message",
    });
    expect(timers.enqueued.map((entry) => entry.options?.delayMs)).toEqual([
      10 * 60_000,
      10 * 60_000,
    ]);
  });

  it("opens a ticket from the current channel", async () => {
    const { ctx, store, actions } = context({ action: "open", subject: "Help me" });
    await ticket.execute(ctx);
    const tickets = await store.listTickets("guild-a");
    expect(tickets).toHaveLength(1);
    expect(tickets[0]?.state).toBe("open");
    expect(actions.threads).toHaveLength(1);
  });

  it("renders guild ticket statistics outside a ticket thread", async () => {
    const { ctx, interaction } = context({ action: "stats" }, ["ManageGuild"]);
    await ticket.execute(ctx);
    expect(interaction.lastReply?.embeds?.[0]?.title).toBe("Ticket statistics");
    expect(interaction.lastReply?.embeds?.[0]?.description).toContain("Open **0**");
  });

  it("makes birthdays, suggestions, sticky, starboard overrides and select roles admin-reachable", async () => {
    const birthday = context({ action: "birthday", value: "11-01" });
    await tools.execute(birthday.ctx);
    expect(await birthday.store.getRecord("guild-a", "birthday", "user-a")).toMatchObject({
      data: { month: 11, day: 1 },
    });

    const birthdays = context(
      { action: "birthdays", channel: "birthdays", value: "Europe/London" },
      ["ManageGuild"],
    );
    await tools.execute(birthdays.ctx);
    expect(await birthdays.ctx.settings.get("guild-a")).toMatchObject({
      birthdays: { enabled: true, channelId: "birthdays", timezone: "Europe/London" },
    });

    const suggestions = context({ action: "suggestions", channel: "ideas" }, ["ManageGuild"]);
    await tools.execute(suggestions.ctx);
    expect(await suggestions.ctx.settings.get("guild-a")).toMatchObject({
      suggestions: { enabled: true, channelId: "ideas" },
    });

    const overrides = context(
      { action: "starboard-override", channel: "hot", target: "star-hot", limit: 2 },
      ["ManageGuild"],
    );
    await tools.execute(overrides.ctx);
    expect(await overrides.ctx.settings.get("guild-a")).toMatchObject({
      starboard: { overrides: { hot: { threshold: 2, channelId: "star-hot" } } },
    });

    const sticky = context(
      { action: "sticky", channel: "rules", value: "Read the rules.", limit: 3 },
      ["ManageGuild"],
    );
    await tools.execute(sticky.ctx);
    expect(await sticky.store.getRecord("guild-a", "sticky", "rules")).toMatchObject({
      data: { message: "Read the rules.", afterMessages: 3 },
    });

    const select = context(
      { action: "roles", channel: "roles", value: "role-a:Alpha,role-b:Beta" },
      ["ManageGuild"],
    );
    await tools.execute(select.ctx);
    const component = select.actions.sent.at(-1)?.message.components?.[0]?.components[0];
    expect(component?.type).toBe("select");
  });

  it("starts a season from the admin path and reports the archive count", async () => {
    const { ctx, store, interaction } = context(
      { action: "season", value: "autumn", days: 30 },
      ["ManageGuild"],
    );
    await store.setLevel("guild-a", "user-a", 2, 200);
    await rank.execute(ctx);
    expect(interaction.lastReply?.content).toContain("Archived **1**");
    expect(await store.topLevels("guild-a", 10)).toEqual([]);
  });

  it("summarizes a ticket through the AI port without pretending to resolve it", async () => {
    const { ctx, store, interaction } = context({ action: "summary" }, ["ManageGuild"]);
    await store.createTicket({
      guildId: "guild-a",
      channelId: "99",
      openerId: "user-a",
      subject: "Help me log in",
    });
    const ai = {
      providerName: "test",
      configured: true,
      summarize: async () => ({
        text: "• Login issue remains unresolved.\n• Next: ask for the exact error.",
        sources: [],
        model: "test-model",
        usage: { inputTokens: 4, outputTokens: 6, costUsd: 0.0001 },
      }),
    } as unknown as AiPort;

    await ticket.execute({ ...ctx, ai });
    expect(interaction.lastReply?.embeds?.[0]?.title).toBe("Ticket summary");
    expect(interaction.lastReply?.embeds?.[0]?.description).toContain("unresolved");
    expect(interaction.lastReply?.embeds?.[0]?.description).toContain("A human decides any action");
  });

  it("configures, lists and removes auto-responders behind ManageGuild", async () => {
    const enable = context({ action: "responders", value: "on" }, ["ManageGuild"]);
    await tools.execute(enable.ctx);
    expect(await enable.ctx.settings.get("guild-a")).toMatchObject({
      responders: { enabled: true },
    });

    const add = context(
      {
        action: "responder",
        name: "hello there",
        value: "General Kenobi!",
        match: "contains",
        limit: 30,
      },
      ["ManageGuild"],
    );
    await tools.execute(add.ctx);
    expect(add.interaction.lastReply?.content).toContain("Auto-responder saved");
    const records = await add.store.listRecords("guild-a", "responder");
    expect(records[0]?.data).toMatchObject({
      trigger: "hello there",
      match: "contains",
      response: "General Kenobi!",
      cooldownSeconds: 30,
    });

    const listInteraction = new FakeInteraction({
      commandName: "tools",
      guildId: "guild-a",
      userId: "user-a",
      permissions: ["ManageGuild"],
      options: {},
      subcommand: "responders",
    });
    await tools.execute({ ...add.ctx, interaction: listInteraction, commandPath: ["responders"] });
    expect(listInteraction.lastReply?.content).toContain("hello there → General Kenobi!");

    for (let index = 0; index < 11; index += 1) {
      await add.store.putRecord("guild-a", "responder", `extra-${index}`, {
        id: `extra-${index}`,
        trigger: `trigger ${index}`,
        match: "exact",
        response: "x".repeat(120),
        cooldownSeconds: 0,
        createdBy: "mod",
      });
    }
    const cappedInteraction = new FakeInteraction({
      commandName: "tools",
      guildId: "guild-a",
      userId: "user-a",
      permissions: ["ManageGuild"],
      options: {},
      subcommand: "responders",
    });
    await tools.execute({ ...add.ctx, interaction: cappedInteraction, commandPath: ["responders"] });
    expect(cappedInteraction.lastReply?.content?.length ?? 0).toBeLessThanOrEqual(2_000);
    expect(cappedInteraction.lastReply?.content).toContain("showing 10 of 12");

    const removeInteraction = new FakeInteraction({
      commandName: "tools",
      guildId: "guild-a",
      userId: "user-a",
      permissions: ["ManageGuild"],
      options: { name: records[0]?.key ?? "" },
      subcommand: "responder-remove",
    });
    await tools.execute({ ...add.ctx, interaction: removeInteraction, commandPath: ["responder-remove"] });
    expect(await add.store.getRecord("guild-a", "responder", records[0]?.key ?? "")).toBeUndefined();

    const denied = context({ action: "responder", name: "x", value: "y" });
    await expect(tools.execute(denied.ctx)).rejects.toThrow(/ManageGuild/i);
  });

  it("runs every economy surface and keeps bot/self/cooldown refusals explicit", async () => {
    const balance = context({ action: "balance" });
    await balance.store.addLedger({
      guildId: "guild-a",
      userId: "user-a",
      amount: 100,
      reason: "seed",
      idempotencyKey: "cmd-seed-balance",
    });
    await rank.execute(balance.ctx);
    expect(balance.interaction.lastReply?.content).toContain("**100 coins**");

    const daily = context({ action: "daily" });
    await rank.execute(daily.ctx);
    expect(daily.interaction.lastReply?.content).toContain("claimed **100 coins**");
    await rank.execute(daily.ctx);
    expect(daily.interaction.lastReply?.content).toContain("Daily already claimed");

    const pay = context({ action: "pay", user: "user-b", amount: 50 });
    await pay.store.addLedger({
      guildId: "guild-a",
      userId: "user-a",
      amount: 100,
      reason: "seed",
      idempotencyKey: "cmd-seed-pay",
    });
    await rank.execute(pay.ctx);
    expect(pay.interaction.lastReply?.content).toContain("Sent **50 coins**");

    const shop = context({ action: "shop" });
    await rank.execute(shop.ctx);
    expect(shop.interaction.lastReply?.embeds?.[0]?.title).toContain("shop");

    const buy = context({ action: "buy", item: "vip" });
    await buy.store.addLedger({
      guildId: "guild-a",
      userId: "user-a",
      amount: 10,
      reason: "seed",
      idempotencyKey: "cmd-seed-buy",
    });
    await rank.execute(buy.ctx);
    expect(buy.interaction.lastReply?.content).toContain("Bought **VIP**");

    const gamble = context({ action: "gamble", amount: 10 }, [], { gambling: true, gambleMax: 50 });
    await gamble.store.addLedger({
      guildId: "guild-a",
      userId: "user-a",
      amount: 100,
      reason: "seed",
      idempotencyKey: "cmd-seed-gamble",
    });
    await rank.execute(gamble.ctx);
    expect(gamble.interaction.lastReply?.content).toMatch(/Balance:/);

    const ledger = context({ action: "ledger" });
    await ledger.store.addLedger({
      guildId: "guild-a",
      userId: "user-a",
      amount: 7,
      reason: "fixture",
      idempotencyKey: "cmd-seed-ledger",
    });
    await rank.execute(ledger.ctx);
    expect(ledger.interaction.lastReply?.embeds?.[0]?.description).toContain("fixture");

    const bot = context({ action: "pay", user: "bot-1", amount: 10 });
    bot.actions.botIds.add("bot-1");
    await expect(rank.execute(bot.ctx)).rejects.toThrow(/bot/i);

    const self = context({ action: "pay", user: "user-a", amount: 10 });
    await expect(rank.execute(self.ctx)).rejects.toThrow(/yourself/i);

    const overCap = context({ action: "pay", user: "user-b", amount: 10_001 });
    await expect(rank.execute(overCap.ctx)).rejects.toThrow(/maximum transfer/i);
  });
});
