import type { ApiScope, ApiTokenRecord, WebSession } from "@keystone/kernel";
import type { RouteContext, WebServerDeps } from "./request-context";
import { HttpError } from "./http-error";
import type { DiscordGuild } from "./oauth";

export interface AuthorizedGuild {
  readonly session: WebSession;
  readonly guild: DiscordGuild;
}

export interface AuthorizedApiGuild {
  readonly guild: DiscordGuild;
  readonly session?: WebSession;
  readonly token?: ApiTokenRecord;
}

export function requireSession(session: WebSession | undefined): WebSession {
  if (!session) throw new HttpError(401, "Sign in with Discord first.", "unauthenticated");
  return session;
}

/**
 * API authentication is one of two principals, not two handlers.
 *
 * A bearer token must remain inside its guild and its scopes, and the bot must
 * still be in the guild. A session falls through to the existing two-check
 * guild gate. The caller gets the same `DiscordGuild` shape either way, so the
 * route does not fork its read or write path.
 */
export async function authorizeApiGuild(
  deps: WebServerDeps,
  ctx: RouteContext,
  guildId: string,
  scope: ApiScope,
): Promise<AuthorizedApiGuild> {
  if (!ctx.bearerPresent) {
    const authorized = await authorizeGuild(deps, ctx.session, guildId);
    return { guild: authorized.guild, session: authorized.session };
  }

  const token = ctx.apiToken;
  if (!token) {
    throw new HttpError(401, "The API token is invalid, expired or revoked.", "token_invalid");
  }
  if (token.guildId !== guildId) {
    throw new HttpError(
      403,
      "This token is scoped to a different guild.",
      "token_guild_forbidden",
    );
  }
  if (!token.scopes.includes(scope)) {
    throw new HttpError(
      403,
      `This token does not include the ${scope} scope.`,
      "token_scope_forbidden",
    );
  }
  if (!(await deps.access.botInGuild(guildId))) {
    throw new HttpError(403, "Keystone is not in that guild.", "bot_not_in_guild");
  }
  return {
    guild: {
      id: guildId,
      name: token.guildName,
      icon: null,
      owner: false,
      permissions: "0",
    },
    token,
  };
}

/** A valid token principal, or the signed-in session. */
export function requireApiPrincipal(
  ctx: RouteContext,
): { readonly kind: "token"; readonly token: ApiTokenRecord } | { readonly kind: "session"; readonly session: WebSession } {
  if (ctx.bearerPresent) {
    if (!ctx.apiToken) {
      throw new HttpError(401, "The API token is invalid, expired or revoked.", "token_invalid");
    }
    return { kind: "token", token: ctx.apiToken };
  }
  return { kind: "session", session: requireSession(ctx.session) };
}

/**
 * One guild authorization path for every read and write: validate the session,
 * decrypt its Discord token only here, then run the two checks in
 * `GuildAccessService` (manage permission and bot membership).
 */
export async function authorizeGuild(
  deps: WebServerDeps,
  session: WebSession | undefined,
  guildId: string,
): Promise<AuthorizedGuild> {
  const active = requireSession(session);
  const guild = await deps.access.authorize(deps.auth.accessToken(active), guildId);
  return { session: active, guild };
}

/**
 * Instance-wide actions are never implied by guild permissions: an admin of one
 * server is not an operator of the deployment. `WEB_OWNER_IDS` is the only
 * allow-list, checked against the Discord user id in the session.
 */
export function requireOwner(
  deps: WebServerDeps,
  session: WebSession | undefined,
): WebSession {
  const active = requireSession(session);
  if (!deps.auth.isOwner(active)) {
    throw new HttpError(403, "That action is limited to instance owners.", "owner_required");
  }
  return active;
}

export function requireCsrf(
  deps: WebServerDeps,
  session: WebSession,
  token: string | undefined,
): void {
  if (!deps.auth.csrfValid(session, token)) {
    throw new HttpError(403, "The CSRF token is missing or invalid.", "csrf_invalid");
  }
}

/**
 * Session + CSRF for a fleet action that has no single guild to authorize yet.
 *
 * The HTML fleet form carries its token in the body, so the body must be parsed
 * before the token can be checked. The caller still has to authorize every
 * selected guild through `authorizeFleet` before reading or writing settings.
 */
export async function requireSessionWrite(
  deps: WebServerDeps,
  session: WebSession | undefined,
  readCsrfToken: () => Promise<string | undefined> | string | undefined,
): Promise<WebSession> {
  const active = requireSession(session);
  requireCsrf(deps, active, await readCsrfToken());
  return active;
}

/** Owner -> CSRF, in that order, for an instance-wide write. */
export async function requireOwnerWrite(
  deps: WebServerDeps,
  session: WebSession | undefined,
  readCsrfToken: () => Promise<string | undefined> | string | undefined,
): Promise<WebSession> {
  const active = requireOwner(deps, session);
  requireCsrf(deps, active, await readCsrfToken());
  return active;
}

/**
 * Authorize a multi-guild selection. The URL or body guild ids are never
 * trusted; `GuildAccessService.authorizeMany` checks each against the OAuth
 * guild list and bot membership.
 */
export async function authorizeFleet(
  deps: WebServerDeps,
  session: WebSession,
  guildIds: readonly string[],
): Promise<DiscordGuild[]> {
  return deps.access.authorizeMany(deps.auth.accessToken(session), guildIds);
}

/**
 * The single gate for a guild settings write.
 *
 * The callback lets each surface choose where its token comes from without
 * duplicating the session/authorization/CSRF sequence. Order is preserved:
 * session -> guild authorization -> token read -> CSRF check. The API reads a
 * header; the HTML form reads its body, so the callback also captures the parsed
 * patch for the caller.
 */
export async function requireSettingsWrite(
  deps: WebServerDeps,
  session: WebSession | undefined,
  guildId: string,
  readCsrfToken: () => Promise<string | undefined> | string | undefined,
): Promise<AuthorizedGuild> {
  const authorized = await authorizeGuild(deps, session, guildId);
  requireCsrf(deps, authorized.session, await readCsrfToken());
  return authorized;
}
