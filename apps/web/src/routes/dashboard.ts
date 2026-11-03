import {
  authorizeFleet,
  authorizeGuild,
  requireSession,
  requireSessionWrite,
  requireSettingsWrite,
} from "../authorization";
import { HttpError } from "../http-error";
import {
  encodePathSegment,
  parseBody,
  parseSettingsFormBody,
  redirect,
  send,
  type SettingsFormBody,
} from "../http";
import { renderFleet, renderGuildList, renderOverview, renderSettingsEditor, renderTemplatePreview } from "../render";
import type { RouteContext } from "../request-context";
import { SettingsValidationError, parseSettingsForm } from "../settings-form";
import { CONFIG_TEMPLATES, findTemplate } from "../templates";

const MAX_FLEET_GUILDS = 25;

interface FleetSelection {
  readonly templateId: string;
  readonly guildIds: readonly string[];
}

function readFleetSelection(params: URLSearchParams): FleetSelection {
  const templateId = (params.get("template") ?? "").trim();
  if (!templateId) throw new HttpError(400, "Choose a template.", "template_missing");

  const guildIds = [
    ...new Set(
      params
        .getAll("guild")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (guildIds.length === 0) {
    throw new HttpError(400, "Select at least one guild.", "guilds_missing");
  }
  if (guildIds.length > MAX_FLEET_GUILDS) {
    throw new HttpError(400, `Select at most ${MAX_FLEET_GUILDS} guilds at once.`, "guilds_too_many");
  }
  for (const guildId of guildIds) {
    if (!/^\d{15,20}$/.test(guildId)) {
      throw new HttpError(400, "One selected guild id is invalid.", "guild_invalid");
    }
  }
  return { templateId, guildIds };
}

function count(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function fleet(ctx: RouteContext): Promise<boolean> {
  const active = requireSession(ctx.session);
  const guilds = await ctx.deps.access.manageableGuilds(ctx.deps.auth.accessToken(active));
  const view = await ctx.deps.dashboard.fleet(guilds);
  send(
    ctx.res,
    200,
    renderFleet(active.username, view, CONFIG_TEMPLATES, ctx.csrfToken, {
      applied: count(ctx.url.searchParams.get("applied")),
      failed: count(ctx.url.searchParams.get("failed")),
    }),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function fleetPreview(ctx: RouteContext): Promise<boolean> {
  let params!: URLSearchParams;
  const active = await requireSessionWrite(ctx.deps, ctx.session, async () => {
    params = new URLSearchParams(await parseBody(ctx.req));
    return params.get("csrf") ?? undefined;
  });

  const selection = readFleetSelection(params);
  const template = findTemplate(selection.templateId);
  if (!template) throw new HttpError(404, "No such template.", "template_not_found");
  const guilds = await authorizeFleet(ctx.deps, active, selection.guildIds);
  const plan = await ctx.deps.dashboard.previewTemplate(guilds, template);

  send(
    ctx.res,
    200,
    renderTemplatePreview(active.username, plan, ctx.csrfToken),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function fleetApply(ctx: RouteContext): Promise<boolean> {
  let params!: URLSearchParams;
  const active = await requireSessionWrite(ctx.deps, ctx.session, async () => {
    params = new URLSearchParams(await parseBody(ctx.req));
    return params.get("csrf") ?? undefined;
  });

  const selection = readFleetSelection(params);
  const fingerprint = (params.get("fingerprint") ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new HttpError(
      400,
      "The preview fingerprint is missing. Preview the template before applying it.",
      "preview_missing",
    );
  }
  const template = findTemplate(selection.templateId);
  if (!template) throw new HttpError(404, "No such template.", "template_not_found");
  const guilds = await authorizeFleet(ctx.deps, active, selection.guildIds);

  const result = await ctx.deps.dashboard.applyTemplate(guilds, template, fingerprint, active.userId);
  for (const failure of result.failures) {
    ctx.deps.logger.warn("fleet template write failed", failure);
  }
  redirect(ctx.res, `/dashboard/fleet?applied=${result.modulesWritten}&failed=${result.failures.length}`);
  return true;
}

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
