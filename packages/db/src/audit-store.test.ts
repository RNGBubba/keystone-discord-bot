import { describe, expect, it } from "vitest";
import { DrizzleAuditStore } from "./audit-store";
import { createMigratedPglite } from "./testing";

const GUILD = "111111111111111111";
const OTHER = "222222222222222222";

describe("DrizzleAuditStore", () => {
  it("appends and reads newest-first, scoped to one guild, with JSON data intact", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleAuditStore(harness.db);
      await store.append({
        guildId: GUILD,
        actorId: "444444444444444444",
        action: "settings.update",
        targetId: "ai",
        data: { moduleId: "ai", source: "dashboard", changes: { chat: { from: false, to: true } } },
        at: Date.parse("2026-11-02T10:00:00.000Z"),
      });
      await store.append({
        guildId: GUILD,
        action: "settings.reset",
        targetId: "logging",
        at: Date.parse("2026-11-02T10:01:00.000Z"),
      });
      await store.append({
        guildId: OTHER,
        action: "settings.update",
        targetId: "ai",
        at: Date.parse("2026-11-02T10:02:00.000Z"),
      });

      const rows = await store.list(GUILD, 10);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.action)).toEqual(["settings.reset", "settings.update"]);
      expect(rows[1]).toMatchObject({
        actorId: "444444444444444444",
        targetId: "ai",
        data: {
          moduleId: "ai",
          source: "dashboard",
          changes: { chat: { from: false, to: true } },
        },
      });
      expect(rows[1]?.createdAt).toBe("2026-11-02T10:00:00.000Z");
      expect(await store.list(OTHER, 10)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("caps a read at the requested limit without changing the order", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleAuditStore(harness.db);
      for (let index = 0; index < 4; index += 1) {
        await store.append({
          guildId: GUILD,
          action: "settings.update",
          targetId: `module-${index}`,
          at: Date.parse(`2026-11-02T10:0${index}:00.000Z`),
        });
      }
      expect((await store.list(GUILD, 2)).map((row) => row.targetId)).toEqual([
        "module-3",
        "module-2",
      ]);
      expect(await store.list(GUILD, 0)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});
