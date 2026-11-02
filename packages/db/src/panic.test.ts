import { afterEach, describe, expect, it } from "vitest";
import { createMigratedPglite, type PgliteHarness } from "./testing";
import { DrizzlePanicStore } from "./panic-store";

let harness: PgliteHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("DrizzlePanicStore", () => {
  it("keeps one snapshot per guild and clears only the requested guild", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzlePanicStore(harness.db as never);
    const state = {
      active: true as const,
      startedAt: "2026-11-02T12:00:00.000Z",
      startedBy: "mod-1",
      reason: "raid in progress",
      channels: [
        { channelId: "channel-1", existed: true, previous: "neutral" as const },
        { channelId: "channel-2", existed: false, previous: "allow" as const },
      ],
    };

    expect(await store.get("guild-a")).toBeUndefined();

    await store.save("guild-a", state);
    await store.save("guild-b", { ...state, reason: "other guild" });

    expect(await store.get("guild-a")).toEqual(state);
    expect((await store.get("guild-b"))?.reason).toBe("other guild");

    await store.clear("guild-a");

    expect(await store.get("guild-a")).toBeUndefined();
    expect(await store.get("guild-b")).toEqual({ ...state, reason: "other guild" });
  });
});
