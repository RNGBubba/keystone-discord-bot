/**
 * Web-facing ports.
 *
 * The dashboard is a separate process, but it reads the same guild data as the
 * bot. These interfaces live in the kernel so the web app and the Postgres
 * adapters share one contract without the web app importing Drizzle or the
 * database package reaching into an app.
 */

export interface WebSession {
  /** SHA-256 hash of the browser cookie value. The raw token is never stored. */
  readonly id: string;
  readonly userId: string;
  readonly username: string;
  /** Sealed (AES-256-GCM) Discord access token; never sent to the browser. */
  readonly accessToken: string;
  /** SHA-256 hash of the browser CSRF token. */
  readonly csrfHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface SessionStore {
  create(session: WebSession): Promise<void>;
  get(id: string): Promise<WebSession | undefined>;
  /**
   * Re-key an existing row in one atomic step. Returns false when the old id is
   * already gone, which is how a replayed pre-rotation cookie is refused.
   */
  rotate(id: string, next: WebSession): Promise<boolean>;
  delete(id: string): Promise<void>;
  /** Delete every session for one user; returns how many rows were removed. */
  deleteForUser(userId: string): Promise<number>;
}

export interface GuildCounts {
  cases: number;
  openTickets: number;
  levels: number;
  imports: number;
  backups: number;
}

export interface ImportSummary {
  id: string;
  source: string;
  state: string;
  createdAt: string;
}

export interface DashboardOverview {
  guildId: string;
  name: string | null;
  joinedAt: string | null;
  counts: GuildCounts;
  latestImport: ImportSummary | null;
}

export interface DashboardStore {
  overview(guildId: string): Promise<DashboardOverview>;
}

export function emptyGuildCounts(): GuildCounts {
  return { cases: 0, openTickets: 0, levels: 0, imports: 0, backups: 0 };
}

export function emptyOverview(guildId: string): DashboardOverview {
  return {
    guildId,
    name: null,
    joinedAt: null,
    counts: emptyGuildCounts(),
    latestImport: null,
  };
}

/** Local/test backing store. Production uses `DrizzleSessionStore`. */
export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, WebSession>();

  async create(session: WebSession): Promise<void> {
    this.#sessions.set(session.id, { ...session });
  }

  async get(id: string): Promise<WebSession | undefined> {
    const session = this.#sessions.get(id);
    return session ? { ...session } : undefined;
  }

  async rotate(id: string, next: WebSession): Promise<boolean> {
    if (!this.#sessions.has(id)) return false;
    this.#sessions.delete(id);
    this.#sessions.set(next.id, { ...next });
    return true;
  }

  async delete(id: string): Promise<void> {
    this.#sessions.delete(id);
  }

  async deleteForUser(userId: string): Promise<number> {
    let removed = 0;
    for (const [id, session] of this.#sessions) {
      if (session.userId !== userId) continue;
      this.#sessions.delete(id);
      removed += 1;
    }
    return removed;
  }
}

/** Local/test backing store. Production uses `DrizzleDashboardStore`. */
export class InMemoryDashboardStore implements DashboardStore {
  readonly #overviews = new Map<string, DashboardOverview>();

  seed(overview: DashboardOverview): this {
    this.#overviews.set(overview.guildId, { ...overview });
    return this;
  }

  async overview(guildId: string): Promise<DashboardOverview> {
    return this.#overviews.get(guildId) ?? emptyOverview(guildId);
  }
}
