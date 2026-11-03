import { randomBytes } from "node:crypto";
import type { Env } from "@keystone/config";
import {
  InMemoryApiTokenStore,
  InMemoryAuditStore,
  InMemoryConfigBaselineStore,
  InMemoryDashboardStore,
  InMemoryIdempotencyStore,
  InMemorySavedTemplateStore,
  InMemorySessionStore,
  InMemorySettingsRepository,
  InMemoryWebhookStore,
  ModuleRegistry,
  SettingsService,
  createLogger,
  type AnalyticsStore,
  type ApiTokenStore,
  type AuditStore,
  type ConfigBaselineStore,
  type DashboardStore,
  type IdempotencyStore,
  type SavedTemplateStore,
  type Logger,
  type SessionStore,
  type SettingsRepository,
  type WebhookStore,
} from "@keystone/kernel";
import {
  createAnalyticsStore,
  createApiTokenStore,
  createAuditStore,
  createConfigBaselineStore,
  createDashboardStore,
  createIdempotencyStore,
  createSavedTemplateStore,
  createPostgresDatabase,
  createSessionStore,
  createSettingsRepository,
  createWebhookStore,
  type PostgresHandle,
} from "@keystone/db";
import { modules } from "@keystone/module-catalog";
import { GuildAccessService } from "./access";
import { ApiTokenService } from "./api-tokens";
import { AuthService } from "./auth";
import { parseSessionSecret, SecretBox } from "./crypto";
import { DiscordOAuthClient, type DiscordOAuth } from "./oauth";
import { DashboardService } from "./overview";
import { createWebHandler, type WebServerDeps } from "./server";
import { HttpError } from "./http-error";
import { DEFAULT_RATE_LIMITS, RateLimiter } from "./rate-limit";
import { startWebhookDrainer, WebhookService } from "./webhooks";

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
/** Re-key the opaque cookie every 15 minutes; the absolute expiry does not move. */
const SESSION_ROTATION_MS = 15 * 60_000;

export interface WebRuntime {
  handler: ReturnType<typeof createWebHandler>;
  logger: Logger;
  mode: { database: "postgres" | "memory"; oauth: boolean; secureCookies: boolean };
  ephemeralSessionKey: boolean;
  close(): Promise<void>;
}

function unavailableOAuth(): DiscordOAuth {
  const fail = async (): Promise<never> => {
    throw new HttpError(503, "Discord OAuth is not configured.", "oauth_unconfigured");
  };
  return {
    authorizationUrl: () => {
      throw new HttpError(503, "Discord OAuth is not configured.", "oauth_unconfigured");
    },
    exchangeCode: fail,
    fetchUser: fail,
    fetchGuilds: fail,
    botInGuild: fail,
    revokeToken: fail,
  };
}

export function createWebRuntime(env: Env): WebRuntime {
  const logger = createLogger("keystone-web", env.LOG_LEVEL);
  const registry = new ModuleRegistry().registerAll(modules);

  let database: PostgresHandle | undefined;
  let settingsRepository: SettingsRepository;
  let sessions: SessionStore;
  let dashboardStore: DashboardStore;
  let auditStore: AuditStore;
  let baselineStore: ConfigBaselineStore;
  let savedTemplateStore: SavedTemplateStore;
  let apiTokenStore: ApiTokenStore;
  let webhookStore: WebhookStore;
  let idempotencyStore: IdempotencyStore;
  let analyticsStore: AnalyticsStore | undefined;
  if (env.DATABASE_URL) {
    database = createPostgresDatabase(env.DATABASE_URL);
    settingsRepository = createSettingsRepository(database);
    sessions = createSessionStore(database);
    dashboardStore = createDashboardStore(database);
    auditStore = createAuditStore(database);
    baselineStore = createConfigBaselineStore(database);
    savedTemplateStore = createSavedTemplateStore(database);
    apiTokenStore = createApiTokenStore(database);
    webhookStore = createWebhookStore(database);
    idempotencyStore = createIdempotencyStore(database);
    analyticsStore = createAnalyticsStore(database);
    logger.info("web data: postgres");
  } else {
    logger.warn("DATABASE_URL is not set — web sessions, audit rows and dashboard reads are process-local.");
    settingsRepository = new InMemorySettingsRepository();
    sessions = new InMemorySessionStore();
    dashboardStore = new InMemoryDashboardStore();
    auditStore = new InMemoryAuditStore();
    baselineStore = new InMemoryConfigBaselineStore();
    savedTemplateStore = new InMemorySavedTemplateStore();
    apiTokenStore = new InMemoryApiTokenStore();
    webhookStore = new InMemoryWebhookStore();
    idempotencyStore = new InMemoryIdempotencyStore();
  }

  const origin = env.WEB_ORIGIN ?? `http://localhost:${env.WEB_PORT}`;
  const redirectUri = env.DISCORD_OAUTH_REDIRECT_URI ?? `${origin}/auth/callback`;
  const secureCookies = origin.startsWith("https://") || env.NODE_ENV === "production";
  const owners = (env.WEB_OWNER_IDS ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  for (const owner of owners) {
    if (!/^\d{15,20}$/.test(owner)) {
      throw new Error(`WEB_OWNER_IDS contains an invalid Discord user id: ${owner}`);
    }
  }
  if (owners.length === 0) {
    logger.warn("WEB_OWNER_IDS is not set — the instance owner console stays closed.");
  }

  let sessionKey: Buffer;
  let ephemeralSessionKey = false;
  if (env.SESSION_SECRET) {
    sessionKey = parseSessionSecret(env.SESSION_SECRET);
  } else if (env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production (32 bytes, base64 or 64 hex).");
  } else {
    sessionKey = randomBytes(32);
    ephemeralSessionKey = true;
    logger.warn("SESSION_SECRET is not set — using an ephemeral development key.");
  }

  const oauth =
    env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_TOKEN
      ? new DiscordOAuthClient({
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
          botToken: env.DISCORD_TOKEN,
        })
      : undefined;
  if (!oauth) {
    logger.warn("Discord OAuth is not configured — /login returns 503 until the three OAuth values and DISCORD_TOKEN are set.");
  }

  const box = new SecretBox(sessionKey);
  const auth = new AuthService({
    oauth,
    sessions,
    box,
    config: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      redirectUri,
      issuer: env.DISCORD_OAUTH_ISSUER,
      sessionTtlMs: SESSION_TTL_MS,
      rotationIntervalMs: SESSION_ROTATION_MS,
      owners,
    },
  });
  const access = new GuildAccessService(oauth ?? unavailableOAuth());
  const webhooks = new WebhookService(webhookStore, box);
  const dashboard = new DashboardService(
    registry,
    new SettingsService(settingsRepository, registry, auditStore),
    dashboardStore,
    auditStore,
    baselineStore,
    savedTemplateStore,
    analyticsStore,
    webhooks,
  );
  const drainer = startWebhookDrainer(webhooks, logger);
  const handler = createWebHandler({
    auth,
    access,
    dashboard,
    logger,
    secureCookies,
    databaseMode: database ? "postgres" : "memory",
    rateLimiter: new RateLimiter(DEFAULT_RATE_LIMITS),
    apiTokens: new ApiTokenService(apiTokenStore),
    audit: auditStore,
    webhooks,
    idempotency: idempotencyStore,
  });

  return {
    handler,
    logger,
    mode: {
      database: database ? "postgres" : "memory",
      oauth: Boolean(oauth),
      secureCookies,
    },
    ephemeralSessionKey,
    async close() {
      drainer.stop();
      await database?.close();
    },
  };
}
