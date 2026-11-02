import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { schema } from "./schema";
import type { schema as schemaType } from "./schema";
import { migrate, type MigrationResult, type SqlRunner } from "./migrator";

/**
 * PGlite is the real Postgres engine compiled to WASM, running in-process. It
 * gives the tests actual transactions, JSONB and unique constraints without
 * requiring a server — and because it can use a data directory, a test can
 * close it and reopen the same database to prove persistence across a restart.
 */
export interface PgliteHarness {
  db: PgDatabase<any, typeof schemaType>;
  runner: SqlRunner;
  close(): Promise<void>;
}

export async function createPgliteDatabase(dataDir?: string): Promise<PgliteHarness> {
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;

  const db = drizzle(client, { schema }) as unknown as PgDatabase<any, typeof schemaType>;

  return {
    db,
    runner: {
      async exec(statement: string): Promise<void> {
        await client.exec(statement);
      },
      async query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
        const result = await client.query(statement);
        return result.rows as T[];
      },
      async transaction<T>(work: (tx: SqlRunner) => Promise<T>): Promise<T> {
        await client.exec("BEGIN");
        const tx: SqlRunner = {
          async exec(statement: string): Promise<void> {
            await client.exec(statement);
          },
          async query<U = Record<string, unknown>>(statement: string): Promise<U[]> {
            const result = await client.query(statement);
            return result.rows as U[];
          },
          // Already inside a transaction; a nested block joins it.
          transaction: (inner) => inner(tx),
        };
        try {
          const value = await work(tx);
          await client.exec("COMMIT");
          return value;
        } catch (error) {
          await client.exec("ROLLBACK").catch(() => undefined);
          throw error;
        }
      },
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

export async function createMigratedPglite(dataDir?: string): Promise<PgliteHarness & MigrationResult> {
  const harness = await createPgliteDatabase(dataDir);
  const result = await migrate(harness.runner);
  return { ...harness, ...result };
}
