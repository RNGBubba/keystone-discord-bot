/**
 * Outbound webhooks.
 *
 * A subscription is a guild-owned HTTP endpoint with a signing secret. The
 * secret is handed to the operator once and stored sealed by the web app; the
 * kernel only carries the already-sealed value, so it never needs a cipher.
 *
 * A delivery is an outbox row, not a fire-and-forget call: the row is written
 * before the network is touched, each attempt updates it, and the receipt the
 * admin sees is that row. That is what makes a retry a fact rather than a
 * promise.
 */

export const WEBHOOK_EVENTS = [
  "settings.updated",
  "api_token.issued",
  "api_token.revoked",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "webhook.test";

/** Events an operator may subscribe to. The test ping is deliberately not one. */
export function isSubscribableEvent(value: unknown): value is (typeof WEBHOOK_EVENTS)[number] {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** Any event a delivery row may carry, including the on-demand test ping. */
export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return value === "webhook.test" || isSubscribableEvent(value);
}

/** Total attempts before a delivery is terminal. */
export const WEBHOOK_MAX_ATTEMPTS = 3;
/** Base delay; attempt n waits backoffMs * 2^(n-1). */
export const WEBHOOK_BACKOFF_MS = 250;

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed";

export interface WebhookSubscription {
  readonly id: string;
  readonly guildId: string;
  readonly url: string;
  /** Sealed by the caller; never the plaintext signing secret. */
  readonly secret: string;
  readonly events: readonly WebhookEvent[];
  readonly createdBy?: string;
  readonly createdAt: string;
}

export interface WebhookSubscriptionInput {
  readonly id: string;
  readonly guildId: string;
  readonly url: string;
  readonly secret: string;
  readonly events: readonly WebhookEvent[];
  readonly createdBy?: string;
  readonly createdAt?: string;
}

export interface WebhookDelivery {
  readonly id: string;
  readonly guildId: string;
  readonly subscriptionId: string;
  readonly event: WebhookEvent;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: WebhookDeliveryStatus;
  /** Attempts already finished. */
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastStatus?: number;
  readonly lastError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deliveredAt?: string;
}

export interface WebhookDeliveryInput {
  readonly guildId: string;
  readonly subscriptionId: string;
  readonly event: WebhookEvent;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly at?: string;
}

export interface WebhookDeliveryResult {
  readonly status?: number;
  readonly error: string;
  /** Null makes the failure terminal. */
  readonly nextAttemptAt?: string | null;
  readonly at: string;
}

export interface WebhookStore {
  createSubscription(input: WebhookSubscriptionInput): Promise<WebhookSubscription>;
  listSubscriptions(guildId: string): Promise<readonly WebhookSubscription[]>;
  getSubscription(guildId: string, id: string): Promise<WebhookSubscription | undefined>;
  /** Removes the subscription and its delivery receipts. */
  removeSubscription(guildId: string, id: string): Promise<boolean>;
  enqueue(inputs: readonly WebhookDeliveryInput[]): Promise<readonly WebhookDelivery[]>;
  /** Pending rows whose next attempt is due, oldest first. */
  due(now: string, limit: number): Promise<readonly WebhookDelivery[]>;
  completeDelivery(id: string, status: number, at: string): Promise<void>;
  failDelivery(id: string, result: WebhookDeliveryResult): Promise<void>;
  /** Newest first, capped by the adapter. */
  listDeliveries(guildId: string, limit: number): Promise<readonly WebhookDelivery[]>;
}

/** Local/test backing store. Production uses `DrizzleWebhookStore`. */
export class InMemoryWebhookStore implements WebhookStore {
  readonly #subscriptions = new Map<string, WebhookSubscription>();
  readonly #deliveries = new Map<string, WebhookDelivery>();

  async createSubscription(input: WebhookSubscriptionInput): Promise<WebhookSubscription> {
    if (this.#subscriptions.has(input.id)) {
      throw new Error("A webhook subscription with that id already exists.");
    }
    const record: WebhookSubscription = {
      id: input.id,
      guildId: input.guildId,
      url: input.url,
      secret: input.secret,
      events: [...input.events],
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.#subscriptions.set(record.id, record);
    return copySubscription(record);
  }

  async listSubscriptions(guildId: string): Promise<readonly WebhookSubscription[]> {
    return [...this.#subscriptions.values()]
      .filter((subscription) => subscription.guildId === guildId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(copySubscription);
  }

  async getSubscription(guildId: string, id: string): Promise<WebhookSubscription | undefined> {
    const subscription = this.#subscriptions.get(id);
    return subscription?.guildId === guildId ? copySubscription(subscription) : undefined;
  }

  async removeSubscription(guildId: string, id: string): Promise<boolean> {
    const subscription = this.#subscriptions.get(id);
    if (!subscription || subscription.guildId !== guildId) return false;
    this.#subscriptions.delete(id);
    for (const [deliveryId, delivery] of this.#deliveries) {
      if (delivery.subscriptionId === id) this.#deliveries.delete(deliveryId);
    }
    return true;
  }

  async enqueue(inputs: readonly WebhookDeliveryInput[]): Promise<readonly WebhookDelivery[]> {
    const created: WebhookDelivery[] = [];
    for (const input of inputs) {
      const at = input.at ?? new Date().toISOString();
      const record: WebhookDelivery = {
        id: globalThis.crypto.randomUUID(),
        guildId: input.guildId,
        subscriptionId: input.subscriptionId,
        event: input.event,
        payload: structuredClone(input.payload),
        status: "pending",
        attempts: 0,
        nextAttemptAt: at,
        createdAt: at,
        updatedAt: at,
      };
      this.#deliveries.set(record.id, record);
      created.push(copyDelivery(record));
    }
    return created;
  }

  async due(now: string, limit: number): Promise<readonly WebhookDelivery[]> {
    return [...this.#deliveries.values()]
      .filter(
        (delivery) =>
          delivery.status === "pending" &&
          delivery.nextAttemptAt !== null &&
          delivery.nextAttemptAt <= now,
      )
      .sort((a, b) => a.nextAttemptAt!.localeCompare(b.nextAttemptAt!))
      .slice(0, Math.max(1, limit))
      .map(copyDelivery);
  }

  async completeDelivery(id: string, status: number, at: string): Promise<void> {
    const delivery = this.#deliveries.get(id);
    if (!delivery) return;
    this.#deliveries.set(id, {
      ...delivery,
      status: "delivered",
      attempts: delivery.attempts + 1,
      lastStatus: status,
      lastError: undefined,
      nextAttemptAt: null,
      deliveredAt: at,
      updatedAt: at,
    });
  }

  async failDelivery(id: string, result: WebhookDeliveryResult): Promise<void> {
    const delivery = this.#deliveries.get(id);
    if (!delivery) return;
    const attempts = delivery.attempts + 1;
    const nextAttemptAt = result.nextAttemptAt ?? null;
    this.#deliveries.set(id, {
      ...delivery,
      status: nextAttemptAt ? "pending" : "failed",
      attempts,
      lastStatus: result.status,
      lastError: result.error.slice(0, 1_000),
      nextAttemptAt,
      updatedAt: result.at,
    });
  }

  async listDeliveries(guildId: string, limit: number): Promise<readonly WebhookDelivery[]> {
    return [...this.#deliveries.values()]
      .filter((delivery) => delivery.guildId === guildId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, limit))
      .map(copyDelivery);
  }
}

function copySubscription(record: WebhookSubscription): WebhookSubscription {
  return { ...record, events: [...record.events] };
}

function copyDelivery(record: WebhookDelivery): WebhookDelivery {
  return { ...record, payload: structuredClone(record.payload) };
}
