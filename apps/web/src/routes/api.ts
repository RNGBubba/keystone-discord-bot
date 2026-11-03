import { authorizeGuild, requireSession, requireSettingsWrite } from "../authorization";
import { csrfHeader, parseApiSettings, sendJson } from "../http";
import type { RouteContext } from "../request-context";

export async function me(ctx: RouteContext): Promise<boolean> {
  const active = requireSession(ctx.session);
  sendJson(ctx.res, 200, { user: { id: active.userId, username: active.username } });
  return true;
}

export async function guilds(ctx: RouteContext): Promise<boolean> {
  const active = requireSession(ctx.session);
  const manageable = await ctx.deps.access.manageableGuilds(
    ctx.deps.auth.accessToken(active),
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
  const { guild } = await authorizeGuild(ctx.deps, ctx.session, guildId);
  sendJson(ctx.res, 200, await ctx.deps.dashboard.view(guild));
  return true;
}

export async function settings(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const moduleId = params[1] as string;
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
