import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PanicState, PanicStore } from "@keystone/kernel";
import type { schema } from "./schema";
import { DrizzleCommunityStore } from "./community-store";

const KIND = "moderation_panic";
const KEY = "state";

/**
 * Panic snapshots reuse the typed-record seam instead of a dedicated table.
 *
 * The value is one small JSON document per guild, read only by the panic
 * command and written only while panic mode is active. A table with one row per
 * guild would add a migration and a second schema for no query benefit.
 */
export class DrizzlePanicStore implements PanicStore {
  readonly #records: DrizzleCommunityStore;

  constructor(db: PgDatabase<any, typeof schema>) {
    this.#records = new DrizzleCommunityStore(db as never);
  }

  async get(guildId: string): Promise<PanicState | undefined> {
    return (await this.#records.getRecord<PanicState>(guildId, KIND, KEY))?.data;
  }

  async save(guildId: string, state: PanicState): Promise<void> {
    await this.#records.putRecord(guildId, KIND, KEY, state);
  }

  async clear(guildId: string): Promise<void> {
    await this.#records.deleteRecord(guildId, KIND, KEY);
  }
}
