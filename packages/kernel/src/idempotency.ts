import type {
  IdempotencyClaim,
  IdempotencyStore,
  RequestClaim,
  StoredHttpResponse,
} from "./types";

/** A claimed HTTP request older than this may run again after a crash. */
export const IDEMPOTENCY_LEASE_MS = 60_000;

/**
 * Receipts for a queue with no database (local development). The interface is
 * the same as Postgres's, so the queue and its tests do not branch on which one
 * is in use.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #rows = new Map<
    string,
    { jobName: string; status: "claimed" | "completed" | "failed"; attempts: number; lastError: string | null }
  >();
  readonly #requests = new Map<
    string,
    {
      fingerprint: string;
      status: "claimed" | "completed";
      response?: StoredHttpResponse;
      updatedAt: number;
    }
  >();

  async claim(key: string, jobName: string): Promise<IdempotencyClaim> {
    const row = this.#rows.get(key);
    if (!row) {
      this.#rows.set(key, { jobName, status: "claimed", attempts: 1, lastError: null });
      return "run";
    }
    if (row.status === "completed") return "done";
    row.status = "claimed";
    row.attempts += 1;
    return "run";
  }

  async complete(key: string): Promise<void> {
    const row = this.#rows.get(key);
    if (row) {
      row.status = "completed";
      row.lastError = null;
    }
  }

  async fail(key: string, error: string): Promise<void> {
    const row = this.#rows.get(key);
    if (row) {
      row.status = "failed";
      row.lastError = error;
    }
  }

  async claimRequest(
    key: string,
    _jobName: string,
    fingerprint: string,
    now = Date.now(),
  ): Promise<RequestClaim> {
    const row = this.#requests.get(key);
    if (!row) {
      this.#requests.set(key, { fingerprint, status: "claimed", updatedAt: now });
      return { outcome: "execute" };
    }
    if (row.fingerprint !== fingerprint) return { outcome: "conflict" };
    if (row.status === "completed" && row.response) {
      return { outcome: "replay", response: row.response };
    }
    if (now - row.updatedAt < IDEMPOTENCY_LEASE_MS) return { outcome: "in-flight" };
    // A crashed or failed request: take the lease again under the same body.
    row.status = "claimed";
    row.updatedAt = now;
    return { outcome: "execute" };
  }

  async completeRequest(
    key: string,
    fingerprint: string,
    response: StoredHttpResponse,
  ): Promise<void> {
    const row = this.#requests.get(key);
    if (!row || row.fingerprint !== fingerprint) return;
    row.status = "completed";
    row.response = structuredClone(response);
    row.updatedAt = Date.now();
  }

  async releaseRequest(key: string): Promise<void> {
    this.#requests.delete(key);
  }

  receipt(key: string):
    | { jobName: string; status: string; attempts: number; lastError: string | null }
    | undefined {
    const row = this.#rows.get(key);
    return row ? { ...row } : undefined;
  }
}
