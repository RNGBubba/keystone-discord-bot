import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  STATE_COOKIE,
  clearCookie,
  serializeCookie,
} from "../cookies";
import { csrfHeader, parseBody, redirect, send, sendJson } from "../http";
import { requireCsrf, requireSession } from "../authorization";
import { renderLanding } from "../render";
import type { RouteContext } from "../request-context";

const STATE_MAX_AGE_MS = 10 * 60_000;

export async function health(ctx: RouteContext): Promise<boolean> {
  sendJson(ctx.res, 200, {
    ok: true,
    database: ctx.deps.databaseMode,
    oauth: ctx.deps.auth.oauthConfigured,
  });
  return true;
}

export async function login(ctx: RouteContext): Promise<boolean> {
  if (ctx.session) {
    redirect(ctx.res, "/dashboard");
    return true;
  }
  const begin = ctx.deps.auth.begin();
  redirect(ctx.res, begin.authorizationUrl, [
    serializeCookie(STATE_COOKIE, begin.stateCookie, {
      maxAgeMs: STATE_MAX_AGE_MS,
      httpOnly: true,
      secure: ctx.deps.secureCookies,
      sameSite: "Lax",
    }),
  ]);
  return true;
}

export async function oauthCallback(ctx: RouteContext): Promise<boolean> {
  const result = await ctx.deps.auth.complete({
    code: ctx.url.searchParams.get("code") ?? "",
    state: ctx.url.searchParams.get("state") ?? "",
    iss: ctx.url.searchParams.get("iss") ?? "",
    stateCookie: ctx.cookies.get(STATE_COOKIE),
  });
  redirect(ctx.res, "/dashboard", [
    serializeCookie(SESSION_COOKIE, result.sessionToken, {
      maxAgeMs: ctx.deps.auth.ttlMs,
      httpOnly: true,
      secure: ctx.deps.secureCookies,
      sameSite: "Lax",
    }),
    serializeCookie(CSRF_COOKIE, result.csrfToken, {
      maxAgeMs: ctx.deps.auth.ttlMs,
      httpOnly: true,
      secure: ctx.deps.secureCookies,
      sameSite: "Lax",
    }),
    clearCookie(STATE_COOKIE, ctx.deps.secureCookies),
  ]);
  return true;
}

export async function logout(ctx: RouteContext): Promise<boolean> {
  const active = requireSession(ctx.session);
  const body = await parseBody(ctx.req);
  const submitted = csrfHeader(ctx.req) ?? new URLSearchParams(body).get("csrf") ?? undefined;
  requireCsrf(ctx.deps, active, submitted);
  const result = await ctx.deps.auth.logout(active);
  if (ctx.deps.auth.oauthConfigured && !result.revoked) {
    // The local session is gone either way; this only records that Discord did
    // not confirm the remote grant was revoked. Never log the token itself.
    ctx.deps.logger.warn("logout closed the session without confirming token revocation", {
      userId: active.userId,
    });
  }
  redirect(ctx.res, "/", [
    clearCookie(SESSION_COOKIE, ctx.deps.secureCookies),
    clearCookie(CSRF_COOKIE, ctx.deps.secureCookies),
  ]);
  return true;
}

export async function landing(ctx: RouteContext): Promise<boolean> {
  send(
    ctx.res,
    200,
    renderLanding(
      ctx.session?.username,
      ctx.session ? ctx.csrfToken : undefined,
      Boolean(ctx.session && ctx.deps.auth.isOwner(ctx.session)),
    ),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}
