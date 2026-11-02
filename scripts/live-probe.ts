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
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "@keystone/config";
import { createLogger } from "@keystone/kernel";
import {
  createIdempotencyStore,
  createPortabilityStore,
  createPostgresDatabase,
  createSettingsRepository,
  guilds,
  migrationStatus,
  probeDatabase,
  type PostgresHandle,
} from "@keystone/db";
import { PortabilityService } from "@keystone/importer";
import { createCooldownStore } from "../packages/cache/src/index";
import { BullJobQueue, createBullWorker } from "../packages/queue/src/index";
import { createWebRuntime } from "../apps/web/src/runtime";

const root = path.resolve(import.meta.dirname, "..");
const GUILD = "live-probe";
const QUEUE = "keystone-live-probe";
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

  // --- Cleanup ---------------------------------------------------------------
  await database.runner.exec(`
    DELETE FROM imports WHERE guild_id LIKE 'live-probe%';
    DELETE FROM job_receipts WHERE idempotency_key LIKE 'live-probe-job-%';
    DELETE FROM settings WHERE guild_id LIKE 'live-probe%';
    DELETE FROM community_records WHERE guild_id LIKE 'live-probe%';
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
