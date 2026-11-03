import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryWebhookStore, WEBHOOK_EVENTS } from "@keystone/kernel";
import { SecretBox } from "./crypto";
import {
  WebhookService,
  signWebhook,
  validateWebhookUrl,
  verifyWebhookSignature,
} from "./webhooks";

const GUILD = "111111111111111111";

function service(options: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const box = new SecretBox(randomBytes(32));
  const store = new InMemoryWebhookStore();
  return {
    box,
    store,
    service: new WebhookService(store, box, {
      fetchImpl: options.fetchImpl,
      now: options.now,
      backoffMs: 250,
      maxAttempts: 3,
    }),
  };
}

describe("webhook subscriptions", () => {
  it("accepts https and loopback http, and refuses insecure or credentialed URLs", () => {
    expect(validateWebhookUrl("https://example.com/hook")).toBe("https://example.com/hook");
    expect(validateWebhookUrl("http://localhost:9000/hook")).toBe("http://localhost:9000/hook");
    expect(validateWebhookUrl("http://127.0.0.1:9000/hook")).toBe("http://127.0.0.1:9000/hook");

    expect(() => validateWebhookUrl("http://example.com/hook")).toThrow(/must use https/);
    expect(() => validateWebhookUrl("ftp://example.com/hook")).toThrow(/must use https/);
    expect(() => validateWebhookUrl("https://user:pass@example.com/hook")).toThrow(
      /must not contain credentials/,
    );
    expect(() => validateWebhookUrl("")).toThrow(/required/);
    expect(() => validateWebhookUrl("not a url")).toThrow(/not valid/);
  });

  it("shows a whsec_ secret once and stores only the sealed value", async () => {
    const { box, store, service: hooks } = service();
    const created = await hooks.create(GUILD, {
      url: "https://example.com/hook",
      events: [],
      createdBy: "user-1",
    });

    expect(created.secret.startsWith("whsec_")).toBe(true);
    expect(created.subscription.events).toEqual([...WEBHOOK_EVENTS]);
    const [listed] = await hooks.list(GUILD);
    expect(listed?.secret).not.toBe(created.secret);
    expect(box.open(listed!.secret)).toBe(created.secret);
    expect(await store.getSubscription(GUILD, created.subscription.id)).toBeDefined();
    expect(await store.getSubscription("999999999999999999", created.subscription.id)).toBeUndefined();
  });

  it("refuses an unknown event before creating a subscription", async () => {
    const { service: hooks } = service();
    await expect(
      hooks.create(GUILD, { url: "https://example.com/hook", events: ["guild.deleted"] }),
    ).rejects.toMatchObject({ status: 400, code: "webhook_event_invalid" });
    expect(await hooks.list(GUILD)).toEqual([]);
  });

  it("queues one row per interested subscription and none for the uninterested", async () => {
    const { service: hooks } = service();
    const both = await hooks.create(GUILD, { url: "https://example.com/a", events: [] });
    const tokensOnly = await hooks.create(GUILD, {
      url: "https://example.com/b",
      events: ["api_token.issued"],
    });
    expect(both.subscription.id).not.toBe(tokensOnly.subscription.id);

    expect(await hooks.enqueue(GUILD, "settings.updated", { moduleId: "ai" })).toBe(1);
    expect(await hooks.enqueue(GUILD, "api_token.issued", { tokenId: "t1" })).toBe(2);
    const deliveries = await hooks.deliveries(GUILD, 10);
    expect(deliveries).toHaveLength(3);
    expect(deliveries.filter((row) => row.event === "settings.updated")).toHaveLength(1);
    expect(deliveries.filter((row) => row.event === "api_token.issued")).toHaveLength(2);
  });
});

describe("webhook delivery", () => {
  it("signs the body with a timestamp a receiver can verify", async () => {
    const clock = Date.parse("2026-11-03T00:00:00.000Z");
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body),
      });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const { service: hooks } = service({ fetchImpl: fakeFetch, now: () => clock });

    const created = await hooks.create(GUILD, { url: "https://example.com/hook", events: [] });
    await hooks.enqueue(GUILD, "settings.updated", { moduleId: "ai", actorId: "user-1" });
    expect(await hooks.drain()).toBe(1);
    expect(calls).toHaveLength(1);

    const [call] = calls;
    expect(call?.url).toBe("https://example.com/hook");
    expect(call?.headers["x-keystone-event"]).toBe("settings.updated");
    expect(call?.headers["x-keystone-delivery"]).toBeTruthy();
    expect(call?.headers["content-type"]).toBe("application/json");
    expect(verifyWebhookSignature(created.secret, call?.headers["x-keystone-signature"], call!.body, clock)).toBe(
      true,
    );
    // Tampering with the body or using an old timestamp fails.
    expect(
      verifyWebhookSignature(created.secret, call?.headers["x-keystone-signature"], `${call!.body} `, clock),
    ).toBe(false);
    expect(
      verifyWebhookSignature(
        created.secret,
        call?.headers["x-keystone-signature"],
        call!.body,
        clock + 10 * 60_000,
      ),
    ).toBe(false);
    expect(verifyWebhookSignature(created.secret, signWebhook(created.secret, 1, "x"), "y", clock)).toBe(false);

    const [receipt] = await hooks.deliveries(GUILD);
    expect(receipt).toMatchObject({ status: "delivered", attempts: 1, lastStatus: 200 });
    expect(receipt?.deliveredAt).toBe("2026-11-03T00:00:00.000Z");
  });

  it("retries a 500 with backoff and stops after three attempts", async () => {
    let clock = Date.parse("2026-11-03T00:00:00.000Z");
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return new Response("nope", { status: 500, statusText: "Server Error" });
    }) as typeof fetch;
    const { service: hooks } = service({ fetchImpl: fakeFetch, now: () => clock });

    await hooks.create(GUILD, { url: "https://example.com/hook", events: [] });
    await hooks.enqueue(GUILD, "settings.updated", {});
    expect(await hooks.drain()).toBe(1);
    let [receipt] = await hooks.deliveries(GUILD);
    expect(receipt).toMatchObject({ status: "pending", attempts: 1, lastStatus: 500 });
    expect(receipt?.nextAttemptAt).toBe(new Date(clock + 250).toISOString());
    expect(await hooks.drain()).toBe(0);

    clock += 250;
    expect(await hooks.drain()).toBe(1);
    [receipt] = await hooks.deliveries(GUILD);
    expect(receipt).toMatchObject({ status: "pending", attempts: 2 });
    expect(receipt?.nextAttemptAt).toBe(new Date(clock + 500).toISOString());

    clock += 500;
    expect(await hooks.drain()).toBe(1);
    [receipt] = await hooks.deliveries(GUILD);
    expect(receipt).toMatchObject({ status: "failed", attempts: 3, lastStatus: 500 });
    expect(receipt?.nextAttemptAt).toBeNull();

    clock += 60_000;
    expect(await hooks.drain()).toBe(0);
    expect(calls).toBe(3);
  });

  it("records a network failure and still sends an on-demand test ping", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;
    const { service: hooks } = service({ fetchImpl: fakeFetch });

    const target = await hooks.create(GUILD, { url: "http://127.0.0.1:9/hook", events: [] });
    const other = await hooks.create(GUILD, { url: "https://example.com/other", events: [] });
    const test = await hooks.sendTest(GUILD, target.subscription.id, "user-1");
    expect(test?.event).toBe("webhook.test");
    expect(await hooks.drain()).toBe(1);
    const [receipt] = await hooks.deliveries(GUILD);
    expect(receipt).toMatchObject({ status: "pending", attempts: 1 });
    expect(receipt?.lastError).toContain("ECONNREFUSED");
    expect(calls).toBe(1);

    // The test ping is addressed to one subscription, not every endpoint.
    expect(await hooks.sendTest(GUILD, other.subscription.id, "user-1")).toMatchObject({
      event: "webhook.test",
    });
    expect(await hooks.sendTest(GUILD, "00000000-0000-4000-8000-000000000000", "user-1")).toBeUndefined();
  });

  it("removes a subscription and its receipts", async () => {
    const fakeFetch = (async () => new Response("ok", { status: 204 })) as typeof fetch;
    const { store, service: hooks } = service({ fetchImpl: fakeFetch });
    const created = await hooks.create(GUILD, { url: "https://example.com/hook", events: [] });
    await hooks.enqueue(GUILD, "settings.updated", {});
    await hooks.drain();
    expect(await hooks.deliveries(GUILD)).toHaveLength(1);

    expect(await hooks.remove(GUILD, created.subscription.id)).toBe(true);
    expect(await hooks.remove(GUILD, created.subscription.id)).toBe(false);
    expect(await hooks.list(GUILD)).toEqual([]);
    expect(await store.listDeliveries(GUILD, 10)).toEqual([]);
  });
});
