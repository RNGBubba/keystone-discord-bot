import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  FALLBACK_MESSAGE,
  SUPPORTED_LOCALES,
  de,
  en,
  guildLocale,
  localeFromSettings,
  lookupMessage,
  resolveLocale,
  resolveMessage,
  t,
} from "./index";

describe("catalog parity", () => {
  it("has the same keys in every locale", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(de).sort()).toEqual(keys);
  });

  it("declares the same argument count for every key", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(de[key].length, key).toBe(en[key].length);
    }
  });

  it("keeps the plural and name arguments present in German", () => {
    expect(t("de", "form.submit.received", "abc", 1)).toContain("1 Antwort.");
    expect(t("de", "form.submit.received", "abc", 2)).toContain("2 Antworten.");
    expect(t("de", "form.errors.missing", "tz")).toBe("Pflichtfeld fehlt: tz.");
    expect(t("de", "form.review.pending", 1, "staff", "line")).toContain("1 offene Bewerbung");
    expect(t("de", "form.review.pending", 2, "staff", "line")).toContain("2 offene Bewerbungen");
  });

  it("interpolates the English strings without a template engine", () => {
    expect(t("en", "form.panel.description", "Staff")).toBe(
      "Applications for **Staff** are open. Staff review every submission.",
    );
    expect(t("en", "form.errors.missing", "why")).toBe("Missing required field: why.");
    expect(t("en", "form.errors.missing", "why, tz")).toBe("Missing required fields: why, tz.");
  });
});

describe("fallbacks", () => {
  it("falls back to English when a locale omits a key", () => {
    const partial = { en, de: { "component.noPermission": de["component.noPermission"] } };
    expect(resolveMessage(partial, "de", "component.expired")).toBe(
      en["component.expired"](),
    );
  });

  it("returns a sentence, never the raw key, when no catalog has it", () => {
    const message = resolveMessage({}, "de", "form.this.key.does.not.exist");
    expect(message).toBe(FALLBACK_MESSAGE);
    expect(message).not.toContain("form.this.key");
  });

  it("treats an unsupported locale as the default", () => {
    expect(resolveLocale("xx")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(localeFromSettings({ locale: "de" })).toBe("de");
    expect(localeFromSettings({ locale: "xx" })).toBe(DEFAULT_LOCALE);
    expect(t("xx", "component.expired")).toBe(en["component.expired"]());
  });

  it("returns undefined for a command description a locale does not ship", () => {
    expect(lookupMessage("de", "command.form.description")).toContain("Bewerbungsformulare");
    expect(lookupMessage("de", "command.unregistered-probe.description")).toBeUndefined();
    expect(SUPPORTED_LOCALES).toEqual(["en", "de"]);
  });
});

describe("guildLocale", () => {
  const source = (settings: Record<string, unknown> | Error) => ({
    async list() {
      if (settings instanceof Error) throw settings;
      return [{ id: "setup", settings }];
    },
  });

  it("reads the setup module's locale", async () => {
    expect(await guildLocale(source({ locale: "de" }), "g")).toBe("de");
    expect(await guildLocale(source({ locale: "zz" }), "g")).toBe("en");
    expect(await guildLocale(source({}), "g")).toBe("en");
  });

  it("falls back to English when the settings service is absent or failing", async () => {
    expect(await guildLocale(undefined, "g")).toBe("en");
    expect(await guildLocale(source(new Error("db down")), "g")).toBe("en");
  });
});
