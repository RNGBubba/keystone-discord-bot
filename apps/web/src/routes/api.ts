import type { RequestClaim } from "@keystone/kernel";
import { authorizeApiGuild, requireApiPrincipal, requireSettingsWrite } from "../authorization";
import {
  csrfHeader,
  parseSettingsJson,
  readApiSettingsBody,
  sendJson,
} from "../http";
import { claimRefusal, parseIdempotencyKey, requestFingerprint } from "../idempotency";
import { analyticsDays } from "../overview";
import { openApiDocument } from "../openapi";
import type { RouteContext } from "../request-context";

export async function openapi(ctx: RouteContext): Promise<boolean> {
  sendJson(ctx.res, 200, openApiDocument());
  return true;
}

export async function me(ctx: RouteContext): Promise<boolean> {
  const principal = requireApiPrincipal(ctx);
  if (principal.kind === "token") {
    const { token } = principal;
    sendJson(ctx.res, 200, {
      token: {
        id: token.id,
        name: token.name,
        guildId: token.guildId,
        guildName: token.guildName,
        scopes: [...token.scopes],
        createdAt: token.createdAt,
        ...(token.lastUsedAt ? { lastUsedAt: token.lastUsedAt } : {}),
        ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
      },
    });
    return true;
  }
  sendJson(ctx.res, 200, {
    user: { id: principal.session.userId, username: principal.session.username },
  });
  return true;
}

export async function guilds(ctx: RouteContext): Promise<boolean> {
  const principal = requireApiPrincipal(ctx);
  if (principal.kind === "token") {
    const { token } = principal;
    sendJson(ctx.res, 200, {
      guilds: [{ id: token.guildId, name: token.guildName, icon: null, owner: false }],
    });
    return true;
  }
  const manageable = await ctx.deps.access.manageableGuilds(
    ctx.deps.auth.accessToken(principal.session),
  );
  sendJson(ctx.res, 200, {
    guilds: manageable.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner: guild.owner,
    })),
  });
  return true;
}

export async function overview(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const { guild } = await authorizeApiGuild(ctx.deps, ctx, guildId, "guild:read");
  sendJson(ctx.res, 200, await ctx.deps.dashboard.view(guild));
  return true;
}

export async function analytics(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const { guild } = await authorizeApiGuild(ctx.deps, ctx, guildId, "analytics:read");
  const days = analyticsDays(ctx.url.searchParams.get("days"));
  const snapshot = await ctx.deps.dashboard.analytics(guild, days);
  if (!snapshot) {
    sendJson(ctx.res, 503, {
      error: {
        code: "analytics_unavailable",
        message: "Analytics needs the shared database adapter; this web process is in memory mode.",
      },
    });
    return true;
  }
  sendJson(ctx.res, 200, snapshot);
  return true;
}

export async function settings(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const moduleId = params[1] as string;

  // Authorize before reading the body. A session must present CSRF; a bearer
  // token cannot forge a cookie, so its scope and guild are the gate.
  let guild;
  let actorId: string;
  if (ctx.bearerPresent) {
    const authorized = await authorizeApiGuild(ctx.deps, ctx, guildId, "settings:write");
    guild = authorized.guild;
    actorId = `token:${authorized.token?.id ?? "unknown"}`;
  } else {
    const write = await requireSettingsWrite(
      ctx.deps,
      ctx.session,
      guildId,
      () => csrfHeader(ctx.req),
    );
    guild = write.guild;
    actorId = write.session.userId;
  }

  // Read the exact bytes once: the patch and the fingerprint must describe the
  // same request, and a replay is a response, not a second parse.
  const raw = await readApiSettingsBody(ctx.req);
  const patch = parseSettingsJson(raw);
  const key = parseIdempotencyKey(ctx.req.headers["idempotency-key"]);
  const storageKey = key ? `http:${actorId}:${key}` : undefined;
  const fingerprint = requestFingerprint(ctx.method, ctx.path, raw);
  let claim: RequestClaim | undefined;

  if (storageKey) {
    claim = await ctx.deps.idempotency.claimRequest(
      storageKey,
      "http.settings.patch",
      fingerprint,
    );
    if (claim.outcome === "replay") {
      sendJson(ctx.res, claim.response.status, claim.response.body, [], {
        "Idempotent-Replayed": "true",
      });
      return true;
    }
    const refusal = claimRefusal(claim);
    if (refusal) throw refusal;
  }

  try {
    const module = await ctx.deps.dashboard.update(guild, moduleId, patch, {
      actorId,
      source: "api",
    });
    const body = { guildId, module };
    if (storageKey) {
      await ctx.deps.idempotency.completeRequest(storageKey, fingerprint, { status: 200, body });
    }
    sendJson(ctx.res, 200, body, [], storageKey ? { "Idempotent-Replayed": "false" } : {});
  } catch (error) {
    // Release the claim so a corrected retry is not stuck behind the lease.
    if (storageKey) await ctx.deps.idempotency.releaseRequest(storageKey);
    throw error;
  }
  return true;
}

export async function notFound(ctx: RouteContext): Promise<boolean> {
  sendJson(ctx.res, 404, { error: { code: "not_found", message: "No such API route." } });
  return true;
}
