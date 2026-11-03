import { requireOwner, requireOwnerWrite } from "../authorization";
import { SESSION_COOKIE, CSRF_COOKIE, clearCookie } from "../cookies";
import { csrfHeader, parseBody, redirect, send } from "../http";
import { HttpError } from "../http-error";
import { renderInstance } from "../render";
import type { RouteContext } from "../request-context";

const DISCORD_USER_ID = /^\d{15,20}$/;

/**
 * The instance operator surface. `/dashboard` is guild-scoped and re-checks
 * Discord permissions; this page is the one place a deployment-wide fact is
 * shown and a deployment-wide action is offered, so `owners[]` is the only gate.
 */
export async function instancePage(ctx: RouteContext): Promise<boolean> {
  const active = requireOwner(ctx.deps, ctx.session);
  const revoked = Number.parseInt(ctx.url.searchParams.get("revoked") ?? "", 10);
  send(
    ctx.res,
    200,
    renderInstance(
      active.username,
      {
        databaseMode: ctx.deps.databaseMode,
        oauthConfigured: ctx.deps.auth.oauthConfigured,
        secureCookies: ctx.deps.secureCookies,
        sessionTtlMs: ctx.deps.auth.ttlMs,
        rotationIntervalMs: ctx.deps.auth.rotationIntervalMs,
        owners: ctx.deps.auth.owners,
        rateLimits: ctx.deps.rateLimiter.policies,
      },
      ctx.csrfToken,
      Number.isInteger(revoked) && revoked >= 0 ? revoked : undefined,
    ),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function instanceRevokeSessions(ctx: RouteContext): Promise<boolean> {
  let body!: URLSearchParams;
  const active = await requireOwnerWrite(ctx.deps, ctx.session, async () => {
    const header = csrfHeader(ctx.req);
    body = new URLSearchParams(await parseBody(ctx.req));
    return header ?? body.get("csrf") ?? undefined;
  });

  const userId = (body.get("userId") ?? "").trim();
  if (!DISCORD_USER_ID.test(userId)) {
    throw new HttpError(400, "Enter the Discord user id whose sessions should end.", "user_invalid");
  }
  const removed = await ctx.deps.auth.revokeUserSessions(userId);
  ctx.deps.logger.info("instance sessions revoked", {
    actorId: active.userId,
    targetUserId: userId,
    removed,
  });

  if (userId === active.userId) {
    // The owner just signed themselves out everywhere; do not leave a cookie
    // that points at a deleted row.
    redirect(ctx.res, "/", [
      clearCookie(SESSION_COOKIE, ctx.deps.secureCookies),
      clearCookie(CSRF_COOKIE, ctx.deps.secureCookies),
    ]);
    return true;
  }
  redirect(ctx.res, `/dashboard/instance?revoked=${removed}`);
  return true;
}
