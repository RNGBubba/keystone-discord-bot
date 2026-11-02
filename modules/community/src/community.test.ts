import { describe, expect, it } from "vitest";
import { RecordingJobQueue } from "@keystone/testing";
import { communitySettingsSchema } from "./settings";
import { InMemoryCommunityStore } from "./store";
import { RecordingCommunityActions, firstRow } from "./testing";
import { EconomyService, LevelingService } from "./progress";
import {
  GiveawayService,
  ReactionRoleService,
  StarboardService,
  TempVoiceService,
  WelcomeService,
} from "./engagement";
import { TicketService } from "./tickets";
import { ContentService, parseRss } from "./content";

const guild = "guild-a";
const user = "user-a";

function settings(overrides: Record<string, unknown> = {}) {
  return communitySettingsSchema.parse(overrides);
}

function nowAt(): { now: () => number; advance: (ms: number) => void } {
  let value = Date.now();
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

describe("P3 leveling and economy", () => {
  it("projects XP from events, levels once, grants a reward and survives duplicate delivery", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const clock = nowAt();
    const config = settings({
      xp: {
        minPerMessage: 50,
        maxPerMessage: 50,
        cooldownMs: 1_000,
        rewards: [{ level: 1, roleId: "role-level-1" }],
      },
    });
    const service = new LevelingService(store, actions, config, clock.now, () => 0);

    const first = await service.awardMessageXp(guild, user, "m-1");
    expect(first.profile.xp).toBe(50);
    expect(first.levelUp).toBe(false);

    clock.advance(1_001);
    const second = await service.awardMessageXp(guild, user, "m-2");
    expect(second.profile).toMatchObject({ xp: 100, level: 1 });
    expect(second.levelUp).toBe(true);
    expect(second.rewards).toEqual(["role-level-1"]);
    expect(actions.roleCalls).toEqual([
      { userId: user, roleId: "role-level-1", added: true },
    ]);

    const duplicate = await service.awardMessageXp(guild, user, "m-2");
    expect(duplicate.awarded).toBe(0);
    expect(duplicate.profile.xp).toBe(100);

    const rank = await service.rank(guild, user);
    expect(rank.rank).toBe(1);
    expect((await service.leaderboard(guild, 5))[0]?.xp).toBe(100);
  });

  it("enforces cooldowns between awards", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const config = settings({ xp: { minPerMessage: 10, maxPerMessage: 10, cooldownMs: 60_000 } });
    const clock = nowAt();
    const service = new LevelingService(store, actions, config, clock.now, () => 0);

    expect((await service.awardMessageXp(guild, user, "m-1")).awarded).toBe(10);
    expect((await service.awardMessageXp(guild, user, "m-2")).awarded).toBe(0);
    clock.advance(60_001);
    expect((await service.awardMessageXp(guild, user, "m-3")).awarded).toBe(10);
  });

  it("keeps an append-only balance, claims daily once, transfers and buys role items", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const config = settings({
      economy: {
        dailyAmount: 100,
        transferMax: 1_000,
        shop: [{ id: "vip", name: "VIP", price: 60, roleId: "role-vip" }],
      },
    });
    const service = new EconomyService(store, actions, config, () => 1_700_000_000_000, () => 0);

    await store.addLedger({
      guildId: guild,
      userId: user,
      amount: 200,
      reason: "seed",
      idempotencyKey: "seed-1",
    });
    const daily = await service.daily(guild, user);
    expect(daily).toMatchObject({ ok: true, amount: 100, balance: 300 });
    expect(await service.daily(guild, user)).toMatchObject({ ok: false, amount: 0 });
    expect(await service.balance(guild, user)).toBe(300);

    const transfer = await service.transfer(guild, user, "user-b", 50);
    expect(transfer).toMatchObject({ ok: true, fromBalance: 250, toBalance: 50 });
    expect((await service.transfer(guild, user, "user-b", 500)).ok).toBe(false);

    const bought = await service.buy(guild, user, "vip");
    expect(bought).toMatchObject({ ok: true, balance: 190 });
    expect(actions.roleCalls.some((call) => call.roleId === "role-vip")).toBe(true);
    expect((await service.buy(guild, user, "vip")).ok).toBe(false);

    const ledger = await service.ledger(guild, user, 10);
    expect(ledger.length).toBeGreaterThanOrEqual(4);
    expect(ledger.some((entry) => entry.amount === -60)).toBe(true);
  });

  it("refuses gambling unless opted in and caps the bet", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const config = settings({ economy: { gambling: false, gambleMax: 50 } });
    const service = new EconomyService(store, actions, config, () => 0, () => 0);

    await store.addLedger({
      guildId: guild,
      userId: user,
      amount: 100,
      reason: "seed",
      idempotencyKey: "seed-gamble",
    });
    await expect(service.gamble(guild, user, 10)).rejects.toThrow(/disabled/i);

    const enabled = new EconomyService(
      store,
      actions,
      settings({ economy: { gambling: true, gambleMax: 50 } }),
      () => 0,
      () => 0,
    );
    await expect(enabled.gamble(guild, user, 51)).rejects.toThrow(/maximum bet/i);
    const result = await enabled.gamble(guild, user, 10);
    expect(result).toMatchObject({ ok: true, won: true, amount: 10 });
  });
});

describe("P3 community", () => {
  it("sends welcome text, grants the autorole and optionally DMs", async () => {
    const actions = new RecordingCommunityActions();
    const service = new WelcomeService(
      actions,
      settings({
        welcome: {
          enabled: true,
          channelId: "welcome-channel",
          roleId: "member-role",
          dm: true,
          message: "Welcome {user} to {server}!",
        },
      }),
    );

    const result = await service.handleJoin(guild, user, "Keystone Test");
    expect(result).toEqual({ sent: true, roleAdded: true, dmSent: true });
    expect(actions.sent[0]?.message.content).toContain("<@user-a>");
    expect(actions.sent[0]?.message.content).toContain("Keystone Test");
    expect(actions.roleCalls[0]?.roleId).toBe("member-role");
    expect(actions.dms[0]?.userId).toBe(user);
  });

  it("posts a button panel and toggles the role on the button path", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const service = new ReactionRoleService(store, actions);

    const panel = await service.createPanel(guild, "roles-channel", "Pick a role", [
      { roleId: "role-news", label: "News" },
    ]);
    const button = firstRow(actions.sent[0]!.message)?.components[0];
    expect(button?.customId).toBe("keystone:role:role-news");

    expect(await service.toggle(guild, user, "role-news")).toMatchObject({
      added: true,
      label: "News",
    });
    expect(await service.toggle(guild, user, "role-news")).toMatchObject({ added: false });
    expect(panel.messageId).toBe(actions.sent[0]?.id);
  });

  it("only posts a starboard entry at the threshold and edits it afterwards", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const service = new StarboardService(
      store,
      actions,
      settings({ starboard: { channelId: "starboard", threshold: 3 } }),
    );
    const input = {
      guildId: guild,
      channelId: "general",
      messageId: "message-1",
      authorId: user,
      content: "A useful message",
      emoji: "⭐",
      count: 2,
    };

    expect(await service.onReaction(input)).toEqual({ posted: false, edited: false });
    expect(actions.sent).toHaveLength(0);
    expect(await service.onReaction({ ...input, count: 3 })).toEqual({
      posted: true,
      edited: false,
    });
    expect(actions.sent).toHaveLength(1);
    expect(await service.onReaction({ ...input, count: 4 })).toEqual({
      posted: false,
      edited: true,
    });
    expect(actions.edited).toHaveLength(1);
  });

  it("enters each giveaway once, refuses early ends and picks winners", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const clock = nowAt();
    const service = new GiveawayService(store, actions, settings(), clock.now, () => 0.1);

    const giveaway = await service.start(guild, "events", "Nitro", 10, 1);
    expect(actions.sent[0]?.message.components?.[0]?.components[0]?.customId).toContain(
      giveaway.id,
    );
    expect(await service.enter(guild, giveaway.id, user)).toMatchObject({
      entered: true,
      entries: 1,
    });
    expect(await service.enter(guild, giveaway.id, user)).toMatchObject({ entered: false });
    expect((await service.end(guild, giveaway.id)).ended).toBe(false);

    clock.advance(11 * 60_000);
    const ended = await service.end(guild, giveaway.id);
    expect(ended.ended).toBe(true);
    expect(ended.winners).toEqual([user]);
    expect(actions.dms[0]?.userId).toBe(user);
    expect((await service.end(guild, giveaway.id)).ended).toBe(false);
  });

  it("creates and cleans up an owned temporary voice channel", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const service = new TempVoiceService(
      store,
      actions,
      settings({ tempVoice: { hubChannelId: "hub", nameTemplate: "{user}'s room" } }),
    );

    const created = await service.onVoice({
      guildId: guild,
      userId: user,
      channelId: "hub",
      displayName: "Ada",
    });
    expect(created.created).toBe("voice-1");
    expect(actions.voiceCreated[0]?.name).toBe("Ada's room");

    actions.memberCount = 1;
    expect(
      await service.onVoice({
        guildId: guild,
        userId: user,
        previousChannelId: "voice-1",
        channelId: "other",
      }),
    ).toEqual({});
    actions.memberCount = 0;
    expect(
      await service.onVoice({
        guildId: guild,
        userId: user,
        previousChannelId: "voice-1",
        channelId: "other",
      }),
    ).toEqual({ deleted: "voice-1" });
    expect(actions.channelsDeleted).toEqual(["voice-1"]);
  });
});

describe("P3 tickets and content", () => {
  it("opens one thread ticket, claims it, stores a transcript, closes it and reports stats", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const clock = nowAt();
    const service = new TicketService(store, actions, settings(), clock.now);

    const panel = await service.panel(guild, "support", "Need help?");
    expect(panel.messageId).toBe("msg-1");
    expect(firstRow(actions.sent[0]!.message)?.components[0]?.customId).toBe(
      "keystone:ticket:open",
    );

    const ticket = await service.open(guild, user, "support", "Broken rank");
    expect(ticket.channelId).toBe("thread-2");
    expect(await store.listTicketEvents(guild, ticket.id)).toHaveLength(1);
    await expect(service.open(guild, user, "support", "Second")).rejects.toThrow(/already have/i);

    const claimed = await service.claim(guild, ticket.id, "mod-1");
    expect(claimed).toMatchObject({ state: "claimed", claimerId: "mod-1" });
    await service.appendMessage(guild, ticket.id, user, "m-1", "Here is the screenshot.");
    const transcript = await service.transcript(guild, ticket.id);
    expect(transcript.text).toContain("Here is the screenshot.");
    expect(transcript.text).toContain("claimed by mod-1");

    clock.advance(5 * 60_000);
    const closed = await service.close(guild, ticket.id, "mod-1");
    expect(closed.state).toBe("closed");
    expect(actions.closedThreads).toEqual([ticket.channelId]);
    const stats = await service.stats(guild);
    expect(stats).toMatchObject({ open: 0, claimed: 0, closed: 1 });
    expect(stats.averageCloseMinutes).toBeGreaterThan(0);
  });

  it("builds embeds, stores tags, fires reminders/schedules and counts poll votes", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const clock = nowAt();
    const service = new ContentService(store, actions, settings(), clock.now);

    await service.createEmbed(guild, "general", "Rules", { title: "Rules", description: "Be kind." });
    expect(actions.sent[0]?.message.embeds?.[0]?.title).toBe("Rules");
    await expect(
      service.createEmbed(guild, "general", "Empty", { description: "" }),
    ).rejects.toThrow(/title or description/i);

    await service.createTag(guild, "rules", "Be kind.", user);
    expect(await service.getTag(guild, "rules")).toBe("Be kind.");

    const due = new Date(clock.now() + 1_000).toISOString();
    await service.createReminder(guild, user, undefined, "drink water", due);
    await service.scheduleMessage(guild, "general", "Scheduled hello", due);
    expect(await service.tick(guild)).toEqual({ reminders: 0, scheduled: 0 });
    clock.advance(2_000);
    expect(await service.tick(guild)).toEqual({ reminders: 1, scheduled: 1 });
    expect(actions.dms[0]?.message.content).toContain("drink water");
    expect(actions.sent.some((entry) => entry.message.content === "Scheduled hello")).toBe(true);
    expect(await service.tick(guild)).toEqual({ reminders: 0, scheduled: 0 });

    const poll = await service.createPoll(guild, "general", "Lunch?", ["Pizza", "Soup"]);
    expect(firstRow(actions.sent.at(-1)!.message)?.components).toHaveLength(2);
    expect(await service.vote(guild, poll.id, user, 0)).toEqual({ counts: [1, 0], total: 1 });
    expect(await service.vote(guild, poll.id, "user-b", 1)).toEqual({
      counts: [1, 1],
      total: 2,
    });
  });

  it("queues one timer per reminder/schedule and delivers idempotently", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const clock = nowAt();
    const queue = new RecordingJobQueue();
    const service = new ContentService(store, actions, settings(), clock.now);

    const due = new Date(clock.now() + 1_000).toISOString();
    const reminder = await service.createReminder(
      guild,
      user,
      undefined,
      "drink water",
      due,
      queue,
    );
    const scheduled = await service.scheduleMessage(
      guild,
      "general",
      "Scheduled hello",
      due,
      queue,
    );

    expect(queue.enqueued.map((entry) => entry.name)).toEqual([
      "content.deliver",
      "content.deliver",
    ]);
    expect(queue.enqueued[0]).toMatchObject({
      payload: { guildId: guild, kind: "reminder", id: reminder.id },
      options: { idempotencyKey: `content.deliver:reminder:${reminder.id}` },
    });
    expect(queue.enqueued[1]).toMatchObject({
      payload: { guildId: guild, kind: "scheduled_message", id: scheduled.id },
      options: { idempotencyKey: `content.deliver:scheduled_message:${scheduled.id}` },
    });

    expect(await service.deliver(guild, "reminder", reminder.id)).toMatchObject({
      status: "not-due",
    });
    expect(actions.dms).toHaveLength(0);

    clock.advance(2_000);
    expect(await service.deliver(guild, "reminder", reminder.id)).toEqual({ status: "sent" });
    expect(await service.deliver(guild, "scheduled_message", scheduled.id)).toEqual({
      status: "sent",
    });
    expect(actions.dms[0]?.message.content).toContain("drink water");
    expect(actions.sent.some((entry) => entry.message.content === "Scheduled hello")).toBe(true);

    // A redelivered timer re-reads the record and cannot send a second copy.
    expect(await service.deliver(guild, "reminder", reminder.id)).toEqual({
      status: "already-sent",
    });
    expect(await service.deliver(guild, "scheduled_message", scheduled.id)).toEqual({
      status: "already-sent",
    });
    expect(await service.deliver(guild, "reminder", "missing")).toEqual({ status: "missing" });
  });

  it("claims a delivery before sending so two sweepers cannot both send", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const clock = nowAt();
    const service = new ContentService(store, actions, settings(), clock.now);

    const due = new Date(clock.now() + 1_000).toISOString();
    const reminder = await service.createReminder(guild, user, undefined, "drink water", due);
    clock.advance(2_000);

    const results = await Promise.all([
      service.deliver(guild, "reminder", reminder.id),
      service.deliver(guild, "reminder", reminder.id),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["already-sent", "sent"]);
    expect(actions.dms).toHaveLength(1);
  });

  it("dedupes feeds by GUID and updates a stat channel", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const service = new ContentService(store, actions, settings(), () => 1_700_000_000_000);
    const feed = await service.addFeed(guild, "https://example.com/feed.xml", "news");

    const xml =
      "<rss><channel><item><title>Hello</title><link>https://example.com/1</link><guid>one</guid></item></channel></rss>";
    expect(parseRss(xml)).toMatchObject({ title: "Hello", guid: "one" });
    expect(await service.pollFeed(guild, feed.id, xml)).toMatchObject({ posted: true });
    expect(await service.pollFeed(guild, feed.id, xml)).toMatchObject({ posted: false });
    expect(actions.sent.filter((entry) => entry.message.embeds?.[0]?.title === "Hello")).toHaveLength(1);

    await service.addStatChannel(guild, "stat-channel", "members");
    expect(await service.refreshStat(guild, "stat-channel", 42)).toBe(true);
    expect(actions.channelNames).toEqual([{ channelId: "stat-channel", name: "Members: 42" }]);
    await expect(service.addFeed(guild, "ftp://nope", "news")).rejects.toThrow(/http/i);
  });
});
