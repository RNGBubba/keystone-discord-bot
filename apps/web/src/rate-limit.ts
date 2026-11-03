import { HttpError } from "./http-error";

/**
 * Per-route fixed-window limits.
 *
 * The dashboard is one self-hosted process, so a small in-process limiter is
 * the honest implementation: it stops a single client from walking the whole
 * settings surface or hammering an authenticated read, and it keeps no second
 * store. The budget is per class, not per URL, so a new page under `/dashboard`
 * inherits the dashboard budget instead of accidentally shipping unlimited.
 */

export type RateLimitClass = "auth" | "dashboard" | "write" | "api" | "apiToken";

export interface RateLimitPolicy {
  readonly max: number;
  readonly windowMs: number;
}

export type RateLimitPolicies = Record<RateLimitClass, RateLimitPolicy>;

export const DEFAULT_RATE_LIMITS: RateLimitPolicies = {
  // Sign-in attempts are anonymous and cheap for an attacker to repeat.
  auth: { max: 20, windowMs: 5 * 60_000 },
  // Pages are reads. A human reloading a page is nowhere near this.
  dashboard: { max: 120, windowMs: 60_000 },
  // A settings write or template action is deliberate and audited.
  write: { max: 30, windowMs: 60_000 },
  // Session-backed API reads and writes.
  api: { max: 60, windowMs: 60_000 },
  // One bucket per issued token, so one client cannot spend another's budget.
  apiToken: { max: 60, windowMs: 60_000 },
};

/** The health check is deliberately exempt: readiness must never be limited. */
export function rateLimitClassFor(method: string, path: string): RateLimitClass | undefined {
  if (path === "/healthz") return undefined;
  if (path === "/login" || path === "/auth/callback") return "auth";
  if (path.startsWith("/api/")) return "api";
  if (method !== "GET" && method !== "HEAD") return "write";
  return "dashboard";
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;

  constructor(
    readonly policies: RateLimitPolicies = DEFAULT_RATE_LIMITS,
    now: () => number = Date.now,
  ) {
    this.#now = now;
  }

  check(limitClass: RateLimitClass, identity: string): RateLimitDecision {
    const policy = this.policies[limitClass];
    const now = this.#now();
    const key = `${limitClass}:${identity}`;
    const bucket = this.#buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.#sweep(now);
      this.#buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
      return { allowed: true, remaining: policy.max - 1, retryAfterSeconds: 0 };
    }
    if (bucket.count >= policy.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
      };
    }
    bucket.count += 1;
    return { allowed: true, remaining: policy.max - bucket.count, retryAfterSeconds: 0 };
  }

  /** Keep an unbounded map of one-off visitors from growing forever. */
  #sweep(now: number): void {
    if (this.#buckets.size < 1_000) return;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key);
    }
  }
}

export function rateLimitError(decision: RateLimitDecision): HttpError {
  return new HttpError(
    429,
    `Too many requests. Try again in ${decision.retryAfterSeconds} second(s).`,
    "rate_limited",
  );
}
