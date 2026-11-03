import type { WebSession } from "@keystone/kernel";
import { authorizeGuild, requireSettingsWrite } from "../authorization";
import { encodePathSegment, parseBody, redirect, send } from "../http";
import { HttpError } from "../http-error";
import { renderWebhooks, type WebhookRenderOptions } from "../render";
import type { RouteContext } from "../request-context";
import type { DiscordGuild } from "../oauth";

/**
 * Webhook administration lives behind the same guild write gate as every other
 * setting: session -> guild authorization -> CSRF. Creating and removing an
 * endpoint is audited with `source: "dashboard"`; the one-time signing secret is
 * rendered in the creation response and never stored in the URL.
 */

async function page(
  ctx: RouteContext,
  session: WebSession,
  guild: DiscordGuild,
  options: WebhookRenderOptions = {},
): Promise<void> {
  const [subscriptions, deliveries] = await Promise.all([
    ctx.deps.webhooks.list(guild.id),
    ctx.deps.webhooks.deliveries(guild.id, 10),
  ]);
  send(
    ctx.res,
    200,
    renderWebhooks(session.username, guild, subscriptions, deliveries, ctx.csrfToken, options),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
}

export async function webhooksPage(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const { session, guild } = await authorizeGuild(ctx.deps, ctx.session, guildId);
  await page(ctx, session, guild, {
    deleted: ctx.url.searchParams.get("deleted") === "1",
    tested: ctx.url.searchParams.get("tested") === "1",
  });
  return true;
}

export async function webhookCreate(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  let body!: URLSearchParams;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });

  const created = await ctx.deps.webhooks.create(write.guild.id, {
    url: body.get("url") ?? "",
    events: body.getAll("event"),
    createdBy: write.session.userId,
  });
  await ctx.deps.audit.append({
    guildId: write.guild.id,
    actorId: write.session.userId,
    action: "webhook.create",
    targetId: created.subscription.id,
    data: {
      source: "dashboard",
      url: created.subscription.url,
      events: [...created.subscription.events],
    },
  });
  await page(ctx, write.session, write.guild, { issued: created });
  return true;
}

export async function webhookDelete(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const webhookId = params[1] as string;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    const body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });

  const subscription = (await ctx.deps.webhooks.list(write.guild.id)).find(
    (candidate) => candidate.id === webhookId,
  );
  if (!subscription || !(await ctx.deps.webhooks.remove(write.guild.id, webhookId))) {
    throw new HttpError(404, "That webhook subscription does not exist.", "webhook_not_found");
  }
  await ctx.deps.audit.append({
    guildId: write.guild.id,
    actorId: write.session.userId,
    action: "webhook.delete",
    targetId: webhookId,
    data: { source: "dashboard", url: subscription.url },
  });
  redirect(
    ctx.res,
    `/dashboard/guilds/${encodePathSegment(guildId)}/webhooks?deleted=1`,
  );
  return true;
}

export async function webhookTest(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const webhookId = params[1] as string;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    const body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });

  const delivery = await ctx.deps.webhooks.sendTest(
    write.guild.id,
    webhookId,
    write.session.userId,
  );
  if (!delivery) {
    throw new HttpError(404, "That webhook subscription does not exist.", "webhook_not_found");
  }
  await ctx.deps.audit.append({
    guildId: write.guild.id,
    actorId: write.session.userId,
    action: "webhook.test",
    targetId: webhookId,
    data: { source: "dashboard", deliveryId: delivery.id },
  });
  redirect(
    ctx.res,
    `/dashboard/guilds/${encodePathSegment(guildId)}/webhooks?tested=1`,
  );
  return true;
}
