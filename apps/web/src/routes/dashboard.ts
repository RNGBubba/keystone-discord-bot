import { authorizeGuild, requireSession, requireSettingsWrite } from "../authorization";
import { encodePathSegment, parseSettingsFormBody, redirect, send, type SettingsFormBody } from "../http";
import { renderGuildList, renderOverview, renderSettingsEditor } from "../render";
import type { RouteContext } from "../request-context";
import { SettingsValidationError, parseSettingsForm } from "../settings-form";

export async function dashboardList(ctx: RouteContext): Promise<boolean> {
  const active = requireSession(ctx.session);
  const guilds = await ctx.deps.access.manageableGuilds(ctx.deps.auth.accessToken(active));
  send(ctx.res, 200, renderGuildList(active.username, guilds, ctx.csrfToken), "text/html; charset=utf-8", {
    "Cache-Control": "no-store",
  });
  return true;
}

export async function guildOverview(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const { session, guild } = await authorizeGuild(ctx.deps, ctx.session, guildId);
  const view = await ctx.deps.dashboard.view(guild);
  send(ctx.res, 200, renderOverview(session.username, view, ctx.csrfToken), "text/html; charset=utf-8", {
    "Cache-Control": "no-store",
  });
  return true;
}

export async function settingsPage(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const moduleId = params[1] as string;

  if (ctx.method === "GET") {
    const { session, guild } = await authorizeGuild(ctx.deps, ctx.session, guildId);
    const [{ module, form }, history] = await Promise.all([
      ctx.deps.dashboard.editor(guild, moduleId),
      ctx.deps.dashboard.history(guild.id, { moduleId }),
    ]);
    send(
      ctx.res,
      200,
      renderSettingsEditor(session.username, guild, module, form, ctx.csrfToken, {
        saved: ctx.url.searchParams.get("saved") === "1",
        history,
      }),
      "text/html; charset=utf-8",
      { "Cache-Control": "no-store" },
    );
    return true;
  }

  if (ctx.method === "POST") {
    // The form carries its CSRF token in the body, so parsing is part of the
    // token read. The gate still runs session -> guild auth -> CSRF in order.
    let body!: SettingsFormBody;
    const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
      body = await parseSettingsFormBody(ctx.req);
      return body.csrf;
    });

    const [{ module, form }, history] = await Promise.all([
      ctx.deps.dashboard.editor(write.guild, moduleId),
      ctx.deps.dashboard.history(write.guild.id, { moduleId }),
    ]);
    const parsed = parseSettingsForm(form, body.params);

    if (parsed.errors.size > 0) {
      send(
        ctx.res,
        400,
        renderSettingsEditor(write.session.username, write.guild, module, form, ctx.csrfToken, {
          submitted: body.params,
          rendered: parsed.rendered,
          fieldErrors: parsed.errors,
          formError: "Fix the highlighted fields. Nothing was saved.",
          history,
        }),
        "text/html; charset=utf-8",
        { "Cache-Control": "no-store" },
      );
      return true;
    }

    try {
      await ctx.deps.dashboard.update(write.guild, moduleId, parsed.patch, {
        actorId: write.session.userId,
        source: "dashboard",
      });
    } catch (error) {
      if (!(error instanceof SettingsValidationError)) throw error;
      const fieldErrors = new Map(
        error.issues.map((issue) => [issue.path, issue.message] as const),
      );
      send(
        ctx.res,
        400,
        renderSettingsEditor(write.session.username, write.guild, module, form, ctx.csrfToken, {
          submitted: body.params,
          rendered: parsed.rendered,
          fieldErrors,
          formError: error.message,
          history,
        }),
        "text/html; charset=utf-8",
        { "Cache-Control": "no-store" },
      );
      return true;
    }

    redirect(
      ctx.res,
      `/dashboard/guilds/${encodePathSegment(guildId)}/settings/${encodePathSegment(moduleId)}?saved=1`,
    );
    return true;
  }

  // Preserve the existing authorization-before-fallthrough behavior for an
  // unsupported method on an existing settings path.
  await authorizeGuild(ctx.deps, ctx.session, guildId);
  return false;
}
