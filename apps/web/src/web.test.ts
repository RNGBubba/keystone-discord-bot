import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemoryApiTokenStore,
  InMemoryAuditStore,
  InMemoryConfigBaselineStore,
  InMemoryDashboardStore,
  InMemoryIdempotencyStore,
  InMemorySavedTemplateStore,
  InMemorySessionStore,
  InMemoryWebhookStore,
  type AnalyticsSnapshot,
  type AnalyticsStore,
  type AnalyticsWindow,
  InMemorySettingsRepository,
  ModuleRegistry,
  SettingsService,
  createSilentLogger,
  emptyOverview,
  type SessionStore,
} from "@keystone/kernel";
import { modules } from "@keystone/module-catalog";
import { GuildAccessService, canManageGuild } from "./access";
import { ApiTokenService } from "./api-tokens";
import { AuthService } from "./auth";
import { verifyWebhookSignature, WebhookService } from "./webhooks";
import { SecretBox, sha256 } from "./crypto";
import { createWebHandler } from "./server";
import { DashboardService } from "./overview";
import { DEFAULT_RATE_LIMITS, RateLimiter, type RateLimitPolicies } from "./rate-limit";
import type { ConfigBundle } from "./config-bundle";
import type { DiscordGuild, DiscordOAuth } from "./oauth";

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";
const GUILD_C = "333333333333333333";
const GUILD_D = "555555555555555555";
const GUILD_Z = "999999999999999999";
const USER = "444444444444444444";
const ACCESS_TOKEN = "discord-access-token-should-never-reach-browser";

function analyticsSnapshot(
  guildId: string,
  window: AnalyticsWindow,
  populated: boolean,
): AnalyticsSnapshot {
  const n = populated ? 1 : 0;
  return {
    version: 1,
    guildId,
    generatedAt: window.until,
    window,
    sources: [
      { id: "logging_events", label: "Audit events", rows: 12 * n },
      { id: "cases", label: "Moderation cases", rows: 4 * n },
      { id: "invite_joins", label: "Invite joins", rows: 2 * n },
      { id: "tickets", label: "Tickets", rows: 3 * n },
      { id: "command_usage", label: "Command runs", rows: 6 * n },
    ],
    overview: {
      loggedEvents: 12 * n,
      activeCases: 3 * n,
      casesOpened: 4 * n,
      inviteJoins: 2 * n,
      retainedInvites: n,
      commandsRun: 6 * n,
      openTickets: 2 * n,
    },
    members: {
      loggedJoins: 3 * n,
      loggedLeaves: n,
      inviteJoins: 2 * n,
      leftSince: n,
      retained: n,
      flagged: n,
      uniqueInviters: n,
    },
    messages: { deleted: 5 * n, edited: 2 * n, contentFilterCases: 4 * n },
    commands: {
      total: 6 * n,
      ok: 5 * n,
      blocked: n,
      error: 0,
      averageLatencyMs: populated ? 140 : null,
      top: populated
        ? [
            {
              command: "ping",
              path: "",
              total: 4,
              ok: 4,
              blocked: 0,
              error: 0,
              averageLatencyMs: 90,
            },
          ]
        : [],
    },
    tickets: {
      open: 2 * n,
      claimed: 0,
      closed: n,
      opened: 3 * n,
      closedInWindow: n,
      averageCloseMinutes: populated ? 30 : null,
      slaBreached: 0,
    },
  };
}

class FixedAnalyticsStore implements AnalyticsStore {
  lastWindow: AnalyticsWindow | undefined;

  async snapshot(guildId: string, window: AnalyticsWindow): Promise<AnalyticsSnapshot> {
    this.lastWindow = window;
    return analyticsSnapshot(guildId, window, guildId === GUILD_A);
  }
}

class FakeOAuth implements DiscordOAuth {
  exchanges = 0;
  readonly revocations: string[] = [];
  revokeFails = false;
  readonly guilds: DiscordGuild[] = [
    { id: GUILD_A, name: "Alpha <script>alert(1)</script>", icon: null, owner: false, permissions: String(1n << 5n) },
    { id: GUILD_B, name: "Beta", icon: null, owner: false, permissions: "0" },
    { id: GUILD_C, name: "Gamma", icon: null, owner: true, permissions: "0" },
    { id: GUILD_D, name: "Delta", icon: null, owner: true, permissions: "0" },
  ];
  readonly botGuilds = new Set([GUILD_A, GUILD_B, GUILD_D]);

  authorizationUrl(input: { state: string }): string {
    return `https://discord.test/oauth?state=${encodeURIComponent(input.state)}`;
  }

  async exchangeCode(): Promise<{ accessToken: string }> {
    this.exchanges += 1;
    return { accessToken: ACCESS_TOKEN };
  }

  async fetchUser(): Promise<{ id: string; username: string }> {
    return { id: USER, username: "Admin <script>alert(1)</script>" };
  }

  async fetchGuilds(): Promise<DiscordGuild[]> {
    return this.guilds;
  }

  async botInGuild(guildId: string): Promise<boolean> {
    return this.botGuilds.has(guildId);
  }

  async revokeToken(accessToken: string): Promise<void> {
    this.revocations.push(accessToken);
    if (this.revokeFails) throw new Error("Discord revocation failed");
  }
}

interface HarnessOptions {
  rotationIntervalMs?: number;
  owners?: readonly string[];
  rateLimiter?: RateLimiter;
  now?: () => number;
}

interface Harness {
  base: string;
  server: Server;
  oauth: FakeOAuth;
  sessions: SessionStore;
  settings: SettingsService;
  audit: InMemoryAuditStore;
  baselines: InMemoryConfigBaselineStore;
  savedTemplates: InMemorySavedTemplateStore;
  analytics: FixedAnalyticsStore;
  apiTokens: ApiTokenService;
  webhooks: WebhookService;
  idempotency: InMemoryIdempotencyStore;
  close(): Promise<void>;
}

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const oauth = new FakeOAuth();
  const sessions = new InMemorySessionStore();
  const dashboardStore = new InMemoryDashboardStore().seed({
    ...emptyOverview(GUILD_A),
    guildId: GUILD_A,
    name: "Alpha",
    joinedAt: "2026-01-01T00:00:00.000Z",
    counts: { cases: 3, openTickets: 2, levels: 10, imports: 1, backups: 1 },
    latestImport: { id: "import-1", source: "bundle", state: "applied", createdAt: "2026-01-02T00:00:00.000Z" },
  });
  const registry = new ModuleRegistry().registerAll(modules);
  const audit = new InMemoryAuditStore();
  const settings = new SettingsService(new InMemorySettingsRepository(), registry, audit);
  const baselines = new InMemoryConfigBaselineStore();
  const savedTemplates = new InMemorySavedTemplateStore();
  const analytics = new FixedAnalyticsStore();
  const apiTokens = new ApiTokenService(new InMemoryApiTokenStore());
  const box = new SecretBox(randomBytes(32));
  const webhooks = new WebhookService(new InMemoryWebhookStore(), box);
  const idempotency = new InMemoryIdempotencyStore();
  const auth = new AuthService({
    oauth,
    sessions,
    box,
    now: options.now,
    config: {
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost/auth/callback",
      issuer: "https://discord.com",
      sessionTtlMs: 7 * 24 * 60 * 60_000,
      rotationIntervalMs: options.rotationIntervalMs,
      owners: options.owners,
    },
  });
  const handler = createWebHandler({
    auth,
    access: new GuildAccessService(oauth),
    dashboard: new DashboardService(
      registry,
      settings,
      dashboardStore,
      audit,
      baselines,
      savedTemplates,
      analytics,
      webhooks,
    ),
    logger: createSilentLogger(),
    secureCookies: false,
    databaseMode: "memory",
    rateLimiter: options.rateLimiter ?? new RateLimiter(DEFAULT_RATE_LIMITS),
    apiTokens,
    audit,
    webhooks,
    idempotency,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return {
    base: `http://127.0.0.1:${address.port}`,
    server,
    oauth,
    sessions,
    settings,
    audit,
    baselines,
    savedTemplates,
    analytics,
    apiTokens,
    webhooks,
    idempotency,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function cookieValue(response: Response, name: string): string | undefined {
  const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return header?.split(";")[0]?.split("=")[1];
}

function patchSettings(
  test: Harness,
  cookie: string,
  csrf: string,
  guildId: string,
  moduleId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${test.base}/api/v1/guilds/${guildId}/settings/${moduleId}`, {
    method: "PATCH",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-keystone-csrf": csrf,
    },
    body: JSON.stringify(body),
  });
}

const AI_FIELDS = [
  "enabled",
  "chat",
  "classification",
  "deflection",
  "explanations",
  "summaries",
  "monthlyBudgetUsd",
  "monthlyRequests",
  "maxOutputTokens",
  "contextChunks",
  "maxDocumentChars",
  "chunkChars",
  "temperature",
  "retention",
] as const;

function aiForm(csrf: string, overrides: Record<string, string> = {}): URLSearchParams {
  const form = new URLSearchParams({
    csrf,
    __rendered: AI_FIELDS.join(","),
    enabled: "on",
    chat: "on",
    monthlyBudgetUsd: "7",
    monthlyRequests: "250",
    maxOutputTokens: "300",
    contextChunks: "3",
    maxDocumentChars: "6000",
    chunkChars: "1200",
    temperature: "0.2",
    retention: "none",
    ...overrides,
  });
  return form;
}

async function postSettingsForm(
  test: Harness,
  cookie: string,
  path: string,
  form: URLSearchParams,
): Promise<Response> {
  return fetch(`${test.base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

async function login(test: Harness): Promise<{ cookie: string; csrf: string }> {
  const begin = await fetch(`${test.base}/login`, { redirect: "manual" });
  expect(begin.status).toBe(302);
  const stateCookie = cookieValue(begin, "keystone_oauth");
  expect(stateCookie).toBeTruthy();
  const location = new URL(begin.headers.get("location") as string);
  const state = location.searchParams.get("state");
  expect(state).toBeTruthy();

  const callback = await fetch(
    `${test.base}/auth/callback?code=good&state=${encodeURIComponent(state as string)}&iss=${encodeURIComponent("https://discord.com")}`,
    { redirect: "manual", headers: { cookie: `keystone_oauth=${stateCookie}` } },
  );
  expect(callback.status).toBe(302);
  const cookie = cookieValue(callback, "keystone_session");
  const csrf = cookieValue(callback, "keystone_csrf");
  expect(cookie).toBeTruthy();
  expect(csrf).toBeTruthy();
  return {
    cookie: `keystone_session=${cookie}; keystone_csrf=${csrf}`,
    csrf: csrf as string,
  };
}

async function downloadConfig(
  test: Harness,
  cookie: string,
  guildId: string,
): Promise<ConfigBundle> {
  const response = await fetch(`${test.base}/dashboard/guilds/${guildId}/config/export`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("content-disposition")).toContain(
    `keystone-config-${guildId}.json`,
  );
  return (await response.json()) as ConfigBundle;
}

function multipartConfig(
  fields: Record<string, string>,
  file: { name: string; content: string },
): { body: string; contentType: string } {
  const boundary = "----keystone-config-test";
  const parts = Object.entries(fields).map(
    ([key, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
  );
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/json\r\n\r\n${file.content}\r\n`,
  );
  parts.push(`--${boundary}--\r\n`);
  return {
    body: parts.join(""),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function postConfigUpload(
  test: Harness,
  cookie: string,
  path: string,
  upload: { body: string; contentType: string },
): Promise<Response> {
  return fetch(`${test.base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": upload.contentType },
    body: upload.body,
  });
}

describe("P6 web auth and authorization", () => {
  it("rejects a missing state cookie, wrong issuer and wrong state before exchange", async () => {
    const test = await harness();
    try {
      const noCookie = await fetch(`${test.base}/auth/callback?code=good&state=abc&iss=https://discord.com`, {
        redirect: "manual",
      });
      expect(noCookie.status).toBe(400);

      const begin = await fetch(`${test.base}/login`, { redirect: "manual" });
      const stateCookie = cookieValue(begin, "keystone_oauth") as string;
      const state = new URL(begin.headers.get("location") as string).searchParams.get("state") as string;

      const wrongIssuer = await fetch(
        `${test.base}/auth/callback?code=good&state=${encodeURIComponent(state)}&iss=https://evil.example`,
        { redirect: "manual", headers: { cookie: `keystone_oauth=${stateCookie}` } },
      );
      expect(wrongIssuer.status).toBe(400);
      expect(test.oauth.exchanges).toBe(0);

      const wrongState = await fetch(
        `${test.base}/auth/callback?code=good&state=not-the-state&iss=https://discord.com`,
        { redirect: "manual", headers: { cookie: `keystone_oauth=${stateCookie}` } },
      );
      expect(wrongState.status).toBe(400);
      expect(test.oauth.exchanges).toBe(0);
    } finally {
      await test.close();
    }
  });

  it("completes login, lists only manageable guilds and reads one real overview", async () => {
    const test = await harness();
    try {
      const { cookie } = await login(test);

      const me = await fetch(`${test.base}/api/v1/me`, { headers: { cookie } });
      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({ user: { id: USER } });

      const guilds = await fetch(`${test.base}/api/v1/guilds`, { headers: { cookie } });
      expect(guilds.status).toBe(200);
      const guildBody = (await guilds.json()) as { guilds: Array<{ id: string; name: string }> };
      expect(guildBody.guilds.map((guild) => guild.id)).toEqual([GUILD_A, GUILD_C, GUILD_D]);
      expect(guildBody.guilds.map((guild) => guild.id)).not.toContain(GUILD_B);

      const dashboard = await fetch(`${test.base}/dashboard`, { headers: { cookie } });
      expect(dashboard.status).toBe(200);
      const list = await dashboard.text();
      expect(list).toContain("Alpha");
      expect(list).not.toContain("Beta");

      const overview = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/overview`, {
        headers: { cookie },
      });
      expect(overview.status).toBe(200);
      const body = (await overview.json()) as {
        guild: { id: string };
        counts: { cases: number; openTickets: number };
        modules: Array<{ id: string }>;
        latestImport: { source: string } | null;
      };
      expect(body.guild.id).toBe(GUILD_A);
      expect(body.counts).toMatchObject({ cases: 3, openTickets: 2 });
      expect(body.modules.map((module) => module.id)).toEqual([
        "diagnostics",
        "setup",
        "moderation",
        "community",
        "ai",
        "invites",
        "logging",
        "analytics",
        "music",
        "forms",
        "events",
        "modmail",
      ]);
      expect(body.latestImport?.source).toBe("bundle");

      const html = await fetch(`${test.base}/dashboard/guilds/${GUILD_A}`, { headers: { cookie } });
      expect(html.status).toBe(200);
      const page = await html.text();
      expect(page).toContain("Alpha");
      expect(page).toContain("Cases");
      expect(page).not.toContain(ACCESS_TOKEN);
      expect(page).toContain("&lt;script&gt;");
      expect(html.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(html.headers.get("cache-control")).toBe("no-store");
    } finally {
      await test.close();
    }
  });

  it("rejects a non-admin, a cross-guild id and a guild without the bot", async () => {
    const test = await harness();
    try {
      const { cookie } = await login(test);
      for (const guildId of [GUILD_B, GUILD_Z, GUILD_C]) {
        const response = await fetch(`${test.base}/api/v1/guilds/${guildId}/overview`, {
          headers: { cookie },
        });
        expect(response.status).toBe(403);
      }
      const unauthenticated = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/overview`);
      expect(unauthenticated.status).toBe(401);
    } finally {
      await test.close();
    }
  });

  it("uses the CSRF token for logout and invalidates the session", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const missing = await fetch(`${test.base}/logout`, { method: "POST", headers: { cookie } });
      expect(missing.status).toBe(403);

      const valid = await fetch(`${test.base}/logout`, {
        method: "POST",
        redirect: "manual",
        headers: {
          cookie: `${cookie}; keystone_csrf=${csrf}`,
          "x-keystone-csrf": csrf,
        },
      });
      expect(valid.status).toBe(302);

      const after = await fetch(`${test.base}/api/v1/me`, { headers: { cookie } });
      expect(after.status).toBe(401);
    } finally {
      await test.close();
    }
  });

  it("keeps the health route public and reports the mode without secrets", async () => {
    const test = await harness();
    try {
      const health = await fetch(`${test.base}/healthz`);
      expect(health.status).toBe(200);
      const body = (await health.json()) as Record<string, unknown>;
      expect(body).toEqual({ ok: true, database: "memory", oauth: true });
      expect(JSON.stringify(body)).not.toContain("client-secret");
    } finally {
      await test.close();
    }
  });

  it("renders schema-driven widgets instead of one JSON textarea", async () => {
    const test = await harness();
    try {
      const { cookie } = await login(test);
      const editor = await fetch(`${test.base}/dashboard/guilds/${GUILD_A}/settings/ai`, {
        headers: { cookie },
      });
      expect(editor.status).toBe(200);
      const page = await editor.text();
      expect(page).toContain('name="monthlyBudgetUsd"');
      expect(page).toContain('min="0" max="1000"');
      expect(page).toContain('step="any"');
      expect(page).toContain('name="chat"');
      expect(page).toContain('type="checkbox"');
      expect(page).toContain('name="enabled"');
      expect(page).toContain('name="__rendered"');
      expect(page).toContain("Audit trail");
      expect(page).not.toContain('name="settings"');
      expect(page).not.toContain("Monthly Budget Usd");
    } finally {
      await test.close();
    }
  });

  it("writes a dashboard widget change through the bot schema and records it in the audit trail", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const before = await test.settings.get(GUILD_A, "ai");
      expect(before).toMatchObject({ chat: false, monthlyBudgetUsd: 1 });

      const saved = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/settings/ai`,
        aiForm(csrf),
      );
      expect(saved.status).toBe(302);
      expect(saved.headers.get("location")).toContain("?saved=1");
      expect(await test.settings.get(GUILD_A, "ai")).toMatchObject({
        enabled: true,
        chat: true,
        classification: false,
        monthlyBudgetUsd: 7,
        monthlyRequests: 250,
        retention: "none",
      });

      expect(test.audit.records(GUILD_A)).toMatchObject([
        {
          actorId: USER,
          action: "settings.update",
          targetId: "ai",
          data: {
            moduleId: "ai",
            source: "dashboard",
            changes: {
              chat: { from: false, to: true },
              monthlyBudgetUsd: { from: 1, to: 7 },
            },
          },
        },
      ]);

      const after = await fetch(
        `${test.base}/dashboard/guilds/${GUILD_A}/settings/ai?saved=1`,
        { headers: { cookie } },
      );
      expect(after.status).toBe(200);
      const page = await after.text();
      expect(page).toContain("Settings saved");
      expect(page).toContain("Audit trail");
      expect(page).toContain("Settings update");
      expect(page).toContain(USER);
      expect(page).toContain("monthlyBudgetUsd");
    } finally {
      await test.close();
    }
  });

  it("rejects a widget value the schema refuses and writes no audit row", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const before = await test.settings.get(GUILD_A, "ai");

      const rejected = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/settings/ai`,
        aiForm(csrf, { monthlyBudgetUsd: "5000" }),
      );
      expect(rejected.status).toBe(400);
      const page = await rejected.text();
      expect(page).toContain("monthlyBudgetUsd");
      expect(page).toContain("1000");
      expect(page).toContain('value="5000"');
      expect(await test.settings.get(GUILD_A, "ai")).toEqual(before);
      expect(test.audit.records(GUILD_A)).toEqual([]);

      const malformed = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/settings/ai`,
        aiForm(csrf, { monthlyBudgetUsd: "not-a-number" }),
      );
      expect(malformed.status).toBe(400);
      expect(await malformed.text()).toContain("Enter a valid number.");
      expect(await test.settings.get(GUILD_A, "ai")).toEqual(before);
      expect(test.audit.records(GUILD_A)).toEqual([]);
    } finally {
      await test.close();
    }
  });

  it("lists manageable guilds and built-in templates on the fleet page", async () => {
    const test = await harness();
    try {
      const { cookie } = await login(test);
      const fleet = await fetch(`${test.base}/dashboard/fleet`, { headers: { cookie } });
      expect(fleet.status).toBe(200);
      const page = await fleet.text();
      expect(page).toContain("Alpha");
      expect(page).toContain("Gamma");
      expect(page).toContain("Delta");
      expect(page).not.toContain("Beta");
      expect(page).toContain("Strict moderation");
      expect(page).toContain('action="/dashboard/fleet/preview"');
      expect(page).toContain('name="guild"');
      expect(page).toContain('name="template"');
    } finally {
      await test.close();
    }
  });

  it("previews a template diff, refuses a stale apply, then writes and audits each guild", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const selection = new URLSearchParams({ csrf, template: "strict-moderation" });
      selection.append("guild", GUILD_A);
      selection.append("guild", GUILD_D);

      const preview = await postSettingsForm(
        test,
        cookie,
        "/dashboard/fleet/preview",
        selection,
      );
      expect(preview.status).toBe(200);
      const previewHtml = await preview.text();
      expect(previewHtml).toContain("Nothing has been written yet");
      expect(previewHtml).toContain("Automod · Links");
      expect(previewHtml).toContain("off");
      expect(previewHtml).toContain("delete");
      const fingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(previewHtml)?.[1];
      expect(fingerprint).toBeTruthy();

      expect(await test.settings.get(GUILD_A, "moderation")).toMatchObject({ dryRun: true });
      expect(test.audit.records(GUILD_A)).toEqual([]);
      expect(test.audit.records(GUILD_D)).toEqual([]);

      const stale = new URLSearchParams(selection);
      stale.set("fingerprint", "0".repeat(64));
      const refused = await postSettingsForm(
        test,
        cookie,
        "/dashboard/fleet/apply",
        stale,
      );
      expect(refused.status).toBe(409);
      expect(await test.settings.get(GUILD_A, "moderation")).toMatchObject({ dryRun: true });
      expect(test.audit.records(GUILD_A)).toEqual([]);

      const apply = new URLSearchParams(selection);
      apply.set("fingerprint", fingerprint as string);
      const applied = await postSettingsForm(
        test,
        cookie,
        "/dashboard/fleet/apply",
        apply,
      );
      expect(applied.status).toBe(302);
      expect(applied.headers.get("location")).toBe("/dashboard/fleet?applied=2&failed=0");

      for (const guildId of [GUILD_A, GUILD_D]) {
        const stored = await test.settings.get(guildId, "moderation");
        expect(stored).toMatchObject({ dryRun: false });
        expect((stored.automod as Record<string, unknown>).links).toBe("delete");
        expect(test.audit.records(guildId)).toMatchObject([
          {
            actorId: USER,
            action: "settings.update",
            targetId: "moderation",
            data: { source: "dashboard" },
          },
        ]);
      }

      const after = await fetch(`${test.base}/dashboard/fleet?applied=2&failed=0`, {
        headers: { cookie },
      });
      expect(after.status).toBe(200);
      expect(await after.text()).toContain("Template applied");
    } finally {
      await test.close();
    }
  });

  it("refuses a fleet preview for a non-admin guild and a guild without the bot", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      for (const guildId of [GUILD_B, GUILD_C]) {
        const form = new URLSearchParams({ csrf, template: "strict-moderation" });
        form.append("guild", guildId);
        const response = await postSettingsForm(
          test,
          cookie,
          "/dashboard/fleet/preview",
          form,
        );
        expect(response.status).toBe(403);
      }
      expect(test.audit.records(GUILD_B)).toEqual([]);
      expect(test.audit.records(GUILD_C)).toEqual([]);
    } finally {
      await test.close();
    }
  });

  it("invalidates a fleet preview when a setting changes before apply", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const selection = new URLSearchParams({ csrf, template: "strict-moderation" });
      selection.append("guild", GUILD_A);
      const preview = await postSettingsForm(
        test,
        cookie,
        "/dashboard/fleet/preview",
        selection,
      );
      const fingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(
        await preview.text(),
      )?.[1];
      expect(fingerprint).toBeTruthy();

      await test.settings.update(GUILD_A, "moderation", {
        automod: { links: "delete" },
      });
      expect(test.audit.records(GUILD_A)).toHaveLength(1);

      const apply = new URLSearchParams(selection);
      apply.set("fingerprint", fingerprint as string);
      const stale = await postSettingsForm(
        test,
        cookie,
        "/dashboard/fleet/apply",
        apply,
      );
      expect(stale.status).toBe(409);
      expect(await test.settings.get(GUILD_A, "moderation")).toMatchObject({ dryRun: true });
      expect(test.audit.records(GUILD_A)).toHaveLength(1);
    } finally {
      await test.close();
    }
  });

  it("requires CSRF for a fleet preview and writes nothing without it", async () => {
    const test = await harness();
    try {
      const { cookie } = await login(test);
      const form = new URLSearchParams({ template: "strict-moderation" });
      form.append("guild", GUILD_A);
      const response = await postSettingsForm(
        test,
        cookie,
        "/dashboard/fleet/preview",
        form,
      );
      expect(response.status).toBe(403);
      expect(await test.settings.get(GUILD_A, "moderation")).toMatchObject({ dryRun: true });
      expect(test.audit.records(GUILD_A)).toEqual([]);
    } finally {
      await test.close();
    }
  });

  it("exports a checksummed config bundle for an authorized guild only", async () => {
    const test = await harness();
    try {
      const { cookie } = await login(test);
      const bundle = await downloadConfig(test, cookie, GUILD_A);
      expect(bundle.sourceGuildId).toBe(GUILD_A);
      expect(bundle.modules).toHaveLength(12);
      expect(bundle.modules.map((module) => module.id)).toContain("ai");
      expect(bundle.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(bundle)).not.toContain(ACCESS_TOKEN);
      expect(bundle.modules.find((module) => module.id === "ai")?.settings)
        .toMatchObject({ monthlyBudgetUsd: 1 });

      const nonAdmin = await fetch(`${test.base}/dashboard/guilds/${GUILD_B}/config/export`, {
        headers: { cookie },
      });
      expect(nonAdmin.status).toBe(403);
      const noBot = await fetch(`${test.base}/dashboard/guilds/${GUILD_C}/config/export`, {
        headers: { cookie },
      });
      expect(noBot.status).toBe(403);
      const signedOut = await fetch(`${test.base}/dashboard/guilds/${GUILD_A}/config/export`);
      expect(signedOut.status).toBe(401);
    } finally {
      await test.close();
    }
  });

  it("previews an uploaded bundle, refuses a bad file and a stale apply, then writes one audited baseline", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      await test.settings.update(GUILD_A, "ai", {
        enabled: true,
        chat: true,
        monthlyBudgetUsd: 7,
      });
      const bundle = await downloadConfig(test, cookie, GUILD_A);

      const preview = await postConfigUpload(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_D}/config/import/preview`,
        multipartConfig({ csrf }, {
          name: "alpha.json",
          content: JSON.stringify(bundle),
        }),
      );
      expect(preview.status).toBe(200);
      const previewHtml = await preview.text();
      expect(previewHtml).toContain("Nothing has been written yet");
      expect(previewHtml).toContain("Monthly budget USD");
      expect(previewHtml).toContain("3 changes");
      expect(previewHtml).toContain('name="fingerprint"');
      expect(await test.settings.get(GUILD_D, "ai")).toMatchObject({ monthlyBudgetUsd: 1 });
      expect(test.audit.records(GUILD_D)).toEqual([]);
      expect(await test.baselines.get(GUILD_D)).toBeUndefined();

      const fingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(previewHtml)?.[1];
      expect(fingerprint).toBeTruthy();

      const edited = JSON.stringify({ ...bundle, checksum: "0".repeat(64) });
      const badFile = await postConfigUpload(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_D}/config/import/preview`,
        multipartConfig({ csrf }, { name: "edited.json", content: edited }),
      );
      expect(badFile.status).toBe(400);
      expect(await badFile.text()).toContain("checksum");
      expect(await test.settings.get(GUILD_D, "ai")).toMatchObject({ monthlyBudgetUsd: 1 });
      expect(test.audit.records(GUILD_D)).toEqual([]);

      const stale = new URLSearchParams({
        csrf,
        fingerprint: "0".repeat(64),
        bundle: JSON.stringify(bundle),
      });
      const refused = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_D}/config/import/apply`,
        stale,
      );
      expect(refused.status).toBe(409);
      expect(await test.settings.get(GUILD_D, "ai")).toMatchObject({ monthlyBudgetUsd: 1 });
      expect(test.audit.records(GUILD_D)).toEqual([]);

      const apply = new URLSearchParams({
        csrf,
        fingerprint: fingerprint as string,
        bundle: JSON.stringify(bundle),
      });
      const applied = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_D}/config/import/apply`,
        apply,
      );
      expect(applied.status).toBe(302);
      expect(applied.headers.get("location")).toBe(
        `/dashboard/guilds/${GUILD_D}/config/drift?imported=1&failed=0`,
      );
      expect(await test.settings.get(GUILD_D, "ai")).toMatchObject({
        enabled: true,
        chat: true,
        monthlyBudgetUsd: 7,
      });
      expect(test.audit.records(GUILD_D)).toMatchObject([
        {
          actorId: USER,
          action: "settings.update",
          targetId: "ai",
          data: { source: "dashboard" },
        },
      ]);
      const baseline = await test.baselines.get(GUILD_D);
      expect(baseline?.checksum).toBe(bundle.checksum);
      expect(baseline?.source).toBe("import");

      const clean = await fetch(
        `${test.base}/dashboard/guilds/${GUILD_D}/config/drift?imported=1&failed=0`,
        { headers: { cookie } },
      );
      expect(clean.status).toBe(200);
      const cleanHtml = await clean.text();
      expect(cleanHtml).toContain("Imported: 1 module setting");
      expect(cleanHtml).toContain("No drift");

      await test.settings.update(GUILD_D, "ai", { monthlyBudgetUsd: 3 });
      const drifted = await fetch(`${test.base}/dashboard/guilds/${GUILD_D}/config/drift`, {
        headers: { cookie },
      });
      expect(drifted.status).toBe(200);
      const driftHtml = await drifted.text();
      expect(driftHtml).toContain("Monthly budget USD");
      expect(driftHtml).toContain("1 change");
      expect(driftHtml).toContain("<code>7</code>");
      expect(driftHtml).toContain("<code>3</code>");
    } finally {
      await test.close();
    }
  });

  it("invalidates an import preview when a setting changes before apply", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      await test.settings.update(GUILD_A, "ai", { monthlyBudgetUsd: 8 });
      const bundle = await downloadConfig(test, cookie, GUILD_A);
      const preview = await postConfigUpload(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_D}/config/import/preview`,
        multipartConfig({ csrf }, { name: "alpha.json", content: JSON.stringify(bundle) }),
      );
      const fingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(
        await preview.text(),
      )?.[1];
      expect(fingerprint).toBeTruthy();

      await test.settings.update(GUILD_D, "ai", { monthlyBudgetUsd: 4 });
      const apply = new URLSearchParams({
        csrf,
        fingerprint: fingerprint as string,
        bundle: JSON.stringify(bundle),
      });
      const stale = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_D}/config/import/apply`,
        apply,
      );
      expect(stale.status).toBe(409);
      expect(await test.settings.get(GUILD_D, "ai")).toMatchObject({ monthlyBudgetUsd: 4 });
      expect(await test.baselines.get(GUILD_D)).toBeUndefined();
    } finally {
      await test.close();
    }
  });

  it("requires CSRF and guild authorization for a config import", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const bundle = await downloadConfig(test, cookie, GUILD_A);
      const noCsrf = await postConfigUpload(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_D}/config/import/preview`,
        multipartConfig({}, { name: "alpha.json", content: JSON.stringify(bundle) }),
      );
      expect(noCsrf.status).toBe(403);

      for (const guildId of [GUILD_B, GUILD_C]) {
        const response = await postConfigUpload(
          test,
          cookie,
          `/dashboard/guilds/${guildId}/config/import/preview`,
          multipartConfig({ csrf }, { name: "alpha.json", content: JSON.stringify(bundle) }),
        );
        expect(response.status).toBe(403);
      }

      const signedOut = await postConfigUpload(
        test,
        "",
        `/dashboard/guilds/${GUILD_D}/config/import/preview`,
        multipartConfig({ csrf }, { name: "alpha.json", content: JSON.stringify(bundle) }),
      );
      expect(signedOut.status).toBe(401);
      expect(await test.settings.get(GUILD_D, "ai")).toMatchObject({ monthlyBudgetUsd: 1 });
      expect(await test.baselines.get(GUILD_D)).toBeUndefined();
    } finally {
      await test.close();
    }
  });

  it("shows an empty baseline instead of inventing drift", async () => {
    const test = await harness();
    try {
      const { cookie } = await login(test);
      const page = await fetch(`${test.base}/dashboard/guilds/${GUILD_A}/config/drift`, {
        headers: { cookie },
      });
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("No baseline yet");
      expect(html).toContain("Download config bundle");
      expect(html).not.toContain("No drift");
    } finally {
      await test.close();
    }
  });

  it("saves, lists, edits, applies and deletes a template over real HTTP", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      await test.settings.update(GUILD_A, "ai", { monthlyBudgetUsd: 6, enabled: true });

      const create = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/templates`,
        new URLSearchParams({ csrf, name: "Alpha six", description: "Six dollars" }),
      );
      expect(create.status).toBe(302);
      const location = create.headers.get("location") ?? "";
      const templateId = /\/templates\/([0-9a-f-]{36})\?created=1$/.exec(location)?.[1];
      expect(templateId).toBeTruthy();
      expect(
        test.audit.records(GUILD_A).find((row) => row.action === "template.create"),
      ).toMatchObject({
        actorId: USER,
        targetId: templateId,
        data: { source: "dashboard", name: "Alpha six" },
      });

      const list = await fetch(`${test.base}/dashboard/guilds/${GUILD_A}/templates`, {
        headers: { cookie },
      });
      expect(list.status).toBe(200);
      expect(await list.text()).toContain("Alpha six");

      const editorPage = await fetch(`${test.base}${location}`, { headers: { cookie } });
      expect(editorPage.status).toBe(200);
      const editorHtml = await editorPage.text();
      expect(editorHtml).toContain("Template saved from this server");
      expect(editorHtml).toContain("Apply to servers");

      await test.settings.update(GUILD_A, "ai", { monthlyBudgetUsd: 4 });
      await test.settings.update(GUILD_D, "ai", { monthlyBudgetUsd: 2 });
      const previewPath = `/dashboard/guilds/${GUILD_A}/templates/${templateId}/preview`;
      const applyPath = `/dashboard/guilds/${GUILD_A}/templates/${templateId}/apply`;
      const selection = new URLSearchParams({ csrf });
      selection.append("guild", GUILD_A);
      selection.append("guild", GUILD_D);

      const preview = await postSettingsForm(test, cookie, previewPath, selection);
      expect(preview.status).toBe(200);
      const previewHtml = await preview.text();
      expect(previewHtml).toContain("Nothing has been written yet");
      expect(previewHtml).toContain("Monthly budget USD");
      const fingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(previewHtml)?.[1];
      expect(fingerprint).toBeTruthy();
      expect(await test.settings.get(GUILD_A, "ai")).toMatchObject({ monthlyBudgetUsd: 4 });
      expect(await test.settings.get(GUILD_D, "ai")).toMatchObject({ monthlyBudgetUsd: 2 });

      const tampered = new URLSearchParams(selection);
      tampered.set("fingerprint", "0".repeat(64));
      const refused = await postSettingsForm(test, cookie, applyPath, tampered);
      expect(refused.status).toBe(409);
      expect(await test.settings.get(GUILD_D, "ai")).toMatchObject({ monthlyBudgetUsd: 2 });

      const edit = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/templates/${templateId}`,
        new URLSearchParams({ csrf, name: "Alpha six v2", description: "Edited" }),
      );
      expect(edit.status).toBe(302);
      expect(
        test.audit.records(GUILD_A).find((row) => row.action === "template.update"),
      ).toMatchObject({ actorId: USER, data: { source: "dashboard", refreshed: false } });

      const stale = new URLSearchParams(selection);
      stale.set("fingerprint", fingerprint as string);
      expect((await postSettingsForm(test, cookie, applyPath, stale)).status).toBe(409);

      const freshPreview = await postSettingsForm(test, cookie, previewPath, selection);
      const freshHtml = await freshPreview.text();
      const freshFingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(freshHtml)?.[1];
      expect(freshFingerprint).toBeTruthy();
      expect(freshFingerprint).not.toBe(fingerprint);

      const apply = new URLSearchParams(selection);
      apply.set("fingerprint", freshFingerprint as string);
      const applied = await postSettingsForm(test, cookie, applyPath, apply);
      expect(applied.status).toBe(302);
      expect(applied.headers.get("location")).toBe(
        `/dashboard/guilds/${GUILD_A}/templates/${templateId}?applied=2&failed=0`,
      );
      for (const guildId of [GUILD_A, GUILD_D]) {
        expect(await test.settings.get(guildId, "ai")).toMatchObject({
          monthlyBudgetUsd: 6,
        });
        const writes = test.audit
          .records(guildId)
          .filter((row) => row.action === "settings.update" && row.actorId === USER);
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({ targetId: "ai", data: { source: "dashboard" } });
      }

      const createdBroken = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/templates`,
        new URLSearchParams({ csrf, name: "Tampered" }),
      );
      const brokenId = /\/templates\/([0-9a-f-]{36})\?created=1$/.exec(
        createdBroken.headers.get("location") ?? "",
      )?.[1];
      expect(brokenId).toBeTruthy();
      const row = await test.savedTemplates.get(GUILD_A, brokenId as string);
      await test.savedTemplates.update(GUILD_A, brokenId as string, {
        modules: (row?.modules ?? []).map((module) =>
          module.id === "ai"
            ? { ...module, settings: { ...module.settings, monthlyBudgetUsd: 5_000 } }
            : module,
        ),
        at: Date.now(),
      });

      const brokenPage = await fetch(
        `${test.base}/dashboard/guilds/${GUILD_A}/templates/${brokenId}`,
        { headers: { cookie } },
      );
      expect(brokenPage.status).toBe(200);
      const brokenHtml = await brokenPage.text();
      expect(brokenHtml).toContain("no longer validates");
      expect(brokenHtml).not.toContain("Apply to servers");

      const brokenSelection = new URLSearchParams({ csrf });
      brokenSelection.append("guild", GUILD_A);
      const brokenPreview = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/templates/${brokenId}/preview`,
        brokenSelection,
      );
      expect(brokenPreview.status).toBe(200);
      expect(await brokenPreview.text()).toContain("does not validate");

      const brokenApply = new URLSearchParams(brokenSelection);
      brokenApply.set("fingerprint", "0".repeat(64));
      const brokenRefused = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/templates/${brokenId}/apply`,
        brokenApply,
      );
      expect(brokenRefused.status).toBe(400);
      expect(await test.settings.get(GUILD_A, "ai")).toMatchObject({ monthlyBudgetUsd: 6 });

      const deleted = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/templates/${templateId}/delete`,
        new URLSearchParams({ csrf }),
      );
      expect(deleted.status).toBe(302);
      expect(
        test.audit.records(GUILD_A).at(-1),
      ).toMatchObject({ action: "template.delete", actorId: USER });
      const listAfter = await fetch(`${test.base}/dashboard/guilds/${GUILD_A}/templates`, {
        headers: { cookie },
      });
      const listAfterHtml = await listAfter.text();
      expect(listAfterHtml).toContain("Tampered");
      expect(listAfterHtml).not.toContain("Alpha six v2");
    } finally {
      await test.close();
    }
  });

  it("reads analytics aggregates behind the dashboard gate and says when a window is empty", async () => {
    const test = await harness();
    try {
      const { cookie } = await login(test);
      const page = await fetch(
        `${test.base}/dashboard/guilds/${GUILD_A}/analytics?days=30`,
        { headers: { cookie } },
      );
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toContain("no-store");
      const html = await page.text();
      expect(html).toContain("Source rows");
      expect(html).toContain("logging_events");
      expect(html).toContain("<b>12</b>");
      expect(html).toContain("30d ·");
      expect(html).toContain("not estimates");
      expect(test.analytics.lastWindow?.days).toBe(30);

      const api = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/analytics?days=30`, {
        headers: { cookie },
      });
      expect(api.status).toBe(200);
      expect(api.headers.get("cache-control")).toContain("no-store");
      expect(await api.json()).toMatchObject({
        guildId: GUILD_A,
        window: { days: 30 },
        overview: { loggedEvents: 12, activeCases: 3, commandsRun: 6, openTickets: 2 },
        members: { loggedJoins: 3, inviteJoins: 2, retained: 1 },
        messages: { deleted: 5, edited: 2, contentFilterCases: 4 },
        commands: { total: 6, ok: 5, blocked: 1, averageLatencyMs: 140 },
        tickets: { open: 2, closed: 1, opened: 3, closedInWindow: 1 },
      });

      const emptyPage = await fetch(
        `${test.base}/dashboard/guilds/${GUILD_D}/analytics?days=7`,
        { headers: { cookie } },
      );
      expect(emptyPage.status).toBe(200);
      const emptyHtml = await emptyPage.text();
      expect(emptyHtml).toContain("No rows in this window");
      expect(emptyHtml).toContain("not an estimate of all Discord activity");
      expect(emptyHtml).not.toContain("<b>12</b>");

      const emptyApi = await fetch(`${test.base}/api/v1/guilds/${GUILD_D}/analytics?days=7`, {
        headers: { cookie },
      });
      expect(emptyApi.status).toBe(200);
      expect(await emptyApi.json()).toMatchObject({
        guildId: GUILD_D,
        overview: { loggedEvents: 0, commandsRun: 0 },
        sources: [
          { id: "logging_events", label: "Audit events", rows: 0 },
          { id: "cases", label: "Moderation cases", rows: 0 },
          { id: "invite_joins", label: "Invite joins", rows: 0 },
          { id: "tickets", label: "Tickets", rows: 0 },
          { id: "command_usage", label: "Command runs", rows: 0 },
        ],
      });

      for (const days of ["91", "abc"]) {
        const refused = await fetch(
          `${test.base}/dashboard/guilds/${GUILD_A}/analytics?days=${days}`,
          { headers: { cookie } },
        );
        expect(refused.status).toBe(400);
        const refusedApi = await fetch(
          `${test.base}/api/v1/guilds/${GUILD_A}/analytics?days=${days}`,
          { headers: { cookie } },
        );
        expect(refusedApi.status).toBe(400);
      }

      for (const path of [
        `/dashboard/guilds/${GUILD_B}/analytics`,
        `/api/v1/guilds/${GUILD_B}/analytics`,
      ]) {
        const nonAdmin = await fetch(`${test.base}${path}`, { headers: { cookie } });
        expect(nonAdmin.status).toBe(403);
      }

      const signedOut = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/analytics`);
      expect(signedOut.status).toBe(401);
    } finally {
      await test.close();
    }
  });

  it("writes module settings through the API and audits the actor and surface", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const updated = await patchSettings(test, cookie, csrf, GUILD_A, "ai", {
        enabled: true,
        chat: true,
        monthlyBudgetUsd: 5,
      });
      expect(updated.status).toBe(200);
      const body = (await updated.json()) as { module: { id: string; settings: Record<string, unknown> } };
      expect(body.module.id).toBe("ai");
      expect(body.module.settings).toMatchObject({ enabled: true, chat: true, monthlyBudgetUsd: 5 });
      expect(await test.settings.get(GUILD_A, "ai")).toMatchObject({
        enabled: true,
        chat: true,
        monthlyBudgetUsd: 5,
        retention: "none",
      });
      expect(test.audit.records(GUILD_A)).toMatchObject([
        {
          actorId: USER,
          action: "settings.update",
          targetId: "ai",
          data: { source: "api", changes: { monthlyBudgetUsd: { from: 1, to: 5 } } },
        },
      ]);

      const overview = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/overview`, {
        headers: { cookie },
      });
      expect(overview.status).toBe(200);
      const overviewBody = (await overview.json()) as {
        modules: Array<{ id: string; settings: Record<string, unknown> }>;
      };
      expect(overviewBody.modules.find((module) => module.id === "ai")?.settings).toMatchObject({
        enabled: true,
        chat: true,
        monthlyBudgetUsd: 5,
      });
    } finally {
      await test.close();
    }
  });

  it("rejects invalid settings without mutating the stored values", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const before = await test.settings.get(GUILD_A, "ai");

      const invalid = await patchSettings(test, cookie, csrf, GUILD_A, "ai", {
        monthlyBudgetUsd: 5_000,
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: "settings_invalid" } });
      expect(await test.settings.get(GUILD_A, "ai")).toEqual(before);

      const unknown = await patchSettings(test, cookie, csrf, GUILD_A, "nope", { enabled: true });
      expect(unknown.status).toBe(404);

      const missingCsrf = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/settings/ai`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      expect(missingCsrf.status).toBe(403);

      const formMissingCsrf = await fetch(`${test.base}/dashboard/guilds/${GUILD_A}/settings/ai`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: aiForm("").toString(),
      });
      expect(formMissingCsrf.status).toBe(403);

      const wrongType = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/settings/ai`, {
        method: "PATCH",
        headers: { cookie, "content-type": "text/plain", "x-keystone-csrf": csrf },
        body: JSON.stringify({ enabled: false }),
      });
      expect(wrongType.status).toBe(415);
      expect(await test.settings.get(GUILD_A, "ai")).toEqual(before);
    } finally {
      await test.close();
    }
  });

  it("rejects cross-guild, non-admin and bot-absent settings writes", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      for (const guildId of [GUILD_B, GUILD_Z, GUILD_C]) {
        const response = await patchSettings(test, cookie, csrf, guildId, "ai", { enabled: true });
        expect(response.status).toBe(403);
      }

      const crossGuildForm = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_B}/settings/ai`,
        aiForm(csrf),
      );
      expect(crossGuildForm.status).toBe(403);

      const noSession = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/settings/ai`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-keystone-csrf": csrf },
        body: JSON.stringify({ enabled: true }),
      });
      expect(noSession.status).toBe(401);
    } finally {
      await test.close();
    }
  });
});

describe("BigInt guild permissions", () => {
  it("does not treat MODERATE_MEMBERS (bit 40) as Manage Guild", () => {
    expect(canManageGuild({ owner: false, permissions: (1n << 40n).toString() })).toBe(false);
  });

  it("accepts Manage Guild, Administrator and owner", () => {
    expect(canManageGuild({ owner: false, permissions: (1n << 5n).toString() })).toBe(true);
    expect(canManageGuild({ owner: false, permissions: (1n << 3n).toString() })).toBe(true);
    expect(canManageGuild({ owner: true, permissions: "0" })).toBe(true);
  });

  it("rejects an invalid bitfield instead of throwing", () => {
    expect(canManageGuild({ owner: false, permissions: "not-a-number" })).toBe(false);
  });
});

describe("P6 session hardening", () => {
  it("rotates the opaque session cookie and refuses the old value", async () => {
    let clock = Date.now();
    const test = await harness({ rotationIntervalMs: 60_000, now: () => clock });
    try {
      const { cookie, csrf } = await login(test);
      clock += 60_000;

      const rotated = await fetch(`${test.base}/api/v1/me`, { headers: { cookie } });
      expect(rotated.status).toBe(200);
      const nextSession = cookieValue(rotated, "keystone_session");
      const nextCsrf = cookieValue(rotated, "keystone_csrf");
      expect(nextSession).toBeTruthy();
      expect(nextCsrf).toBeTruthy();
      expect(nextSession).not.toBe(
        cookie.split("; ").find((part) => part.startsWith("keystone_session="))?.split("=")[1],
      );
      expect(nextCsrf).not.toBe(csrf);

      const replay = await fetch(`${test.base}/api/v1/me`, { headers: { cookie } });
      expect(replay.status).toBe(401);

      const current = `keystone_session=${nextSession}; keystone_csrf=${nextCsrf}`;
      const accepted = await fetch(`${test.base}/api/v1/me`, { headers: { cookie: current } });
      expect(accepted.status).toBe(200);
    } finally {
      await test.close();
    }
  });

  it("revokes the Discord token before deleting the local session", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const response = await fetch(`${test.base}/logout`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "x-keystone-csrf": csrf },
      });
      expect(response.status).toBe(302);
      expect(test.oauth.revocations).toEqual([ACCESS_TOKEN]);
      expect(await test.sessions.get(sha256(cookie.split("=")[1] as string))).toBeUndefined();
      expect((await fetch(`${test.base}/api/v1/me`, { headers: { cookie } })).status).toBe(401);
    } finally {
      await test.close();
    }
  });

  it("still deletes the session when Discord revocation fails", async () => {
    const test = await harness();
    try {
      test.oauth.revokeFails = true;
      const { cookie, csrf } = await login(test);
      const response = await fetch(`${test.base}/logout`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "x-keystone-csrf": csrf },
      });
      expect(response.status).toBe(302);
      expect(test.oauth.revocations).toEqual([ACCESS_TOKEN]);
      expect((await fetch(`${test.base}/api/v1/me`, { headers: { cookie } })).status).toBe(401);
    } finally {
      await test.close();
    }
  });

  it("returns 429 past a route limit and recovers in the next window", async () => {
    let clock = 1_000_000;
    const limits: RateLimitPolicies = {
      ...DEFAULT_RATE_LIMITS,
      api: { max: 2, windowMs: 60_000 },
    };
    const test = await harness({ rateLimiter: new RateLimiter(limits, () => clock) });
    try {
      const { cookie } = await login(test);
      expect((await fetch(`${test.base}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
      expect((await fetch(`${test.base}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
      const limited = await fetch(`${test.base}/api/v1/me`, { headers: { cookie } });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });

      clock += 60_000;
      expect((await fetch(`${test.base}/api/v1/me`, { headers: { cookie } })).status).toBe(200);
    } finally {
      await test.close();
    }
  });

  it("limits anonymous sign-in attempts and never limits the health check", async () => {
    let clock = 1_000_000;
    const limits: RateLimitPolicies = {
      ...DEFAULT_RATE_LIMITS,
      auth: { max: 1, windowMs: 60_000 },
    };
    const test = await harness({ rateLimiter: new RateLimiter(limits, () => clock) });
    try {
      expect((await fetch(`${test.base}/login`, { redirect: "manual" })).status).toBe(302);
      const limited = await fetch(`${test.base}/login`, { redirect: "manual" });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");

      for (let index = 0; index < 3; index += 1) {
        expect((await fetch(`${test.base}/healthz`)).status).toBe(200);
      }
    } finally {
      await test.close();
    }
  });

  it("refuses the instance console to a guild admin and allows an owner", async () => {
    const admin = await harness({ owners: ["999999999999999999"] });
    try {
      const { cookie, csrf } = await login(admin);
      expect((await fetch(`${admin.base}/dashboard/instance`, { headers: { cookie } })).status).toBe(403);
      const refused = await fetch(`${admin.base}/dashboard/instance/sessions/revoke`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf, userId: "777777777777777777" }).toString(),
      });
      expect(refused.status).toBe(403);
    } finally {
      await admin.close();
    }

    const owner = await harness({ owners: [USER] });
    try {
      const { cookie, csrf } = await login(owner);
      const page = await fetch(`${owner.base}/dashboard/instance`, { headers: { cookie } });
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Instance");
      expect(html).toContain("Session rotation");
      expect(html).toContain(USER);

      await owner.sessions.create({
        id: "other-session-id",
        userId: "777777777777777777",
        username: "Other",
        accessToken: "sealed-other",
        csrfHash: sha256("other-csrf"),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const revoked = await fetch(`${owner.base}/dashboard/instance/sessions/revoke`, {
        method: "POST",
        redirect: "manual",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
          "x-keystone-csrf": csrf,
        },
        body: new URLSearchParams({ userId: "777777777777777777" }).toString(),
      });
      expect(revoked.status).toBe(302);
      expect(revoked.headers.get("location")).toBe("/dashboard/instance?revoked=1");
      expect(await owner.sessions.get("other-session-id")).toBeUndefined();
    } finally {
      await owner.close();
    }

    const anonymous = await harness();
    try {
      expect((await fetch(`${anonymous.base}/dashboard/instance`)).status).toBe(401);
    } finally {
      await anonymous.close();
    }
  });
});

describe("P6 scoped API tokens", () => {
  async function issueToken(
    test: Harness,
    cookie: string,
    csrf: string,
    scopes: readonly string[],
    guildId = GUILD_A,
  ): Promise<{ secret: string; id: string; html: string; status: number }> {
    const form = new URLSearchParams({ csrf, name: "deploy", expiresInDays: "30" });
    for (const scope of scopes) form.append("scope", scope);
    const response = await postSettingsForm(
      test,
      cookie,
      `/dashboard/guilds/${guildId}/tokens`,
      form,
    );
    const html = await response.text();
    const secret = /<pre>(keystone_[A-Za-z0-9_-]+)<\/pre>/.exec(html)?.[1] ?? "";
    const [record] = await test.apiTokens.list(guildId);
    return { secret, id: record?.id ?? "", html, status: response.status };
  }

  it("issues one-show secrets, authorizes the same API handler and audits issue/revoke", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);

      const anonymous = await fetch(`${test.base}/api/v1/me`);
      expect(anonymous.status).toBe(401);

      const issued = await issueToken(test, cookie, csrf, ["guild:read"]);
      expect(issued.status).toBe(200);
      expect(issued.secret).toMatch(/^keystone_/);
      expect(issued.html).toContain("only time it is shown");

      // Only the hash is stored; the page and the record never repeat the secret.
      const [record] = await test.apiTokens.list(GUILD_A);
      expect(record?.tokenHash).toBe(sha256(issued.secret));
      expect(JSON.stringify(record)).not.toContain(issued.secret);
      const page = await fetch(`${test.base}/dashboard/guilds/${GUILD_A}/tokens`, {
        headers: { cookie },
      });
      expect(await page.text()).not.toContain(issued.secret);

      expect(
        (await fetch(`${test.base}/api/v1/me`, {
          headers: { authorization: `Bearer ${issued.secret}` },
        }).then((response) => response.json())) as Record<string, unknown>,
      ).toMatchObject({ token: { guildId: GUILD_A, scopes: ["guild:read"] } });

      const overview = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/overview`, {
        headers: { authorization: `Bearer ${issued.secret}` },
      });
      expect(overview.status).toBe(200);

      const wrongScope = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/analytics`, {
        headers: { authorization: `Bearer ${issued.secret}` },
      });
      expect(wrongScope.status).toBe(403);
      expect(await wrongScope.json()).toMatchObject({
        error: { code: "token_scope_forbidden" },
      });

      const foreignGuild = await fetch(`${test.base}/api/v1/guilds/${GUILD_D}/overview`, {
        headers: { authorization: `Bearer ${issued.secret}` },
      });
      expect(foreignGuild.status).toBe(403);
      expect(await foreignGuild.json()).toMatchObject({
        error: { code: "token_guild_forbidden" },
      });

      const invalid = await fetch(`${test.base}/api/v1/me`, {
        headers: { authorization: "Bearer keystone_not-a-real-secret-value-here" },
      });
      expect(invalid.status).toBe(401);

      expect(test.audit.records(GUILD_A)).toMatchObject([
        {
          actorId: USER,
          action: "api_token.issue",
          targetId: issued.id,
          data: { source: "dashboard", name: "deploy", scopes: ["guild:read"] },
        },
      ]);

      const revoked = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/tokens/${issued.id}/revoke`,
        new URLSearchParams({ csrf }),
      );
      expect(revoked.status).toBe(302);
      expect(
        (await fetch(`${test.base}/api/v1/me`, {
          headers: { authorization: `Bearer ${issued.secret}` },
        })).status,
      ).toBe(401);
      expect(test.audit.records(GUILD_A).map((entry) => entry.action)).toEqual([
        "api_token.issue",
        "api_token.revoke",
      ]);

      // A second revoke finds no active row and is refused rather than audited twice.
      const again = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/tokens/${issued.id}/revoke`,
        new URLSearchParams({ csrf }),
      );
      expect(again.status).toBe(404);
      expect(test.audit.records(GUILD_A)).toHaveLength(2);
    } finally {
      await test.close();
    }
  });

  it("lets a settings:write token use the session write handler without CSRF", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const issued = await issueToken(test, cookie, csrf, ["settings:write"]);
      expect(issued.status).toBe(200);

      const readOnly = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/overview`, {
        headers: { authorization: `Bearer ${issued.secret}` },
      });
      expect(readOnly.status).toBe(403);
      expect(await readOnly.json()).toMatchObject({
        error: { code: "token_scope_forbidden" },
      });

      const patched = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/settings/ai`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${issued.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ monthlyBudgetUsd: 5 }),
      });
      expect(patched.status).toBe(200);
      expect(await test.settings.get(GUILD_A, "ai")).toMatchObject({ monthlyBudgetUsd: 5 });
      expect(
        test.audit.records(GUILD_A).find((entry) => entry.action === "settings.update"),
      ).toMatchObject({
        actorId: `token:${issued.id}`,
        action: "settings.update",
        data: { moduleId: "ai", source: "api" },
      });

      const invalid = await fetch(`${test.base}/api/v1/guilds/${GUILD_A}/settings/ai`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${issued.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ monthlyBudgetUsd: 5_000 }),
      });
      expect(invalid.status).toBe(400);
      expect(await test.settings.get(GUILD_A, "ai")).toMatchObject({ monthlyBudgetUsd: 5 });
    } finally {
      await test.close();
    }
  });

  it("gives each bearer token its own fixed window", async () => {
    let clock = 1_000_000;
    const test = await harness({
      rateLimiter: new RateLimiter(
        { ...DEFAULT_RATE_LIMITS, apiToken: { max: 2, windowMs: 60_000 } },
        () => clock,
      ),
    });
    try {
      const { cookie, csrf } = await login(test);
      const first = await issueToken(test, cookie, csrf, ["guild:read"]);
      const second = await issueToken(test, cookie, csrf, ["guild:read"]);
      const call = (secret: string): Promise<Response> =>
        fetch(`${test.base}/api/v1/me`, { headers: { authorization: `Bearer ${secret}` } });

      expect((await call(first.secret)).status).toBe(200);
      expect((await call(first.secret)).status).toBe(200);
      const limited = await call(first.secret);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      // The other token has its own bucket.
      expect((await call(second.secret)).status).toBe(200);

      clock += 60_000;
      expect((await call(first.secret)).status).toBe(200);
    } finally {
      await test.close();
    }
  });

  it("refuses unknown scopes and lifetimes at issuance, before storing a row", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const badScope = await issueToken(test, cookie, csrf, ["guild:admin"]);
      expect(badScope.status).toBe(400);
      const badDays = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/tokens`,
        new URLSearchParams({ csrf, name: "deploy", expiresInDays: "0", scope: "guild:read" }),
      );
      expect(badDays.status).toBe(400);
      expect(await test.apiTokens.list(GUILD_A)).toEqual([]);
      expect(test.audit.records(GUILD_A)).toEqual([]);
    } finally {
      await test.close();
    }
  });
});

describe("P6 webhooks and Idempotency-Key", () => {
  async function receiver(status: number): Promise<{
    url: string;
    received: { headers: Record<string, string | string[] | undefined>; body: string }[];
    close(): Promise<void>;
  }> {
    const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.statusCode = status;
        res.end(status >= 200 && status < 300 ? "ok" : "nope");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("receiver did not bind");
    return {
      url: `http://127.0.0.1:${address.port}/hook`,
      received,
      async close() {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  it("creates, tests and removes a subscription through the guild write gate", async () => {
    const test = await harness();
    const sink = await receiver(200);
    try {
      const { cookie, csrf } = await login(test);
      const base = `${test.base}/dashboard/guilds/${GUILD_A}/webhooks`;
      const empty = await fetch(base, { headers: { cookie } });
      expect(empty.status).toBe(200);
      expect(await empty.text()).toContain("No webhook endpoints");

      const insecure = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/webhooks`,
        new URLSearchParams({ csrf, url: "http://example.com/hook", event: "settings.updated" }),
      );
      expect(insecure.status).toBe(400);
      expect(await test.webhooks.list(GUILD_A)).toEqual([]);

      const form = new URLSearchParams({ csrf, url: sink.url });
      form.append("event", "settings.updated");
      form.append("event", "api_token.issued");
      const created = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/webhooks`,
        form,
      );
      expect(created.status).toBe(200);
      const html = await created.text();
      const secret = /<pre>(whsec_[A-Za-z0-9_-]+)<\/pre>/.exec(html)?.[1];
      expect(secret).toBeTruthy();
      expect(html).toContain("Signing secret");

      const [subscription] = await test.webhooks.list(GUILD_A);
      expect(subscription?.url).toBe(sink.url);
      expect(subscription?.events).toEqual(["settings.updated", "api_token.issued"]);
      expect(subscription?.secret).not.toContain(secret as string);
      expect(test.audit.records(GUILD_A)).toMatchObject([
        { actorId: USER, action: "webhook.create", targetId: subscription?.id },
      ]);

      const withoutCsrf = await fetch(`${base}/${subscription?.id}/test`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: "",
      });
      expect(withoutCsrf.status).toBe(403);

      const tested = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/webhooks/${subscription?.id}/test`,
        new URLSearchParams({ csrf }),
      );
      expect(tested.status).toBe(302);
      expect(tested.headers.get("location")).toBe(
        `/dashboard/guilds/${GUILD_A}/webhooks?tested=1`,
      );
      expect(await test.webhooks.drain()).toBe(1);
      expect(sink.received).toHaveLength(1);
      expect(sink.received[0]?.headers["x-keystone-event"]).toBe("webhook.test");
      expect(
        verifyWebhookSignature(
          secret as string,
          sink.received[0]?.headers["x-keystone-signature"] as string,
          sink.received[0]?.body as string,
        ),
      ).toBe(true);

      // A real settings write queues the subscribed event through the same path.
      const saved = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/settings/ai`,
        aiForm(csrf),
      );
      expect(saved.status).toBe(302);
      expect(await test.webhooks.drain()).toBe(1);
      const settingsDelivery = sink.received[1];
      expect(settingsDelivery?.headers["x-keystone-event"]).toBe("settings.updated");
      expect(JSON.parse(settingsDelivery?.body as string)).toMatchObject({
        event: "settings.updated",
        data: { moduleId: "ai", actorId: USER, source: "dashboard" },
      });

      const page = await fetch(base, { headers: { cookie } });
      const pageHtml = await page.text();
      expect(pageHtml).toContain("Delivery receipts");
      expect(pageHtml).toContain("delivered");

      const removed = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/webhooks/${subscription?.id}/delete`,
        new URLSearchParams({ csrf }),
      );
      expect(removed.status).toBe(302);
      expect(await test.webhooks.list(GUILD_A)).toEqual([]);
      expect(await test.webhooks.deliveries(GUILD_A)).toEqual([]);
      expect(test.audit.records(GUILD_A).map((row) => row.action)).toContain("webhook.delete");
    } finally {
      await sink.close();
      await test.close();
    }
  });

  it("records a failing receiver's HTTP status and error as a receipt", async () => {
    const test = await harness();
    const sink = await receiver(500);
    try {
      const { cookie, csrf } = await login(test);
      const form = new URLSearchParams({ csrf, url: sink.url, event: "settings.updated" });
      await postSettingsForm(test, cookie, `/dashboard/guilds/${GUILD_A}/webhooks`, form);
      await test.webhooks.enqueue(GUILD_A, "settings.updated", { moduleId: "ai" });
      expect(await test.webhooks.drain()).toBe(1);

      const [receipt] = await test.webhooks.deliveries(GUILD_A);
      expect(receipt).toMatchObject({ status: "pending", attempts: 1, lastStatus: 500 });
      expect(receipt?.lastError).toContain("500");

      const page = await fetch(`${test.base}/dashboard/guilds/${GUILD_A}/webhooks`, {
        headers: { cookie },
      });
      const html = await page.text();
      expect(html).toContain("Internal Server Error");
      expect(html).toContain("500");
    } finally {
      await sink.close();
      await test.close();
    }
  });

  it("replays a token write on the same Idempotency-Key and refuses a different body", async () => {
    const test = await harness();
    try {
      const { cookie, csrf } = await login(test);
      const issued = await postSettingsForm(
        test,
        cookie,
        `/dashboard/guilds/${GUILD_A}/tokens`,
        (() => {
          const form = new URLSearchParams({ csrf, name: "deploy", expiresInDays: "30" });
          form.append("scope", "settings:write");
          return form;
        })(),
      );
      expect(issued.status).toBe(200);
      const secret = /<pre>(keystone_[A-Za-z0-9_-]+)<\/pre>/.exec(await issued.text())?.[1] as string;
      const writesBefore = test.audit.records(GUILD_A).filter(
        (row) => row.action === "settings.update",
      ).length;

      const patch = (body: string, key: string): Promise<Response> =>
        fetch(`${test.base}/api/v1/guilds/${GUILD_A}/settings/ai`, {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
            "idempotency-key": key,
          },
          body,
        });

      const first = await patch(JSON.stringify({ monthlyBudgetUsd: 11 }), "probe-key-0001");
      expect(first.status).toBe(200);
      expect(first.headers.get("idempotent-replayed")).toBe("false");
      const firstBody = await first.text();
      expect(await test.settings.get(GUILD_A, "ai")).toMatchObject({ monthlyBudgetUsd: 11 });

      const replay = await patch(JSON.stringify({ monthlyBudgetUsd: 11 }), "probe-key-0001");
      expect(replay.status).toBe(200);
      expect(replay.headers.get("idempotent-replayed")).toBe("true");
      expect(await replay.text()).toBe(firstBody);
      expect(
        test.audit.records(GUILD_A).filter((row) => row.action === "settings.update"),
      ).toHaveLength(writesBefore + 1);

      const conflict = await patch(JSON.stringify({ monthlyBudgetUsd: 12 }), "probe-key-0001");
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ error: { code: "idempotency_conflict" } });
      expect(await test.settings.get(GUILD_A, "ai")).toMatchObject({ monthlyBudgetUsd: 11 });

      const invalid = await patch(JSON.stringify({ monthlyBudgetUsd: 12 }), "short");
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: "idempotency_key_invalid" } });
    } finally {
      await test.close();
    }
  });
});

describe("session storage", () => {
  it("stores only a hash of the session id and a sealed token", async () => {
    const store = new InMemorySessionStore();
    const raw = "browser-session-token";
    await store.create({
      id: sha256(raw),
      userId: USER,
      username: "Admin",
      accessToken: "sealed-a",
      csrfHash: sha256("csrf"),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(await store.get(raw)).toBeUndefined();
    expect(await store.get(sha256(raw))).toMatchObject({ accessToken: "sealed-a" });
  });
});
