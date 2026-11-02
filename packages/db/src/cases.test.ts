import { afterEach, describe, expect, it } from "vitest";
import { createMigratedPglite, type PgliteHarness } from "./testing";
import { DrizzleCaseStore } from "./case-store";

let harness: PgliteHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("DrizzleCaseStore", () => {
  it("allocates per-guild numbers, stores cases and appends events", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleCaseStore(harness.db as never);

    expect(await store.nextCaseNumber("guild-a")).toBe(1);
    expect(await store.nextCaseNumber("guild-a")).toBe(2);
    expect(await store.nextCaseNumber("guild-b")).toBe(1);

    const record = await store.create({
      guildId: "guild-a",
      caseNumber: 1,
      actorId: "mod-1",
      targetId: "user-1",
      action: "ban",
      reason: "raid invite",
      rule: "manual",
      evidence: { messageId: "m-1" },
    });
    expect(record.caseNumber).toBe(1);
    expect(record.state).toBe("open");
    expect(await store.get("guild-a", 1)).toMatchObject({ targetId: "user-1" });
    expect(await store.get("guild-b", 1)).toBeUndefined();

    const event = await store.appendEvent(record.id, "appealed", "user-1", { message: "review" });
    expect(event.type).toBe("appealed");
    expect(event.data).toEqual({ message: "review" });
    expect((await store.listEvents(record.id)).map((entry) => entry.type)).toEqual([
      "appealed",
    ]);

    await store.updateState(record.id, "appealed");
    expect((await store.getById(record.id))?.state).toBe("appealed");
    expect(await store.list("guild-a", { state: "appealed" })).toHaveLength(1);
  });

  it("stores a release time and reads due and pending temporary cases separately", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleCaseStore(harness.db as never);
    const record = await store.create({
      guildId: "guild-expiry",
      caseNumber: 1,
      actorId: "mod-1",
      targetId: "user-1",
      action: "ban",
      reason: "temporary",
      expiresAt: "2026-11-02T12:00:00.000Z",
    });
    expect(record.expiresAt).toBe("2026-11-02T12:00:00.000Z");

    const future = await store.create({
      guildId: "guild-expiry",
      caseNumber: 2,
      actorId: "mod-1",
      targetId: "user-2",
      action: "temp-role",
      reason: "temporary role",
      evidence: { roleId: "role-vip" },
      expiresAt: "2026-11-02T13:00:00.000Z",
    });

    expect(await store.listDueExpiries("guild-expiry", "2026-11-02T12:30:00.000Z")).toHaveLength(1);
    expect((await store.listPendingExpiries("guild-expiry", "2026-11-02T12:30:00.000Z"))[0]?.id).toBe(
      future.id,
    );

    const cleared = await store.updateExpiry(record.id, null);
    expect(cleared?.expiresAt).toBeUndefined();
    expect((await store.listDueExpiries("guild-expiry", "2026-11-02T14:00:00.000Z"))[0]?.id).toBe(
      future.id,
    );

    await store.updateState(future.id, "closed");
    expect(await store.listDueExpiries("guild-expiry", "2026-11-02T14:00:00.000Z")).toHaveLength(0);
    expect(await store.listPendingExpiries("guild-expiry", "2026-11-02T12:30:00.000Z")).toHaveLength(
      0,
    );
  });

  it("claims one release atomically and refuses the second claim", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleCaseStore(harness.db as never);
    const record = await store.create({
      guildId: "guild-claim",
      caseNumber: 1,
      actorId: "mod-1",
      targetId: "user-1",
      action: "ban",
      reason: "temporary",
      expiresAt: "2026-11-02T12:00:00.000Z",
    });

    const [first, second] = await Promise.all([
      store.claimExpiry(record.id),
      store.claimExpiry(record.id),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(first?.expiresAt ?? second?.expiresAt).toBeUndefined();
    expect(await store.claimExpiry(record.id)).toBeUndefined();
  });

  it("does not reuse a case number under concurrent allocation", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleCaseStore(harness.db as never);

    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => store.nextCaseNumber("guild-race")),
    );
    expect(new Set(numbers).size).toBe(8);
    expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
