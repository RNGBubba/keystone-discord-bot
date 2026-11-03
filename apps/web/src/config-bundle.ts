import { createHash } from "node:crypto";
import { canonicalJson } from "@keystone/importer";
import type { ModuleRegistry } from "@keystone/kernel";
import { HttpError } from "./http-error";
import type { SettingsPlanGuild } from "./settings-plan";
import { SECRET_SETTING_KEY, type SettingsIssue } from "./settings-form";

/**
 * A config bundle is the settings half of a guild, not a full backup.
 *
 * The importer's bundle carries cases, members, levels and transcripts; this
 * file carries only the per-module settings the dashboard can preview and
 * write. Every module has its own `version` so a future schema change is visible
 * in the file, and the checksum covers the exact content so a hand-edited file
 * is refused before any value is applied.
 *
 * Settings whose names look like secrets are omitted on export. That makes a
 * bundle safe to keep in a pastebin, but it also means an import cannot restore
 * a token; the module's own value stays in place.
 */
export const CONFIG_BUNDLE_KIND = "keystone.config";
export const CONFIG_BUNDLE_VERSION = 1;
const MAX_CONFIG_BYTES = 1_048_576;

export interface ConfigBundleModule {
  readonly id: string;
  readonly version: string;
  readonly settings: Record<string, unknown>;
}

export interface ConfigBundle {
  readonly schemaVersion: typeof CONFIG_BUNDLE_VERSION;
  readonly kind: typeof CONFIG_BUNDLE_KIND;
  readonly sourceGuildId: string;
  readonly exportedAt: string;
  readonly modules: readonly ConfigBundleModule[];
  readonly checksum: string;
}

type ConfigBundleContent = Omit<ConfigBundle, "checksum">;

export interface ConfigPlan {
  readonly bundle: {
    readonly checksum: string;
    readonly sourceGuildId: string;
    readonly exportedAt: string;
    readonly moduleCount: number;
  };
  readonly guild: { readonly id: string; readonly name: string };
  readonly modules: SettingsPlanGuild["modules"];
  readonly changeCount: number;
  readonly issueCount: number;
  readonly fingerprint: string;
}

export interface ConfigDriftBaseline {
  readonly checksum: string;
  readonly source: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly exportedAt: string;
  readonly sourceGuildId: string;
}

export interface ConfigDrift {
  readonly baseline: ConfigDriftBaseline | null;
  readonly guild: { readonly id: string; readonly name: string };
  readonly modules: SettingsPlanGuild["modules"];
  readonly changeCount: number;
  readonly issueCount: number;
  /** A stored baseline that no longer parses; the page reports it, not hides it. */
  readonly error?: string;
}

/** A 4xx with the same field-path issues the settings form uses. */
export class ConfigBundleError extends HttpError {
  constructor(readonly issues: readonly SettingsIssue[]) {
    super(
      400,
      `The config bundle was refused: ${issues
        .slice(0, 5)
        .map((issue) => `${issue.path || "(root)"}: ${issue.message}`)
        .join("; ")}${issues.length > 5 ? `; and ${issues.length - 5} more` : ""}`,
      "config_bundle_invalid",
    );
    this.name = "ConfigBundleError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Never write a credential-shaped setting into a downloadable file. */
function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_SETTING_KEY.test(key))
      .map(([key, entry]) => [key, withoutSecrets(entry)]),
  );
}

function contentOf(bundle: ConfigBundleContent): ConfigBundleContent {
  return {
    schemaVersion: bundle.schemaVersion,
    kind: bundle.kind,
    sourceGuildId: bundle.sourceGuildId,
    exportedAt: bundle.exportedAt,
    modules: [...bundle.modules]
      .map((module) => ({
        id: module.id,
        version: module.version,
        settings: module.settings,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/** The one checksum rule: canonical content, no checksum field inside it. */
export function configChecksum(content: ConfigBundleContent): string {
  return createHash("sha256").update(canonicalJson(contentOf(content))).digest("hex");
}

export function createConfigBundle(
  sourceGuildId: string,
  modules: readonly ConfigBundleModule[],
  at: number = Date.now(),
): ConfigBundle {
  const content: ConfigBundleContent = {
    schemaVersion: CONFIG_BUNDLE_VERSION,
    kind: CONFIG_BUNDLE_KIND,
    sourceGuildId,
    exportedAt: new Date(at).toISOString(),
    modules: [...modules]
      .map((module) => ({
        id: module.id,
        version: module.version,
        settings: withoutSecrets(structuredClone(module.settings)) as Record<string, unknown>,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  return { ...content, checksum: configChecksum(content) };
}

/**
 * Parse and verify a config bundle before the preview reads any setting.
 *
 * Order matters: structure, then checksum, then each module's own schema. A
 * checksum failure is reported alone because every other message would be
 * noise over a file that is already known to be edited.
 */
export function parseConfigBundle(value: unknown, registry: ModuleRegistry): ConfigBundle {
  const issues: SettingsIssue[] = [];
  const add = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (!isRecord(value)) {
    throw new ConfigBundleError([{ path: "(root)", message: "Expected a JSON object." }]);
  }

  if (value.schemaVersion !== CONFIG_BUNDLE_VERSION) {
    add(
      "schemaVersion",
      `Expected ${CONFIG_BUNDLE_VERSION}; this build cannot read version ${String(value.schemaVersion)}.`,
    );
  }
  if (value.kind !== CONFIG_BUNDLE_KIND) {
    add("kind", `Expected "${CONFIG_BUNDLE_KIND}".`);
  }
  const sourceGuildId = typeof value.sourceGuildId === "string" ? value.sourceGuildId.trim() : "";
  if (!sourceGuildId) add("sourceGuildId", "A source guild id is required.");
  const exportedAt =
    typeof value.exportedAt === "string" && !Number.isNaN(Date.parse(value.exportedAt))
      ? value.exportedAt
      : "";
  if (!exportedAt) add("exportedAt", "An ISO timestamp is required.");

  const checksum =
    typeof value.checksum === "string" && /^[a-f0-9]{64}$/.test(value.checksum)
      ? value.checksum
      : "";
  if (!checksum) add("checksum", "A SHA-256 hex checksum is required.");

  const modules: ConfigBundleModule[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(value.modules)) {
    add("modules", "An array of modules is required.");
  } else {
    value.modules.forEach((entry, index) => {
      const path = `modules[${index}]`;
      if (!isRecord(entry)) {
        add(path, "Expected an object.");
        return;
      }
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (!id) add(`${path}.id`, "A module id is required.");
      if (id && seen.has(id)) add(`${path}.id`, `Module "${id}" appears twice.`);
      if (id) seen.add(id);
      const version = typeof entry.version === "string" ? entry.version.trim() : "";
      if (!version) add(`${path}.version`, "A module version is required.");
      if (!isRecord(entry.settings)) {
        add(`${path}.settings`, "An object of settings is required.");
        return;
      }
      if (id && version) modules.push({ id, version, settings: entry.settings });
    });
  }

  for (const registered of registry.listModules()) {
    if (!seen.has(registered.id)) {
      add("modules", `Module "${registered.id}" is missing from the bundle.`);
    }
  }
  for (const id of seen) {
    if (!registry.getModule(id)) {
      add("modules", `Module "${id}" is not registered in this build.`);
    }
  }

  if (issues.length > 0) throw new ConfigBundleError(issues);

  const content: ConfigBundleContent = {
    schemaVersion: CONFIG_BUNDLE_VERSION,
    kind: CONFIG_BUNDLE_KIND,
    sourceGuildId,
    exportedAt,
    modules,
  };
  const actual = configChecksum(content);
  if (actual !== checksum) {
    throw new ConfigBundleError([
      {
        path: "checksum",
        message: "The checksum does not match the file contents; it was edited or corrupted.",
      },
    ]);
  }

  const schemaIssues: SettingsIssue[] = [];
  for (const module of modules) {
    const registered = registry.getModule(module.id);
    if (!registered) continue;
    const parsed = registered.settingsSchema.safeParse(module.settings);
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      schemaIssues.push({
        path: `${module.id}.${issue.path.join(".") || "(root)"}`,
        message: issue.message,
      });
    }
  }
  if (schemaIssues.length > 0) throw new ConfigBundleError(schemaIssues);

  return {
    schemaVersion: CONFIG_BUNDLE_VERSION,
    kind: CONFIG_BUNDLE_KIND,
    sourceGuildId,
    exportedAt,
    modules: [...modules].sort((left, right) => left.id.localeCompare(right.id)),
    checksum,
  };
}

export function parseConfigBundleText(text: string, registry: ModuleRegistry): ConfigBundle {
  if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) {
    throw new HttpError(
      400,
      `The config file is larger than ${MAX_CONFIG_BYTES / 1024} KB.`,
      "config_bundle_too_large",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "The config file is not valid JSON.", "config_bundle_invalid_json");
  }
  return parseConfigBundle(raw, registry);
}
