import { ZodError } from "zod";
import type {
  AuditEventRecord,
  AuditStore,
  DashboardOverview,
  DashboardStore,
  ModuleManifest,
  ModuleRegistry,
  SettingsChangeContext,
  SettingsService,
} from "@keystone/kernel";
import { diffSettings } from "@keystone/kernel";
import { HttpError } from "./http-error";
import type { DiscordGuild } from "./oauth";
import {
  SECRET_SETTING_KEY,
  SettingsValidationError,
  buildSettingsForm,
  type SettingsFormModel,
} from "./settings-form";
import {
  mergeSettings,
  templateFingerprint,
  type ConfigTemplate,
  type TemplateGuildPlan,
  type TemplateModulePlan,
  type TemplatePlan,
} from "./templates";

export interface DashboardModule {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface DashboardView {
  guild: {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
  };
  joinedAt: string | null;
  counts: DashboardOverview["counts"];
  latestImport: DashboardOverview["latestImport"];
  modules: DashboardModule[];
}

export interface FleetModule {
  readonly id: string;
  readonly name: string;
  /** `null` means the stored settings could not be read against the schema. */
  readonly enabled: boolean | null;
}

export interface FleetGuild {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly owner: boolean;
  readonly modules: readonly FleetModule[];
  readonly enabledCount: number;
}

export interface FleetView {
  readonly guilds: readonly FleetGuild[];
}

export interface TemplateApplyResult {
  readonly guilds: number;
  readonly modulesWritten: number;
  readonly failures: readonly { readonly guildId: string; readonly moduleId: string }[];
}

/** Never ship a credential-shaped setting to a browser, even by accident. */
function safeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === "object") return safeSettings(value as Record<string, unknown>);
  return value;
}

function safeSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings)
      .filter(([key]) => !SECRET_SETTING_KEY.test(key))
      .map(([key, value]) => [key, safeValue(value)]),
  );
}

/** Cross-realm and duplicated-zod safe: `instanceof` alone can miss a ZodError. */
function zodIssues(error: unknown): ZodError["issues"] | undefined {
  if (error instanceof ZodError) return error.issues;
  const candidate = error as { name?: unknown; issues?: unknown } | null;
  if (candidate?.name === "ZodError" && Array.isArray(candidate.issues)) {
    return candidate.issues as ZodError["issues"];
  }
  return undefined;
}

export interface DashboardEditor {
  readonly module: DashboardModule;
  readonly form: SettingsFormModel;
}

/**
 * Composes the existing `SettingsService` with the dashboard read model and the
 * narrow settings write path. No SQL here: Postgres lives in
 * `DrizzleDashboardStore`; HTTP lives in the server. This class is the one place
 * that shapes the browser-safe view and maps schema errors to HTTP.
 */
export class DashboardService {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly settings: SettingsService,
    private readonly store: DashboardStore,
    private readonly audit?: AuditStore,
  ) {}

  private present(module: ModuleManifest, values: Record<string, unknown>): DashboardModule {
    const settings = safeSettings(values);
    return {
      id: module.id,
      name: module.name,
      description: module.description,
      version: module.version,
      enabled: settings.enabled !== false,
      settings,
    };
  }

  async view(guild: DiscordGuild): Promise<DashboardView> {
    const [overview, modules] = await Promise.all([
      this.store.overview(guild.id),
      Promise.all(
        this.registry.listModules().map(async (module) =>
          this.present(module, await this.settings.get(guild.id, module.id)),
        ),
      ),
    ]);

    return {
      guild: { id: guild.id, name: guild.name, icon: guild.icon, owner: guild.owner },
      joinedAt: overview.joinedAt,
      counts: overview.counts,
      latestImport: overview.latestImport,
      modules,
    };
  }

  /**
   * One row per guild the caller can manage, with the enabled modules only.
   * A stored record that no longer parses marks that module as unreadable
   * instead of taking the whole fleet page down.
   */
  async fleet(guilds: readonly DiscordGuild[]): Promise<FleetView> {
    const rows = await Promise.all(
      guilds.map(async (guild) => {
        const modules: FleetModule[] = await Promise.all(
          this.registry.listModules().map(async (module) => {
            let enabled: boolean | null = null;
            try {
              enabled = (await this.settings.get(guild.id, module.id)).enabled !== false;
            } catch {
              enabled = null;
            }
            return { id: module.id, name: module.name, enabled };
          }),
        );
        return {
          id: guild.id,
          name: guild.name,
          icon: guild.icon,
          owner: guild.owner,
          modules,
          enabledCount: modules.filter((module) => module.enabled === true).length,
        };
      }),
    );
    return { guilds: rows };
  }

  /**
   * Build the preview for a template without writing anything.
   *
   * Each patch is deep-merged over the guild's current settings and parsed by
   * the module's own schema, then diffed with the same helper the audit trail
   * uses. A module with no effective change is omitted; a schema issue keeps
   * the module in the plan with no target, so apply can refuse the whole
   * preview instead of writing part of it.
   */
  async previewTemplate(
    guilds: readonly DiscordGuild[],
    template: ConfigTemplate,
  ): Promise<TemplatePlan> {
    const plans: TemplateGuildPlan[] = [];

    for (const guild of guilds) {
      const modules: TemplateModulePlan[] = [];

      for (const entry of template.modules) {
        const module = this.registry.getModule(entry.moduleId);
        if (!module) {
          modules.push({
            moduleId: entry.moduleId,
            moduleName: entry.moduleId,
            changes: {},
            issues: [{ path: entry.moduleId, message: "This module is not registered." }],
          });
          continue;
        }

        let current: Record<string, unknown>;
        try {
          current = await this.settings.get(guild.id, entry.moduleId);
        } catch (error) {
          const issues = zodIssues(error);
          if (!issues) throw error;
          modules.push({
            moduleId: module.id,
            moduleName: module.name,
            changes: {},
            issues: issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          });
          continue;
        }

        const parsed = module.settingsSchema.safeParse(mergeSettings(current, entry.patch));
        if (!parsed.success) {
          modules.push({
            moduleId: module.id,
            moduleName: module.name,
            changes: {},
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          });
          continue;
        }

        const target = parsed.data as Record<string, unknown>;
        const changes = diffSettings(current, target);
        if (Object.keys(changes).length === 0) continue;
        modules.push({
          moduleId: module.id,
          moduleName: module.name,
          changes,
          target,
          issues: [],
        });
      }

      plans.push({
        guild: { id: guild.id, name: guild.name },
        modules,
        changeCount: modules.reduce((count, module) => count + Object.keys(module.changes).length, 0),
        issueCount: modules.reduce((count, module) => count + module.issues.length, 0),
      });
    }

    return {
      template: { id: template.id, name: template.name, description: template.description },
      guilds: plans,
      changeCount: plans.reduce((count, guild) => count + guild.changeCount, 0),
      issueCount: plans.reduce((count, guild) => count + guild.issueCount, 0),
      fingerprint: templateFingerprint(template.id, plans),
    };
  }

  /**
   * Apply a previewed template.
   *
   * The plan is recomputed from current settings and must match the fingerprint
   * the browser submitted, so an apply cannot race a settings change and a
   * direct POST without a preview is refused. Every module write goes through
   * `SettingsService.update`, which appends the audit row; there is no parallel
   * write path. A failure is reported by guild/module and does not stop the
   * remaining writes.
   */
  async applyTemplate(
    guilds: readonly DiscordGuild[],
    template: ConfigTemplate,
    fingerprint: string,
    actorId?: string,
  ): Promise<TemplateApplyResult> {
    const plan = await this.previewTemplate(guilds, template);
    if (plan.issueCount > 0) {
      throw new HttpError(
        400,
        "The template does not validate against the current module schemas. Nothing was applied.",
        "template_invalid",
      );
    }
    if (plan.fingerprint !== fingerprint) {
      throw new HttpError(
        409,
        "The preview is out of date. Preview the template again before applying it.",
        "preview_stale",
      );
    }

    let modulesWritten = 0;
    const failures: { guildId: string; moduleId: string }[] = [];
    for (const guildPlan of plan.guilds) {
      for (const modulePlan of guildPlan.modules) {
        if (!modulePlan.target) continue;
        try {
          await this.settings.update(guildPlan.guild.id, modulePlan.moduleId, modulePlan.target, {
            ...(actorId ? { actorId } : {}),
            source: "dashboard",
          });
          modulesWritten += 1;
        } catch {
          failures.push({ guildId: guildPlan.guild.id, moduleId: modulePlan.moduleId });
        }
      }
    }

    return { guilds: plan.guilds.length, modulesWritten, failures };
  }

  async module(guild: DiscordGuild, moduleId: string): Promise<DashboardModule> {
    const module = this.registry.getModule(moduleId);
    if (!module) throw new HttpError(404, "No such module.", "module_not_found");
    return this.present(module, await this.settings.get(guild.id, moduleId));
  }

  /**
   * The editable view: the browser-safe module summary plus the widget model
   * derived from the same schema the write path validates against.
   */
  async editor(guild: DiscordGuild, moduleId: string): Promise<DashboardEditor> {
    const module = this.registry.getModule(moduleId);
    if (!module) throw new HttpError(404, "No such module.", "module_not_found");
    const values = await this.settings.get(guild.id, moduleId);
    return {
      module: this.present(module, values),
      form: buildSettingsForm(module.settingsSchema, values),
    };
  }

  /** Newest-first audit rows for one guild, optionally filtered to one module. */
  async history(
    guildId: string,
    options: { moduleId?: string; limit?: number } = {},
  ): Promise<readonly AuditEventRecord[]> {
    if (!this.audit) return [];
    const rows = await this.audit.list(guildId, 100);
    return rows
      .filter((row) => !options.moduleId || row.targetId === options.moduleId)
      .slice(0, Math.min(Math.max(options.limit ?? 8, 1), 20));
  }

  /**
   * The one write path for module settings. The module's own Zod schema is the
   * validator, so the dashboard cannot save a value the bot would reject. The
   * caller has already passed the OAuth/bot authorization gate and CSRF check.
   * `SettingsService` appends the audit row; this method only shapes the view
   * and turns schema issues into field-level errors.
   */
  async update(
    guild: DiscordGuild,
    moduleId: string,
    patch: Record<string, unknown>,
    context: SettingsChangeContext = { source: "dashboard" },
  ): Promise<DashboardModule> {
    const module = this.registry.getModule(moduleId);
    if (!module) throw new HttpError(404, "No such module.", "module_not_found");
    try {
      const values = await this.settings.update(guild.id, moduleId, patch, context);
      return this.present(module, values);
    } catch (error) {
      const issues = zodIssues(error);
      if (issues) {
        throw new SettingsValidationError(
          issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        );
      }
      throw error;
    }
  }
}
