import { diffSettings, type AuditStore, type SettingsChangeContext } from "./audit";
import type { ConfigModuleView, ConfigPort } from "./config";
import type { ModuleRegistry } from "./registry";
import type { ModuleSettings } from "./types";

export interface SettingsRepository {
  get(guildId: string, moduleId: string): Promise<Record<string, unknown> | undefined>;
  set(guildId: string, moduleId: string, value: Record<string, unknown>): Promise<void>;
  clear(guildId: string, moduleId: string): Promise<void>;
}

/**
 * P0 backing store. Deliberately in-memory so the whole test suite runs with no
 * Postgres. P1 adds `DrizzleSettingsRepository` against the same interface and
 * this class is not touched.
 */
export class InMemorySettingsRepository implements SettingsRepository {
  readonly #data = new Map<string, Record<string, unknown>>();

  #key(guildId: string, moduleId: string): string {
    return `${guildId}:${moduleId}`;
  }

  async get(guildId: string, moduleId: string): Promise<Record<string, unknown> | undefined> {
    const value = this.#data.get(this.#key(guildId, moduleId));
    return value ? { ...value } : undefined;
  }

  async set(guildId: string, moduleId: string, value: Record<string, unknown>): Promise<void> {
    this.#data.set(this.#key(guildId, moduleId), { ...value });
  }

  async clear(guildId: string, moduleId: string): Promise<void> {
    this.#data.delete(this.#key(guildId, moduleId));
  }
}

/**
 * Drop explicit `undefined` values before persisting.
 *
 * Zod keeps an optional key that a caller explicitly set to `undefined`, but a
 * settings column is JSON: `undefined` has no representation, and a driver may
 * turn it into SQL NULL, which the same optional schema would reject on the
 * next read. A cleared optional field is represented by removing its key, so
 * that is what we store.
 */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)]),
  );
}

/**
 * Validates every read and write against the module's Zod schema. A module
 * cannot persist a value its own schema rejects, which is what keeps a bad
 * dashboard payload from corrupting a guild's config.
 *
 * When an `AuditStore` is wired, every real change (and every reset) appends
 * one row with the actor, the surface and the dotted-path diff. Tests and
 * embedded use may omit the store; the production composition roots do not.
 */
export class SettingsService implements ConfigPort {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly registry: ModuleRegistry,
    private readonly audit?: AuditStore,
  ) {}

  async list(guildId: string): Promise<ConfigModuleView[]> {
    return Promise.all(
      this.registry.listModules().map(async (module) => ({
        id: module.id,
        name: module.name,
        settings: await this.get(guildId, module.id),
      })),
    );
  }

  async get(guildId: string, moduleId: string): Promise<Record<string, unknown>> {
    const manifest = this.registry.requireModule(moduleId);
    const stored = await this.repository.get(guildId, moduleId);
    const merged = { ...manifest.defaultSettings, ...stored };
    return manifest.settingsSchema.parse(merged) as Record<string, unknown>;
  }

  async update(
    guildId: string,
    moduleId: string,
    patch: Record<string, unknown>,
    context: SettingsChangeContext = { source: "module" },
  ): Promise<Record<string, unknown>> {
    const manifest = this.registry.requireModule(moduleId);
    const current = await this.get(guildId, moduleId);
    const parsed = manifest.settingsSchema.parse({ ...current, ...patch }) as Record<string, unknown>;
    const next = stripUndefined(parsed) as Record<string, unknown>;
    await this.repository.set(guildId, moduleId, next);

    const changes = diffSettings(current, next);
    if (this.audit && Object.keys(changes).length > 0) {
      await this.audit.append({
        guildId,
        ...(context.actorId ? { actorId: context.actorId } : {}),
        action: "settings.update",
        targetId: moduleId,
        data: { moduleId, source: context.source, changes },
      });
    }
    return next;
  }

  async reset(
    guildId: string,
    moduleId: string,
    context: SettingsChangeContext = { source: "module" },
  ): Promise<void> {
    this.registry.requireModule(moduleId);
    // A reset must still work when the stored record no longer satisfies the
    // current schema; the audit row then has no previous effective values.
    const current = await this.get(guildId, moduleId).catch(() => ({}));
    await this.repository.clear(guildId, moduleId);
    if (this.audit) {
      await this.audit.append({
        guildId,
        ...(context.actorId ? { actorId: context.actorId } : {}),
        action: "settings.reset",
        targetId: moduleId,
        data: { moduleId, source: context.source, previous: current },
      });
    }
  }

  /** Bind the service to one module, which is what commands actually receive. */
  forModule(moduleId: string): ModuleSettings {
    this.registry.requireModule(moduleId);
    return {
      get: (guildId) => this.get(guildId, moduleId),
      update: (guildId, patch) => this.update(guildId, moduleId, patch),
    };
  }
}
