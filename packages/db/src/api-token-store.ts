import { and, desc, eq, isNull } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  isApiScope,
  type ApiScope,
  type ApiTokenInput,
  type ApiTokenRecord,
  type ApiTokenStore,
} from "@keystone/kernel";
import { apiTokens } from "./schema";
import type { schema } from "./schema";

/**
 * Postgres implementation of the API-token port.
 *
 * `scopes` is JSONB and is filtered through `isApiScope` on read: a row edited
 * outside the dashboard must not smuggle a scope the code does not know.
 * Revocation is a conditional update, so a second revoke returns undefined and
 * writes nothing; that keeps the audited action one row per real revocation.
 */
export class DrizzleApiTokenStore implements ApiTokenStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async create(input: ApiTokenInput): Promise<ApiTokenRecord> {
    const [row] = await this.db
      .insert(apiTokens)
      .values({
        id: input.id,
        guildId: input.guildId,
        guildName: input.guildName,
        name: input.name,
        tokenHash: input.tokenHash,
        scopes: [...input.scopes],
        createdBy: input.createdBy ?? null,
        createdAt: new Date(input.createdAt ?? Date.now()),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      })
      .returning();
    if (!row) throw new Error("The API token insert returned no row.");
    return toRecord(row);
  }

  async findByHash(tokenHash: string): Promise<ApiTokenRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash))
      .limit(1);
    return row ? toRecord(row) : undefined;
  }

  async get(guildId: string, id: string): Promise<ApiTokenRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.guildId, guildId), eq(apiTokens.id, id)))
      .limit(1);
    return row ? toRecord(row) : undefined;
  }

  async list(guildId: string, limit = 50): Promise<readonly ApiTokenRecord[]> {
    const rows = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.guildId, guildId))
      .orderBy(desc(apiTokens.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
    return rows.map(toRecord);
  }

  async revoke(
    guildId: string,
    id: string,
    revokedAt: string,
  ): Promise<ApiTokenRecord | undefined> {
    const [row] = await this.db
      .update(apiTokens)
      .set({ revokedAt: new Date(revokedAt) })
      .where(
        and(
          eq(apiTokens.guildId, guildId),
          eq(apiTokens.id, id),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning();
    return row ? toRecord(row) : undefined;
  }

  async touch(id: string, lastUsedAt: string): Promise<void> {
    await this.db
      .update(apiTokens)
      .set({ lastUsedAt: new Date(lastUsedAt) })
      .where(eq(apiTokens.id, id));
  }
}

function toRecord(row: typeof apiTokens.$inferSelect): ApiTokenRecord {
  const scopes = Array.isArray(row.scopes) ? row.scopes.filter(isApiScope) : [];
  return {
    id: row.id,
    guildId: row.guildId,
    guildName: row.guildName,
    name: row.name,
    tokenHash: row.tokenHash,
    scopes: scopes as ApiScope[],
    ...(row.createdBy ? { createdBy: row.createdBy } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt.toISOString() } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
    ...(row.revokedAt ? { revokedAt: row.revokedAt.toISOString() } : {}),
  };
}
