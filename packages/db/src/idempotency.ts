import { eq, sql } from "drizzle-orm";
import {
  IDEMPOTENCY_LEASE_MS,
  type IdempotencyClaim,
  type IdempotencyStore,
  type RequestClaim,
  type StoredHttpResponse,
} from "@keystone/kernel";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { jobReceipts } from "./schema";
import type { schema } from "./schema";

export interface JobReceipt {
  idempotencyKey: string;
  jobName: string;
  status: string;
  attempts: number;
  lastError: string | null;
}

/**
 * Postgres receipts for queue work.
 *
 * `claim` is the important call: the first worker to insert wins, and a receipt
 * that is already `completed` makes the retry a no-op. A `claimed` receipt is
 * allowed to run again — delivery is at-least-once, so the handler must be
 * idempotent as well. Both halves of that contract are documented in
 * `06-Operations/` and tested in `packages/queue`.
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async claim(key: string, jobName: string): Promise<IdempotencyClaim> {
    const inserted = await this.db
      .insert(jobReceipts)
      .values({ idempotencyKey: key, jobName, status: "claimed", attempts: 1 })
      .onConflictDoNothing()
      .returning({ key: jobReceipts.idempotencyKey });

    if (inserted.length > 0) return "run";

    const [existing] = await this.db
      .select()
      .from(jobReceipts)
      .where(eq(jobReceipts.idempotencyKey, key))
      .limit(1);

    if (!existing) return "run";
    if (existing.status === "completed") return "done";

    await this.db
      .update(jobReceipts)
      .set({
        status: "claimed",
        attempts: sql`${jobReceipts.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(jobReceipts.idempotencyKey, key));

    return "run";
  }

  async complete(key: string): Promise<void> {
    await this.db
      .update(jobReceipts)
      .set({ status: "completed", lastError: null, updatedAt: new Date() })
      .where(eq(jobReceipts.idempotencyKey, key));
  }

  async fail(key: string, error: string): Promise<void> {
    await this.db
      .update(jobReceipts)
      .set({ status: "failed", lastError: error.slice(0, 2_000), updatedAt: new Date() })
      .where(eq(jobReceipts.idempotencyKey, key));
  }

  /**
   * The HTTP claim lives on the same receipt row.
   *
   * Insert-on-conflict is the lock: the first request wins. A completed row
   * with the same fingerprint replays its stored status and body; a different
   * fingerprint is a conflict even while the first request is still running.
   * A crashed claim is reclaimable after the lease, and a failed row may run
   * again immediately under the same body.
   */
  async claimRequest(
    key: string,
    jobName: string,
    fingerprint: string,
    now = Date.now(),
  ): Promise<RequestClaim> {
    const inserted = await this.db
      .insert(jobReceipts)
      .values({
        idempotencyKey: key,
        jobName,
        status: "claimed",
        attempts: 1,
        fingerprint,
        updatedAt: new Date(now),
      })
      .onConflictDoNothing()
      .returning({ key: jobReceipts.idempotencyKey });
    if (inserted.length > 0) return { outcome: "execute" };

    const [existing] = await this.db
      .select()
      .from(jobReceipts)
      .where(eq(jobReceipts.idempotencyKey, key))
      .limit(1);
    if (!existing) return { outcome: "execute" };
    if (existing.fingerprint && existing.fingerprint !== fingerprint) {
      return { outcome: "conflict" };
    }
    if (existing.status === "completed" && existing.responseStatus !== null) {
      // The body is stored as the exact bytes that were sent, so parsing here
      // and re-serialising at the edge preserves key order and formatting.
      let body: unknown = null;
      if (existing.responseBody !== null) {
        try {
          body = JSON.parse(existing.responseBody);
        } catch {
          body = null;
        }
      }
      return {
        outcome: "replay",
        response: { status: existing.responseStatus, body },
      };
    }
    if (
      existing.status !== "failed" &&
      now - existing.updatedAt.getTime() < IDEMPOTENCY_LEASE_MS
    ) {
      return { outcome: "in-flight" };
    }

    await this.db
      .update(jobReceipts)
      .set({
        status: "claimed",
        attempts: sql`${jobReceipts.attempts} + 1`,
        fingerprint,
        lastError: null,
        updatedAt: new Date(now),
      })
      .where(eq(jobReceipts.idempotencyKey, key));
    return { outcome: "execute" };
  }

  async completeRequest(
    key: string,
    fingerprint: string,
    response: StoredHttpResponse,
  ): Promise<void> {
    await this.db
      .update(jobReceipts)
      .set({
        status: "completed",
        fingerprint,
        responseStatus: response.status,
        responseBody: JSON.stringify(response.body) ?? "null",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(jobReceipts.idempotencyKey, key));
  }

  async releaseRequest(key: string): Promise<void> {
    await this.db.delete(jobReceipts).where(eq(jobReceipts.idempotencyKey, key));
  }

  async receipt(key: string): Promise<JobReceipt | undefined> {
    const [row] = await this.db
      .select({
        idempotencyKey: jobReceipts.idempotencyKey,
        jobName: jobReceipts.jobName,
        status: jobReceipts.status,
        attempts: jobReceipts.attempts,
        lastError: jobReceipts.lastError,
      })
      .from(jobReceipts)
      .where(eq(jobReceipts.idempotencyKey, key))
      .limit(1);
    return row;
  }
}
