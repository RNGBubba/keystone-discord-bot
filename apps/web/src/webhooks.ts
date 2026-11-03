import { createHmac, timingSafeEqual } from "node:crypto";
import {
  WEBHOOK_BACKOFF_MS,
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ATTEMPTS,
  isSubscribableEvent,
  type Logger,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookStore,
  type WebhookSubscription,
} from "@keystone/kernel";
import { randomToken, SecretBox } from "./crypto";
import { HttpError } from "./http-error";

/**
 * Outbound webhooks.
 *
 * The signing secret is generated here, sealed with the same `SecretBox` the
 * dashboard uses for Discord tokens, and handed to the operator once. A delivery
 * is an outbox row written before the network call; `drain` turns due rows into
 * attempts and writes the result back, so a retry survives a restart and the
 * admin's receipt is a stored fact.
 */

export const WEBHOOK_SECRET_PREFIX = "whsec_";
export const WEBHOOK_TIMEOUT_MS = 5_000;
/** A receiver should reject an older signature as a replay. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;
export const WEBHOOK_USER_AGENT = "Keystone-Webhooks/1";

export interface WebhookServiceOptions {
  readonly now?: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly timeoutMs?: number;
}

export interface CreatedWebhook {
  readonly subscription: WebhookSubscription;
  /** Shown once; the stored row holds only the sealed value. */
  readonly secret: string;
}

export class WebhookService {
  readonly #now: () => number;
  readonly #fetch: typeof fetch;
  readonly #maxAttempts: number;
  readonly #backoffMs: number;
  readonly #timeoutMs: number;

  constructor(
    private readonly store: WebhookStore,
    private readonly box: SecretBox,
    options: WebhookServiceOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#maxAttempts = options.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
    this.#backoffMs = options.backoffMs ?? WEBHOOK_BACKOFF_MS;
    this.#timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  }

  list(guildId: string): Promise<readonly WebhookSubscription[]> {
    return this.store.listSubscriptions(guildId);
  }

  deliveries(guildId: string, limit = 10): Promise<readonly WebhookDelivery[]> {
    return this.store.listDeliveries(guildId, limit);
  }

  async create(
    guildId: string,
    input: {
      readonly url: string;
      readonly events: readonly string[];
      readonly createdBy?: string;
    },
  ): Promise<CreatedWebhook> {
    const url = validateWebhookUrl(input.url);
    const events = parseEvents(input.events);
    const secret = `${WEBHOOK_SECRET_PREFIX}${randomToken(24)}`;
    const subscription = await this.store.createSubscription({
      id: globalThis.crypto.randomUUID(),
      guildId,
      url,
      secret: this.box.seal(secret),
      events,
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      createdAt: new Date(this.#now()).toISOString(),
    });
    return { subscription, secret };
  }

  remove(guildId: string, id: string): Promise<boolean> {
    return this.store.removeSubscription(guildId, id);
  }

  /** One outbox row per subscription that asked for this event. */
  async enqueue(
    guildId: string,
    event: (typeof WEBHOOK_EVENTS)[number],
    payload: Readonly<Record<string, unknown>>,
  ): Promise<number> {
    const subscriptions = await this.store.listSubscriptions(guildId);
    const matching = subscriptions.filter((subscription) => subscription.events.includes(event));
    if (matching.length === 0) return 0;
    const at = new Date(this.#now()).toISOString();
    const created = await this.store.enqueue(
      matching.map((subscription) => ({
        guildId,
        subscriptionId: subscription.id,
        event,
        payload,
        at,
      })),
    );
    return created.length;
  }

  /** Send the on-demand ping an admin uses to check a receiver. */
  async sendTest(guildId: string, id: string, actorId: string): Promise<WebhookDelivery | undefined> {
    const subscription = await this.store.getSubscription(guildId, id);
    if (!subscription) return undefined;
    const [delivery] = await this.store.enqueue([
      {
        guildId,
        subscriptionId: subscription.id,
        event: "webhook.test",
        payload: { requestedBy: actorId },
        at: new Date(this.#now()).toISOString(),
      },
    ]);
    return delivery;
  }

  /**
   * Attempt every due row once. A failed attempt either schedules the next one
   * with exponential backoff or becomes terminal when the attempt cap is hit.
   */
  async drain(limit = 20): Promise<number> {
    const due = await this.store.due(new Date(this.#now()).toISOString(), limit);
    for (const delivery of due) await this.#attempt(delivery);
    return due.length;
  }

  async #attempt(delivery: WebhookDelivery): Promise<void> {
    const subscription = await this.store.getSubscription(
      delivery.guildId,
      delivery.subscriptionId,
    );
    // The row cascades with its subscription; a race can still surface here.
    if (!subscription) return;

    const secret = this.unseal(subscription.secret);
    if (!secret) {
      await this.store.failDelivery(delivery.id, {
        error: "The signing secret could not be unsealed; reissue this subscription.",
        at: new Date(this.#now()).toISOString(),
        nextAttemptAt: null,
      });
      return;
    }

    const timestamp = Math.floor(this.#now() / 1_000);
    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      guildId: delivery.guildId,
      createdAt: delivery.createdAt,
      data: delivery.payload,
    });

    try {
      const response = await this.#fetch(subscription.url, {
        method: "POST",
        headers: signatureHeaders(secret, delivery, timestamp, body),
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      const at = new Date(this.#now()).toISOString();
      if (response.ok) {
        await this.store.completeDelivery(delivery.id, response.status, at);
        return;
      }
      await this.#fail(delivery, `${response.status} ${response.statusText}`.trim(), response.status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.#fail(delivery, message || errorName(error));
    }
  }

  async #fail(delivery: WebhookDelivery, error: string, status?: number): Promise<void> {
    const attempts = delivery.attempts + 1;
    const terminal = attempts >= this.#maxAttempts;
    await this.store.failDelivery(delivery.id, {
      error,
      ...(status === undefined ? {} : { status }),
      at: new Date(this.#now()).toISOString(),
      nextAttemptAt: terminal
        ? null
        : new Date(this.#now() + this.#backoffMs * 2 ** (attempts - 1)).toISOString(),
    });
  }

  /** A rotated or missing key makes old rows undeliverable; say so, do not throw. */
  private unseal(value: string): string | undefined {
    try {
      return this.box.open(value);
    } catch {
      return undefined;
    }
  }
}

/**
 * One drainer per web process.
 *
 * The dashboard already runs as one process and owns the sealing key, so the
 * drainer lives here rather than in the Discord worker (which has no web deps
 * and no reason to hold this key). The outbox is durable, so a future worker
 * can drain the same rows without changing the store contract. The interval is
 * unref'd so it never keeps a process or a test alive.
 */
export function startWebhookDrainer(
  service: WebhookService,
  logger: Logger,
  intervalMs = 2_000,
): { stop(): void } {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void service
      .drain()
      .catch((error: unknown) => {
        logger.warn("webhook drain failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}

/** HTTPS only, except loopback HTTP so a local receiver can be tested. */
export function validateWebhookUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new HttpError(400, "A webhook URL is required.", "webhook_url_missing");
  }
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "That webhook URL is not valid.", "webhook_url_invalid");
  }
  if (url.username || url.password) {
    throw new HttpError(400, "A webhook URL must not contain credentials.", "webhook_url_invalid");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new HttpError(
      400,
      "A webhook URL must use https. Plain http is accepted only for localhost.",
      "webhook_url_insecure",
    );
  }
  if (url.href.length > 2_048) {
    throw new HttpError(400, "That webhook URL is too long.", "webhook_url_invalid");
  }
  return url.href;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function parseEvents(values: readonly string[]): readonly (typeof WEBHOOK_EVENTS)[number][] {
  const events: (typeof WEBHOOK_EVENTS)[number][] = [];
  for (const value of values) {
    if (!isSubscribableEvent(value)) {
      throw new HttpError(400, `Unknown webhook event: ${value}.`, "webhook_event_invalid");
    }
    if (!events.includes(value)) events.push(value);
  }
  return events.length > 0 ? events : [...WEBHOOK_EVENTS];
}

/**
 * `t=<unix>,v1=<hex>` over `<t>.<body>`. The receiver recomputes the HMAC,
 * compares in constant time and rejects a timestamp outside its tolerance, so a
 * captured body cannot be replayed later.
 */
export function signatureHeaders(
  secret: string,
  delivery: Pick<WebhookDelivery, "id" | "event">,
  timestamp: number,
  body: string,
): Record<string, string> {
  return {
    "content-type": "application/json",
    "user-agent": WEBHOOK_USER_AGENT,
    "x-keystone-event": delivery.event,
    "x-keystone-delivery": delivery.id,
    "x-keystone-signature": signWebhook(secret, timestamp, body),
  };
}

export function signWebhook(secret: string, timestamp: number, body: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

export function verifyWebhookSignature(
  secret: string,
  header: string | undefined,
  body: string,
  now = Date.now(),
  toleranceMs = WEBHOOK_TOLERANCE_MS,
): boolean {
  if (!header) return false;
  const parts = new Map(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
    }),
  );
  const timestamp = Number(parts.get("t"));
  const presented = parts.get("v1");
  if (!Number.isInteger(timestamp) || !presented) return false;
  if (Math.abs(now - timestamp * 1_000) > toleranceMs) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(presented, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "request failed";
}
