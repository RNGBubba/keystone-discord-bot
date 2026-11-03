import { describe, expect, it } from "vitest";
import { PostgresIdempotencyStore } from "./idempotency";
import { createMigratedPglite } from "./testing";

const KEY = "http:token:test-key";
const FINGERPRINT = "a".repeat(64);

describe("PostgresIdempotencyStore request claims", () => {
  it("claims once, replays the stored response and refuses a different body", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new PostgresIdempotencyStore(harness.db);
      const now = Date.parse("2026-11-03T00:00:00.000Z");

      expect(await store.claimRequest(KEY, "http.settings.patch", FINGERPRINT, now)).toEqual({
        outcome: "execute",
      });
      // A concurrent retry with the same body waits rather than running twice.
      expect(
        await store.claimRequest(KEY, "http.settings.patch", FINGERPRINT, now + 1_000),
      ).toEqual({ outcome: "in-flight" });
      expect(
        await store.claimRequest(KEY, "http.settings.patch", "b".repeat(64), now + 1_000),
      ).toEqual({ outcome: "conflict" });

      await store.completeRequest(KEY, FINGERPRINT, {
        status: 200,
        body: { guildId: "1", module: { id: "ai", enabled: true } },
      });
      const replayed = await store.claimRequest(
        KEY,
        "http.settings.patch",
        FINGERPRINT,
        now + 2_000,
      );
      if (replayed.outcome !== "replay") throw new Error(`expected a replay, saw ${replayed.outcome}`);
      expect(replayed.response.status).toBe(200);
      // Exact bytes, not merely an equal value: jsonb would reorder these keys.
      expect(JSON.stringify(replayed.response.body)).toBe(
        JSON.stringify({ guildId: "1", module: { id: "ai", enabled: true } }),
      );
      expect(
        await store.claimRequest(KEY, "http.settings.patch", "c".repeat(64), now + 2_000),
      ).toEqual({ outcome: "conflict" });

      const [row] = await harness.runner.query<{
        status: string;
        attempts: number;
        fingerprint: string;
        response_status: number;
      }>(
        `SELECT status, attempts, fingerprint, response_status FROM job_receipts WHERE idempotency_key = '${KEY}'`,
      );
      expect(row).toMatchObject({
        status: "completed",
        attempts: 1,
        fingerprint: FINGERPRINT,
        response_status: 200,
      });
    } finally {
      await harness.close();
    }
  });

  it("releases a failed request so a corrected retry can run", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new PostgresIdempotencyStore(harness.db);
      const now = Date.parse("2026-11-03T00:00:00.000Z");

      expect(await store.claimRequest(KEY, "http.settings.patch", FINGERPRINT, now)).toEqual({
        outcome: "execute",
      });
      await store.releaseRequest(KEY);
      expect(await store.claimRequest(KEY, "http.settings.patch", FINGERPRINT, now)).toEqual({
        outcome: "execute",
      });

      // A failed job receipt is retryable immediately, not stuck behind the lease.
      await store.fail(KEY, "settings invalid");
      expect(await store.claimRequest(KEY, "http.settings.patch", FINGERPRINT, now + 1)).toEqual({
        outcome: "execute",
      });

      // Past the lease, a crashed claim may run again.
      expect(
        await store.claimRequest(KEY, "http.settings.patch", FINGERPRINT, now + 61_000),
      ).toEqual({ outcome: "execute" });

      // The queue's own contract is unchanged.
      expect(await store.claim("job:1", "levels.sync")).toBe("run");
      await store.complete("job:1");
      expect(await store.claim("job:1", "levels.sync")).toBe("done");
    } finally {
      await harness.close();
    }
  });
});
