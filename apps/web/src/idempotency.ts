import { createHash } from "node:crypto";
import type { RequestClaim } from "@keystone/kernel";
import { HttpError } from "./http-error";

/**
 * `Idempotency-Key` for token writes.
 *
 * The key is not trusted as a row name: it is namespaced by principal (and a
 * hash of the exact request body is stored with it), so two clients cannot
 * collide and the same key cannot silently replay a different write.
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function parseIdempotencyKey(
  header: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === "") return undefined;
  if (!KEY_PATTERN.test(value)) {
    throw new HttpError(
      400,
      "An Idempotency-Key must be 8–128 characters from A-Z, a-z, 0-9, _ and -.",
      "idempotency_key_invalid",
    );
  }
  return value;
}

export function requestFingerprint(method: string, path: string, body: string): string {
  return createHash("sha256").update(`${method} ${path}\n${body}`, "utf8").digest("hex");
}

/** The refusal a claim outcome implies, or undefined when the write may run. */
export function claimRefusal(claim: RequestClaim): HttpError | undefined {
  if (claim.outcome === "conflict") {
    return new HttpError(
      409,
      "That Idempotency-Key was already used with a different request body.",
      "idempotency_conflict",
    );
  }
  if (claim.outcome === "in-flight") {
    return new HttpError(
      409,
      "That Idempotency-Key is still being processed. Retry after the first request finishes.",
      "idempotency_in_progress",
    );
  }
  return undefined;
}
