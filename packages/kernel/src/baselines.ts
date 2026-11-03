/**
 * A config baseline is the last bundle an operator applied (or explicitly
 * stored) for a guild. Drift is a comparison, never a second settings store:
 * live values always come from `SettingsService`, and the baseline only answers
 * "what did the operator intend?".
 *
 * The port stays tiny so the SQL adapter and the in-memory adapter are
 * interchangeable in tests and memory mode.
 */
export interface ConfigBaselineInput {
  readonly guildId: string;
  readonly source: string;
  readonly bundle: unknown;
  readonly checksum: string;
  /** Milliseconds since the epoch; the SQL adapter maps this to timestamptz. */
  readonly at?: number;
}

export interface ConfigBaselineRecord {
  readonly guildId: string;
  readonly source: string;
  readonly bundle: unknown;
  readonly checksum: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ConfigBaselineStore {
  get(guildId: string): Promise<ConfigBaselineRecord | undefined>;
  /** Insert or replace this guild's baseline; a replace keeps `createdAt`. */
  save(input: ConfigBaselineInput): Promise<ConfigBaselineRecord>;
}

export class InMemoryConfigBaselineStore implements ConfigBaselineStore {
  private readonly rows = new Map<string, ConfigBaselineRecord>();

  async get(guildId: string): Promise<ConfigBaselineRecord | undefined> {
    const row = this.rows.get(guildId);
    return row ? structuredClone(row) : undefined;
  }

  async save(input: ConfigBaselineInput): Promise<ConfigBaselineRecord> {
    const at = input.at ?? Date.now();
    const existing = this.rows.get(input.guildId);
    const record: ConfigBaselineRecord = {
      guildId: input.guildId,
      source: input.source,
      bundle: structuredClone(input.bundle),
      checksum: input.checksum,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    this.rows.set(input.guildId, record);
    return structuredClone(record);
  }
}
