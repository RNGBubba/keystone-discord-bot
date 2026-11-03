import { describe, expect, it } from "vitest";
import { SavedTemplateNameTakenError, type SavedTemplateModule } from "@keystone/kernel";
import { DrizzleSavedTemplateStore } from "./config-template-store";
import { createMigratedPglite } from "./testing";

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";

function modules(budget = 9): SavedTemplateModule[] {
  return [
    {
      id: "ai",
      version: "1.0.0",
      settings: { enabled: true, monthlyBudgetUsd: budget },
    },
  ];
}

describe("Drizzle saved-template store", () => {
  it("round-trips a snapshot and scopes it to its guild", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleSavedTemplateStore(harness.db);
      const created = await store.create({
        guildId: GUILD_A,
        name: "Baseline",
        description: "Alpha's settings",
        modules: modules(),
        createdBy: "admin-1",
        at: 1_000,
      });

      const loaded = await store.get(GUILD_A, created.id);
      expect(loaded).toMatchObject({
        guildId: GUILD_A,
        name: "Baseline",
        description: "Alpha's settings",
        createdBy: "admin-1",
        createdAt: 1_000,
      });
      expect(loaded?.modules).toEqual(modules());
      expect(await store.get(GUILD_B, created.id)).toBeUndefined();
      expect(await store.list(GUILD_B)).toEqual([]);
      expect(await store.list(GUILD_A)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("enforces a case-insensitive unique name and keeps the id on rename", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleSavedTemplateStore(harness.db);
      const first = await store.create({
        guildId: GUILD_A,
        name: "AI strict",
        description: "",
        modules: modules(),
      });

      await expect(
        store.create({
          guildId: GUILD_A,
          name: "ai STRICT",
          description: "",
          modules: modules(),
        }),
      ).rejects.toBeInstanceOf(SavedTemplateNameTakenError);

      const renamed = await store.update(GUILD_A, first.id, {
        name: "AI relaxed",
        modules: modules(7),
        at: 2_000,
      });
      expect(renamed).toMatchObject({ id: first.id, name: "AI relaxed", updatedAt: 2_000 });
      expect(renamed?.modules).toEqual(modules(7));

      expect(await store.delete(GUILD_B, first.id)).toBe(false);
      expect(await store.delete(GUILD_A, first.id)).toBe(true);
      expect(await store.get(GUILD_A, first.id)).toBeUndefined();
    } finally {
      await harness.close();
    }
  });
});
