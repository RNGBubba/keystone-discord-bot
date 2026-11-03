import { describe, expect, it } from "vitest";
import {
  InMemoryDashboardStore,
  InMemorySettingsRepository,
  ModuleRegistry,
  SettingsService,
  type AnalyticsSnapshot,
  type AnalyticsStore,
  type AnalyticsWindow,
} from "@keystone/kernel";
import { modules } from "@keystone/module-catalog";
import { DashboardService } from "./overview";
import type { DiscordGuild } from "./oauth";
import { renderAnalytics } from "./render";

const GUILD: DiscordGuild = {
  id: "111111111111111111",
  name: "Alpha",
  icon: null,
  owner: true,
  permissions: "0",
};

function populated(window: AnalyticsWindow): AnalyticsSnapshot {
  return {
    version: 1,
    guildId: GUILD.id,
    generatedAt: window.until,
    window,
    sources: [
      { id: "logging_events", label: "Audit events", rows: 7 },
      { id: "cases", label: "Moderation cases", rows: 2 },
      { id: "invite_joins", label: "Invite joins", rows: 2 },
      { id: "tickets", label: "Tickets", rows: 3 },
      { id: "command_usage", label: "Command runs", rows: 5 },
    ],
    overview: {
      loggedEvents: 7,
      activeCases: 1,
      casesOpened: 2,
      inviteJoins: 2,
      retainedInvites: 1,
      commandsRun: 5,
      openTickets: 2,
    },
    members: {
      loggedJoins: 3,
      loggedLeaves: 1,
      inviteJoins: 2,
      leftSince: 1,
      retained: 1,
      flagged: 1,
      uniqueInviters: 1,
    },
    messages: { deleted: 4, edited: 2, contentFilterCases: 2 },
    commands: {
      total: 5,
      ok: 4,
      blocked: 1,
      error: 0,
      averageLatencyMs: 120,
      top: [
        {
          command: "ping",
          path: "",
          total: 3,
          ok: 3,
          blocked: 0,
          error: 0,
          averageLatencyMs: 90,
        },
      ],
    },
    tickets: {
      open: 2,
      claimed: 0,
      closed: 1,
      opened: 3,
      closedInWindow: 1,
      averageCloseMinutes: 30,
      slaBreached: 0,
    },
  };
}

function empty(window: AnalyticsWindow): AnalyticsSnapshot {
  return {
    version: 1,
    guildId: GUILD.id,
    generatedAt: window.until,
    window,
    sources: [
      { id: "logging_events", label: "Audit events", rows: 0 },
      { id: "cases", label: "Moderation cases", rows: 0 },
      { id: "invite_joins", label: "Invite joins", rows: 0 },
      { id: "tickets", label: "Tickets", rows: 0 },
      { id: "command_usage", label: "Command runs", rows: 0 },
    ],
    overview: {
      loggedEvents: 0,
      activeCases: 0,
      casesOpened: 0,
      inviteJoins: 0,
      retainedInvites: 0,
      commandsRun: 0,
      openTickets: 0,
    },
    members: {
      loggedJoins: 0,
      loggedLeaves: 0,
      inviteJoins: 0,
      leftSince: 0,
      retained: 0,
      flagged: 0,
      uniqueInviters: 0,
    },
    messages: { deleted: 0, edited: 0, contentFilterCases: 0 },
    commands: { total: 0, ok: 0, blocked: 0, error: 0, averageLatencyMs: null, top: [] },
    tickets: {
      open: 0,
      claimed: 0,
      closed: 0,
      opened: 0,
      closedInWindow: 0,
      averageCloseMinutes: null,
      slaBreached: 0,
    },
  };
}

class FixedAnalyticsStore implements AnalyticsStore {
  calls = 0;
  lastWindow: AnalyticsWindow | undefined;
  constructor(private readonly populatedData: boolean) {}

  async snapshot(guildId: string, window: AnalyticsWindow): Promise<AnalyticsSnapshot> {
    this.calls += 1;
    this.lastWindow = window;
    const snapshot = this.populatedData ? populated(window) : empty(window);
    return { ...snapshot, guildId };
  }
}

function build(analyticsStore?: AnalyticsStore) {
  const registry = new ModuleRegistry().registerAll(modules);
  const settings = new SettingsService(new InMemorySettingsRepository(), registry);
  return new DashboardService(
    registry,
    settings,
    new InMemoryDashboardStore(),
    undefined,
    undefined,
    undefined,
    analyticsStore,
  );
}

describe("dashboard analytics aggregates", () => {
  it("reads the existing AnalyticsStore with a bounded window", async () => {
    const store = new FixedAnalyticsStore(true);
    const snapshot = await build(store).analytics(GUILD, 30);
    expect(store.calls).toBe(1);
    expect(store.lastWindow?.days).toBe(30);
    const span = Date.parse(store.lastWindow!.until) - Date.parse(store.lastWindow!.since);
    expect(span).toBe(30 * 86_400_000);
    expect(snapshot).toMatchObject({
      guildId: GUILD.id,
      window: { days: 30 },
      overview: { loggedEvents: 7, commandsRun: 5 },
    });
  });

  it("refuses an out-of-range window before calling the store", async () => {
    const store = new FixedAnalyticsStore(true);
    const dashboard = build(store);
    await expect(dashboard.analytics(GUILD, 0)).rejects.toThrow(/between 1 and 90/);
    await expect(dashboard.analytics(GUILD, 91)).rejects.toThrow(/between 1 and 90/);
    await expect(dashboard.analytics(GUILD, 7.5)).rejects.toThrow(/between 1 and 90/);
    expect(store.calls).toBe(0);
  });

  it("returns null in memory mode instead of pretending zeroes are measurements", async () => {
    await expect(build().analytics(GUILD, 7)).resolves.toBeNull();
  });

  it("renders the numbers, source rows and the coverage caveat", () => {
    const window: AnalyticsWindow = {
      days: 30,
      since: "2026-10-04T00:00:00.000Z",
      until: "2026-11-03T00:00:00.000Z",
    };
    const html = renderAnalytics("Admin", GUILD, populated(window), 30, "csrf");
    expect(html).toContain("Analytics");
    expect(html).toContain("Logged events");
    expect(html).toContain("<b>7</b>");
    expect(html).toContain("logging_events");
    expect(html).toContain("Source rows");
    expect(html).toContain("not estimates");
    expect(html).toContain("/dashboard/guilds/111111111111111111/analytics?days=90");
    expect(html).not.toContain("No rows in this window");
  });

  it("says plainly when a window has no retained rows", () => {
    const window: AnalyticsWindow = {
      days: 7,
      since: "2026-10-27T00:00:00.000Z",
      until: "2026-11-03T00:00:00.000Z",
    };
    const html = renderAnalytics("Admin", GUILD, empty(window), 7, "csrf");
    expect(html).toContain("No rows in this window");
    expect(html).toContain("not an estimate of all Discord activity");
    expect(html).toContain("Open tickets (current)");
    expect(html).toContain("No command runs recorded in this window.");
  });

  it("names memory mode instead of rendering a zero dashboard", () => {
    const html = renderAnalytics("Admin", GUILD, null, 7, "csrf");
    expect(html).toContain("Not available in this process");
    expect(html).toContain("DATABASE_URL");
    expect(html).not.toContain("Logged events");
  });
});
