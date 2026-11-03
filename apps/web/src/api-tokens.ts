import {
  API_SCOPES,
  isApiScope,
  tokenIsActive,
  type ApiScope,
  type ApiTokenRecord,
  type ApiTokenStore,
} from "@keystone/kernel";
import { randomToken, sha256 } from "./crypto";
import { HttpError } from "./http-error";

/**
 * Public API tokens.
 *
 * The service owns the only secret-handling path: mint `keystone_…`, hash it,
 * store the record, return the secret once. It never logs the secret and never
 * returns it from `list`. The route layer owns the admin gate and the audit
 * row; this file owns the token rules.
 */

export const API_TOKEN_PREFIX = "keystone_";
export const DEFAULT_TOKEN_DAYS = 30;
export const MAX_TOKEN_DAYS = 365;
const TOUCH_INTERVAL_MS = 60_000;

export interface IssueApiTokenInput {
  readonly guildId: string;
  readonly guildName: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly createdBy?: string;
  readonly expiresInDays?: number | string;
}

export interface IssuedApiToken {
  readonly record: ApiTokenRecord;
  /** Shown once; never stored or returned again. */
  readonly secret: string;
}

export function parseTokenScopes(values: readonly string[]): ApiScope[] {
  const scopes: ApiScope[] = [];
  for (const value of values) {
    if (!isApiScope(value)) {
      throw new HttpError(400, `Unknown API scope: ${value}.`, "token_scope_invalid");
    }
    if (!scopes.includes(value)) scopes.push(value);
  }
  if (scopes.length === 0) {
    throw new HttpError(400, "Choose at least one scope for the token.", "token_scope_missing");
  }
  return scopes;
}

function tokenName(value: string): string {
  const name = value.trim();
  if (!name) throw new HttpError(400, "A token name is required.", "token_name_missing");
  if (name.length > 80) {
    throw new HttpError(400, "A token name must be 80 characters or fewer.", "token_name_too_long");
  }
  return name;
}

function expiresInDays(value: number | string | undefined): number {
  const days =
    value === undefined || value === ""
      ? DEFAULT_TOKEN_DAYS
      : typeof value === "number"
        ? value
        : Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_TOKEN_DAYS) {
    throw new HttpError(
      400,
      `The token lifetime must be a whole number of days between 1 and ${MAX_TOKEN_DAYS}.`,
      "token_expiry_invalid",
    );
  }
  return days;
}

export class ApiTokenService {
  constructor(
    private readonly store: ApiTokenStore,
    private readonly now: () => number = Date.now,
  ) {}

  async issue(input: IssueApiTokenInput): Promise<IssuedApiToken> {
    const name = tokenName(input.name);
    const scopes = parseTokenScopes(input.scopes);
    const days = expiresInDays(input.expiresInDays);
    const secret = `${API_TOKEN_PREFIX}${randomToken(32)}`;
    const createdAt = new Date(this.now()).toISOString();
    const record = await this.store.create({
      id: globalThis.crypto.randomUUID(),
      guildId: input.guildId,
      guildName: input.guildName,
      name,
      tokenHash: sha256(secret),
      scopes,
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      createdAt,
      expiresAt: new Date(this.now() + days * 24 * 60 * 60_000).toISOString(),
    });
    return { record, secret };
  }

  /**
   * Resolve an `Authorization: Bearer keystone_…` secret, or undefined. A
   * revoked or expired token is indistinguishable from an unknown one to the
   * caller; the route returns one 401 without naming which condition failed.
   */
  async authenticate(secret: string): Promise<ApiTokenRecord | undefined> {
    if (!secret.startsWith(API_TOKEN_PREFIX) || secret.length < API_TOKEN_PREFIX.length + 20) {
      return undefined;
    }
    const record = await this.store.findByHash(sha256(secret));
    if (!record || !tokenIsActive(record, this.now())) return undefined;

    const lastUsed = record.lastUsedAt ? Date.parse(record.lastUsedAt) : undefined;
    if (lastUsed === undefined || this.now() - lastUsed > TOUCH_INTERVAL_MS) {
      await this.store.touch(record.id, new Date(this.now()).toISOString());
    }
    return record;
  }

  list(guildId: string): Promise<readonly ApiTokenRecord[]> {
    return this.store.list(guildId);
  }

  revoke(guildId: string, id: string): Promise<ApiTokenRecord | undefined> {
    return this.store.revoke(guildId, id, new Date(this.now()).toISOString());
  }
}

/** The OpenAPI scope list is the same constant the route checks use. */
export const TOKEN_SCOPES = API_SCOPES;
