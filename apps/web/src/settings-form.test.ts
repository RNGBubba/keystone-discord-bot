import { describe, expect, it } from "vitest";
import { modules } from "@keystone/module-catalog";
import {
  SECRET_SETTING_KEY,
  buildSettingsForm,
  labelFor,
  parseSettingsForm,
  type SettingsField,
} from "./settings-form";

function moderationSchema() {
  const module = modules.find((candidate) => candidate.id === "moderation");
  if (!module) throw new Error("moderation module is missing");
  return module.settingsSchema;
}

function allFields(form: ReturnType<typeof buildSettingsForm>): SettingsField[] {
  return [...form.fields];
}

function value(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe("schema-driven settings form", () => {
  it("maps every registered module to widgets without exposing credential-shaped keys", () => {
    for (const module of modules) {
      const form = buildSettingsForm(module.settingsSchema, module.defaultSettings);
      expect(form.fields.length).toBeGreaterThan(0);
      const paths = form.fields.map((field) => field.path);
      expect(new Set(paths).size).toBe(paths.length);
      for (const path of paths) {
        expect(SECRET_SETTING_KEY.test(path.split(".").at(-1) ?? "")).toBe(false);
      }
    }
  });

  it("chooses a real widget for booleans, numbers, enums, strings, arrays and records", () => {
    const schema = moderationSchema();
    const form = buildSettingsForm(schema, schema.parse({}));
    const fields = new Map(allFields(form).map((field) => [field.path, field]));

    expect(fields.get("enabled")).toMatchObject({ kind: "boolean", value: true });
    expect(fields.get("automod.zalgoThreshold")).toMatchObject({
      kind: "number",
      min: 1,
      max: 100,
      step: 1,
    });
    expect(fields.get("automod.links")).toMatchObject({
      kind: "select",
      options: ["off", "alert", "delete"],
    });
    expect(fields.get("modLogChannelId")).toMatchObject({
      kind: "text",
      optional: true,
    });
    expect(fields.get("automod.linkBlocklist")).toMatchObject({
      kind: "lines",
      itemType: "string",
    });
    expect(
      buildSettingsForm(
        modules.find((module) => module.id === "community")!.settingsSchema,
        modules.find((module) => module.id === "community")!.defaultSettings,
      ).fields.find((field) => field.path === "starboard.overrides"),
    ).toMatchObject({ kind: "json" });
  });

  it("uses human labels and avoids leaking raw camelCase in common acronyms", () => {
    expect(labelFor("monthlyBudgetUsd")).toBe("Monthly budget USD");
    expect(labelFor("modLogChannelId")).toBe("Mod log channel ID");
    expect(labelFor("antiRaid")).toBe("Anti raid");
  });

  it("parses named widgets back into a nested patch", () => {
    const schema = moderationSchema();
    const form = buildSettingsForm(schema, schema.parse({}));
    const parsed = parseSettingsForm(
      form,
      value({
        __rendered: [
          "enabled",
          "dryRun",
          "modLogChannelId",
          "automod.links",
          "automod.linkBlocklist",
          "joinGate.enabled",
        ].join(","),
        enabled: "on",
        dryRun: "on",
        modLogChannelId: "",
        "automod.links": "delete",
        "automod.linkBlocklist": "phish.test\nbad.example\n\n",
        "joinGate.enabled": "on",
      }),
    );

    expect(parsed.errors.size).toBe(0);
    expect(parsed.patch).toMatchObject({
      enabled: true,
      dryRun: true,
      modLogChannelId: undefined,
      automod: {
        links: "delete",
        linkBlocklist: ["phish.test", "bad.example"],
      },
      joinGate: { enabled: true },
    });
    expect(parsed.patch).not.toHaveProperty("automod.bannedWords");
  });

  it("treats a rendered unchecked checkbox as false, not as untouched", () => {
    const schema = moderationSchema();
    const form = buildSettingsForm(schema, schema.parse({}));
    const parsed = parseSettingsForm(
      form,
      value({
        __rendered: ["enabled", "dryRun", "joinGate.enabled"].join(","),
        enabled: "on",
        "joinGate.enabled": "on",
      }),
    );

    expect(parsed.patch).toMatchObject({ enabled: true, dryRun: false, joinGate: { enabled: true } });
  });

  it("reports a bad number, a bad enum and malformed JSON at their field paths", () => {
    const schema = moderationSchema();
    const form = buildSettingsForm(schema, schema.parse({}));
    const parsed = parseSettingsForm(
      form,
      value({
        __rendered: ["automod.zalgoThreshold", "automod.links"].join(","),
        "automod.zalgoThreshold": "many",
        "automod.links": "shout",
      }),
    );

    expect(parsed.errors.get("automod.zalgoThreshold")).toBe("Enter a valid number.");
    expect(parsed.errors.get("automod.links")).toBe("Choose one of the listed values.");
    expect(parsed.patch).toEqual({});
  });

  it("uses a validated JSON box for a record shape", () => {
    const community = modules.find((module) => module.id === "community")!;
    const form = buildSettingsForm(community.settingsSchema, community.defaultSettings);
    const field = form.fields.find((candidate) => candidate.path === "starboard.overrides");
    expect(field).toMatchObject({ kind: "json" });

    const broken = parseSettingsForm(
      form,
      value({ __rendered: "starboard.overrides", "starboard.overrides": "[not json" }),
    );
    expect(broken.errors.get("starboard.overrides")).toBe("That is not valid JSON.");

    const valid = parseSettingsForm(
      form,
      value({
        __rendered: "starboard.overrides",
        "starboard.overrides": '{"123":{"threshold":5,"channelId":"456"}}',
      }),
    );
    expect(valid.errors.size).toBe(0);
    expect(valid.patch).toEqual({ starboard: { overrides: { "123": { threshold: 5, channelId: "456" } } } });
  });
});
