/**
 * Scoped public API tokens.
 *
 * A token is an opaque `keystone_…` secret shown exactly once. Only its SHA-256
 * hash is stored, so a database read cannot replay a client. A token is bound
 * to one guild and carries a subset of the three API scopes; the token is a
 * ceiling, never a substitute for the bot-membership check.
 *
 * The port is deliberately small: create, look up by hash, list and revoke for
 * one guild, and touch last-used. There is no second authorization model here —
 * `apps/web` checks the scopes per route.
 */

export const API_SCOPES = ["guild:read", "analytics:read", "settings:write"] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPES as readonly string[]).includes(value);
}

export interface ApiTokenRecord {
  readonly id: string;
  readonly guildId: string;
  /** Label captured at issue time; the API never trusts it for authorization. */
  readonly guildName: string;
  readonly name: string;
  /** SHA-256 of the secret. The secret itself is never stored. */
  readonly tokenHash: string;
  readonly scopes: readonly ApiScope[];
  readonly createdBy?: string;
  readonly createdAt: string;
  readonly lastUsedAt?: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

export interface ApiTokenInput {
  readonly id: string;
  readonly guildId: string;
  readonly guildName: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly scopes: readonly ApiScope[];
  readonly createdBy?: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
}

export interface ApiTokenStore {
  create(input: ApiTokenInput): Promise<ApiTokenRecord>;
  findByHash(tokenHash: string): Promise<ApiTokenRecord | undefined>;
  get(guildId: string, id: string): Promise<ApiTokenRecord | undefined>;
  /** Newest first, capped by the adapter. */
  list(guildId: string, limit?: number): Promise<readonly ApiTokenRecord[]>;
  /** Set `revoked_at` only when the row is still active. */
  revoke(guildId: string, id: string, revokedAt: string): Promise<ApiTokenRecord | undefined>;
  touch(id: string, lastUsedAt: string): Promise<void>;
}

export function tokenIsActive(record: ApiTokenRecord, now = Date.now()): boolean {
  if (record.revokedAt) return false;
  if (record.expiresAt && Date.parse(record.expiresAt) <= now) return false;
  return true;
}

/** Local/test backing store. Production uses `DrizzleApiTokenStore`. */
export class InMemoryApiTokenStore implements ApiTokenStore {
  readonly #tokens = new Map<string, ApiTokenRecord>();

  async create(input: ApiTokenInput): Promise<ApiTokenRecord> {
    if (this.#tokens.has(input.id)) throw new Error("An API token with that id already exists.");
    for (const token of this.#tokens.values()) {
      if (token.tokenHash === input.tokenHash) throw new Error("An API token with that hash already exists.");
    }
    const record: ApiTokenRecord = {
      id: input.id,
      guildId: input.guildId,
      guildName: input.guildName,
      name: input.name,
      tokenHash: input.tokenHash,
      scopes: [...input.scopes],
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    this.#tokens.set(record.id, record);
    return copy(record);
  }

  async findByHash(tokenHash: string): Promise<ApiTokenRecord | undefined> {
    for (const token of this.#tokens.values()) {
      if (token.tokenHash === tokenHash) return copy(token);
    }
    return undefined;
  }

  async get(guildId: string, id: string): Promise<ApiTokenRecord | undefined> {
    const token = this.#tokens.get(id);
    return token?.guildId === guildId ? copy(token) : undefined;
  }

  async list(guildId: string, limit = 50): Promise<readonly ApiTokenRecord[]> {
    return [...this.#tokens.values()]
      .filter((token) => token.guildId === guildId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map(copy);
  }

  async revoke(
    guildId: string,
    id: string,
    revokedAt: string,
  ): Promise<ApiTokenRecord | undefined> {
    const token = this.#tokens.get(id);
    if (!token || token.guildId !== guildId || token.revokedAt) return undefined;
    const next: ApiTokenRecord = { ...token, revokedAt };
    this.#tokens.set(id, next);
    return copy(next);
  }

  async touch(id: string, lastUsedAt: string): Promise<void> {
    const token = this.#tokens.get(id);
    if (token) this.#tokens.set(id, { ...token, lastUsedAt });
  }
}

function copy(record: ApiTokenRecord): ApiTokenRecord {
  return { ...record, scopes: [...record.scopes] };
}
