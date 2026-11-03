import { de } from "./de";
import { en, type MessageCatalog, type MessageKey } from "./messages";

export { de } from "./de";
export { en } from "./messages";
export type { Catalog, MessageArgs, MessageFunction, MessageKey, MessageCatalog } from "./messages";

/** Every locale the bot ships. Adding one is a catalog plus this list. */
export const SUPPORTED_LOCALES = ["en", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** A missing message is said in words, never rendered as the raw key. */
export const FALLBACK_MESSAGE = "This message is unavailable.";

const CATALOGS: Record<Locale, MessageCatalog> = { en, de };

/** An unknown or malformed stored value resolves to the default locale. */
export function resolveLocale(value: unknown): Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as Locale)
    : DEFAULT_LOCALE;
}

/** The effective locale from a guild's setup settings record, validated. */
export function localeFromSettings(settings: unknown): Locale {
  if (!settings || typeof settings !== "object") return DEFAULT_LOCALE;
  return resolveLocale((settings as { locale?: unknown }).locale);
}

/**
 * The one fallback chain: requested locale → English → a plain sentence.
 * The key itself is never returned, because a raw key is not a user-facing
 * string and revealing one tells a user nothing they can act on.
 *
 * Exported with an injectable catalog so the missing-key branch is testable
 * without deleting a real translation.
 */
export function resolveMessage(
  catalogs: Partial<Record<string, MessageCatalog>>,
  locale: string,
  key: string,
  args: readonly unknown[] = [],
): string {
  const exact = catalogs[resolveLocale(locale)]?.[key];
  if (exact) return exact(...(args as never[]));
  const fallback = catalogs[DEFAULT_LOCALE]?.[key];
  if (fallback) return fallback(...(args as never[]));
  return FALLBACK_MESSAGE;
}

/**
 * Translate one typed key. The argument list is the English message's own, so a
 * translation that omits an interpolation or changes a plural argument's type
 * does not compile.
 */
export function t<K extends MessageKey>(
  locale: string,
  key: K,
  ...args: Parameters<(typeof en)[K]>
): string {
  return resolveMessage(CATALOGS, locale, key, args);
}

/**
 * A no-argument message for the locale, or undefined when that locale does not
 * translate it. Used for command descriptions, where the fallback is the
 * definition's English string rather than another catalog entry.
 */
export function lookupMessage(locale: string, key: string): string | undefined {
  const message = CATALOGS[resolveLocale(locale)]?.[key];
  return message ? message() : undefined;
}

/** The modules a locale lookup needs; `SettingsService` already satisfies it. */
export interface LocaleSource {
  list(guildId: string): Promise<ReadonlyArray<{ readonly id: string; readonly settings: Record<string, unknown> }>>;
  /** One module's settings. Present on `SettingsService`; avoids listing all. */
  get?(guildId: string, moduleId: string): Promise<Record<string, unknown> | undefined>;
}

/**
 * Read the effective locale from the setup module's stored settings. An absent
 * or unreadable settings service is not an error a user should see: the bot
 * renders in English and keeps working.
 *
 * `get` is preferred where the source has it: `list` parses every module's
 * schema and turns one locale read into a dozen queries on a large registry.
 */
export async function guildLocale(
  source: LocaleSource | undefined,
  guildId: string,
): Promise<Locale> {
  if (!source) return DEFAULT_LOCALE;
  try {
    if (source.get) return localeFromSettings(await source.get(guildId, "setup"));
    const view = await source.list(guildId);
    return localeFromSettings(view.find((module) => module.id === "setup")?.settings);
  } catch {
    return DEFAULT_LOCALE;
  }
}
