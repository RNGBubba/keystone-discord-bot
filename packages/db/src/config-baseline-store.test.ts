import { afterEach, describe, expect, it } from "vitest";
import { createMigratedPglite, type PgliteHarness } from "./testing";
import { DrizzleConfigBaselineStore } from "./config-baseline-store";

let harness: PgliteHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("config baseline store", () => {
  it("stores one baseline per guild and keeps the first creation time", async () => {
    harness = await createMigratedPglite();
    const store = new DrizzleConfigBaselineStore(harness.db);
    const guildId = "111111111111111111";

    expect(await store.get(guildId)).toBeUndefined();

    const first = await store.save({
      guildId,
      source: "import",
      bundle: { schemaVersion: 1, modules: [{ id: "ai", settings: { enabled: true } }] },
      checksum: "a".repeat(64),
      at: 1_700_000_000_000,
    });
    expect(first.guildId).toBe(guildId);
    expect(first.createdAt).toBe(1_700_000_000_000);
    expect(first.updatedAt).toBe(1_700_000_000_000);
    expect(first.bundle).toEqual({
      schemaVersion: 1,
      modules: [{ id: "ai", settings: { enabled: true } }],
    });

    const second = await store.save({
      guildId,
      source: "import",
      bundle: { schemaVersion: 1, modules: [], nested: { list: [1, 2, 3] } },
      checksum: "b".repeat(64),
      at: 1_700_000_100_000,
    });
    expect(second.createdAt).toBe(1_700_000_000_000);
    expect(second.updatedAt).toBe(1_700_000_100_000);
    expect(second.checksum).toBe("b".repeat(64));
    expect(second.bundle).toEqual({
      schemaVersion: 1,
      modules: [],
      nested: { list: [1, 2, 3] },
    });

    expect(await store.get(guildId)).toEqual(second);
    expect(await store.get("222222222222222222")).toBeUndefined();
  });
});
