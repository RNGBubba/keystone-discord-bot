import { describe, expect, it } from "vitest";
import type { WebSession } from "@keystone/kernel";
import { DrizzleDashboardStore } from "./web-dashboard-store";
import { DrizzleSessionStore } from "./web-session-store";
import { createMigratedPglite } from "./testing";
import { backups, cases, guilds, imports, levels, tickets } from "./schema";

const GUILD = "111111111111111111";

function session(): WebSession {
  const now = new Date();
  return {
    id: "hashed-session-id",
    userId: "444444444444444444",
    username: "Admin",
    accessToken: "sealed-access-token",
    csrfHash: "hashed-csrf-token",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
  };
}

describe("Drizzle web stores", () => {
  it("round-trips an opaque session without refresh credentials", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleSessionStore(harness.db);
      const original = session();
      await store.create(original);
      const loaded = await store.get("hashed-session-id");
      expect(loaded).toMatchObject({
        userId: "444444444444444444",
        accessToken: "sealed-access-token",
        csrfHash: "hashed-csrf-token",
      });
      expect(loaded?.expiresAt).toBe(original.expiresAt);
      expect(loaded).not.toHaveProperty("refreshToken");
      expect(loaded).not.toHaveProperty("rotatedAt");

      await store.delete("hashed-session-id");
      expect(await store.get("hashed-session-id")).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it("re-keys a session atomically and deletes every session for one user", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleSessionStore(harness.db);
      const original = session();
      await store.create(original);

      const next: WebSession = {
        ...original,
        id: "next-hashed-id",
        csrfHash: "next-hashed-csrf",
        createdAt: new Date().toISOString(),
      };
      expect(await store.rotate(original.id, next)).toBe(true);
      expect(await store.get(original.id)).toBeUndefined();
      expect(await store.get(next.id)).toMatchObject({
        userId: original.userId,
        accessToken: "sealed-access-token",
        csrfHash: "next-hashed-csrf",
      });
      expect(await store.rotate("already-gone", next)).toBe(false);

      await store.create({
        ...original,
        id: "another-row",
        userId: "999999999999999999",
      });
      expect(await store.deleteForUser(original.userId)).toBe(1);
      expect(await store.get(next.id)).toBeUndefined();
      expect(await store.get("another-row")).toBeDefined();
    } finally {
      await harness.close();
    }
  });

  it("counts only the requested guild in the overview read model", async () => {
    const harness = await createMigratedPglite();
    try {
      await harness.db.insert(guilds).values([
        { id: GUILD, name: "Alpha" },
        { id: "222222222222222222", name: "Beta" },
      ]);
      await harness.db.insert(cases).values([
        {
          guildId: GUILD,
          caseNumber: 1,
          actorId: "1",
          targetId: "2",
          action: "warn",
        },
        {
          guildId: GUILD,
          caseNumber: 2,
          actorId: "1",
          targetId: "3",
          action: "ban",
        },
        {
          guildId: "222222222222222222",
          caseNumber: 1,
          actorId: "1",
          targetId: "2",
          action: "warn",
        },
      ]);
      await harness.db.insert(tickets).values([
        { guildId: GUILD, channelId: "10", openerId: "2", state: "open" },
        { guildId: GUILD, channelId: "11", openerId: "3", state: "closed" },
      ]);
      await harness.db.insert(levels).values([{ guildId: GUILD, userId: "2", xp: 10, level: 1 }]);
      await harness.db.insert(imports).values([
        { guildId: GUILD, source: "bundle", state: "applied" },
        { guildId: "222222222222222222", source: "bundle", state: "applied" },
      ]);
      await harness.db.insert(backups).values({ guildId: GUILD, kind: "manual", state: "complete" });

      const overview = await new DrizzleDashboardStore(harness.db).overview(GUILD);
      expect(overview).toMatchObject({
        guildId: GUILD,
        name: "Alpha",
        counts: { cases: 2, openTickets: 1, levels: 1, imports: 1, backups: 1 },
      });
      expect(overview.latestImport?.source).toBe("bundle");
      expect(overview.joinedAt).not.toBeNull();

      const unknown = await new DrizzleDashboardStore(harness.db).overview("999999999999999999");
      expect(unknown).toMatchObject({
        name: null,
        joinedAt: null,
        counts: { cases: 0, openTickets: 0, levels: 0, imports: 0, backups: 0 },
        latestImport: null,
      });
    } finally {
      await harness.close();
    }
  });
});
