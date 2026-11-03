import { authorizeApiGuild, requireApiPrincipal, requireSettingsWrite } from "../authorization";
import { csrfHeader, parseApiSettings, sendJson } from "../http";
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

  if (ctx.bearerPresent) {
    const authorized = await authorizeApiGuild(ctx.deps, ctx, guildId, "settings:write");
    const patch = await parseApiSettings(ctx.req);
    const module = await ctx.deps.dashboard.update(authorized.guild, moduleId, patch, {
      actorId: `token:${authorized.token?.id ?? "unknown"}`,
      source: "api",
    });
    sendJson(ctx.res, 200, { guildId, module });
    return true;
  }

  const write = await requireSettingsWrite(
    ctx.deps,
    ctx.session,
    guildId,
    () => csrfHeader(ctx.req),
  );
  const patch = await parseApiSettings(ctx.req);
  const module = await ctx.deps.dashboard.update(write.guild, moduleId, patch, {
    actorId: write.session.userId,
    source: "api",
  });
  sendJson(ctx.res, 200, { guildId, module });
  return true;
}

export async function notFound(ctx: RouteContext): Promise<boolean> {
  sendJson(ctx.res, 404, { error: { code: "not_found", message: "No such API route." } });
  return true;
}
