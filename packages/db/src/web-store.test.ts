import { describe, expect, it } from "vitest";
import type { WebSession } from "@keystone/kernel";
import { DrizzleApiTokenStore } from "./api-token-store";
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

  it("stores a token hash and scopes, scopes reads to one guild and revokes once", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleApiTokenStore(harness.db);
      const created = await store.create({
        id: "0f7dbc9c-0000-4000-8000-000000000001",
        guildId: GUILD,
        guildName: "Alpha",
        name: "deploy",
        tokenHash: "a".repeat(64),
        scopes: ["guild:read", "analytics:read"],
        createdBy: "444444444444444444",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(created.scopes).toEqual(["guild:read", "analytics:read"]);
      expect(created.tokenHash).toBe("a".repeat(64));

      await store.create({
        id: "0f7dbc9c-0000-4000-8000-000000000002",
        guildId: "222222222222222222",
        guildName: "Beta",
        name: "other",
        tokenHash: "b".repeat(64),
        scopes: ["guild:read"],
      });

      expect(await store.findByHash("a".repeat(64))).toMatchObject({ name: "deploy", guildId: GUILD });
      expect(await store.findByHash("c".repeat(64))).toBeUndefined();
      expect((await store.list(GUILD)).map((token) => token.name)).toEqual(["deploy"]);
      expect(await store.get("222222222222222222", created.id)).toBeUndefined();

      const revokedAt = new Date().toISOString();
      expect(await store.revoke(GUILD, created.id, revokedAt)).toMatchObject({ revokedAt });
      expect(await store.revoke(GUILD, created.id, revokedAt)).toBeUndefined();
      // The row is retained so the audit trail can still name the token.
      const [retained] = await store.list(GUILD);
      expect(retained).toMatchObject({ id: created.id, revokedAt });

      await store.touch(created.id, revokedAt);
      expect((await store.get(GUILD, created.id))?.lastUsedAt).toBe(revokedAt);
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
