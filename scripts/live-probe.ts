/**
 * `pnpm probe:live` — prove the configured services with real code paths.
 *
 * This is deliberately **not** part of `pnpm check`: the gate must pass on a
 * machine with no database and no network. The probe is the operator step that
 * turns "tested on PGlite" into "ran here, against Postgres and Redis", and it
 * leaves `memory/machine/live.json` as the evidence the memory gate reads.
 *
 * It is safe to re-run: every row it writes lives under `live-probe*` ids and is
 * removed before it exits.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "@keystone/config";
import { ModuleRegistry, SettingsService, createLogger } from "@keystone/kernel";
import {
  createAnalyticsStore,
  createApiTokenStore,
  createAuditStore,
  createCaseStore,
  createCommunityStore,
  createConfigBaselineStore,
  createDashboardStore,
  createSavedTemplateStore,
  createIdempotencyStore,
  createWebhookStore,
  createPanicStore,
  createPortabilityStore,
  createPostgresDatabase,
  createSessionStore,
  createSettingsRepository,
  guilds,
  migrationStatus,
  probeDatabase,
  type PostgresHandle,
} from "@keystone/db";
import { modules } from "../packages/module-catalog/src/index";
import {
  CaseService,
  TemporaryActionService,
  moderationSettingsSchema,
} from "../modules/moderation/src/index";
import {
  ContentService,
  communitySettingsSchema,
} from "../modules/community/src/index";
import { PortabilityService } from "@keystone/importer";
import { createCooldownStore } from "../packages/cache/src/index";
import { BullJobQueue, createBullWorker } from "../packages/queue/src/index";
import { createWebRuntime } from "../apps/web/src/runtime";
import { GuildAccessService } from "../apps/web/src/access";
import { ApiTokenService } from "../apps/web/src/api-tokens";
import { AuthService } from "../apps/web/src/auth";
import { SecretBox, sha256 } from "../apps/web/src/crypto";
import { DashboardService } from "../apps/web/src/overview";
import { createWebHandler } from "../apps/web/src/server";
import { startWebhookDrainer, WebhookService } from "../apps/web/src/webhooks";
import { DEFAULT_RATE_LIMITS, RateLimiter, type RateLimitPolicies } from "../apps/web/src/rate-limit";
import type { ConfigBundle } from "../apps/web/src/config-bundle";
import type { DiscordGuild, DiscordOAuth } from "../apps/web/src/oauth";

const root = path.resolve(import.meta.dirname, "..");
const GUILD = "live-probe";
const WEB_GUILD = "999999999999999999";
const WEB_GUILD_B = "888888888888888888";
const WEB_USER = "777777777777777777";
const WEB_NORMAL_USER = "777777777777777778";
const QUEUE = "keystone-live-probe";
const DELAYED_QUEUE = "keystone-live-probe-delayed";
const TEMPORARY_QUEUE = "keystone-live-probe-temporary";
// A fresh key per run: BullMQ keeps completed jobs by id, so reusing one would
// make the second probe wait on the first run's job instead of executing.
const JOB_KEY = `live-probe-job-${Date.now().toString(36)}`;

interface Check {
  id: string;
  status: "pass";
  detail: string;
  features: string[];
}

interface LiveReport {
  schemaVersion: 1;
  id: string;
  date: string;
  generatedAt: string;
  docker: { version: string | null; running: boolean };
  services: {
    postgres: {
      reachable: boolean;
      version: string;
      migrations: { applied: number; pending: number; upToDate: boolean };
    };
    redis: { reachable: boolean };
  };
  checks: Check[];
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(ok: boolean, message: string): asserts ok {
  if (!ok) fail(message);
}

class WebProbeOAuth implements DiscordOAuth {
  /** The probe has no Discord login, so it selects which user the fake returns. */
  userId = WEB_USER;
  readonly revocations: string[] = [];

  authorizationUrl(input: { state: string }): string {
    return `https://discord.test/oauth?state=${encodeURIComponent(input.state)}`;
  }

  async exchangeCode(): Promise<{ accessToken: string }> {
    return { accessToken: "live-probe-access-token" };
  }

  async fetchUser(): Promise<{ id: string; username: string }> {
    return { id: this.userId, username: `Live probe ${this.userId}` };
  }

  async revokeToken(accessToken: string): Promise<void> {
    this.revocations.push(accessToken);
  }

  async fetchGuilds(): Promise<DiscordGuild[]> {
    return [
      { id: WEB_GUILD, name: "Live probe web", icon: null, owner: true, permissions: "0" },
      { id: WEB_GUILD_B, name: "Live probe web two", icon: null, owner: true, permissions: "0" },
    ];
  }

  async botInGuild(): Promise<boolean> {
    return true;
  }
}

function responseCookie(response: Response, name: string): string | undefined {
  const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  return header?.split(";")[0];
}

function multipartFile(csrf: string, text: string): { body: string; contentType: string } {
  const boundary = "----keystone-live-probe-config";
  const body = [
    `--${boundary}\r\nContent-Disposition: form-data; name="csrf"\r\n\r\n${csrf}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="guild.json"\r\nContent-Type: application/json\r\n\r\n${text}\r\n`,
    `--${boundary}--\r\n`,
  ].join("");
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function dockerVersion(): { version: string | null; running: boolean } {
  try {
    const version = execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { version: version || null, running: Boolean(version) };
  } catch {
    return { version: null, running: false };
  }
}

async function openDatabase(url: string): Promise<PostgresHandle> {
  const database = createPostgresDatabase(url);
  const health = await probeDatabase(database.runner);
  assert(health.reachable, `Postgres is not reachable: ${health.detail}`);
  assert(health.migrated, `Postgres is reachable but not migrated: ${health.detail}`);
  return database;
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL || !env.REDIS_URL) {
    fail("probe:live needs DATABASE_URL and REDIS_URL. Start docker compose and copy .env.example.");
  }

  const logger = createLogger("keystone-live-probe", "warn");
  const checks: Check[] = [];
  const record = (check: Check): void => {
    checks.push(check);
    console.log(`  ✓ ${check.id} — ${check.detail}`);
  };

  const docker = dockerVersion();
  let database = await openDatabase(env.DATABASE_URL);

  const migrations = await migrationStatus(database.runner);
  assert(migrations.pending.length === 0, `pending migrations: ${migrations.pending.join(", ")}`);
  const versionRows = await database.runner.query<{ version: string }>(
    "SELECT current_setting('server_version') AS version",
  );
  const postgresVersion = versionRows[0]?.version ?? "unknown";
  record({
    id: "postgres-migrations",
    status: "pass",
    detail: `${migrations.applied.length} migrations applied, 0 pending on Postgres ${postgresVersion}`,
    features: [],
  });

  await database.db.insert(guilds).values({ id: GUILD, name: "Keystone live probe" }).onConflictDoNothing();
  const settings = createSettingsRepository(database);
  await settings.set(GUILD, "community", {
    probe: { at: new Date().toISOString(), marker: "survives-a-restart" },
  });
  await database.close();

  // Reopen a new pool: this is the restart `/config` promises, not a reuse of
  // the same client or process memory.
  database = await openDatabase(env.DATABASE_URL);
  const reopened = createSettingsRepository(database);
  const stored = await reopened.get(GUILD, "community");
  assert(
    (stored?.probe as { marker?: string } | undefined)?.marker === "survives-a-restart",
    "settings did not survive a close/reopen of the Postgres pool",
  );
  record({
    id: "postgres-settings-restart",
    status: "pass",
    detail: "one settings row written, pool closed and reopened, same value read back",
    features: ["operations.in-bot-config"],
  });

  // --- Redis -----------------------------------------------------------------
  const firstCache = await createCooldownStore({ redisUrl: env.REDIS_URL, logger });
  const secondCache = await createCooldownStore({ redisUrl: env.REDIS_URL, logger });
  assert(firstCache.mode === "redis" && secondCache.mode === "redis", "cooldowns did not select Redis");
  const cooldownKey = `live-probe-${Date.now()}`;
  const firstHit = await firstCache.store.hit(cooldownKey, 2_000);
  const secondHit = await secondCache.store.hit(cooldownKey, 2_000);
  assert(firstHit.allowed, "the first Redis cooldown was refused");
  assert(!secondHit.allowed && secondHit.retryAfterMs > 0, "Redis cooldown state was not shared");
  await firstCache.close();
  await secondCache.close();
  record({
    id: "redis-shared-cooldown",
    status: "pass",
    detail: `two clients: first allowed, second refused with ${secondHit.retryAfterMs}ms remaining`,
    features: [],
  });

  // --- BullMQ + Postgres receipts -------------------------------------------
  const idempotency = createIdempotencyStore(database);
  const queue = BullJobQueue.create({ redisUrl: env.REDIS_URL, queueName: QUEUE });
  let calls = 0;
  const worker = createBullWorker({
    redisUrl: env.REDIS_URL,
    queueName: QUEUE,
    handlers: {
      "live.probe": async () => {
        calls += 1;
      },
    },
    idempotency,
    logger,
  });
  await worker.waitUntilReady();
  await queue.enqueue("live.probe", { at: new Date().toISOString() }, { idempotencyKey: JOB_KEY });
  await queue.enqueue("live.probe", { at: new Date().toISOString() }, { idempotencyKey: JOB_KEY });

  const deadline = Date.now() + 15_000;
  let receipt = await idempotency.receipt(JOB_KEY);
  while (receipt?.status !== "completed" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    receipt = await idempotency.receipt(JOB_KEY);
  }
  assert(receipt?.status === "completed", `job receipt is ${receipt?.status ?? "missing"} after 15s`);
  assert(calls === 1, `handler ran ${calls} times; expected one idempotent execution`);
  await worker.close();
  await queue.close();
  record({
    id: "bullmq-job-idempotency",
    status: "pass",
    detail: "two enqueues with one idempotency key produced one handler call and a completed Postgres receipt",
    features: [],
  });

  // --- A delayed timer, not just an immediate job ---------------------------
  const delayedKey = `live-probe-delayed-${Date.now().toString(36)}`;
  const delayedQueue = BullJobQueue.create({ redisUrl: env.REDIS_URL, queueName: DELAYED_QUEUE });
  let delayedRuns = 0;
  const delayedWorker = createBullWorker({
    redisUrl: env.REDIS_URL,
    queueName: DELAYED_QUEUE,
    handlers: {
      "live.delayed": async () => {
        delayedRuns += 1;
      },
    },
    idempotency,
    logger,
  });
  await delayedWorker.waitUntilReady();
  const startedAt = Date.now();
  await delayedQueue.enqueue(
    "live.delayed",
    { at: new Date().toISOString() },
    { idempotencyKey: delayedKey, delayMs: 1_000 },
  );
  let delayedReceipt = await idempotency.receipt(delayedKey);
  while (delayedReceipt?.status !== "completed" && Date.now() < startedAt + 15_000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    delayedReceipt = await idempotency.receipt(delayedKey);
  }
  const elapsed = Date.now() - startedAt;
  assert(delayedReceipt?.status === "completed", `delayed receipt is ${delayedReceipt?.status ?? "missing"}`);
  assert(elapsed >= 800, `delayed job ran after ${elapsed}ms, before its delay`);
  assert(delayedRuns === 1, `delayed handler ran ${delayedRuns} times`);
  await delayedWorker.close();
  await delayedQueue.close();
  record({
    id: "bullmq-delayed-timer",
    status: "pass",
    detail: `one delayed job fired once after ${elapsed}ms and wrote a completed receipt`,
    features: [],
  });

  // --- Temporary moderation against real case rows -------------------------
  const caseStore = createCaseStore(database);
  const cases = new CaseService(caseStore);
  let released = 0;
  const moderationActions = {
    async unban() {
      released += 1;
      return { ok: true };
    },
    async notify() {
      /* the probe records the action, not a Discord message */
    },
  } as unknown as import("@keystone/kernel").ModerationActions;
  const temporaryCase = await cases.open({
    guildId: GUILD,
    actorId: "live-probe",
    targetId: "live-probe-target",
    action: "ban",
    reason: "live-probe temporary ban",
    rule: "manual",
    state: "open",
  });
  const temporarySettings = moderationSettingsSchema.parse({ modLogChannelId: "live-probe-log" });
  const temporaryService = new TemporaryActionService(cases, moderationActions, temporarySettings);
  const temporaryKey = `moderation:expire:${temporaryCase.id}`;
  const scheduledCase =
    (await cases.setExpiry(temporaryCase.id, new Date(Date.now() - 1_000).toISOString())) ??
    temporaryCase;
  const temporaryQueue = BullJobQueue.create({
    redisUrl: env.REDIS_URL,
    queueName: TEMPORARY_QUEUE,
  });
  const temporaryWorker = createBullWorker({
    redisUrl: env.REDIS_URL,
    queueName: TEMPORARY_QUEUE,
    handlers: {
      "moderation.expire": async (payload) => {
        const caseId = (payload as { caseId?: unknown }).caseId;
        if (typeof caseId !== "string") throw new Error("missing case id");
        const result = await temporaryService.expire(caseId);
        if (result.status !== "expired") {
          throw new Error(`temporary case finished as ${result.status}`);
        }
      },
    },
    idempotency,
    logger,
  });
  await temporaryWorker.waitUntilReady();
  assert(
    (await temporaryService.schedule(temporaryQueue, scheduledCase)) === temporaryKey,
    "temporary job key does not match the expected three-part id",
  );
  let temporaryReceipt = await idempotency.receipt(temporaryKey);
  const temporaryDeadline = Date.now() + 15_000;
  while (temporaryReceipt?.status !== "completed" && Date.now() < temporaryDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    temporaryReceipt = await idempotency.receipt(temporaryKey);
  }
  assert(temporaryReceipt?.status === "completed", `temporary receipt is ${temporaryReceipt?.status ?? "missing"}`);
  await temporaryWorker.close();
  await temporaryQueue.close();

  assert(released === 1, `release action ran ${released} times`);
  const afterExpiry = await caseStore.getById(temporaryCase.id);
  assert(afterExpiry?.state === "closed", `temporary case state is ${afterExpiry?.state ?? "missing"}`);
  const expiryEvents = await caseStore.listEvents(temporaryCase.id);
  assert(expiryEvents.some((event) => event.type === "expired"), "case has no expired event");
  record({
    id: "temporary-moderation-expiry",
    status: "pass",
    detail:
      "a real Postgres case was scheduled through the three-part BullMQ id, expired through TemporaryActionService, the release action ran once and the case closed with an expired event",
    features: [],
  });

  // --- Panic snapshot against a real row ------------------------------------
  // This proves the durable way back, not the Discord lockdown itself: the
  // probe has no gateway, so `lockdown`/`restoreLockdown` are covered by the
  // adapter and service tests, not claimed here.
  const panicStore = createPanicStore(database);
  const panicSnapshot = {
    active: true as const,
    startedAt: new Date().toISOString(),
    startedBy: "live-probe",
    reason: "live-probe panic",
    channels: [{ channelId: "live-probe-channel", existed: true, previous: "neutral" as const }],
  };
  await panicStore.save(GUILD, panicSnapshot);
  const readPanic = await panicStore.get(GUILD);
  // jsonb reorders object keys, so compare the values that matter rather than
  // their serialized order.
  assert(
    readPanic?.active === true &&
      readPanic.startedBy === panicSnapshot.startedBy &&
      readPanic.reason === panicSnapshot.reason &&
      readPanic.channels.length === 1 &&
      readPanic.channels[0]?.channelId === panicSnapshot.channels[0]!.channelId &&
      readPanic.channels[0]?.existed === true &&
      readPanic.channels[0]?.previous === "neutral",
    "panic snapshot did not round-trip through Postgres",
  );
  await panicStore.clear(GUILD);
  assert((await panicStore.get(GUILD)) === undefined, "cleared panic snapshot is still stored");
  record({
    id: "panic-snapshot-persistence",
    status: "pass",
    detail:
      "a panic snapshot was written, read back and cleared on Postgres; Discord lockdown calls are adapter-tested only",
    features: [],
  });

  // --- Reminder/scheduled delivery against real community rows -------------
  const communityStore = createCommunityStore(database);
  const delivered: string[] = [];
  const communityActions = {
    async sendMessage(_guildId: string, _channelId: string, message: { content?: string }) {
      delivered.push(message.content ?? "");
      return { ok: true, id: `live-${delivered.length}` };
    },
    async sendDM(_userId: string, message: { content?: string }) {
      delivered.push(message.content ?? "");
      return { ok: true, id: `live-${delivered.length}` };
    },
  } as unknown as import("@keystone/kernel").CommunityActions;
  const content = new ContentService(
    communityStore,
    communityActions,
    communitySettingsSchema.parse({}),
  );
  const dueAt = new Date(Date.now() - 1_000).toISOString();
  await communityStore.putRecord(GUILD, "reminder", "live-probe-reminder", {
    id: "live-probe-reminder",
    userId: "live-probe-user",
    dueAt,
    text: "live-probe reminder",
    sent: false,
  });
  await communityStore.putRecord(GUILD, "scheduled_message", "live-probe-scheduled", {
    id: "live-probe-scheduled",
    userId: "server",
    channelId: "live-probe-channel",
    dueAt,
    text: "live-probe scheduled message",
    sent: false,
  });
  assert(
    (await content.deliver(GUILD, "reminder", "live-probe-reminder")).status === "sent",
    "reminder was not delivered",
  );
  assert(
    (await content.deliver(GUILD, "scheduled_message", "live-probe-scheduled")).status === "sent",
    "scheduled message was not delivered",
  );
  assert(
    (await content.deliver(GUILD, "reminder", "live-probe-reminder")).status === "already-sent",
    "redelivered reminder was not idempotent",
  );

  // The timer and the 60-second sweep can call deliver at the same time. The
  // conditional UPDATE must give the claim to exactly one of them.
  await communityStore.putRecord(GUILD, "reminder", "live-probe-race", {
    id: "live-probe-race",
    userId: "live-probe-user",
    dueAt,
    text: "live-probe race",
    sent: false,
  });
  const race = await Promise.all([
    content.deliver(GUILD, "reminder", "live-probe-race"),
    content.deliver(GUILD, "reminder", "live-probe-race"),
  ]);
  assert(
    race.map((result) => result.status).sort().join(",") === "already-sent,sent",
    `concurrent delivery produced ${race.map((result) => result.status).join(",")}`,
  );
  assert(delivered.length === 3, `expected three deliveries, got ${delivered.length}`);
  record({
    id: "content-timer-delivery",
    status: "pass",
    detail:
      "a real community record delivered a reminder and a scheduled message once, and two concurrent claims produced exactly one send",
    features: [],
  });

  // --- Portability on real rows ---------------------------------------------
  const portability = new PortabilityService(createPortabilityStore(database));
  const source = "live-probe-src";
  const destination = "live-probe-dst";
  await database.db.insert(guilds).values({ id: source, name: "Probe source" }).onConflictDoNothing();
  await reopened.set(source, "community", { probe: { marker: "bundle-source" } });

  const bundle = await portability.exportGuild(source);
  assert(bundle.manifest.counts.settings >= 1, "export bundle has no settings rows");
  const preview = await portability.importBundle(bundle, destination, {
    mode: "replace",
    dryRun: true,
    actorId: "live-probe",
  });
  assert(preview.state === "dry-run" && preview.receipt.dryRun === true, "dry run was not a dry run");
  assert(preview.diff.settings.added >= 1, "dry run reported no setting changes");
  record({
    id: "portability-dry-run",
    status: "pass",
    detail: `dry run reported ${preview.diff.settings.added} added / ${preview.diff.settings.changed} changed / ${preview.diff.settings.removed} removed setting(s)`,
    features: ["portability.dry-run-import-diff"],
  });

  const applied = await portability.importBundle(bundle, destination, {
    mode: "replace",
    actorId: "live-probe",
  });
  assert(applied.state === "applied", `import state is ${applied.state}`);
  assert(applied.receipt.verified === true, "the post-import checksum did not verify");
  assert(Boolean(applied.importId), "the applied import has no id");
  record({
    id: "portability-import-verify",
    status: "pass",
    detail: `bundle checksum ${applied.receipt.checksum?.slice(0, 12) ?? "?"}… matched after import ${applied.importId?.slice(0, 8) ?? "?"}`,
    features: ["portability.restore-and-config-hash", "security.backup-restore"],
  });

  const rolledBack = await portability.rollback(applied.importId!);
  assert(rolledBack.state === "rolled-back", `rollback state is ${rolledBack.state}`);
  const afterRollback = await portability.exportGuild(destination);
  assert(afterRollback.manifest.counts.settings === 0, "rollback left settings behind");
  record({
    id: "portability-rollback",
    status: "pass",
    detail: "the applied import restored its pre-import backup; the destination has no settings rows",
    features: ["portability.rollback-window", "security.backup-restore"],
  });

  // Leave one row behind so the deletion receipt proves it retained counts, not
  // merely that it can delete an already-empty guild.
  await reopened.set(destination, "community", { probe: { marker: "delete-me" } });
  const deletion = await portability.deleteGuild(destination, "live-probe");
  assert(deletion.record.state === "deleted", `deletion state is ${deletion.record.state}`);
  assert(deletion.counts.settings === 1, `deletion receipt counted ${deletion.counts.settings} settings`);
  const destinationGuild = await database.runner.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM guilds WHERE id = '${destination}'`,
  );
  assert(destinationGuild[0]?.count === "0", "deletion left the guild row behind");
  record({
    id: "portability-deletion-receipt",
    status: "pass",
    detail: `deletion receipt retained ${deletion.counts.settings} setting(s) and the guild row is gone`,
    features: ["portability.deletion-receipt"],
  });

  // --- Web health with a real database --------------------------------------
  const web = createWebRuntime(env);
  assert(web.mode.database === "postgres", "the web runtime did not use Postgres");
  const server = createServer(web.handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  try {
    const address = server.address();
    assert(address !== null && typeof address === "object", "the web server has no port");
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    const body = (await response.json()) as { ok?: boolean; database?: string };
    assert(response.ok && body.ok === true, "the health endpoint did not answer ok");
    assert(body.database === "postgres", `health reports database=${body.database ?? "missing"}`);
    record({
      id: "web-health-postgres",
      status: "pass",
      detail: `/healthz returned 200 with database=postgres on an ephemeral port`,
      features: [],
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await web.close();
  }

  // --- Dashboard widgets over real HTTP, Postgres sessions/settings/audit ---
  // The OAuth *port* is faked because the probe has no Discord client. Login,
  // state validation, the session cookie, CSRF, the HTML form, the schema gate
  // and the Postgres writes are all the real code paths, not service methods
  // called directly.
  {
    // This block owns the two probe guilds, so it starts from their clean state.
    // A failed earlier run must not make the next one pass or fail for the
    // wrong reason (the schema-widget check counts the audit trail).
    await database.runner.exec(`
      DELETE FROM audit_events WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
      DELETE FROM settings WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
      DELETE FROM api_tokens WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
      DELETE FROM config_baselines WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
      DELETE FROM config_templates WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
      DELETE FROM webhook_subscriptions WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
    `);

    const registry = new ModuleRegistry().registerAll(modules);
    const auditStore = createAuditStore(database);
    const baselineStore = createConfigBaselineStore(database);
    const savedTemplateStore = createSavedTemplateStore(database);
    const analyticsStore = createAnalyticsStore(database);
    const settings = new SettingsService(createSettingsRepository(database), registry, auditStore);
    const apiTokens = new ApiTokenService(createApiTokenStore(database));
    const box = new SecretBox(randomBytes(32));
    const webhooks = new WebhookService(createWebhookStore(database), box);
    const idempotency = createIdempotencyStore(database);
    const probeOAuth = new WebProbeOAuth();
    let authClock = Date.now();
    const auth = new AuthService({
      oauth: probeOAuth,
      sessions: createSessionStore(database),
      box,
      now: () => authClock,
      config: {
        clientId: "live-probe-client",
        clientSecret: "live-probe-secret",
        redirectUri: "http://127.0.0.1/auth/callback",
        issuer: "https://discord.com",
        sessionTtlMs: 60 * 60_000,
        rotationIntervalMs: 60_000,
        owners: [WEB_USER],
      },
    });
    const access = new GuildAccessService(probeOAuth);
    const dashboard = new DashboardService(
      registry,
      settings,
      createDashboardStore(database),
      auditStore,
      baselineStore,
      savedTemplateStore,
      analyticsStore,
      webhooks,
    );
    // This long script must not throttle itself: the deliberate 429 proof runs
    // on a second handler with tight policies below.
    const generousLimits: RateLimitPolicies = {
      auth: { max: 1_000, windowMs: 60_000 },
      dashboard: { max: 1_000, windowMs: 60_000 },
      write: { max: 1_000, windowMs: 60_000 },
      api: { max: 1_000, windowMs: 60_000 },
      apiToken: { max: 1_000, windowMs: 60_000 },
    };
    const serverDeps = {
      auth,
      access,
      dashboard,
      logger,
      secureCookies: false,
      databaseMode: "postgres" as const,
      apiTokens,
      audit: auditStore,
      webhooks,
      idempotency,
    };
    const handler = createWebHandler({
      ...serverDeps,
      rateLimiter: new RateLimiter(generousLimits),
    });
    const server = createServer(handler);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    // The same drainer the real web runtime starts: the probe does not call the
    // service directly, so the 429/retry/backoff timing is the shipped one.
    const webhookDrainer = startWebhookDrainer(webhooks, logger, 100);

    try {
      const address = server.address();
      assert(address !== null && typeof address === "object", "the widget server has no port");
      const base = `http://127.0.0.1:${address.port}`;

      const signIn = async (): Promise<{ cookie: string; csrf: string }> => {
        const begin = await fetch(`${base}/login`, { redirect: "manual" });
        assert(begin.status === 302, `login returned ${begin.status}`);
        const stateCookie = responseCookie(begin, "keystone_oauth");
        assert(stateCookie !== undefined, "login did not set a state cookie");
        const state = new URL(begin.headers.get("location") ?? "https://invalid.test").searchParams.get(
          "state",
        );
        assert(state !== null, "login URL has no state");

        const callback = await fetch(
          `${base}/auth/callback?code=live-probe&state=${encodeURIComponent(state)}&iss=${encodeURIComponent("https://discord.com")}`,
          { redirect: "manual", headers: { cookie: stateCookie } },
        );
        assert(callback.status === 302, `OAuth callback returned ${callback.status}`);
        const sessionCookie = responseCookie(callback, "keystone_session");
        const csrfCookie = responseCookie(callback, "keystone_csrf");
        assert(
          sessionCookie !== undefined && csrfCookie !== undefined,
          "callback did not set both session cookies",
        );
        return { cookie: `${sessionCookie}; ${csrfCookie}`, csrf: csrfCookie.split("=")[1] ?? "" };
      };

      const { cookie, csrf } = await signIn();

      const editor = await fetch(`${base}/dashboard/guilds/${WEB_GUILD}/settings/ai`, {
        headers: { cookie },
      });
      assert(editor.status === 200, `settings page returned ${editor.status}`);
      const editorHtml = await editor.text();
      assert(editorHtml.includes('name="monthlyBudgetUsd"'), "the page has no number widget");
      assert(editorHtml.includes('name="__rendered"'), "the page has no rendered-field marker");
      assert(editorHtml.includes("Audit trail"), "the page has no audit trail");
      assert(!editorHtml.includes('name="settings"'), "the page still posts one JSON blob");

      const rendered = [
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
      ].join(",");
      const widgetForm = (budget: string): URLSearchParams =>
        new URLSearchParams({
          csrf,
          __rendered: rendered,
          enabled: "on",
          chat: "on",
          monthlyBudgetUsd: budget,
          monthlyRequests: "250",
          maxOutputTokens: "300",
          contextChunks: "3",
          maxDocumentChars: "6000",
          chunkChars: "1200",
          temperature: "0.2",
          retention: "none",
        });

      const saved = await fetch(`${base}/dashboard/guilds/${WEB_GUILD}/settings/ai`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: widgetForm("9").toString(),
      });
      assert(saved.status === 302, `valid form returned ${saved.status}`);
      assert(
        (saved.headers.get("location") ?? "").includes("?saved=1"),
        "a successful save did not redirect with the saved marker",
      );
      const storedAi = await settings.get(WEB_GUILD, "ai");
      assert(storedAi.monthlyBudgetUsd === 9, `stored budget is ${String(storedAi.monthlyBudgetUsd)}`);
      assert(storedAi.chat === true, "stored chat flag is not true");

      const auditRows = await auditStore.list(WEB_GUILD, 10);
      assert(auditRows.length === 1, `expected one audit row, found ${auditRows.length}`);
      assert(auditRows[0]?.actorId === WEB_USER, "the audit row has the wrong actor");
      assert(auditRows[0]?.action === "settings.update", "the audit row has the wrong action");
      assert(
        (auditRows[0]?.data as { source?: string } | undefined)?.source === "dashboard",
        "the audit row does not name the dashboard surface",
      );

      const after = await fetch(`${base}/dashboard/guilds/${WEB_GUILD}/settings/ai?saved=1`, {
        headers: { cookie },
      });
      const afterHtml = await after.text();
      assert(afterHtml.includes("Settings saved"), "the saved notice is missing");
      assert(afterHtml.includes(WEB_USER), "the audit trail does not name the actor");
      assert(afterHtml.includes("monthlyBudgetUsd"), "the audit trail does not name the changed field");

      const rejected = await fetch(`${base}/dashboard/guilds/${WEB_GUILD}/settings/ai`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: widgetForm("5000").toString(),
      });
      assert(rejected.status === 400, `invalid form returned ${rejected.status}`);
      const rejectedHtml = await rejected.text();
      assert(rejectedHtml.includes("monthlyBudgetUsd"), "the rejection does not name the field");
      assert(rejectedHtml.includes("1000"), "the rejection does not state the schema bound");
      assert(rejectedHtml.includes('value="5000"'), "the rejection did not preserve the input");
      assert(
        (await settings.get(WEB_GUILD, "ai")).monthlyBudgetUsd === 9,
        "a rejected form changed the stored budget",
      );
      assert((await auditStore.list(WEB_GUILD, 10)).length === 1, "a rejected form wrote an audit row");

      record({
        id: "web-schema-widgets",
        status: "pass",
        detail:
          "real local HTTP login/session/CSRF + the schema-generated form on Postgres: save 9 persisted, the audit row named the dashboard actor, 5000 was rejected at 400 with the field preserved and no second audit row; OAuth exchange itself used a fake port",
        features: [
          "operations.dashboard-settings-writes",
          "operations.dashboard-field-widgets",
          "operations.settings-audit-trail",
        ],
      });

      // --- Fleet view + template preview/apply over the same real HTTP stack ---
      const fleet = await fetch(`${base}/dashboard/fleet`, { headers: { cookie } });
      assert(fleet.status === 200, `fleet page returned ${fleet.status}`);
      const fleetHtml = await fleet.text();
      assert(fleetHtml.includes("Live probe web two"), "the fleet page does not list the second guild");
      assert(fleetHtml.includes("Strict moderation"), "the fleet page has no templates");

      const fleetForm = (fingerprint?: string): URLSearchParams => {
        const form = new URLSearchParams({ csrf, template: "strict-moderation" });
        form.append("guild", WEB_GUILD);
        form.append("guild", WEB_GUILD_B);
        if (fingerprint) form.set("fingerprint", fingerprint);
        return form;
      };

      const preview = await fetch(`${base}/dashboard/fleet/preview`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: fleetForm().toString(),
      });
      assert(preview.status === 200, `fleet preview returned ${preview.status}`);
      const previewHtml = await preview.text();
      assert(previewHtml.includes("Nothing has been written yet"), "the preview does not promise no writes");
      assert(previewHtml.includes("Automod · Links"), "the preview does not label the changed path");
      const fingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(previewHtml)?.[1];
      assert(fingerprint !== undefined, "the preview has no fingerprint");
      assert(
        (await settings.get(WEB_GUILD, "moderation")).dryRun === true,
        "the preview wrote moderation settings",
      );
      assert((await auditStore.list(WEB_GUILD, 10)).length === 1, "the preview wrote an audit row");
      assert(
        (await auditStore.list(WEB_GUILD_B, 10)).length === 0,
        "the preview wrote an audit row in the second guild",
      );

      const stale = await fetch(`${base}/dashboard/fleet/apply`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: fleetForm("0".repeat(64)).toString(),
      });
      assert(stale.status === 409, `a stale apply returned ${stale.status}`);
      assert(
        (await settings.get(WEB_GUILD, "moderation")).dryRun === true,
        "a stale apply changed moderation settings",
      );
      assert(
        (await auditStore.list(WEB_GUILD_B, 10)).length === 0,
        "a stale apply wrote an audit row",
      );

      const applied = await fetch(`${base}/dashboard/fleet/apply`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: fleetForm(fingerprint).toString(),
      });
      assert(applied.status === 302, `fleet apply returned ${applied.status}`);
      assert(
        (applied.headers.get("location") ?? "") === "/dashboard/fleet?applied=2&failed=0",
        `fleet apply redirected to ${String(applied.headers.get("location"))}`,
      );

      for (const guildId of [WEB_GUILD, WEB_GUILD_B]) {
        const stored = await settings.get(guildId, "moderation");
        assert(stored.dryRun === false, `apply left dryRun on in ${guildId}`);
        assert(
          (stored.automod as Record<string, unknown>).links === "delete",
          `apply left links off in ${guildId}`,
        );
        const rows = await auditStore.list(guildId, 10);
        const row = rows[0];
        assert(row !== undefined, `apply wrote no audit row in ${guildId}`);
        assert(row.actorId === WEB_USER, `the fleet audit row in ${guildId} has the wrong actor`);
        assert(
          (row.data as { source?: string } | undefined)?.source === "dashboard",
          `the fleet audit row in ${guildId} does not name the dashboard`,
        );
        assert(
          JSON.stringify((row.data as { changes?: unknown } | undefined)?.changes).includes(
            "automod.links",
          ),
          `the fleet audit row in ${guildId} does not name the changed setting`,
        );
      }
      assert(
        (await auditStore.list(WEB_GUILD, 10)).length === 2,
        "the first guild should have one widget row and one fleet row",
      );
      assert(
        (await auditStore.list(WEB_GUILD_B, 10)).length === 1,
        "the second guild should have exactly one fleet row",
      );

      const fleetAfter = await fetch(`${base}/dashboard/fleet?applied=2&failed=0`, {
        headers: { cookie },
      });
      assert(fleetAfter.status === 200, `fleet result page returned ${fleetAfter.status}`);
      assert((await fleetAfter.text()).includes("Template applied"), "the fleet page has no success notice");

      record({
        id: "web-fleet-templates",
        status: "pass",
        detail:
          "real local HTTP fleet page on Postgres listed both guilds; the strict-moderation preview showed the diff without writing; a wrong fingerprint was refused at 409; the previewed plan then wrote one moderation row and one dashboard audit row per guild; OAuth exchange itself used a fake port",
        features: ["operations.multi-server-fleet", "operations.config-templates"],
      });

      // --- Config export, import preview/apply and drift over real HTTP ---------
      const exported = await fetch(`${base}/dashboard/guilds/${WEB_GUILD}/config/export`, {
        headers: { cookie },
      });
      assert(exported.status === 200, `config export returned ${exported.status}`);
      assert(
        (exported.headers.get("content-disposition") ?? "").includes(`keystone-config-${WEB_GUILD}.json`),
        "the config export is not offered as a file",
      );
      const configBundle = (await exported.json()) as ConfigBundle;
      assert(configBundle.sourceGuildId === WEB_GUILD, "the bundle names the wrong source guild");
      assert(configBundle.modules.length === registry.listModules().length, "the bundle is missing modules");
      assert(/^[a-f0-9]{64}$/.test(configBundle.checksum), "the bundle has no SHA-256 checksum");

      const importPath = `/dashboard/guilds/${WEB_GUILD_B}/config/import`;
      const upload = multipartFile(csrf, JSON.stringify(configBundle));
      const importPreview = await fetch(`${base}${importPath}/preview`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": upload.contentType },
        body: upload.body,
      });
      assert(importPreview.status === 200, `config preview returned ${importPreview.status}`);
      const importPreviewHtml = await importPreview.text();
      assert(importPreviewHtml.includes("Nothing has been written yet"), "the import preview promises no writes");
      assert(importPreviewHtml.includes("Monthly budget USD"), "the import preview omits the changed setting");
      const importFingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(importPreviewHtml)?.[1];
      assert(importFingerprint !== undefined, "the import preview has no fingerprint");
      assert(
        (await settings.get(WEB_GUILD_B, "ai")).monthlyBudgetUsd === 1,
        "the import preview wrote settings",
      );
      assert(
        (await auditStore.list(WEB_GUILD_B, 10)).length === 1,
        "the import preview wrote an audit row",
      );
      assert((await baselineStore.get(WEB_GUILD_B)) === undefined, "the preview stored a baseline");

      const editedUpload = multipartFile(
        csrf,
        JSON.stringify({ ...configBundle, checksum: "0".repeat(64) }),
      );
      const badImport = await fetch(`${base}${importPath}/preview`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": editedUpload.contentType },
        body: editedUpload.body,
      });
      assert(badImport.status === 400, `an edited bundle returned ${badImport.status}`);
      assert((await badImport.text()).toLowerCase().includes("checksum"), "the refusal does not name the checksum");
      assert(
        (await settings.get(WEB_GUILD_B, "ai")).monthlyBudgetUsd === 1,
        "an edited bundle changed settings",
      );

      const staleImport = await fetch(`${base}${importPath}/apply`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrf,
          fingerprint: "0".repeat(64),
          bundle: JSON.stringify(configBundle),
        }).toString(),
      });
      assert(staleImport.status === 409, `a stale import returned ${staleImport.status}`);
      assert((await baselineStore.get(WEB_GUILD_B)) === undefined, "a stale import stored a baseline");

      const appliedImport = await fetch(`${base}${importPath}/apply`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrf,
          fingerprint: importFingerprint,
          bundle: JSON.stringify(configBundle),
        }).toString(),
      });
      assert(appliedImport.status === 302, `config apply returned ${appliedImport.status}`);
      assert(
        (appliedImport.headers.get("location") ?? "") ===
          `/dashboard/guilds/${WEB_GUILD_B}/config/drift?imported=1&failed=0`,
        `config apply redirected to ${String(appliedImport.headers.get("location"))}`,
      );
      const importedAi = await settings.get(WEB_GUILD_B, "ai");
      assert(importedAi.monthlyBudgetUsd === 9, `imported budget is ${String(importedAi.monthlyBudgetUsd)}`);
      assert(importedAi.enabled === true && importedAi.chat === true, "the import did not enable AI chat");
      const importRows = await auditStore.list(WEB_GUILD_B, 10);
      assert(importRows.length === 2, `the import should add one audit row, found ${importRows.length}`);
      assert(importRows[0]?.actorId === WEB_USER, "the import audit row has the wrong actor");
      assert(
        (importRows[0]?.data as { source?: string } | undefined)?.source === "dashboard",
        "the import audit row does not name the dashboard",
      );
      assert(
        JSON.stringify((importRows[0]?.data as { changes?: unknown } | undefined)?.changes).includes(
          "monthlyBudgetUsd",
        ),
        "the import audit row does not name the changed setting",
      );
      const baseline = await baselineStore.get(WEB_GUILD_B);
      assert(baseline?.checksum === configBundle.checksum, "the applied bundle is not the stored baseline");

      const cleanDrift = await fetch(`${base}/dashboard/guilds/${WEB_GUILD_B}/config/drift?imported=1&failed=0`, {
        headers: { cookie },
      });
      assert(cleanDrift.status === 200, `drift page returned ${cleanDrift.status}`);
      const cleanDriftHtml = await cleanDrift.text();
      assert(cleanDriftHtml.includes("Imported: 1 module setting"), "the drift page has no import notice");
      assert(cleanDriftHtml.includes("No drift"), "a just-imported guild reports drift");

      await settings.update(WEB_GUILD_B, "ai", { monthlyBudgetUsd: 3 });
      const drifted = await fetch(`${base}/dashboard/guilds/${WEB_GUILD_B}/config/drift`, {
        headers: { cookie },
      });
      assert(drifted.status === 200, `drifted page returned ${drifted.status}`);
      const driftedHtml = await drifted.text();
      assert(driftedHtml.includes("Monthly budget USD"), "drift does not name the changed setting");
      assert(driftedHtml.includes("1 change"), "drift did not count one change");
      assert(driftedHtml.includes("<code>9</code>"), "drift does not show the baseline value");
      assert(driftedHtml.includes("<code>3</code>"), "drift does not show the live value");

      record({
        id: "web-config-export-import-drift",
        status: "pass",
        detail:
          "real local HTTP on Postgres: exported a 12-module checksummed bundle as a file; uploaded it to another guild via multipart and previewed the diff without writing; an edited checksum was refused at 400 and a wrong fingerprint at 409; apply wrote one AI row with one dashboard audit row and stored the baseline; drift showed no changes, then exactly one changed value after an out-of-band update; OAuth exchange itself used a fake port",
        features: ["operations.config-portability"],
      });

      // --- Saved templates: save, list, preview, apply, invalidate, delete ---
      const templatesPath = `/dashboard/guilds/${WEB_GUILD}/templates`;
      const createdTemplate = await fetch(`${base}${templatesPath}`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrf,
          name: "Probe snapshot",
          description: "Saved from the live probe guild",
        }).toString(),
      });
      assert(createdTemplate.status === 302, `saving a template returned ${createdTemplate.status}`);
      const templateLocation = createdTemplate.headers.get("location") ?? "";
      const templateId = /\/templates\/([0-9a-f-]{36})\?created=1$/.exec(templateLocation)?.[1];
      assert(templateId !== undefined, `the create redirect has no template id: ${templateLocation}`);

      const createRow = (await auditStore.list(WEB_GUILD, 20)).find(
        (row) => row.action === "template.create" && row.targetId === templateId,
      );
      assert(createRow?.actorId === WEB_USER, "the template create row has the wrong actor");
      assert(
        (createRow?.data as { source?: string } | undefined)?.source === "dashboard",
        "the template create row does not name the dashboard",
      );

      const templateList = await fetch(`${base}${templatesPath}`, { headers: { cookie } });
      assert(templateList.status === 200, `the template list returned ${templateList.status}`);
      assert(
        (await templateList.text()).includes("Probe snapshot"),
        "the saved template is not listed",
      );

      const templateEditor = await fetch(`${base}${templateLocation}`, { headers: { cookie } });
      assert(templateEditor.status === 200, `the template page returned ${templateEditor.status}`);
      const templateEditorHtml = await templateEditor.text();
      assert(
        templateEditorHtml.includes("Template saved from this server"),
        "the template page has no created notice",
      );
      assert(
        templateEditorHtml.includes("Apply to servers"),
        "the template page has no apply selection",
      );

      await settings.update(WEB_GUILD, "ai", { monthlyBudgetUsd: 5 });
      await settings.update(WEB_GUILD_B, "ai", { monthlyBudgetUsd: 2 });
      const savedSelection = new URLSearchParams({ csrf });
      savedSelection.append("guild", WEB_GUILD);
      savedSelection.append("guild", WEB_GUILD_B);
      const previewPath = `${templatesPath}/${templateId}/preview`;
      const applyPath = `${templatesPath}/${templateId}/apply`;
      const applyForm = (fingerprint: string): URLSearchParams => {
        const form = new URLSearchParams(savedSelection);
        form.set("fingerprint", fingerprint);
        return form;
      };

      const savedPreview = await fetch(`${base}${previewPath}`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: savedSelection.toString(),
      });
      assert(savedPreview.status === 200, `saved-template preview returned ${savedPreview.status}`);
      const savedPreviewHtml = await savedPreview.text();
      assert(
        savedPreviewHtml.includes("Nothing has been written yet"),
        "the saved-template preview claims writes",
      );
      assert(
        savedPreviewHtml.includes("Monthly budget USD"),
        "the saved-template preview does not label the changed setting",
      );
      const savedFingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(
        savedPreviewHtml,
      )?.[1];
      assert(savedFingerprint !== undefined, "the saved-template preview has no fingerprint");
      assert(
        (await settings.get(WEB_GUILD, "ai")).monthlyBudgetUsd === 5,
        "the saved-template preview wrote settings",
      );

      const tamperedSaved = await fetch(`${base}${applyPath}`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: applyForm("0".repeat(64)).toString(),
      });
      assert(tamperedSaved.status === 409, `a tampered saved-template apply returned ${tamperedSaved.status}`);
      assert(
        (await settings.get(WEB_GUILD, "ai")).monthlyBudgetUsd === 5,
        "a tampered saved-template apply wrote settings",
      );

      const editedTemplate = await fetch(`${base}${templatesPath}/${templateId}`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrf,
          name: "Probe snapshot v2",
          description: "Edited by the live probe",
        }).toString(),
      });
      assert(editedTemplate.status === 302, `editing a template returned ${editedTemplate.status}`);
      const updateRow = (await auditStore.list(WEB_GUILD, 20)).find(
        (row) => row.action === "template.update" && row.targetId === templateId,
      );
      assert(updateRow?.actorId === WEB_USER, "the template edit row has the wrong actor");

      const staleSaved = await fetch(`${base}${applyPath}`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: applyForm(savedFingerprint).toString(),
      });
      assert(staleSaved.status === 409, `a stale saved-template apply returned ${staleSaved.status}`);

      const freshPreview = await fetch(`${base}${previewPath}`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: savedSelection.toString(),
      });
      const freshFingerprint = /name="fingerprint" value="([a-f0-9]{64})"/.exec(
        await freshPreview.text(),
      )?.[1];
      assert(freshFingerprint !== undefined, "the re-preview has no fingerprint");
      assert(freshFingerprint !== savedFingerprint, "the edit did not invalidate the old preview");
      const auditBeforeA = (await auditStore.list(WEB_GUILD, 100)).length;
      const auditBeforeB = (await auditStore.list(WEB_GUILD_B, 100)).length;

      const appliedSaved = await fetch(`${base}${applyPath}`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: applyForm(freshFingerprint).toString(),
      });
      assert(appliedSaved.status === 302, `saved-template apply returned ${appliedSaved.status}`);
      assert(
        (appliedSaved.headers.get("location") ?? "") ===
          `${templatesPath}/${templateId}?applied=2&failed=0`,
        `saved-template apply redirected to ${String(appliedSaved.headers.get("location"))}`,
      );
      assert(
        (await settings.get(WEB_GUILD, "ai")).monthlyBudgetUsd === 9,
        "the saved template did not restore the first guild's budget",
      );
      assert(
        (await settings.get(WEB_GUILD_B, "ai")).monthlyBudgetUsd === 9,
        "the saved template did not write the second guild's budget",
      );
      for (const [guildId, before] of [
        [WEB_GUILD, auditBeforeA],
        [WEB_GUILD_B, auditBeforeB],
      ] as const) {
        const rows = await auditStore.list(guildId, 100);
        assert(rows.length === before + 1, `expected one apply row in ${guildId}, found ${rows.length - before}`);
        const row = rows[0];
        assert(row?.actorId === WEB_USER, `the saved-template row in ${guildId} has the wrong actor`);
        assert(row?.action === "settings.update", `the saved-template row in ${guildId} is not a settings write`);
        assert(
          (row?.data as { source?: string } | undefined)?.source === "dashboard",
          `the saved-template row in ${guildId} does not name the dashboard`,
        );
        assert(
          JSON.stringify((row?.data as { changes?: unknown } | undefined)?.changes).includes(
            "monthlyBudgetUsd",
          ),
          `the saved-template row in ${guildId} does not name the changed setting`,
        );
      }

      const createdInvalid = await fetch(`${base}${templatesPath}`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf, name: "Probe invalid" }).toString(),
      });
      const invalidId = /\/templates\/([0-9a-f-]{36})\?created=1$/.exec(
        createdInvalid.headers.get("location") ?? "",
      )?.[1];
      assert(invalidId !== undefined, "the invalid-template create has no id");
      const invalidRow = await savedTemplateStore.get(WEB_GUILD, invalidId);
      assert(invalidRow !== undefined, "the invalid-template row was not stored");
      await savedTemplateStore.update(WEB_GUILD, invalidId, {
        modules: invalidRow.modules.map((module) =>
          module.id === "ai"
            ? { ...module, settings: { ...module.settings, monthlyBudgetUsd: 5_000 } }
            : module,
        ),
        at: Date.now(),
      });

      const invalidEditor = await fetch(`${base}${templatesPath}/${invalidId}`, {
        headers: { cookie },
      });
      assert(invalidEditor.status === 200, `the invalid template page returned ${invalidEditor.status}`);
      const invalidHtml = await invalidEditor.text();
      assert(invalidHtml.includes("no longer validates"), "the page does not report the schema drift");
      assert(!invalidHtml.includes("Apply to servers"), "an invalid template still offers apply");

      const invalidPreview = await fetch(`${base}${templatesPath}/${invalidId}/preview`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf, guild: WEB_GUILD }).toString(),
      });
      assert(invalidPreview.status === 200, `the invalid preview returned ${invalidPreview.status}`);
      assert(
        (await invalidPreview.text()).includes("does not validate"),
        "the invalid preview does not explain the refusal",
      );

      const invalidApply = await fetch(`${base}${templatesPath}/${invalidId}/apply`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrf,
          guild: WEB_GUILD,
          fingerprint: "0".repeat(64),
        }).toString(),
      });
      assert(invalidApply.status === 400, `an invalid template apply returned ${invalidApply.status}`);
      assert(
        (await settings.get(WEB_GUILD, "ai")).monthlyBudgetUsd === 9,
        "an invalid template changed settings",
      );

      const deletedTemplate = await fetch(`${base}${templatesPath}/${templateId}/delete`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf }).toString(),
      });
      assert(deletedTemplate.status === 302, `deleting a template returned ${deletedTemplate.status}`);
      const deleteRow = (await auditStore.list(WEB_GUILD, 20))[0];
      assert(deleteRow?.action === "template.delete", "the delete is not the newest audit row");
      assert(deleteRow?.actorId === WEB_USER, "the template delete row has the wrong actor");
      await fetch(`${base}${templatesPath}/${invalidId}/delete`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf }).toString(),
      });
      const afterDelete = await fetch(`${base}${templatesPath}`, { headers: { cookie } });
      const afterDeleteHtml = await afterDelete.text();
      assert(!afterDeleteHtml.includes("Probe snapshot v2"), "the deleted template is still listed");
      assert(!afterDeleteHtml.includes("Probe invalid"), "the invalid template is still listed");

      record({
        id: "web-saved-templates",
        status: "pass",
        detail:
          "real local HTTP on Postgres: saved a template from one guild, listed it, previewed a diff for two guilds without writing, refused a tampered fingerprint at 409 and a stale preview after an edit at 409, then applied one write per guild with one dashboard audit row each; an out-of-band schema-invalid row was reported and refused at 400; create/update/delete were audited; OAuth exchange itself used a fake port",
        features: ["operations.config-templates", "operations.multi-server-fleet"],
      });

      // --- Dashboard analytics aggregates over the real ledgers -------------
      await database.runner.exec(`
        DELETE FROM logging_events WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
        DELETE FROM case_events WHERE case_id IN (SELECT id FROM cases WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}'));
        DELETE FROM cases WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
        DELETE FROM invite_joins WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
        DELETE FROM tickets WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
        DELETE FROM command_usage WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
      `);
      await database.runner.exec(`
        INSERT INTO logging_events (guild_id, kind, summary, created_at) VALUES
          ('${WEB_GUILD}', 'message_delete', 'deleted one', now() - interval '3 hours'),
          ('${WEB_GUILD}', 'message_delete', 'deleted two', now() - interval '2 hours'),
          ('${WEB_GUILD}', 'message_delete', 'deleted three', now() - interval '1 hour'),
          ('${WEB_GUILD}', 'message_edit', 'edited one', now() - interval '2 hours'),
          ('${WEB_GUILD}', 'message_edit', 'edited two', now() - interval '1 hour'),
          ('${WEB_GUILD}', 'member_join', 'joined', now() - interval '1 hour'),
          ('${WEB_GUILD}', 'member_leave', 'left', now() - interval '30 minutes');

        INSERT INTO cases (guild_id, case_number, actor_id, target_id, action, rule, state, created_at) VALUES
          ('${WEB_GUILD}', 90001, 'probe-mod', 'probe-user-1', 'alert', 'automod.links', 'open', now() - interval '2 hours'),
          ('${WEB_GUILD}', 90002, 'probe-mod', 'probe-user-2', 'alert', 'automod.profanity', 'open', now() - interval '1 hour'),
          ('${WEB_GUILD}', 90003, 'probe-mod', 'probe-user-3', 'warn', NULL, 'closed', now() - interval '3 hours');

        INSERT INTO invite_joins (guild_id, user_id, inviter_id, code, fake_reasons, joined_at, left_at) VALUES
          ('${WEB_GUILD}', 'probe-invite-1', 'probe-inviter', 'probe-code', '[]'::jsonb, now() - interval '2 hours', NULL),
          ('${WEB_GUILD}', 'probe-invite-2', 'probe-inviter', 'probe-code', '["account_age"]'::jsonb, now() - interval '1 hour', now() - interval '30 minutes');

        INSERT INTO tickets (guild_id, channel_id, opener_id, state, subject, created_at, sla_due_at, closed_at) VALUES
          ('${WEB_GUILD}', 'probe-channel-1', 'probe-user-1', 'open', 'open one', now() - interval '2 hours', NULL, NULL),
          ('${WEB_GUILD}', 'probe-channel-2', 'probe-user-2', 'open', 'open two', now() - interval '1 hour', NULL, NULL),
          ('${WEB_GUILD}', 'probe-channel-3', 'probe-user-3', 'closed', 'closed one', now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour');

        INSERT INTO command_usage (guild_id, command, path, status, duration_ms, created_at) VALUES
          ('${WEB_GUILD}', 'ping', '', 'ok', 100, now() - interval '30 minutes'),
          ('${WEB_GUILD}', 'ping', '', 'blocked', 300, now() - interval '20 minutes'),
          ('${WEB_GUILD}', 'analytics', 'overview', 'ok', 200, now() - interval '10 minutes');
      `);

      const analyticsApi = await fetch(
        `${base}/api/v1/guilds/${WEB_GUILD}/analytics?days=30`,
        { headers: { cookie } },
      );
      assert(analyticsApi.status === 200, `analytics API returned ${analyticsApi.status}`);
      const analyticsSnapshot = (await analyticsApi.json()) as {
        overview: Record<string, number>;
        members: Record<string, number>;
        messages: Record<string, number>;
        commands: { total: number; ok: number; blocked: number; averageLatencyMs: number | null };
        tickets: Record<string, number | null>;
        sources: { id: string; rows: number }[];
        window: { days: number };
      };
      assert(analyticsSnapshot.window.days === 30, "the analytics API ignored the window");
      assert(analyticsSnapshot.overview.loggedEvents === 7, `logged events: ${analyticsSnapshot.overview.loggedEvents}`);
      assert(analyticsSnapshot.overview.activeCases === 2, "active cases did not match the seeded open cases");
      assert(analyticsSnapshot.overview.casesOpened === 3, "cases opened did not match the window rows");
      assert(analyticsSnapshot.overview.inviteJoins === 2, "invite joins did not match");
      assert(analyticsSnapshot.overview.retainedInvites === 1, "invite retention did not match");
      assert(analyticsSnapshot.overview.commandsRun === 3, "command runs did not match");
      assert(analyticsSnapshot.overview.openTickets === 2, "open tickets did not match current state");
      assert(analyticsSnapshot.members.loggedJoins === 1 && analyticsSnapshot.members.loggedLeaves === 1, "member event counts did not match");
      assert(analyticsSnapshot.messages.deleted === 3 && analyticsSnapshot.messages.edited === 2, "message counts did not match");
      assert(analyticsSnapshot.messages.contentFilterCases === 2, "content-filter cases did not match");
      assert(
        analyticsSnapshot.commands.total === 3 &&
          analyticsSnapshot.commands.ok === 2 &&
          analyticsSnapshot.commands.blocked === 1 &&
          analyticsSnapshot.commands.averageLatencyMs === 200,
        `command aggregate was ${JSON.stringify(analyticsSnapshot.commands)}`,
      );
      assert(analyticsSnapshot.tickets.opened === 3 && analyticsSnapshot.tickets.closedInWindow === 1, "ticket window counts did not match");
      assert(analyticsSnapshot.tickets.averageCloseMinutes === 120, `average close was ${String(analyticsSnapshot.tickets.averageCloseMinutes)}`);
      assert(analyticsSnapshot.tickets.slaBreached === 1, "SLA breach did not match the seeded close");
      assert(
        analyticsSnapshot.sources.find((source) => source.id === "logging_events")?.rows === 7,
        "the source table count did not match the seeded rows",
      );

      const analyticsPage = await fetch(
        `${base}/dashboard/guilds/${WEB_GUILD}/analytics?days=30`,
        { headers: { cookie } },
      );
      assert(analyticsPage.status === 200, `analytics page returned ${analyticsPage.status}`);
      const analyticsHtml = await analyticsPage.text();
      assert(analyticsHtml.includes("Source rows"), "the analytics page has no source table");
      assert(analyticsHtml.includes("logging_events"), "the analytics page does not name its source");
      assert(analyticsHtml.includes("<b>7</b>"), "the analytics page does not show logged events");
      assert(analyticsHtml.includes("Open tickets (current)"), "the page does not distinguish current state");
      assert(analyticsHtml.includes("not estimates"), "the page does not caveat that counts are retained rows");
      assert(!analyticsHtml.includes("No rows in this window"), "a populated window reported no rows");

      const emptyAnalytics = await fetch(
        `${base}/dashboard/guilds/${WEB_GUILD_B}/analytics?days=7`,
        { headers: { cookie } },
      );
      assert(emptyAnalytics.status === 200, `empty analytics page returned ${emptyAnalytics.status}`);
      const emptyAnalyticsHtml = await emptyAnalytics.text();
      assert(emptyAnalyticsHtml.includes("No rows in this window"), "an empty window did not say so");
      assert(emptyAnalyticsHtml.includes("not an estimate of all Discord activity"), "empty analytics overclaims");

      const emptyAnalyticsApi = await fetch(
        `${base}/api/v1/guilds/${WEB_GUILD_B}/analytics?days=7`,
        { headers: { cookie } },
      );
      assert(emptyAnalyticsApi.status === 200, `empty analytics API returned ${emptyAnalyticsApi.status}`);
      const emptySnapshot = (await emptyAnalyticsApi.json()) as { overview: Record<string, number> };
      assert(emptySnapshot.overview.loggedEvents === 0 && emptySnapshot.overview.commandsRun === 0, "empty analytics returned nonzero counts");

      for (const days of ["91", "abc"]) {
        const refused = await fetch(
          `${base}/dashboard/guilds/${WEB_GUILD}/analytics?days=${days}`,
          { headers: { cookie } },
        );
        assert(refused.status === 400, `analytics days=${days} returned ${refused.status}`);
        const refusedApi = await fetch(
          `${base}/api/v1/guilds/${WEB_GUILD}/analytics?days=${days}`,
          { headers: { cookie } },
        );
        assert(refusedApi.status === 400, `analytics API days=${days} returned ${refusedApi.status}`);
      }

      const signedOutAnalytics = await fetch(
        `${base}/api/v1/guilds/${WEB_GUILD}/analytics`,
      );
      assert(signedOutAnalytics.status === 401, `signed-out analytics returned ${signedOutAnalytics.status}`);

      record({
        id: "web-analytics-aggregates",
        status: "pass",
        detail:
          "real local HTTP on Postgres: seeded 7 audit rows, 3 cases, 2 invite joins, 3 tickets and 3 command runs in the real tables, then the dashboard API and page matched every aggregate (7 logged events, 2 active cases, 3 cases opened, 2 invite joins/1 retained, 3 command runs/2 ok/1 blocked/200ms avg, 2 open tickets, 120-minute average close and 1 SLA breach); the source table counts matched; an empty guild said no rows instead of inventing activity; days=91/abc were refused at 400 and signed-out reads at 401; OAuth exchange itself used a fake port",
        features: ["operations.dashboard-analytics"],
      });

      // --- Scoped API tokens: issue, authorize, limit, revoke -----------------
      await database.runner.exec(
        `DELETE FROM api_tokens WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');`,
      );

      const tokensPath = `/dashboard/guilds/${WEB_GUILD}/tokens`;
      const tokenListPage = await fetch(`${base}${tokensPath}`, { headers: { cookie } });
      assert(tokenListPage.status === 200, `the token page returned ${tokenListPage.status}`);
      const tokenListHtml = await tokenListPage.text();
      assert(tokenListHtml.includes("No tokens have been issued"), "the empty token page is not honest");

      const tokenForm = new URLSearchParams({
        csrf,
        name: "probe automation",
        expiresInDays: "30",
      });
      tokenForm.append("scope", "guild:read");
      const issuedResponse = await fetch(`${base}${tokensPath}`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: tokenForm.toString(),
      });
      assert(issuedResponse.status === 200, `token issue returned ${issuedResponse.status}`);
      const issuedHtml = await issuedResponse.text();
      const secret = /<pre>(keystone_[A-Za-z0-9_-]+)<\/pre>/.exec(issuedHtml)?.[1];
      assert(secret !== undefined, "the issued token secret was not shown once");

      const tokenRows = await database.runner.query<{
        id: string;
        token_hash: string;
        scopes: unknown;
        last_used_at: Date | null;
      }>(
        `SELECT id, token_hash, scopes, last_used_at FROM api_tokens WHERE guild_id = '${WEB_GUILD}'`,
      );
      assert(tokenRows.length === 1, `expected one token row, saw ${tokenRows.length}`);
      const tokenRow = tokenRows[0]!;
      assert(
        tokenRow.token_hash === sha256(secret),
        "the stored token hash does not match the secret",
      );
      const plaintextRows = await database.runner.query<{ hits: string }>(
        `SELECT count(*)::text AS hits FROM api_tokens WHERE token_hash = '${secret.replaceAll("'", "''")}'`,
      );
      assert(plaintextRows[0]?.hits === "0", "the plaintext token secret is in the database");
      assert(!JSON.stringify(tokenRow).includes(secret), "the token row leaked the secret");

      const listedAfterIssue = await fetch(`${base}${tokensPath}`, { headers: { cookie } });
      const listedHtml = await listedAfterIssue.text();
      assert(!listedHtml.includes(secret), "the token list repeated the one-time secret");
      assert(listedHtml.includes("probe automation"), "the issued token is not listed");
      assert(listedHtml.includes("guild:read"), "the issued token does not show its scope");

      const bearer = { authorization: `Bearer ${secret}` };
      const anonymousMe = await fetch(`${base}/api/v1/me`);
      assert(anonymousMe.status === 401, `anonymous /api/v1/me returned ${anonymousMe.status}`);
      const bogusMe = await fetch(`${base}/api/v1/me`, {
        headers: { authorization: "Bearer keystone_not-a-real-secret-value" },
      });
      assert(bogusMe.status === 401, `a bogus bearer returned ${bogusMe.status}`);

      const tokenIdentity = await fetch(`${base}/api/v1/me`, { headers: bearer });
      assert(tokenIdentity.status === 200, `token /api/v1/me returned ${tokenIdentity.status}`);
      const identity = (await tokenIdentity.json()) as {
        token?: { id: string; guildId: string; scopes: string[] };
      };
      assert(identity.token?.id === tokenRow.id, "the token identity names a different row");
      assert(identity.token?.guildId === WEB_GUILD, "the token identity names a different guild");
      assert(
        identity.token?.scopes.length === 1 && identity.token.scopes[0] === "guild:read",
        "the token identity does not echo its scopes",
      );

      const tokenOverview = await fetch(`${base}/api/v1/guilds/${WEB_GUILD}/overview`, {
        headers: bearer,
      });
      assert(
        tokenOverview.status === 200,
        `the guild:read token could not use the session overview handler (${tokenOverview.status})`,
      );
      const tokenGuilds = await fetch(`${base}/api/v1/guilds`, { headers: bearer });
      assert(tokenGuilds.status === 200, `the token guild list returned ${tokenGuilds.status}`);
      const tokenGuildList = (await tokenGuilds.json()) as { guilds: { id: string }[] };
      assert(
        tokenGuildList.guilds.length === 1 && tokenGuildList.guilds[0]?.id === WEB_GUILD,
        "the token guild list did not stay inside its guild",
      );

      const wrongScope = await fetch(`${base}/api/v1/guilds/${WEB_GUILD}/analytics`, {
        headers: bearer,
      });
      assert(wrongScope.status === 403, `a wrong-scope call returned ${wrongScope.status}`);
      const wrongScopeBody = (await wrongScope.json()) as { error?: { code?: string } };
      assert(
        wrongScopeBody.error?.code === "token_scope_forbidden",
        "the wrong-scope refusal did not name the scope",
      );
      const foreignGuild = await fetch(`${base}/api/v1/guilds/${WEB_GUILD_B}/overview`, {
        headers: bearer,
      });
      assert(foreignGuild.status === 403, `a foreign-guild call returned ${foreignGuild.status}`);

      const usedRows = await database.runner.query<{ last_used_at: Date | null }>(
        `SELECT last_used_at FROM api_tokens WHERE id = '${tokenRow.id}'`,
      );
      assert(usedRows[0]?.last_used_at !== null, "the token's first use was not recorded");

      // A tight per-token window on a second handler: 429, then recovery in the
      // next fixed window without waiting on the wall clock.
      let tokenClock = Date.now();
      const tokenLimited = createServer(
        createWebHandler({
          ...serverDeps,
          rateLimiter: new RateLimiter(
            { ...generousLimits, apiToken: { max: 2, windowMs: 1_500 } },
            () => tokenClock,
          ),
        }),
      );
      await new Promise<void>((resolve, reject) => {
        tokenLimited.once("error", reject);
        tokenLimited.listen(0, "127.0.0.1", () => resolve());
      });
      try {
        const limitedAddress = tokenLimited.address();
        assert(
          limitedAddress !== null && typeof limitedAddress === "object",
          "the token-limited server has no port",
        );
        const limitedBase = `http://127.0.0.1:${limitedAddress.port}`;
        for (let index = 0; index < 2; index += 1) {
          assert(
            (await fetch(`${limitedBase}/api/v1/me`, { headers: bearer })).status === 200,
            "the per-token limit fired early",
          );
        }
        const limited = await fetch(`${limitedBase}/api/v1/me`, { headers: bearer });
        assert(limited.status === 429, `a spent per-token window returned ${limited.status}`);
        assert(limited.headers.get("retry-after") === "2", "the 429 had no Retry-After");
        tokenClock += 1_500;
        assert(
          (await fetch(`${limitedBase}/api/v1/me`, { headers: bearer })).status === 200,
          "the per-token window did not recover",
        );
      } finally {
        tokenLimited.closeAllConnections();
        await new Promise<void>((resolve) => tokenLimited.close(() => resolve()));
      }

      const specResponse = await fetch(`${base}/api/v1/openapi.json`);
      assert(specResponse.status === 200, `the OpenAPI document returned ${specResponse.status}`);
      const spec = (await specResponse.json()) as {
        openapi: string;
        paths: Record<string, Record<string, { security?: unknown[]; "x-keystone-scopes"?: string[] }>>;
      };
      assert(spec.openapi === "3.1.0", `the OpenAPI version is ${spec.openapi}`);
      const analyticsOperation = spec.paths["/api/v1/guilds/{guildId}/analytics"]?.get;
      assert(analyticsOperation !== undefined, "the document omits the analytics route");
      assert(
        analyticsOperation.security?.length === 2,
        "the document does not name both principals",
      );
      assert(
        JSON.stringify(analyticsOperation["x-keystone-scopes"]) === JSON.stringify(["analytics:read"]),
        "the document does not name the route's scope",
      );

      const revokeResponse = await fetch(`${base}${tokensPath}/${tokenRow.id}/revoke`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf }).toString(),
      });
      assert(revokeResponse.status === 302, `token revoke returned ${revokeResponse.status}`);
      assert(
        (await fetch(`${base}/api/v1/me`, { headers: bearer })).status === 401,
        "the revoked token still works",
      );
      const duplicateRevoke = await fetch(`${base}${tokensPath}/${tokenRow.id}/revoke`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ csrf }).toString(),
      });
      assert(duplicateRevoke.status === 404, `a second revoke returned ${duplicateRevoke.status}`);

      const tokenAudit = await auditStore.list(WEB_GUILD, 20);
      const issueRow = tokenAudit.find(
        (row) => row.action === "api_token.issue" && row.targetId === tokenRow.id,
      );
      const revokeRow = tokenAudit.find(
        (row) => row.action === "api_token.revoke" && row.targetId === tokenRow.id,
      );
      assert(issueRow?.actorId === WEB_USER, "the issue audit row has the wrong actor");
      assert(
        (issueRow?.data as { source?: string } | undefined)?.source === "dashboard",
        "the issue audit row has no dashboard source",
      );
      assert(revokeRow?.actorId === WEB_USER, "the revoke audit row has the wrong actor");
      assert(
        tokenAudit.filter((row) => row.action === "api_token.revoke" && row.targetId === tokenRow.id)
          .length === 1,
        "the duplicate revoke wrote a second audit row",
      );

      record({
        id: "web-api-tokens",
        status: "pass",
        detail:
          "real local HTTP on Postgres: an owner issued a guild:read token from the dashboard, the secret was shown once and only its SHA-256 hash reached Postgres; the token authorized the existing overview and guild-list handlers and returned its own identity at /api/v1/me while a foreign-guild call and a wrong-scope analytics call were 403 and anonymous/bogus bearers were 401; the token's first use was stamped; a tight per-token window returned 429 + Retry-After and recovered in the next window; revoke then returned 401, a second revoke wrote no row and exactly one api_token.issue and one api_token.revoke dashboard audit row named the owner; /api/v1/openapi.json was served from the route table. OAuth exchange used a fake port",
        features: ["operations.scoped-api-tokens"],
      });

      // --- Webhooks and Idempotency-Key ---------------------------------------
      await database.runner.exec(`
        DELETE FROM webhook_subscriptions WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
        DELETE FROM job_receipts WHERE idempotency_key LIKE 'http:token:%';
      `);

      const receivedHooks: { headers: Record<string, string | string[] | undefined>; body: string }[] =
        [];
      const hookReceiver = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        req.on("end", () => {
          receivedHooks.push({ headers: req.headers, body });
          res.statusCode = 200;
          res.end("ok");
        });
      });
      let failedAttempts = 0;
      const failingReceiver = createServer((req, res) => {
        failedAttempts += 1;
        req.resume();
        req.on("end", () => {
          res.statusCode = 500;
          res.end("nope");
        });
      });
      for (const [label, receiver] of [
        ["hook", hookReceiver],
        ["failing", failingReceiver],
      ] as const) {
        await new Promise<void>((resolve, reject) => {
          receiver.once("error", reject);
          receiver.listen(0, "127.0.0.1", () => resolve());
        });
        const bound = receiver.address();
        assert(bound !== null && typeof bound === "object", `the ${label} receiver has no port`);
      }
      const hookPort = (hookReceiver.address() as { port: number }).port;
      const failingPort = (failingReceiver.address() as { port: number }).port;

      const waitFor = async (
        label: string,
        check: () => Promise<boolean> | boolean,
        timeoutMs = 10_000,
      ): Promise<void> => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          if (await check()) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert(false, `timed out waiting for ${label}`);
      };

      const signatureVerifies = (
        hook: { headers: Record<string, string | string[] | undefined>; body: string },
        signingSecret: string,
      ): boolean => {
        const header = hook.headers["x-keystone-signature"];
        if (typeof header !== "string") return false;
        const parts = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
        if (!parts) return false;
        // Independent HMAC: the probe does not reuse the sender's verifier.
        const expected = createHmac("sha256", signingSecret)
          .update(`${parts[1]}.${hook.body}`)
          .digest("hex");
        const left = Buffer.from(expected);
        const right = Buffer.from(parts[2] as string);
        return left.length === right.length && timingSafeEqual(left, right);
      };

      try {
        const hooksPath = `/dashboard/guilds/${WEB_GUILD}/webhooks`;
        const emptyHooks = await fetch(`${base}${hooksPath}`, { headers: { cookie } });
        assert(emptyHooks.status === 200, `the webhooks page returned ${emptyHooks.status}`);
        assert(
          (await emptyHooks.text()).includes("No webhook endpoints"),
          "the empty webhook page is not honest",
        );

        const insecure = await fetch(`${base}${hooksPath}`, {
          method: "POST",
          redirect: "manual",
          headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ csrf, url: "http://example.com/hook" }).toString(),
        });
        assert(insecure.status === 400, `an insecure webhook URL returned ${insecure.status}`);

        const hookForm = new URLSearchParams({ csrf, url: `http://127.0.0.1:${hookPort}/hook` });
        hookForm.append("event", "settings.updated");
        const hookCreate = await fetch(`${base}${hooksPath}`, {
          method: "POST",
          redirect: "manual",
          headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
          body: hookForm.toString(),
        });
        assert(hookCreate.status === 200, `webhook create returned ${hookCreate.status}`);
        const hookSecret = /<pre>(whsec_[A-Za-z0-9_-]+)<\/pre>/.exec(await hookCreate.text())?.[1];
        assert(hookSecret !== undefined, "the signing secret was not shown once");

        const hookRows = await database.runner.query<{
          id: string;
          secret: string;
          events: unknown;
        }>(
          `SELECT id, secret, events FROM webhook_subscriptions WHERE guild_id = '${WEB_GUILD}'`,
        );
        assert(hookRows.length === 1, `expected one subscription, saw ${hookRows.length}`);
        const hookId = hookRows[0]!.id;
        assert(
          hookRows[0]!.secret !== hookSecret && hookRows[0]!.secret.startsWith("v1."),
          "the signing secret is not sealed at rest",
        );
        assert(
          !JSON.stringify(hookRows).includes(hookSecret),
          "the plaintext signing secret is in the database",
        );

        const hookTest = await fetch(`${base}${hooksPath}/${hookId}/test`, {
          method: "POST",
          redirect: "manual",
          headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ csrf }).toString(),
        });
        assert(hookTest.status === 302, `the webhook test ping returned ${hookTest.status}`);
        await waitFor("the test delivery", () => receivedHooks.length >= 1);
        const ping = receivedHooks[0]!;
        assert(ping.headers["x-keystone-event"] === "webhook.test", "the ping has the wrong event");
        assert(signatureVerifies(ping, hookSecret), "the test delivery signature did not verify");
        const pingTimestamp = Number(
          /^t=(\d+),/.exec(String(ping.headers["x-keystone-signature"]))?.[1],
        );
        assert(
          Math.abs(Date.now() / 1_000 - pingTimestamp) < 60,
          "the delivery timestamp is not fresh",
        );

        // A token write with an Idempotency-Key: the second call replays, the
        // same key with a different body is refused, and the write is audited once.
        const hookTokenForm = new URLSearchParams({
          csrf,
          name: "probe webhooks",
          expiresInDays: "30",
        });
        hookTokenForm.append("scope", "settings:write");
        const hookTokenResponse = await fetch(
          `${base}/dashboard/guilds/${WEB_GUILD}/tokens`,
          {
            method: "POST",
            redirect: "manual",
            headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
            body: hookTokenForm.toString(),
          },
        );
        assert(hookTokenResponse.status === 200, "the webhook write token was not issued");
        const writeToken = /<pre>(keystone_[A-Za-z0-9_-]+)<\/pre>/.exec(
          await hookTokenResponse.text(),
        )?.[1];
        assert(writeToken !== undefined, "the write token secret was not shown");
        const [writeTokenRow] = await database.runner.query<{ id: string }>(
          `SELECT id FROM api_tokens WHERE guild_id = '${WEB_GUILD}' ORDER BY created_at DESC LIMIT 1`,
        );
        assert(writeTokenRow !== undefined, "the write token row is missing");

        const settingsPath = `/api/v1/guilds/${WEB_GUILD}/settings/ai`;
        const patch = (body: string, key: string): Promise<Response> =>
          fetch(`${base}${settingsPath}`, {
            method: "PATCH",
            headers: {
              authorization: `Bearer ${writeToken}`,
              "content-type": "application/json",
              "idempotency-key": key,
            },
            body,
          });
        const writesBefore = (await auditStore.list(WEB_GUILD, 50)).filter(
          (row) => row.action === "settings.update",
        ).length;
        const firstPatch = await patch(JSON.stringify({ monthlyBudgetUsd: 13 }), "live-probe-key-1");
        assert(firstPatch.status === 200, `the first keyed write returned ${firstPatch.status}`);
        assert(
          firstPatch.headers.get("idempotent-replayed") === "false",
          "the first keyed write claimed to be a replay",
        );
        const firstPatchBody = await firstPatch.text();

        const replayPatch = await patch(
          JSON.stringify({ monthlyBudgetUsd: 13 }),
          "live-probe-key-1",
        );
        assert(replayPatch.status === 200, `the replayed write returned ${replayPatch.status}`);
        assert(
          replayPatch.headers.get("idempotent-replayed") === "true",
          "the replayed write did not say it was a replay",
        );
        assert(
          (await replayPatch.text()) === firstPatchBody,
          "the replay returned a different body",
        );

        const conflictPatch = await patch(
          JSON.stringify({ monthlyBudgetUsd: 14 }),
          "live-probe-key-1",
        );
        assert(conflictPatch.status === 409, `a body mismatch returned ${conflictPatch.status}`);
        const conflictBody = (await conflictPatch.json()) as { error?: { code?: string } };
        assert(
          conflictBody.error?.code === "idempotency_conflict",
          "the body mismatch did not name the conflict",
        );
        const writesAfter = (await auditStore.list(WEB_GUILD, 50)).filter(
          (row) => row.action === "settings.update",
        ).length;
        assert(
          writesAfter === writesBefore + 1,
          `the replay or conflict wrote an extra audit row (${writesBefore} -> ${writesAfter})`,
        );

        const receiptRows = await database.runner.query<{
          status: string;
          fingerprint: string;
          response_status: number;
        }>(
          `SELECT status, fingerprint, response_status FROM job_receipts
             WHERE idempotency_key = 'http:token:${writeTokenRow.id}:live-probe-key-1'`,
        );
        assert(
          receiptRows[0]?.status === "completed" &&
            receiptRows[0]?.response_status === 200 &&
            /^[0-9a-f]{64}$/.test(receiptRows[0]?.fingerprint ?? ""),
          "the idempotency receipt did not store the fingerprint and response",
        );

        await waitFor("the settings webhook", () => receivedHooks.length >= 2);
        const settingsHook = receivedHooks.find(
          (hook) => hook.headers["x-keystone-event"] === "settings.updated",
        );
        assert(settingsHook !== undefined, "the settings update queued no webhook");
        assert(signatureVerifies(settingsHook, hookSecret), "the settings delivery did not verify");
        const settingsPayload = JSON.parse(settingsHook.body) as {
          event?: string;
          data?: { moduleId?: string; actorId?: string; source?: string };
        };
        assert(settingsPayload.event === "settings.updated", "the payload has the wrong event");
        assert(
          settingsPayload.data?.moduleId === "ai" &&
            settingsPayload.data?.actorId === `token:${writeTokenRow.id}` &&
            settingsPayload.data?.source === "api",
          "the settings payload did not name the module, actor and source",
        );

        const receiptsPage = await fetch(`${base}${hooksPath}`, { headers: { cookie } });
        const receiptsHtml = await receiptsPage.text();
        assert(receiptsHtml.includes("Delivery receipts"), "the receipt table is missing");
        assert(receiptsHtml.includes("delivered"), "a delivered receipt is not shown");

        // A receiver that always fails: three attempts with backoff, then stop.
        const failForm = new URLSearchParams({ csrf, url: `http://127.0.0.1:${failingPort}/hook` });
        failForm.append("event", "settings.updated");
        const failCreate = await fetch(`${base}${hooksPath}`, {
          method: "POST",
          redirect: "manual",
          headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
          body: failForm.toString(),
        });
        assert(failCreate.status === 200, `the failing subscription returned ${failCreate.status}`);
        const failRows = await database.runner.query<{ id: string }>(
          `SELECT id FROM webhook_subscriptions WHERE guild_id = '${WEB_GUILD}' AND url LIKE '%${failingPort}%'`,
        );
        const failId = failRows[0]?.id;
        assert(failId !== undefined, "the failing subscription was not stored");

        const secondWrite = await patch(
          JSON.stringify({ monthlyBudgetUsd: 15 }),
          "live-probe-key-2",
        );
        assert(secondWrite.status === 200, `the second keyed write returned ${secondWrite.status}`);
        await waitFor(
          "the failing delivery to exhaust its attempts",
          async () => {
            const rows = await database.runner.query<{ status: string; attempts: number }>(
              `SELECT status, attempts FROM webhook_deliveries WHERE subscription_id = '${failId}'`,
            );
            return rows.length === 1 && rows[0]!.status === "failed" && rows[0]!.attempts === 3;
          },
          15_000,
        );
        assert(failedAttempts >= 3, `the failing receiver saw ${failedAttempts} attempts`);

        const failedReceipts = await fetch(`${base}${hooksPath}`, { headers: { cookie } });
        const failedHtml = await failedReceipts.text();
        assert(failedHtml.includes("failed"), "a terminal failure is not shown");
        assert(failedHtml.includes("500"), "the receipt does not show the HTTP status");

        for (const id of [hookId, failId]) {
          const removed = await fetch(`${base}${hooksPath}/${id}/delete`, {
            method: "POST",
            redirect: "manual",
            headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ csrf }).toString(),
          });
          assert(removed.status === 302, `webhook delete returned ${removed.status}`);
        }
        const hookAudit = await auditStore.list(WEB_GUILD, 100);
        assert(
          hookAudit.filter((row) => row.action === "webhook.create").length === 2,
          "the two subscriptions did not leave two create rows",
        );
        assert(
          hookAudit.filter((row) => row.action === "webhook.delete").length === 2,
          "the two removals did not leave two delete rows",
        );
        const leftover = await database.runner.query<{ rows: string }>(
          `SELECT count(*)::text AS rows FROM webhook_subscriptions WHERE guild_id = '${WEB_GUILD}'`,
        );
        assert(leftover[0]?.rows === "0", "a removed subscription is still stored");

        record({
          id: "web-webhooks",
          status: "pass",
          detail:
            "real local HTTP on Postgres: a subscription was created behind the guild write gate, its whsec_ secret was shown once and stored sealed, an on-demand test ping reached a local receiver and its t/v1 HMAC verified independently, a settings.updated event was delivered with the module/actor/source payload, an always-500 receiver was retried three times with backoff and then showed a failed receipt with HTTP 500, and both removals left dashboard audit rows; plain-http non-loopback URLs were refused at 400",
          features: ["operations.public-api-webhooks"],
        });

        record({
          id: "web-idempotency-key",
          status: "pass",
          detail:
            "real local HTTP on Postgres: a settings:write token sent the same Idempotency-Key and body twice; the second response carried Idempotent-Replayed: true and the identical body, the same key with a different body returned 409 idempotency_conflict, only one settings.update audit row was written, and the job_receipts row stored the request fingerprint and the 200 response",
          features: ["operations.public-api-webhooks"],
        });
      } finally {
        hookReceiver.closeAllConnections();
        await new Promise<void>((resolve) => hookReceiver.close(() => resolve()));
        failingReceiver.closeAllConnections();
        await new Promise<void>((resolve) => failingReceiver.close(() => resolve()));
      }

      // --- Session hardening: owners, limits, rotation and revocation ---------
      probeOAuth.userId = WEB_NORMAL_USER;
      const normal = await signIn();
      probeOAuth.userId = WEB_USER;

      assert(
        (await fetch(`${base}/dashboard/instance`)).status === 401,
        "the anonymous instance page was not refused at 401",
      );
      assert(
        (await fetch(`${base}/dashboard/instance`, { headers: { cookie: normal.cookie } })).status === 403,
        "a normal guild admin reached the instance console",
      );
      const ownerPage = await fetch(`${base}/dashboard/instance`, { headers: { cookie } });
      assert(ownerPage.status === 200, `the owner instance page returned ${ownerPage.status}`);
      const ownerHtml = await ownerPage.text();
      assert(ownerHtml.includes("Session rotation"), "the owner page does not show session rotation");
      assert(ownerHtml.includes(WEB_USER), "the owner page does not list the owner id");

      const normalForbidden = await fetch(`${base}/dashboard/instance/sessions/revoke`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie: normal.cookie, "x-keystone-csrf": normal.csrf },
        body: new URLSearchParams({ userId: WEB_USER }).toString(),
      });
      assert(normalForbidden.status === 403, `a normal admin revocation returned ${normalForbidden.status}`);

      const ownerRevoked = await fetch(`${base}/dashboard/instance/sessions/revoke`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie, "x-keystone-csrf": csrf },
        body: new URLSearchParams({ userId: WEB_NORMAL_USER }).toString(),
      });
      assert(ownerRevoked.status === 302, `owner session revocation returned ${ownerRevoked.status}`);
      assert(
        (ownerRevoked.headers.get("location") ?? "") === "/dashboard/instance?revoked=1",
        `owner session revocation redirected to ${String(ownerRevoked.headers.get("location"))}`,
      );
      assert(
        (await fetch(`${base}/api/v1/me`, { headers: { cookie: normal.cookie } })).status === 401,
        "the revoked normal-admin session still works",
      );

      // A second handler with tight policies proves each route class returns
      // 429 with Retry-After and recovers in the next fixed window. The clock is
      // moved by the probe so the window does not need a real sleep.
      let limitClock = Date.now();
      const tightLimits: RateLimitPolicies = {
        auth: { max: 2, windowMs: 1_500 },
        dashboard: { max: 2, windowMs: 1_500 },
        write: { max: 2, windowMs: 1_500 },
        api: { max: 2, windowMs: 1_500 },
        apiToken: { max: 2, windowMs: 1_500 },
      };
      const limited = createServer(
        createWebHandler({
          ...serverDeps,
          rateLimiter: new RateLimiter(tightLimits, () => limitClock),
        }),
      );
      await new Promise<void>((resolve, reject) => {
        limited.once("error", reject);
        limited.listen(0, "127.0.0.1", () => resolve());
      });
      try {
        const limitedAddress = limited.address();
        assert(
          limitedAddress !== null && typeof limitedAddress === "object",
          "the rate-limited server has no port",
        );
        const limitedBase = `http://127.0.0.1:${limitedAddress.port}`;
        const expect429 = async (response: Response, label: string): Promise<void> => {
          assert(response.status === 429, `${label} did not return 429 (${response.status})`);
          assert(
            response.headers.get("retry-after") === "2",
            `${label} did not return Retry-After: 2`,
          );
        };

        for (let index = 0; index < 2; index += 1) {
          assert(
            (await fetch(`${limitedBase}/api/v1/me`, { headers: { cookie } })).status === 200,
            "the API limit fired early",
          );
        }
        await expect429(
          await fetch(`${limitedBase}/api/v1/me`, { headers: { cookie } }),
          "the API route",
        );
        limitClock += 1_500;
        assert(
          (await fetch(`${limitedBase}/api/v1/me`, { headers: { cookie } })).status === 200,
          "the API route did not recover in a later window",
        );

        for (let index = 0; index < 2; index += 1) {
          assert(
            (await fetch(`${limitedBase}/dashboard`, { headers: { cookie } })).status === 200,
            "the dashboard limit fired early",
          );
        }
        await expect429(
          await fetch(`${limitedBase}/dashboard`, { headers: { cookie } }),
          "the dashboard route",
        );
        limitClock += 1_500;
        assert(
          (await fetch(`${limitedBase}/dashboard`, { headers: { cookie } })).status === 200,
          "the dashboard route did not recover in a later window",
        );

        const previewForm = new URLSearchParams({ csrf, template: "strict-moderation" });
        previewForm.append("guild", WEB_GUILD);
        const preview = (): Promise<Response> =>
          fetch(`${limitedBase}/dashboard/fleet/preview`, {
            method: "POST",
            redirect: "manual",
            headers: {
              cookie,
              "x-keystone-csrf": csrf,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: previewForm.toString(),
          });
        for (let index = 0; index < 2; index += 1) {
          assert((await preview()).status === 200, "the write limit fired early");
        }
        await expect429(await preview(), "the write route");
        limitClock += 1_500;
        assert((await preview()).status === 200, "the write route did not recover in a later window");

        for (let index = 0; index < 2; index += 1) {
          assert(
            (await fetch(`${limitedBase}/login`, { redirect: "manual" })).status === 302,
            "the sign-in limit fired early",
          );
        }
        await expect429(
          await fetch(`${limitedBase}/login`, { redirect: "manual" }),
          "the sign-in route",
        );
        limitClock += 1_500;
        assert(
          (await fetch(`${limitedBase}/login`, { redirect: "manual" })).status === 302,
          "sign-in did not recover in a later window",
        );

        for (let index = 0; index < 3; index += 1) {
          assert((await fetch(`${limitedBase}/healthz`)).status === 200, "the health check was limited");
        }
      } finally {
        limited.closeAllConnections();
        await new Promise<void>((resolve) => limited.close(() => resolve()));
      }

      authClock += 60_000;
      const beforeRotation = cookie.split("; ").find((part) => part.startsWith("keystone_session="));
      const rotatedResponse = await fetch(`${base}/api/v1/me`, { headers: { cookie } });
      assert(rotatedResponse.status === 200, `rotation request returned ${rotatedResponse.status}`);
      const rotatedSession = responseCookie(rotatedResponse, "keystone_session");
      const rotatedCsrfCookie = responseCookie(rotatedResponse, "keystone_csrf");
      assert(
        rotatedSession !== undefined && rotatedCsrfCookie !== undefined,
        "rotation did not set replacement session and CSRF cookies",
      );
      assert(rotatedSession !== beforeRotation, "rotation kept the old session cookie");
      assert(
        (await fetch(`${base}/api/v1/me`, { headers: { cookie } })).status === 401,
        "the pre-rotation cookie still works",
      );
      const rotatedCookie = `${rotatedSession}; ${rotatedCsrfCookie}`;
      assert(
        (await fetch(`${base}/api/v1/me`, { headers: { cookie: rotatedCookie } })).status === 200,
        "the rotated cookie does not work",
      );

      const loggedOut = await fetch(`${base}/logout`, {
        method: "POST",
        redirect: "manual",
        headers: { cookie: rotatedCookie, "x-keystone-csrf": rotatedCsrfCookie.split("=")[1] },
      });
      assert(loggedOut.status === 302, `logout returned ${loggedOut.status}`);
      assert(
        probeOAuth.revocations.length === 1,
        `expected one Discord revocation, saw ${probeOAuth.revocations.length}`,
      );
      assert(
        probeOAuth.revocations[0] === "live-probe-access-token",
        "logout did not revoke the session's Discord access token",
      );
      assert(
        (await fetch(`${base}/api/v1/me`, { headers: { cookie: rotatedCookie } })).status === 401,
        "the logged-out session still works",
      );
      assert(
        (await fetch(`${base}/logout`, { method: "POST", redirect: "manual" })).status === 401,
        "anonymous logout was not refused at 401",
      );

      record({
        id: "web-session-hardening",
        status: "pass",
        detail:
          "real local HTTP on Postgres: the instance console was 401 anonymous, 403 for a guild admin and 200 for an owner; the owner's revocation deleted the admin's session and that cookie then failed at 401; a tight limiter returned 429 + Retry-After on the auth, dashboard, write and API classes and each recovered in the next window while /healthz stayed exempt; past the rotation interval the opaque cookie was re-keyed, the old value was refused and the new one worked; logout asked the OAuth port to revoke the access token and the session then failed at 401. Token revocation is asserted at the fake port; no live Discord revocation or login is claimed",
        features: ["operations.dashboard-session-hardening"],
      });
    } finally {
      webhookDrainer.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  // --- Cleanup ---------------------------------------------------------------
  await database.runner.exec(`
    DELETE FROM imports WHERE guild_id LIKE 'live-probe%';
    DELETE FROM audit_events WHERE guild_id = '${WEB_GUILD}';
    DELETE FROM audit_events WHERE guild_id = '${WEB_GUILD_B}';
    DELETE FROM config_baselines WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
    DELETE FROM config_templates WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
    DELETE FROM logging_events WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
    DELETE FROM case_events WHERE case_id IN (SELECT id FROM cases WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}'));
    DELETE FROM cases WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
    DELETE FROM invite_joins WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
    DELETE FROM tickets WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
    DELETE FROM command_usage WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
    DELETE FROM settings WHERE guild_id = '${WEB_GUILD}';
    DELETE FROM settings WHERE guild_id = '${WEB_GUILD_B}';
    DELETE FROM web_sessions WHERE user_id IN ('${WEB_USER}', '${WEB_NORMAL_USER}');
    DELETE FROM api_tokens WHERE guild_id IN ('${WEB_GUILD}', '${WEB_GUILD_B}');
    DELETE FROM job_receipts
      WHERE idempotency_key LIKE 'live-probe-%'
         OR idempotency_key = '${temporaryKey}';
    DELETE FROM settings WHERE guild_id LIKE 'live-probe%';
    DELETE FROM community_records WHERE guild_id LIKE 'live-probe%';
    DELETE FROM case_events WHERE case_id IN (SELECT id FROM cases WHERE guild_id LIKE 'live-probe%');
    DELETE FROM cases WHERE guild_id LIKE 'live-probe%';
    DELETE FROM case_counters WHERE guild_id LIKE 'live-probe%';
    DELETE FROM guilds WHERE id LIKE 'live-probe%';
  `);
  await database.close();

  const date = new Date().toISOString().slice(0, 10);
  const report: LiveReport = {
    schemaVersion: 1,
    id: `live-${date}`,
    date,
    generatedAt: new Date().toISOString(),
    docker,
    services: {
      postgres: {
        reachable: true,
        version: postgresVersion,
        migrations: {
          applied: migrations.applied.length,
          pending: migrations.pending.length,
          upToDate: migrations.pending.length === 0,
        },
      },
      redis: { reachable: true },
    },
    checks,
  };

  await writeFile(
    path.join(root, "memory/machine/live.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `\nlive: ${checks.length} checks passed on Postgres ${postgresVersion} / Redis · wrote memory/machine/live.json`,
  );
}

main().catch((error: unknown) => {
  console.error(`live probe failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
