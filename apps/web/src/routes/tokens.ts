import { authorizeGuild, requireSettingsWrite } from "../authorization";
import { encodePathSegment, parseBody, redirect, send } from "../http";
import { HttpError } from "../http-error";
import { renderApiTokens } from "../render";
import type { RouteContext } from "../request-context";

/**
 * Token issue/revoke uses the same guild write gate as a settings change:
 * session -> guild authorization -> CSRF, before any token is minted or
 * revoked. The secret is rendered in the creation response and never stored in
 * the page URL or a redirect.
 */
export async function tokensPage(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const { session, guild } = await authorizeGuild(ctx.deps, ctx.session, guildId);
  const tokens = await ctx.deps.apiTokens.list(guild.id);
  send(
    ctx.res,
    200,
    renderApiTokens(session.username, guild, tokens, ctx.csrfToken, {
      revoked: ctx.url.searchParams.get("revoked") === "1",
    }),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function tokenCreate(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  let body!: URLSearchParams;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });

  const issued = await ctx.deps.apiTokens.issue({
    guildId: write.guild.id,
    guildName: write.guild.name,
    name: body.get("name") ?? "",
    scopes: body.getAll("scope"),
    createdBy: write.session.userId,
    expiresInDays: body.get("expiresInDays") ?? undefined,
  });
  await ctx.deps.audit.append({
    guildId: write.guild.id,
    actorId: write.session.userId,
    action: "api_token.issue",
    targetId: issued.record.id,
    data: {
      source: "dashboard",
      name: issued.record.name,
      scopes: [...issued.record.scopes],
      expiresAt: issued.record.expiresAt,
    },
  });

  const tokens = await ctx.deps.apiTokens.list(write.guild.id);
  send(
    ctx.res,
    200,
    renderApiTokens(write.session.username, write.guild, tokens, ctx.csrfToken, {
      issued: { secret: issued.secret, record: issued.record },
    }),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function tokenRevoke(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const tokenId = params[1] as string;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    const body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });

  const revoked = await ctx.deps.apiTokens.revoke(write.guild.id, tokenId);
  if (!revoked) {
    throw new HttpError(404, "That token does not exist or is already revoked.", "token_not_found");
  }
  await ctx.deps.audit.append({
    guildId: write.guild.id,
    actorId: write.session.userId,
    action: "api_token.revoke",
    targetId: revoked.id,
    data: { source: "dashboard", name: revoked.name, scopes: [...revoked.scopes] },
  });
  redirect(
    ctx.res,
    `/dashboard/guilds/${encodePathSegment(guildId)}/tokens?revoked=1`,
  );
  return true;
}
