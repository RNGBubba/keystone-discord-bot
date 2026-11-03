import type { WebSession } from "@keystone/kernel";
import type { WebServerDeps } from "./request-context";
import { HttpError } from "./http-error";
import type { DiscordGuild } from "./oauth";

export interface AuthorizedGuild {
  readonly session: WebSession;
  readonly guild: DiscordGuild;
}

export function requireSession(session: WebSession | undefined): WebSession {
  if (!session) throw new HttpError(401, "Sign in with Discord first.", "unauthenticated");
  return session;
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
