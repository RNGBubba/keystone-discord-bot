import { describe, expect, it } from "vitest";
import {
  InMemorySavedTemplateStore,
  SavedTemplateNameTakenError,
  type SavedTemplateModule,
} from "./saved-templates";

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

describe("in-memory saved templates", () => {
  it("scopes a template to the guild it was saved from", async () => {
    const store = new InMemorySavedTemplateStore();
    const created = await store.create({
      guildId: GUILD_A,
      name: "Baseline",
      description: "Alpha's settings",
      modules: modules(),
      createdBy: "admin-1",
      at: 1_000,
    });

    expect(await store.list(GUILD_A)).toHaveLength(1);
    expect(await store.list(GUILD_B)).toEqual([]);
    expect(await store.get(GUILD_A, created.id)).toMatchObject({
      name: "Baseline",
      createdBy: "admin-1",
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(await store.get(GUILD_B, created.id)).toBeUndefined();
    expect(await store.delete(GUILD_B, created.id)).toBe(false);
  });

  it("refuses a duplicate name case-insensitively and keeps the id on rename", async () => {
    const store = new InMemorySavedTemplateStore();
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

    const renamed = await store.update(GUILD_A, first.id, { name: "AI relaxed", at: 2_000 });
    expect(renamed).toMatchObject({ id: first.id, name: "AI relaxed", updatedAt: 2_000 });

    await expect(
      store.update(GUILD_A, first.id, { name: "AI relaxed" }),
    ).resolves.toBeDefined();

    const second = await store.create({
      guildId: GUILD_A,
      name: "Second",
      description: "",
      modules: modules(),
    });
    await expect(
      store.update(GUILD_A, second.id, { name: "AI relaxed" }),
    ).rejects.toBeInstanceOf(SavedTemplateNameTakenError);

    expect(await store.list(GUILD_A)).toHaveLength(2);
  });

  it("reflects a refreshed snapshot and deletes only owned rows", async () => {
    const store = new InMemorySavedTemplateStore();
    const created = await store.create({
      guildId: GUILD_A,
      name: "Snapshot",
      description: "",
      modules: modules(3),
    });

    const refreshed = await store.update(GUILD_A, created.id, {
      modules: modules(7),
      at: 3_000,
    });
    expect(refreshed?.modules[0]?.settings).toMatchObject({ monthlyBudgetUsd: 7 });

    expect(await store.delete(GUILD_A, created.id)).toBe(true);
    expect(await store.get(GUILD_A, created.id)).toBeUndefined();
    expect(await store.delete(GUILD_A, created.id)).toBe(false);
  });
});
