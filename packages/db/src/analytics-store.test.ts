import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMigratedPglite, type PgliteHarness } from "./testing";
import { DrizzleAnalyticsStore } from "./analytics-store";
import { DrizzleLoggingStore } from "./logging-store";
import { DrizzleCaseStore } from "./case-store";
import { DrizzleInviteStore } from "./invite-store";
import { DrizzleCommunityStore } from "./community-store";
import { DrizzleCommandUsageStore } from "./command-usage-store";

const dirs: string[] = [];
const WINDOW = {
  days: 3650,
  since: "2020-01-01T00:00:00.000Z",
  until: "2030-01-01T00:00:00.000Z",
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "keystone-analytics-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("DrizzleAnalyticsStore", () => {
  it("reports only stored rows and agrees with a raw count", async () => {
    const harness: PgliteHarness = await createMigratedPglite(await tempDir());
    const guild = "guild-a";
    const other = "guild-b";

    const logging = new DrizzleLoggingStore(harness.db);
    await logging.append({ guildId: guild, kind: "member_join", targetId: "u1", summary: "join", at: Date.parse("2026-10-29T10:00:00Z") });
    await logging.append({ guildId: guild, kind: "member_join", targetId: "u2", summary: "join", at: Date.parse("2026-10-30T10:00:00Z") });
    await logging.append({ guildId: guild, kind: "message_delete", targetId: "u3", summary: "delete", at: Date.parse("2026-10-31T10:00:00Z") });
    await logging.append({ guildId: other, kind: "message_delete", summary: "other guild", at: Date.parse("2026-10-31T11:00:00Z") });

    const cases = new DrizzleCaseStore(harness.db as never);
    await cases.create({
      guildId: guild,
      caseNumber: await cases.nextCaseNumber(guild),
      actorId: "mod",
      targetId: "u1",
      action: "alert",
      reason: "filter hit",
      rule: "automod.profanity",
      state: "open",
    });
    await cases.create({
      guildId: guild,
      caseNumber: await cases.nextCaseNumber(guild),
      actorId: "mod",
      targetId: "u2",
      action: "warn",
      reason: "old warning",
      state: "closed",
    });

    const invites = new DrizzleInviteStore(harness.db as never);
    await invites.recordJoin({
      guildId: guild,
      userId: "u1",
      inviterId: "inviter",
      code: "abc",
      joinedAt: "2026-10-29T10:00:00.000Z",
    });
    await invites.recordJoin({
      guildId: guild,
      userId: "u2",
      inviterId: "inviter",
      code: "abc",
      joinedAt: "2026-10-30T10:00:00.000Z",
      fakeReasons: ["account_age"],
    });
    await invites.recordLeave(guild, "u2", "2026-10-31T10:00:00.000Z");

    const community = new DrizzleCommunityStore(harness.db as never);
    await community.createTicket({
      guildId: guild,
      channelId: "c1",
      openerId: "u1",
      subject: "open ticket",
    });
    const closed = await community.createTicket({
      guildId: guild,
      channelId: "c2",
      openerId: "u2",
      subject: "done",
    });
    await community.updateTicket(guild, closed.id, {
      state: "closed",
      closedAt: new Date(Date.parse(closed.createdAt) + 10 * 60_000).toISOString(),
    });

    const usage = new DrizzleCommandUsageStore(harness.db as never);
    await usage.record({ guildId: guild, command: "ping", path: "", status: "ok", durationMs: 10, at: "2026-10-30T10:00:00.000Z" });
    await usage.record({ guildId: guild, command: "ping", path: "", status: "blocked", durationMs: 30, at: "2026-10-30T10:01:00.000Z" });
    await usage.record({ guildId: guild, command: "analytics", path: "overview", status: "ok", durationMs: 50, at: "2026-10-30T10:02:00.000Z" });

    const snapshot = await new DrizzleAnalyticsStore(harness.db).snapshot(guild, WINDOW);

    const logs = await harness.runner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM logging_events WHERE guild_id = '${guild}'`,
    );
    const runs = await harness.runner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM command_usage WHERE guild_id = '${guild}'`,
    );

    expect(snapshot.overview.loggedEvents).toBe(Number(logs[0]?.count));
    expect(snapshot.overview.commandsRun).toBe(Number(runs[0]?.count));
    expect(snapshot.overview).toMatchObject({
      loggedEvents: 3,
      activeCases: 1,
      casesOpened: 2,
      inviteJoins: 2,
      retainedInvites: 1,
      commandsRun: 3,
      openTickets: 1,
    });
    expect(snapshot.members).toMatchObject({
      loggedJoins: 2,
      loggedLeaves: 0,
      inviteJoins: 2,
      leftSince: 1,
      retained: 1,
      flagged: 1,
      uniqueInviters: 1,
    });
    expect(snapshot.messages).toEqual({ deleted: 1, edited: 0, contentFilterCases: 1 });
    expect(snapshot.commands).toMatchObject({ total: 3, ok: 2, blocked: 1, averageLatencyMs: 30 });
    expect(snapshot.commands.top.find((row) => row.command === "ping")).toMatchObject({
      total: 2,
      averageLatencyMs: 20,
    });
    expect(snapshot.tickets).toMatchObject({
      open: 1,
      claimed: 0,
      closed: 1,
      opened: 2,
      closedInWindow: 1,
      averageCloseMinutes: 10,
      slaBreached: 0,
    });
    expect(snapshot.sources).toEqual([
      { id: "logging_events", label: "Audit events", rows: 3 },
      { id: "cases", label: "Moderation cases", rows: 2 },
      { id: "invite_joins", label: "Invite joins", rows: 2 },
      { id: "tickets", label: "Tickets", rows: 2 },
      { id: "command_usage", label: "Command runs", rows: 3 },
    ]);

    const indexes = await harness.runner.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const names = new Set(indexes.map((row) => row.indexname));
    for (const name of [
      "cases_guild_created_idx",
      "invite_joins_guild_joined_idx",
      "tickets_guild_created_idx",
      "tickets_guild_closed_idx",
    ]) {
      expect(names.has(name)).toBe(true);
    }

    await harness.close();
  });
});
