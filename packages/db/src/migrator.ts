import { sql as migration0001, version as version0001 } from "./migrations/0001-init";
import { sql as migration0002, version as version0002 } from "./migrations/0002-settings-nullable";
import { sql as migration0003, version as version0003 } from "./migrations/0003-case-counters";
import { sql as migration0004, version as version0004 } from "./migrations/0004-community-records";
import { sql as migration0005, version as version0005 } from "./migrations/0005-ai-documents-usage";
import { sql as migration0006, version as version0006 } from "./migrations/0006-web-sessions";
import { sql as migration0007, version as version0007 } from "./migrations/0007-invite-tracking";
import { sql as migration0008, version as version0008 } from "./migrations/0008-web-session-cleanup";
import { sql as migration0009, version as version0009 } from "./migrations/0009-logging-events";
import { sql as migration0010, version as version0010 } from "./migrations/0010-command-usage";
import { sql as migration0011, version as version0011 } from "./migrations/0011-forms";
import { sql as migration0012, version as version0012 } from "./migrations/0012-events";
import { sql as migration0013, version as version0013 } from "./migrations/0013-modmail";
import { sql as migration0014, version as version0014 } from "./migrations/0014-case-expiry";
import { sql as migration0015, version as version0015 } from "./migrations/0015-config-baselines";
import { sql as migration0016, version as version0016 } from "./migrations/0016-config-templates";
import { sql as migration0017, version as version0017 } from "./migrations/0017-analytics-indexes";
import { sql as migration0018, version as version0018 } from "./migrations/0018-api-tokens";
import { sql as migration0019, version as version0019 } from "./migrations/0019-webhooks";
import { sql as migration0020, version as version0020 } from "./migrations/0020-session-refresh";

/**
 * The smallest database surface a migrator needs. Both the production driver
 * (`postgres.js`) and the test driver (PGlite) implement it, which is why the
 * same migrations run in CI and in a container.
 */
export interface SqlRunner {
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /**
   * Run `work` in one real transaction.
   *
   * `exec("BEGIN")` is not portable: postgres.js pools connections and rejects
   * raw transaction control with `UNSAFE_TRANSACTION`, because the following
   * statement may land on a different connection. Each driver exposes its own
   * transaction primitive; the migrator uses this instead.
   */
  transaction<T>(work: (tx: SqlRunner) => Promise<T>): Promise<T>;
}

export interface Migration {
  version: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: version0001, sql: migration0001 },
  { version: version0002, sql: migration0002 },
  { version: version0003, sql: migration0003 },
  { version: version0004, sql: migration0004 },
  { version: version0005, sql: migration0005 },
  { version: version0006, sql: migration0006 },
  { version: version0007, sql: migration0007 },
  { version: version0008, sql: migration0008 },
  { version: version0009, sql: migration0009 },
  { version: version0010, sql: migration0010 },
  { version: version0011, sql: migration0011 },
  { version: version0012, sql: migration0012 },
  { version: version0013, sql: migration0013 },
  { version: version0014, sql: migration0014 },
  { version: version0015, sql: migration0015 },
  { version: version0016, sql: migration0016 },
  { version: version0017, sql: migration0017 },
  { version: version0018, sql: migration0018 },
  { version: version0019, sql: migration0019 },
  { version: version0020, sql: migration0020 },
];

const LEDGER = "schema_migrations";

function escape(value: string): string {
  return value.replaceAll("'", "''");
}

export async function ensureLedger(runner: SqlRunner): Promise<void> {
  await runner.exec(
    `CREATE TABLE IF NOT EXISTS ${LEDGER} (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Explicit, ordered, idempotent migrations.
 *
 * There is deliberately no "run this on boot" path: two replicas starting at
 * once would race, and a failed migration would leave a half-started bot. The
 * operator runs `pnpm db:migrate` (or the compose `migrate` service) first.
 */
export async function migrate(
  runner: SqlRunner,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationResult> {
  await ensureLedger(runner);

  const rows = await runner.query<{ version: string }>(`SELECT version FROM ${LEDGER}`);
  const applied = new Set(rows.map((row) => row.version));
  const appliedNow: string[] = [];
  const alreadyApplied: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      alreadyApplied.push(migration.version);
      continue;
    }

    try {
      await runner.transaction(async (tx) => {
        await tx.exec(migration.sql);
        await tx.exec(
          `INSERT INTO ${LEDGER} (version) VALUES ('${escape(migration.version)}')`,
        );
      });
    } catch (error) {
      throw new Error(
        `Migration ${migration.version} failed and was rolled back: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    appliedNow.push(migration.version);
  }

  return { applied: appliedNow, alreadyApplied };
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
  upToDate: boolean;
}

export async function migrationStatus(
  runner: SqlRunner,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<MigrationStatus> {
  await ensureLedger(runner);
  const rows = await runner.query<{ version: string }>(`SELECT version FROM ${LEDGER}`);
  const applied = new Set(rows.map((row) => row.version));
  const pending = migrations.filter((migration) => !applied.has(migration.version)).map((m) => m.version);
  return { applied: [...applied].sort(), pending, upToDate: pending.length === 0 };
}
