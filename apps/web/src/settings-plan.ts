import { createHash } from "node:crypto";
import type { SettingsValueChange } from "@keystone/kernel";
import type { SettingsIssue } from "./settings-form";

/**
 * A settings plan is the shape both a template preview and a config import
 * preview produce: one guild, the modules that would change, and the exact
 * before/after leaves. The apply routes reuse it, so the fingerprint rules and
 * the rendered diff cannot drift between the two features.
 */
export interface SettingsPlanModule {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly changes: Readonly<Record<string, SettingsValueChange>>;
  /** The schema-parsed result; absent when the module cannot be applied. */
  readonly target?: Readonly<Record<string, unknown>>;
  readonly issues: readonly SettingsIssue[];
}

export interface SettingsPlanGuild {
  readonly guild: { readonly id: string; readonly name: string };
  readonly modules: readonly SettingsPlanModule[];
  readonly changeCount: number;
  readonly issueCount: number;
}

/**
 * A fingerprint binds an apply request to the plan that was displayed.
 *
 * The seed names the source of the plan (a template id or a bundle checksum).
 * Each guild's modules are sorted, and each module contributes its target and
 * its sorted before/after leaves. A different selection, a different file or a
 * setting changed between preview and apply all produce a different value.
 */
export function planFingerprint(
  seed: string,
  guilds: readonly SettingsPlanGuild[],
): string {
  const canonical = {
    seed,
    guilds: [...guilds]
      .sort((left, right) => left.guild.id.localeCompare(right.guild.id))
      .map((guild) => ({
        guild: guild.guild.id,
        modules: guild.modules
          .filter((module) => module.issues.length === 0 && module.target)
          .sort((left, right) => left.moduleId.localeCompare(right.moduleId))
          .map((module) => ({
            module: module.moduleId,
            target: module.target,
            changes: Object.keys(module.changes)
              .sort()
              .map((path) => [path, module.changes[path]]),
          })),
      })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
