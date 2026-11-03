import {
  authorizeFleet,
  authorizeGuild,
  requireSession,
  requireSessionWrite,
  requireSettingsWrite,
} from "../authorization";
import { HttpError } from "../http-error";
import { ConfigBundleError, type ConfigBundle } from "../config-bundle";
import {
  encodePathSegment,
  parseBody,
  parseConfigUpload,
  parseSettingsFormBody,
  redirect,
  send,
  type ConfigUpload,
  type SettingsFormBody,
} from "../http";
import {
  renderConfigDrift,
  renderConfigPreview,
  renderFleet,
  renderGuildList,
  renderOverview,
  renderSavedTemplateEditor,
  renderSavedTemplates,
  renderSettingsEditor,
  renderTemplatePreview,
} from "../render";
import type { RouteContext } from "../request-context";
import { SettingsValidationError, parseSettingsForm } from "../settings-form";
import { CONFIG_TEMPLATES, findTemplate } from "../templates";

const MAX_FLEET_GUILDS = 25;

interface FleetSelection {
  readonly templateId: string;
  readonly guildIds: readonly string[];
}

function readGuildIds(params: URLSearchParams): readonly string[] {
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
  return guildIds;
}

function readFleetSelection(params: URLSearchParams): FleetSelection {
  const templateId = (params.get("template") ?? "").trim();
  if (!templateId) throw new HttpError(400, "Choose a template.", "template_missing");
  return { templateId, guildIds: readGuildIds(params) };
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

export async function configExport(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const { guild } = await authorizeGuild(ctx.deps, ctx.session, guildId);
  const bundle = await ctx.deps.dashboard.exportConfig(guild);
  send(ctx.res, 200, `${JSON.stringify(bundle, null, 2)}\n`, "application/json; charset=utf-8", {
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="keystone-config-${guild.id}.json"`,
  });
  return true;
}

export async function configDriftPage(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const { session, guild } = await authorizeGuild(ctx.deps, ctx.session, guildId);
  const drift = await ctx.deps.dashboard.configDrift(guild);
  send(
    ctx.res,
    200,
    renderConfigDrift(session.username, guild, drift, ctx.csrfToken, {
      imported: count(ctx.url.searchParams.get("imported")),
      failed: count(ctx.url.searchParams.get("failed")),
    }),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function configImportPreview(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  let upload!: ConfigUpload;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    upload = await parseConfigUpload(ctx.req);
    return upload.csrf;
  });
  if (!upload.text.trim()) {
    throw new HttpError(400, "Choose a config file to import.", "config_file_missing");
  }

  let bundle: ConfigBundle;
  try {
    bundle = ctx.deps.dashboard.parseConfig(upload.text);
  } catch (error) {
    if (!(error instanceof ConfigBundleError)) throw error;
    const drift = await ctx.deps.dashboard.configDrift(write.guild);
    send(
      ctx.res,
      400,
      renderConfigDrift(write.session.username, write.guild, drift, ctx.csrfToken, {
        importError: error.message,
      }),
      "text/html; charset=utf-8",
      { "Cache-Control": "no-store" },
    );
    return true;
  }

  const plan = await ctx.deps.dashboard.previewConfigImport(write.guild, bundle);
  send(
    ctx.res,
    200,
    renderConfigPreview(write.session.username, plan, upload.text, ctx.csrfToken),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function configImportApply(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  let upload!: ConfigUpload;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    upload = await parseConfigUpload(ctx.req);
    return upload.csrf;
  });
  if (!upload.text.trim()) {
    throw new HttpError(400, "Choose a config file to import.", "config_file_missing");
  }

  const fingerprint = (upload.fields.get("fingerprint") ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new HttpError(
      400,
      "The preview fingerprint is missing. Preview the config before applying it.",
      "preview_missing",
    );
  }

  const bundle = ctx.deps.dashboard.parseConfig(upload.text);
  const result = await ctx.deps.dashboard.applyConfigImport(
    write.guild,
    bundle,
    fingerprint,
    write.session.userId,
  );
  for (const failure of result.failures) {
    ctx.deps.logger.warn("config import write failed", {
      guildId: write.guild.id,
      moduleId: failure.moduleId,
      message: failure.message,
    });
  }
  redirect(
    ctx.res,
    `/dashboard/guilds/${encodePathSegment(guildId)}/config/drift?imported=${result.modulesWritten}&failed=${result.failures.length}`,
  );
  return true;
}

export async function templatesPage(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const { session, guild } = await authorizeGuild(ctx.deps, ctx.session, guildId);
  const templates = await ctx.deps.dashboard.listSavedTemplates(guild);
  send(
    ctx.res,
    200,
    renderSavedTemplates(session.username, guild, templates, ctx.csrfToken, {
      created: ctx.url.searchParams.get("created") === "1",
      deleted: ctx.url.searchParams.get("deleted") === "1",
    }),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function templateCreate(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  let body!: URLSearchParams;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });
  const template = await ctx.deps.dashboard.createSavedTemplate(
    write.guild,
    {
      name: body.get("name") ?? "",
      description: body.get("description") ?? "",
    },
    write.session.userId,
  );
  redirect(
    ctx.res,
    `/dashboard/guilds/${encodePathSegment(guildId)}/templates/${encodePathSegment(template.id)}?created=1`,
  );
  return true;
}

export async function templateEditorPage(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const templateId = params[1] as string;
  const { session, guild } = await authorizeGuild(ctx.deps, ctx.session, guildId);
  const [template, targets, history] = await Promise.all([
    ctx.deps.dashboard.savedTemplate(guild, templateId),
    ctx.deps.access.manageableGuilds(ctx.deps.auth.accessToken(session)),
    ctx.deps.dashboard.history(guild.id, { targetId: templateId, limit: 12 }),
  ]);
  send(
    ctx.res,
    200,
    renderSavedTemplateEditor(session.username, guild, template, targets, ctx.csrfToken, {
      created: ctx.url.searchParams.get("created") === "1",
      updated: ctx.url.searchParams.get("saved") === "1",
      applied: count(ctx.url.searchParams.get("applied")),
      failed: count(ctx.url.searchParams.get("failed")),
      history,
    }),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function templateUpdate(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const templateId = params[1] as string;
  let body!: URLSearchParams;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });
  await ctx.deps.dashboard.updateSavedTemplate(
    write.guild,
    templateId,
    {
      name: body.get("name") ?? "",
      description: body.get("description") ?? "",
      refreshSettings: body.get("refresh") === "1",
    },
    write.session.userId,
  );
  redirect(
    ctx.res,
    `/dashboard/guilds/${encodePathSegment(guildId)}/templates/${encodePathSegment(templateId)}?saved=1`,
  );
  return true;
}

export async function templateDelete(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const templateId = params[1] as string;
  let body!: URLSearchParams;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });
  await ctx.deps.dashboard.deleteSavedTemplate(write.guild, templateId, write.session.userId);
  redirect(ctx.res, `/dashboard/guilds/${encodePathSegment(guildId)}/templates?deleted=1`);
  return true;
}

export async function templatePreview(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const templateId = params[1] as string;
  let body!: URLSearchParams;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });
  const targets = await authorizeFleet(ctx.deps, write.session, readGuildIds(body));
  const template = await ctx.deps.dashboard.savedTemplateRecord(write.guild, templateId);
  const plan = await ctx.deps.dashboard.previewSavedTemplate(targets, template);
  send(
    ctx.res,
    200,
    renderTemplatePreview(write.session.username, plan, ctx.csrfToken, {
      applyAction: `/dashboard/guilds/${encodePathSegment(guildId)}/templates/${encodePathSegment(templateId)}/apply`,
      includeTemplateField: false,
      backHref: `/dashboard/guilds/${encodePathSegment(guildId)}/templates/${encodePathSegment(templateId)}`,
      backLabel: "Back to the template",
    }),
    "text/html; charset=utf-8",
    { "Cache-Control": "no-store" },
  );
  return true;
}

export async function templateApply(
  ctx: RouteContext,
  params: readonly string[],
): Promise<boolean> {
  const guildId = params[0] as string;
  const templateId = params[1] as string;
  let body!: URLSearchParams;
  const write = await requireSettingsWrite(ctx.deps, ctx.session, guildId, async () => {
    body = new URLSearchParams(await parseBody(ctx.req));
    return body.get("csrf") ?? undefined;
  });
  const fingerprint = (body.get("fingerprint") ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new HttpError(
      400,
      "The preview fingerprint is missing. Preview the saved template before applying it.",
      "preview_missing",
    );
  }
  const targets = await authorizeFleet(ctx.deps, write.session, readGuildIds(body));
  const template = await ctx.deps.dashboard.savedTemplateRecord(write.guild, templateId);
  const result = await ctx.deps.dashboard.applySavedTemplate(
    targets,
    template,
    fingerprint,
    write.session.userId,
  );
  for (const failure of result.failures) {
    ctx.deps.logger.warn("saved template write failed", failure);
  }
  redirect(
    ctx.res,
    `/dashboard/guilds/${encodePathSegment(guildId)}/templates/${encodePathSegment(templateId)}?applied=${result.modulesWritten}&failed=${result.failures.length}`,
  );
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
