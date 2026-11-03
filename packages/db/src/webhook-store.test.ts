import { describe, expect, it } from "vitest";
import { DrizzleWebhookStore } from "./webhook-store";
import { createMigratedPglite } from "./testing";

const GUILD = "111111111111111111";
const OTHER = "222222222222222222";

describe("DrizzleWebhookStore", () => {
  it("round-trips a subscription and scopes it to its guild", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleWebhookStore(harness.db);
      const created = await store.createSubscription({
        id: "0f7dbc9c-0000-4000-8000-000000000001",
        guildId: GUILD,
        url: "https://example.com/hook",
        secret: "v1.sealed.secret",
        events: ["settings.updated", "api_token.issued"],
        createdBy: "444444444444444444",
        createdAt: "2026-11-03T00:00:00.000Z",
      });
      expect(created.events).toEqual(["settings.updated", "api_token.issued"]);
      expect(created.secret).toBe("v1.sealed.secret");

      const [listed] = await store.listSubscriptions(GUILD);
      expect(listed).toMatchObject({ id: created.id, createdBy: "444444444444444444" });
      expect(await store.listSubscriptions(OTHER)).toEqual([]);
      expect(await store.getSubscription(OTHER, created.id)).toBeUndefined();

      // A row edited out of contract cannot smuggle an unknown event.
      await harness.runner.query(
        `UPDATE webhook_subscriptions SET events = '["settings.updated","guild.deleted"]'::jsonb WHERE id = '${created.id}'`,
      );
      expect((await store.getSubscription(GUILD, created.id))?.events).toEqual([
        "settings.updated",
      ]);
    } finally {
      await harness.close();
    }
  });

  it("queues due rows, completes one and retries another", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleWebhookStore(harness.db);
      const subscription = await store.createSubscription({
        id: "0f7dbc9c-0000-4000-8000-000000000002",
        guildId: GUILD,
        url: "https://example.com/hook",
        secret: "v1.sealed.secret",
        events: ["settings.updated"],
      });
      const queued = await store.enqueue([
        {
          guildId: GUILD,
          subscriptionId: subscription.id,
          event: "settings.updated",
          payload: { moduleId: "ai" },
          at: "2026-11-03T00:00:00.000Z",
        },
        {
          guildId: GUILD,
          subscriptionId: subscription.id,
          event: "api_token.issued",
          payload: { tokenId: "t1" },
          at: "2026-11-03T00:00:01.000Z",
        },
      ]);
      expect(queued).toHaveLength(2);
      expect(await store.due("2026-11-02T23:59:59.000Z", 10)).toEqual([]);
      const due = await store.due("2026-11-03T00:00:00.000Z", 10);
      expect(due).toHaveLength(1);
      expect(due[0]).toMatchObject({ event: "settings.updated", status: "pending", attempts: 0 });

      await store.completeDelivery(due[0]!.id, 204, "2026-11-03T00:00:02.000Z");
      expect(await store.due("2026-11-03T00:00:03.000Z", 10)).toHaveLength(1);
      const [delivered] = (await store.listDeliveries(GUILD, 10)).filter(
        (row) => row.status === "delivered",
      );
      expect(delivered).toMatchObject({
        attempts: 1,
        lastStatus: 204,
        deliveredAt: "2026-11-03T00:00:02.000Z",
        nextAttemptAt: null,
      });

      await store.failDelivery(queued[1]!.id, {
        error: "connect ECONNREFUSED",
        at: "2026-11-03T00:00:03.000Z",
        nextAttemptAt: "2026-11-03T00:00:03.250Z",
      });
      const retry = (await store.listDeliveries(GUILD, 10)).find((row) => row.id === queued[1]!.id);
      expect(retry).toMatchObject({
        status: "pending",
        attempts: 1,
        nextAttemptAt: "2026-11-03T00:00:03.250Z",
      });
      expect(retry?.lastError).toBe("connect ECONNREFUSED");
      expect(await store.due("2026-11-03T00:00:03.250Z", 10)).toHaveLength(1);

      await store.failDelivery(queued[1]!.id, {
        error: "terminal",
        at: "2026-11-03T00:00:04.000Z",
        nextAttemptAt: null,
      });
      const failed = (await store.listDeliveries(GUILD, 10)).find((row) => row.id === queued[1]!.id);
      expect(failed).toMatchObject({ status: "failed", attempts: 2, nextAttemptAt: null });
      expect(await store.due("2026-11-04T00:00:00.000Z", 10)).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("deletes receipts with their subscription", async () => {
    const harness = await createMigratedPglite();
    try {
      const store = new DrizzleWebhookStore(harness.db);
      const subscription = await store.createSubscription({
        id: "0f7dbc9c-0000-4000-8000-000000000003",
        guildId: GUILD,
        url: "https://example.com/hook",
        secret: "v1.sealed.secret",
        events: [],
      });
      await store.enqueue([
        {
          guildId: GUILD,
          subscriptionId: subscription.id,
          event: "webhook.test",
          payload: {},
        },
      ]);
      expect(await store.removeSubscription(OTHER, subscription.id)).toBe(false);
      expect(await store.removeSubscription(GUILD, subscription.id)).toBe(true);
      expect(await store.listDeliveries(GUILD, 10)).toEqual([]);
      expect(await store.getSubscription(GUILD, subscription.id)).toBeUndefined();
    } finally {
      await harness.close();
    }
  });
});
