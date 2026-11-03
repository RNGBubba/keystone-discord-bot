import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { SessionStore, WebSession } from "@keystone/kernel";
import { webSessions } from "./schema";
import type { schema } from "./schema";

/**
 * Postgres session store.
 *
 * The browser holds a random opaque token; this table only holds its SHA-256
 * hash. The Discord access token arrives already sealed by the web layer, so
 * this adapter never needs the encryption key and cannot accidentally log a
 * token. There is no refresh token: the dashboard has no refresh path, and
 * storing one would be an unused credential.
 */
export class DrizzleSessionStore implements SessionStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async create(session: WebSession): Promise<void> {
    await this.db.insert(webSessions).values({
      id: session.id,
      userId: session.userId,
      username: session.username,
      accessToken: session.accessToken,
      csrfHash: session.csrfHash,
      createdAt: new Date(session.createdAt),
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
      csrfHash: row.csrfHash,
      createdAt: row.createdAt.toISOString(),
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
        expiresAt: new Date(next.expiresAt),
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
