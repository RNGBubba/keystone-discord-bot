/**
 * The append-only audit trail.
 *
 * `audit_events` is the existing SQL table every destructive action and config
 * change is supposed to write. This port is deliberately small: append one
 * record, read the newest records for one guild. A caller never edits or
 * deletes an audit row, so a mistaken change is corrected by another row.
 *
 * The port lives in the kernel because settings writes live there. The bot and
 * the dashboard share one contract and one diff helper, so a `/config set` and
 * a dashboard form produce the same kind of row.
 */

export type SettingsChangeSource = "command" | "dashboard" | "api" | "module" | "system";

export interface SettingsChangeContext {
  /** The Discord user who asked for the change; absent for a system write. */
  readonly actorId?: string;
  readonly source: SettingsChangeSource;
}

export interface AuditEventInput {
  readonly guildId: string;
  readonly actorId?: string;
  readonly action: string;
  readonly targetId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
  /** Millisecond timestamp; defaults to now. */
  readonly at?: number;
}

export interface AuditEventRecord {
  readonly id: string;
  readonly guildId: string;
  readonly actorId?: string;
  readonly action: string;
  readonly targetId?: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface AuditStore {
  append(input: AuditEventInput): Promise<AuditEventRecord>;
  /** Newest first, capped by the adapter. */
  list(guildId: string, limit: number): Promise<AuditEventRecord[]>;
}

/**
 * Local/test backing store. The SQL adapter is `DrizzleAuditStore`.
 *
 * `crypto.randomUUID` is a Web API, so the kernel does not import a Node
 * built-in just to label an in-memory row.
 */
export class InMemoryAuditStore implements AuditStore {
  readonly #events: AuditEventRecord[] = [];

  async append(input: AuditEventInput): Promise<AuditEventRecord> {
    const record: AuditEventRecord = {
      id: globalThis.crypto.randomUUID(),
      guildId: input.guildId,
      ...(input.actorId ? { actorId: input.actorId } : {}),
      action: input.action,
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.data ? { data: structuredClone(input.data) } : {}),
      createdAt: new Date(input.at ?? Date.now()).toISOString(),
    };
    this.#events.push(record);
    return record;
  }

  async list(guildId: string, limit: number): Promise<AuditEventRecord[]> {
    return this.#events
      .filter((record) => record.guildId === guildId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map((record) => structuredClone(record));
  }

  /** Read-only test helper; not part of the port. */
  records(guildId: string): readonly AuditEventRecord[] {
    return this.#events.filter((record) => record.guildId === guildId).map((record) => structuredClone(record));
  }
}

export interface SettingsValueChange {
  readonly from?: unknown;
  readonly to?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/**
 * Flatten the leaves that actually changed into dotted paths.
 *
 * Arrays are compared as one value on purpose: "many banned words" is one
 * setting, and showing an index-by-index diff would be noise. An absent key is
 * represented by omitting `from`/`to` rather than inventing a sentinel.
 */
export function diffSettings(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, SettingsValueChange> {
  const changes: Record<string, SettingsValueChange> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  const walk = (path: string, left: unknown, right: unknown): void => {
    if (isRecord(left) && isRecord(right)) {
      const nested = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of nested) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        walk(path ? `${path}.${key}` : key, left[key], right[key]);
      }
      return;
    }
    if (sameValue(left, right)) return;
    changes[path] = {
      ...(left !== undefined ? { from: left } : {}),
      ...(right !== undefined ? { to: right } : {}),
    };
  };

  for (const key of keys) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    walk(key, before[key], after[key]);
  }
  return changes;
}
