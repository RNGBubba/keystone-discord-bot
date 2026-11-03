import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ApiTokenRecord,
  AuditStore,
  IdempotencyStore,
  Logger,
  WebSession,
} from "@keystone/kernel";
import type { GuildAccessService } from "./access";
import type { ApiTokenService } from "./api-tokens";
import type { AuthService } from "./auth";
import { CSRF_COOKIE, SESSION_COOKIE, parseCookies, serializeCookie } from "./cookies";
import { appendSetCookie } from "./http";
import type { DashboardService } from "./overview";
import type { RateLimiter } from "./rate-limit";
import type { WebhookService } from "./webhooks";

export interface WebServerDeps {
  auth: AuthService;
  access: GuildAccessService;
  dashboard: DashboardService;
  logger: Logger;
  secureCookies: boolean;
  databaseMode: "memory" | "postgres";
  rateLimiter: RateLimiter;
  apiTokens: ApiTokenService;
  audit: AuditStore;
  webhooks: WebhookService;
  /** Receipts for `Idempotency-Key` on a token write. */
  idempotency: IdempotencyStore;
}

export interface RouteContext {
  readonly deps: WebServerDeps;
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  readonly path: string;
  readonly method: string;
  readonly cookies: Map<string, string>;
  readonly session: WebSession | undefined;
  /** True whenever an Authorization header was sent, valid or not. */
  readonly bearerPresent: boolean;
  /** A valid, active bearer token; never the secret. */
  readonly apiToken: ApiTokenRecord | undefined;
  readonly csrfToken: string;
}

/**
 * Every route receives the same request facts. In particular, the session is
 * resolved once here, before any route runs; handlers must not re-read cookies
 * or re-hash the session id.
 */
export async function createRouteContext(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebServerDeps,
): Promise<RouteContext> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const cookies = parseCookies(req.headers.cookie);
  const method = req.method ?? "GET";
  const resolution = await deps.auth.resolve(cookies.get(SESSION_COOKIE), method);
  const authorization = req.headers.authorization;
  const bearerPresent = typeof authorization === "string" && authorization.trim().length > 0;
  const bearer = bearerPresent ? bearerSecret(authorization) : undefined;
  const apiToken = bearer ? await deps.apiTokens.authenticate(bearer) : undefined;

  // Rotation happens before any route so the handler only ever sees the
  // current session. The replacement cookies are appended now; a later
  // redirect or logout merge keeps them instead of overwriting them.
  if (resolution.rotated) {
    const options = {
      maxAgeMs: resolution.rotated.maxAgeMs,
      httpOnly: true,
      secure: deps.secureCookies,
      sameSite: "Lax" as const,
    };
    appendSetCookie(res, serializeCookie(SESSION_COOKIE, resolution.rotated.sessionToken, options));
    appendSetCookie(res, serializeCookie(CSRF_COOKIE, resolution.rotated.csrfToken, options));
  }

  return {
    deps,
    req,
    res,
    url,
    path: url.pathname,
    method,
    cookies,
    session: resolution.session,
    bearerPresent,
    apiToken,
    csrfToken: resolution.rotated?.csrfToken ?? cookies.get(CSRF_COOKIE) ?? "",
  };
}

/** Only `Bearer <secret>` is a token attempt; any Authorization header still counts as one. */
function bearerSecret(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1]?.trim() || undefined;
}
