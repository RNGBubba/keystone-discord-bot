import { describe, expect, it } from "vitest";
import { setupDefaultSettings, setupSettingsSchema } from "./settings";

describe("setup settings", () => {
  it("defaults to English and the enabled setup module", () => {
    expect(setupDefaultSettings).toEqual({ enabled: true, locale: "en" });
  });

  it("accepts a supported locale and rejects an unsupported one", () => {
    expect(setupSettingsSchema.parse({ locale: "de" })).toMatchObject({ locale: "de" });
    expect(setupSettingsSchema.safeParse({ locale: "xx" }).success).toBe(false);
    expect(setupSettingsSchema.safeParse({ locale: "DE" }).success).toBe(false);
  });
});
