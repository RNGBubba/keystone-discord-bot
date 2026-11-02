import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMigratedPglite, type PgliteHarness } from "./testing";
import { DrizzleCommunityStore } from "./community-store";

let harness: PgliteHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("DrizzleCommunityStore", () => {
  it("projects XP idempotently and isolates guild leaderboards", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleCommunityStore(harness.db as never);

    const first = await store.awardXp({
      guildId: "guild-a",
      userId: "user-1",
      amount: 60,
      source: "message",
      idempotencyKey: "xp:m-1",
    });
    expect(first.inserted).toBe(true);
    expect(first.profile.xp).toBe(60);

    const duplicate = await store.awardXp({
      guildId: "guild-a",
      userId: "user-1",
      amount: 60,
      source: "message",
      idempotencyKey: "xp:m-1",
    });
    expect(duplicate.inserted).toBe(false);
    expect(duplicate.profile.xp).toBe(60);

    await store.awardXp({
      guildId: "guild-a",
      userId: "user-2",
      amount: 110,
      source: "message",
      idempotencyKey: "xp:m-2",
    });
    expect((await store.topLevels("guild-a", 10)).map((row) => row.userId)).toEqual([
      "user-2",
      "user-1",
    ]);
    expect(await store.getLevel("guild-b", "user-1")).toBeUndefined();
  });

  it("keeps money in an append-only ledger and transfers atomically", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleCommunityStore(harness.db as never);

    await store.addLedger({
      guildId: "guild-a",
      userId: "user-1",
      amount: 100,
      reason: "seed",
      idempotencyKey: "seed",
    });
    const duplicate = await store.addLedger({
      guildId: "guild-a",
      userId: "user-1",
      amount: 100,
      reason: "seed",
      idempotencyKey: "seed",
    });
    expect(duplicate).toEqual({ inserted: false, balance: 100 });

    const transfer = await store.transfer({
      guildId: "guild-a",
      fromUserId: "user-1",
      toUserId: "user-2",
      amount: 40,
      reason: "test",
      idempotencyKey: "transfer-1",
    });
    expect(transfer).toMatchObject({ ok: true, fromBalance: 60, toBalance: 40 });
    expect(await store.getBalance("guild-a", "user-1")).toBe(60);
    expect((await store.listLedger("guild-a", "user-1", 10)).length).toBe(2);

    const insufficient = await store.transfer({
      guildId: "guild-a",
      fromUserId: "user-2",
      toUserId: "user-1",
      amount: 500,
      reason: "test",
      idempotencyKey: "transfer-2",
    });
    expect(insufficient.ok).toBe(false);
  });

  it("persists tickets, transcript events and scoped community records", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleCommunityStore(harness.db as never);

    const ticket = await store.createTicket({
      guildId: "guild-a",
      channelId: "thread-1",
      openerId: "user-1",
      subject: "Help",
    });
    await store.appendTicketEvent("guild-a", ticket.id, "opened", "user-1", { subject: "Help" });
    const claimed = await store.updateTicket("guild-a", ticket.id, {
      state: "claimed",
      claimerId: "mod-1",
    });
    expect(claimed).toMatchObject({ state: "claimed", claimerId: "mod-1" });
    expect(await store.listTicketEvents("guild-a", ticket.id)).toHaveLength(1);

    await store.putRecord("guild-a", "tag", "rules", { value: "Be kind." });
    expect(await store.getRecord("guild-a", "tag", "rules")).toMatchObject({
      data: { value: "Be kind." },
    });
    expect(await store.getRecord("guild-b", "tag", "rules")).toBeUndefined();
    await store.putRecord("guild-a", "tag", "rules", { value: "Be excellent." });
    expect(await store.getRecord("guild-a", "tag", "rules")).toMatchObject({
      data: { value: "Be excellent." },
    });
    await store.deleteRecord("guild-a", "tag", "rules");
    expect(await store.getRecord("guild-a", "tag", "rules")).toBeUndefined();
  });

  it("persists auto-responder records per guild through a close and reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keystone-responder-"));
    try {
      harness = await createMigratedPglite(directory);
      let store = new DrizzleCommunityStore(harness.db as never);
      await store.putRecord("guild-a", "responder", "dev-hello", {
        id: "dev-hello",
        trigger: "hello keystone",
        match: "exact",
        response: "Hi from the fixture.",
        cooldownSeconds: 10,
        createdBy: "mod-1",
      });
      await harness.close();
      harness = undefined;

      harness = await createMigratedPglite(directory);
      store = new DrizzleCommunityStore(harness.db as never);
      const records = await store.listRecords("guild-a", "responder");
      expect(records).toHaveLength(1);
      expect(records[0]?.data).toMatchObject({
        trigger: "hello keystone",
        match: "exact",
        response: "Hi from the fixture.",
      });
      expect(await store.listRecords("guild-b", "responder")).toHaveLength(0);
    } finally {
      await harness?.close();
      harness = undefined;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("claims a due delivery once so two sweepers cannot both send", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleCommunityStore(harness.db as never);
    await store.putRecord("guild-a", "reminder", "r-1", {
      dueAt: "2026-11-02T00:00:00.000Z",
      text: "drink water",
      sent: false,
    });

    const claimed = await store.claimSent("guild-a", "reminder", "r-1");
    expect(claimed?.data).toMatchObject({ text: "drink water", sent: true });
    expect(await store.claimSent("guild-a", "reminder", "r-1")).toBeUndefined();
    expect(await store.claimSent("guild-a", "reminder", "missing")).toBeUndefined();
    expect(await store.getRecord("guild-b", "reminder", "r-1")).toBeUndefined();
  });

  it("archives the XP projection before clearing a season", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleCommunityStore(harness.db as never);
    await store.setLevel("guild-a", "user-1", 3, 350);

    const first = await store.resetLevels("guild-a", "autumn");
    expect(first).toEqual({ archived: 1, alreadyReset: false });
    expect(await store.getLevel("guild-a", "user-1")).toBeUndefined();
    expect(await store.getRecord("guild-a", "xp_season_archive", "autumn:user-1")).toMatchObject({
      data: { seasonKey: "autumn", xp: 350, level: 3 },
    });

    expect(await store.resetLevels("guild-a", "autumn")).toEqual({
      archived: 0,
      alreadyReset: true,
    });
    await store.setLevel("guild-a", "user-2", 1, 120);
    expect(await store.resetLevels("guild-a", "winter")).toEqual({
      archived: 1,
      alreadyReset: false,
    });
    expect(await store.listRecords("guild-a", "xp_season_archive", 10)).toHaveLength(2);
  });
});
