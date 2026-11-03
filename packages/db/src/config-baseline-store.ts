import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type {
  ConfigBaselineInput,
  ConfigBaselineRecord,
  ConfigBaselineStore,
} from "@keystone/kernel";
import { configBaselines } from "./schema";
import type { schema } from "./schema";

/**
 * Postgres implementation of the config baseline port.
 *
 * One row per guild. Applying a new bundle replaces `source`, `bundle`,
 * `checksum` and `updated_at`, while `created_at` stays at the first baseline so
 * the page can say when this guild first had one. `bundle` uses the shared JSONB
 * round-trip; the checksum is stored beside it so drift can report a row whose
 * payload no longer parses.
 */
export class DrizzleConfigBaselineStore implements ConfigBaselineStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async get(guildId: string): Promise<ConfigBaselineRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(configBaselines)
      .where(eq(configBaselines.guildId, guildId))
      .limit(1);
    return row ? toRecord(row) : undefined;
  }

  async save(input: ConfigBaselineInput): Promise<ConfigBaselineRecord> {
    const at = new Date(input.at ?? Date.now());
    const [row] = await this.db
      .insert(configBaselines)
      .values({
        guildId: input.guildId,
        source: input.source,
        bundle: input.bundle,
        checksum: input.checksum,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: configBaselines.guildId,
        set: {
          source: input.source,
          bundle: input.bundle,
          checksum: input.checksum,
          updatedAt: at,
        },
      })
      .returning();

    if (!row) throw new Error("The config baseline upsert returned no row.");
    return toRecord(row);
  }
}

function toRecord(row: typeof configBaselines.$inferSelect): ConfigBaselineRecord {
  return {
    guildId: row.guildId,
    source: row.source,
    bundle: row.bundle,
    checksum: row.checksum,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
