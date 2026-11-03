import {
  planFingerprint,
  type SettingsPlanGuild,
  type SettingsPlanModule,
} from "./settings-plan";

/**
 * Built-in configuration templates.
 *
 * A template is a partial patch per module, not a second settings store and not
 * a second schema. The fleet preview merges each patch over the guild's current
 * settings and parses the result with that module's own Zod schema, so a
 * template can only produce values the bot would accept.
 *
 * Templates are intentionally small and opinionated. They never include channel
 * or role ids, because those are guild-specific; an operator still configures
 * destinations per guild. Custom saved templates are a later P6 slice.
 */

export interface ConfigTemplateModule {
  readonly moduleId: string;
  /** A partial patch; records are deep-merged over the guild's current values. */
  readonly patch: Readonly<Record<string, unknown>>;
}

export interface ConfigTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly modules: readonly ConfigTemplateModule[];
}

export const CONFIG_TEMPLATES: readonly ConfigTemplate[] = [
  {
    id: "alert-first",
    name: "Alert-first moderation",
    description:
      "Turn on every content filter in alert mode and keep dry-run on. Hits become review cases; nothing is deleted or timed out.",
    modules: [
      {
        moduleId: "moderation",
        patch: {
          enabled: true,
          dryRun: true,
          automod: {
            invites: "alert",
            links: "alert",
            profanity: "alert",
            zalgo: "alert",
          },
        },
      },
    ],
  },
  {
    id: "strict-moderation",
    name: "Strict moderation",
    description:
      "Enforce the filters: delete links, profanity and zalgo, time out invite spam and cap mentions at five. Turns dry-run off.",
    modules: [
      {
        moduleId: "moderation",
        patch: {
          enabled: true,
          dryRun: false,
          automod: {
            invites: "timeout",
            links: "delete",
            profanity: "delete",
            zalgo: "delete",
            maxMentions: 5,
          },
        },
      },
    ],
  },
  {
    id: "quiet-optional",
    name: "Quiet optional modules",
    description:
      "Disable AI (and every AI feature flag) and music. Cases, levels, logs and every other module are untouched.",
    modules: [
      {
        moduleId: "ai",
        patch: {
          enabled: false,
          chat: false,
          classification: false,
          deflection: false,
          explanations: false,
          summaries: false,
        },
      },
      {
        moduleId: "music",
        patch: { enabled: false },
      },
    ],
  },
];

export function findTemplate(id: string): ConfigTemplate | undefined {
  return CONFIG_TEMPLATES.find((template) => template.id === id);
}

export type TemplateModulePlan = SettingsPlanModule;
export type TemplateGuildPlan = SettingsPlanGuild;

export interface TemplatePlan {
  readonly template: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
  };
  readonly guilds: readonly TemplateGuildPlan[];
  readonly changeCount: number;
  readonly issueCount: number;
  readonly fingerprint: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep-merge a template patch over a guild's current settings.
 *
 * Records merge recursively so a template can set `automod.links` without
 * wiping an operator's `bannedWords`; arrays replace as one value, which is the
 * same rule the audit diff uses. Prototype keys are ignored on the way in.
 */
export function mergeSettings(
  base: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value)
      ? mergeSettings(current, value)
      : structuredClone(value);
  }
  return merged;
}

/**
 * A preview fingerprint binds an apply request to the exact plan that was shown.
 *
 * It covers the template id and every guild's schema-parsed target, so:
 * - a different selection or template produces a different fingerprint;
 * - a settings change between preview and apply invalidates the preview;
 * - the apply route can recompute the plan and refuse a stale form without
 *   keeping preview state in the session.
 */
export function templateFingerprint(
  templateId: string,
  guilds: readonly TemplateGuildPlan[],
): string {
  return planFingerprint(`template:${templateId}`, guilds);
}
