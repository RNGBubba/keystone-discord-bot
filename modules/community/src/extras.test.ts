import { describe, expect, it } from "vitest";
import { createComponentSigner } from "@keystone/kernel";
import { birthdayOutput } from "./test-helpers";
import { communitySettingsSchema } from "./settings";
import { InMemoryCommunityStore } from "./store";
import { RecordingCommunityActions, firstRow } from "./testing";
import {
  BirthdayService,
  SeasonService,
  StickyService,
  SuggestionService,
} from "./extras";
import { ReactionRoleService, StarboardService, WelcomeService } from "./engagement";

const guild = "guild-a";
const user = "user-a";
const componentSigner = createComponentSigner("community-test-secret");

function settings(overrides: Record<string, unknown> = {}) {
  return communitySettingsSchema.parse(overrides);
}

function clockAt(iso: string): { now: () => number; advance: (ms: number) => void } {
  let value = new Date(iso).getTime();
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

describe("P3 follow-up community features", () => {
  it("announces a birthday once per year, validates the date and supports removal", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const clock = clockAt("2026-11-01T12:00:00.000Z");
    const service = new BirthdayService(
      store,
      actions,
      settings({ birthdays: { enabled: true, channelId: "birthdays", timezone: "UTC" } }),
      clock.now,
    );

    expect(await service.set(guild, user, "11-01")).toEqual({ month: 11, day: 1 });
    await expect(service.set(guild, user, "02-30")).rejects.toThrow(/real calendar/i);
    expect(() => settings({ birthdays: { timezone: "Mars/Olympus" } })).toThrow(
      /timezone/i,
    );
    expect(await service.announceDue(guild)).toBe(1);
    expect(birthdayOutput(actions)).toBe(1);
    expect(await service.announceDue(guild)).toBe(0);
    expect(await service.get(guild, user)).toMatchObject({ month: 11, day: 1, lastAnnouncedYear: 2026 });

    await service.remove(guild, user);
    expect(await service.get(guild, user)).toBeUndefined();
    expect(await service.announceDue(guild)).toBe(0);
  });

  it("submits suggestions, counts one vote per user and records a decision once", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const service = new SuggestionService(
      store,
      actions,
      settings({ suggestions: { enabled: true, channelId: "suggestions" } }),
      () => 1_700_000_000_000,
      componentSigner,
    );

    const suggestion = await service.submit(guild, user, "Please add a movie night channel.");
    expect(suggestion.messageId).toBe("msg-1");
    expect(firstRow(actions.sent[0]!.message)?.components[0]?.customId).toContain("suggest:up");

    expect(await service.vote(guild, suggestion.id, "user-b", "up")).toMatchObject({
      up: 1,
      down: 0,
      changed: true,
    });
    expect(await service.vote(guild, suggestion.id, "user-b", "up")).toMatchObject({
      up: 1,
      changed: false,
    });
    expect(await service.vote(guild, suggestion.id, "user-b", "down")).toMatchObject({
      up: 0,
      down: 1,
      changed: true,
    });

    expect((await service.decide(guild, suggestion.id, "mod-1", "approved")).changed).toBe(true);
    expect((await service.decide(guild, suggestion.id, "mod-1", "approved")).changed).toBe(false);
    await expect(service.vote(guild, suggestion.id, "user-c", "up")).rejects.toThrow(/decided/i);

    const disabled = new SuggestionService(
      store,
      actions,
      settings({ suggestions: { enabled: false } }),
      Date.now,
      componentSigner,
    );
    await expect(disabled.submit(guild, user, "No suggestions here.")).rejects.toThrow(/disabled/i);
  });

  it("posts a multi-role select panel and applies the selected set idempotently", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const service = new ReactionRoleService(store, actions, componentSigner);

    const panel = await service.createSelectPanel(guild, "roles", "Pick roles", [
      { roleId: "role-a", label: "Alpha" },
      { roleId: "role-b", label: "Beta" },
      { roleId: "role-c", label: "Gamma" },
    ]);
    const select = firstRow(actions.sent[0]!.message)?.components[0];
    expect(select?.type).toBe("select");
    if (select?.type !== "select") throw new Error("expected select");
    expect(select.maxValues).toBe(3);
    expect(select.options.map((option) => option.value)).toEqual(["role-a", "role-b", "role-c"]);

    expect(await service.applySelection(guild, user, panel.panelId, ["role-a", "role-c"])).toEqual({
      added: 2,
      removed: 0,
    });
    expect(await service.applySelection(guild, user, panel.panelId, ["role-a", "role-c"])).toEqual({
      added: 0,
      removed: 0,
    });
    expect(await service.applySelection(guild, user, panel.panelId, ["role-b"])).toEqual({
      added: 1,
      removed: 2,
    });
    await expect(service.applySelection(guild, user, panel.panelId, ["role-x"])).rejects.toThrow(
      /not part/i,
    );
  });

  it("honours a per-channel starboard override before the guild threshold", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const service = new StarboardService(
      store,
      actions,
      settings({
        starboard: {
          channelId: "starboard-global",
          threshold: 5,
          overrides: { "channel-hot": { channelId: "starboard-hot", threshold: 1 } },
        },
      }),
    );
    const input = {
      guildId: guild,
      channelId: "channel-hot",
      messageId: "message-hot",
      authorId: user,
      content: "hot",
      emoji: "⭐",
      count: 1,
    };

    expect(await service.onReaction(input)).toEqual({ posted: true, edited: false });
    expect(actions.sent[0]?.channelId).toBe("starboard-hot");
    expect(await service.onReaction({ ...input, count: 2 })).toEqual({
      posted: false,
      edited: true,
    });
    expect(await service.onReaction({ ...input, channelId: "channel-cold", count: 4 })).toEqual({
      posted: false,
      edited: false,
    });
  });

  it("queues a delayed autorole and applies it once after the due time", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const clock = clockAt("2026-11-01T12:00:00.000Z");
    const service = new WelcomeService(
      actions,
      settings({
        welcome: {
          enabled: true,
          channelId: "welcome",
          roleId: "member-role",
          roleDelayMinutes: 10,
        },
      }),
      store,
      clock.now,
    );

    const joined = await service.handleJoin(guild, user, "Keystone");
    expect(joined).toMatchObject({ roleAdded: false });
    expect(actions.roleCalls).toHaveLength(0);
    expect(await service.applyDueAutoroles(guild)).toBe(0);

    clock.advance(10 * 60_000 + 1);
    expect(await service.applyDueAutoroles(guild)).toBe(1);
    expect(actions.roleCalls).toEqual([
      { userId: user, roleId: "member-role", added: true },
    ]);
    expect(await service.applyDueAutoroles(guild)).toBe(0);
  });

  it("reposts a sticky only after the configured count and ignores duplicate message events", async () => {
    const store = new InMemoryCommunityStore();
    const actions = new RecordingCommunityActions();
    const service = new StickyService(store, actions);

    await service.configure(guild, "general", "Read the rules.", 2);
    expect(await service.onMessage(guild, "general", "m-1")).toEqual({
      posted: false,
      count: 1,
    });
    expect(await service.onMessage(guild, "general", "m-1")).toEqual({
      posted: false,
      count: 1,
    });
    expect(await service.onMessage(guild, "general", "m-2")).toEqual({
      posted: true,
      count: 0,
    });
    expect(actions.sent).toHaveLength(1);
    expect(actions.deletedMessages).toHaveLength(0);

    expect(await service.onMessage(guild, "general", "m-3")).toEqual({
      posted: false,
      count: 1,
    });
    expect(await service.onMessage(guild, "general", "m-4")).toEqual({
      posted: true,
      count: 0,
    });
    expect(actions.deletedMessages).toEqual([{ channelId: "general", messageId: "msg-1" }]);
  });

  it("archives and clears a season without losing the old profile, and rolls over once", async () => {
    const store = new InMemoryCommunityStore();
    const clock = clockAt("2026-11-01T12:00:00.000Z");
    await store.setLevel(guild, user, 4, 450);
    const service = new SeasonService(store, clock.now);

    const started = await service.start(guild, "autumn", 30);
    expect(started).toMatchObject({ archived: 1, alreadyReset: false });
    expect(await store.topLevels(guild, 10)).toEqual([]);
    const archived = await store.listRecords<{ seasonKey: string; xp: number }>(
      guild,
      "xp_season_archive",
      10,
    );
    expect(archived[0]?.data).toMatchObject({ seasonKey: "autumn", xp: 450 });

    expect(await service.start(guild, "autumn", 30)).toMatchObject({
      archived: 0,
      alreadyReset: true,
    });
    expect((await service.rollover(guild)).rotated).toBe(false);
    await store.setLevel(guild, "user-b", 2, 200);
    clock.advance(31 * 86_400_000);
    const rolled = await service.rollover(guild);
    expect(rolled).toMatchObject({ rotated: true, archived: 1 });
    expect(await store.topLevels(guild, 10)).toEqual([]);
    expect(
      await store.listRecords(guild, "xp_season_archive", 10),
    ).toHaveLength(2);
  });
});
