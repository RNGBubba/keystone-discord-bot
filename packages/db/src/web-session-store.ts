import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { SessionCredentials, SessionStore, WebSession } from "@keystone/kernel";
import { webSessions } from "./schema";
import type { schema } from "./schema";

/**
 * Postgres session store.
 *
 * The browser holds a random opaque token; this table only holds its SHA-256
 * hash. The Discord access and refresh tokens arrive already sealed by the web
 * layer, so this adapter never needs the encryption key and cannot accidentally
 * log a token. Three timestamps have three jobs: `created_at` is the rotation
 * clock, `last_seen_at` is the idle clock, and `expires_at` is the absolute
 * lifetime that activity never moves.
 */
export class DrizzleSessionStore implements SessionStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async create(session: WebSession): Promise<void> {
    await this.db.insert(webSessions).values({
      id: session.id,
      userId: session.userId,
      username: session.username,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken ?? null,
      accessExpiresAt: new Date(session.accessExpiresAt),
      csrfHash: session.csrfHash,
      createdAt: new Date(session.createdAt),
      lastSeenAt: new Date(session.lastSeenAt),
      expiresAt: new Date(session.expiresAt),
    });
  }

  async get(id: string): Promise<WebSession | undefined> {
    const [row] = await this.db
      .select()
      .from(webSessions)
      .where(eq(webSessions.id, id))
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      userId: row.userId,
      username: row.username,
      accessToken: row.accessToken,
      ...(row.refreshToken ? { refreshToken: row.refreshToken } : {}),
      accessExpiresAt: row.accessExpiresAt.toISOString(),
      csrfHash: row.csrfHash,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async rotate(id: string, next: WebSession): Promise<boolean> {
    const updated = await this.db
      .update(webSessions)
      .set({
        id: next.id,
        csrfHash: next.csrfHash,
        createdAt: new Date(next.createdAt),
        lastSeenAt: new Date(next.lastSeenAt),
        expiresAt: new Date(next.expiresAt),
      })
      .where(eq(webSessions.id, id))
      .returning({ id: webSessions.id });
    return updated.length > 0;
  }

  async touch(id: string, lastSeenAt: string): Promise<boolean> {
    const updated = await this.db
      .update(webSessions)
      .set({ lastSeenAt: new Date(lastSeenAt) })
      .where(eq(webSessions.id, id))
      .returning({ id: webSessions.id });
    return updated.length > 0;
  }

  async updateTokens(id: string, credentials: SessionCredentials): Promise<boolean> {
    const updated = await this.db
      .update(webSessions)
      .set({
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken ?? null,
        accessExpiresAt: new Date(credentials.accessExpiresAt),
        lastSeenAt: new Date(credentials.lastSeenAt),
      })
      .where(eq(webSessions.id, id))
      .returning({ id: webSessions.id });
    return updated.length > 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(webSessions).where(eq(webSessions.id, id));
  }

  async deleteForUser(userId: string): Promise<number> {
    const removed = await this.db
      .delete(webSessions)
      .where(eq(webSessions.userId, userId))
      .returning({ id: webSessions.id });
    return removed.length;
  }
}
