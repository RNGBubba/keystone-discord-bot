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
import { HttpError } from "./http-error";
import type { DiscordGuild } from "./oauth";
import {
  SECRET_SETTING_KEY,
  SettingsValidationError,
  buildSettingsForm,
  type SettingsFormModel,
} from "./settings-form";

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
