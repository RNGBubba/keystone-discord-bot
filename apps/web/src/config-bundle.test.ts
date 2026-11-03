import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "@keystone/kernel";
import { modules } from "@keystone/module-catalog";
import {
  CONFIG_BUNDLE_KIND,
  ConfigBundleError,
  configChecksum,
  createConfigBundle,
  parseConfigBundle,
  parseConfigBundleText,
  type ConfigBundle,
} from "./config-bundle";

const registry = new ModuleRegistry().registerAll(modules);
const SOURCE = "111111111111111111";
const AT = Date.parse("2026-11-03T12:00:00.000Z");

function bundleFor(guildId = SOURCE, at = AT): ConfigBundle {
  return createConfigBundle(
    guildId,
    registry.listModules().map((module) => ({
      id: module.id,
      version: module.version,
      settings: module.defaultSettings,
    })),
    at,
  );
}

function rehash(bundle: ConfigBundle): ConfigBundle {
  const { checksum: _checksum, ...content } = bundle;
  return { ...content, checksum: configChecksum(content) };
}

describe("config bundles", () => {
  it("round-trips every registered module with a stable checksum", () => {
    const bundle = bundleFor();
    expect(bundle.kind).toBe(CONFIG_BUNDLE_KIND);
    expect(bundle.modules).toHaveLength(registry.listModules().length);
    expect(bundle.modules.map((module) => module.id)).toEqual(
      [...bundle.modules.map((module) => module.id)].sort(),
    );
    expect(bundle.checksum).toMatch(/^[a-f0-9]{64}$/);

    const parsed = parseConfigBundle(JSON.parse(JSON.stringify(bundle)), registry);
    expect(parsed.checksum).toBe(bundle.checksum);
    expect(parsed.sourceGuildId).toBe(SOURCE);
    expect(parsed.exportedAt).toBe("2026-11-03T12:00:00.000Z");
  });

  it("does not depend on module order or settings key order", () => {
    const bundle = bundleFor();
    const reordered = {
      ...bundle,
      modules: [...bundle.modules].reverse().map((module) => ({
        ...module,
        settings: Object.fromEntries(Object.entries(module.settings).reverse()),
      })),
    };
    expect(parseConfigBundle(reordered, registry).checksum).toBe(bundle.checksum);
  });

  it("refuses an edited file whose checksum no longer matches", () => {
    const bundle = bundleFor();
    const edited = {
      ...bundle,
      modules: bundle.modules.map((module) =>
        module.id === "ai" ? { ...module, settings: { ...module.settings, monthlyBudgetUsd: 9 } } : module,
      ),
    };
    expect(() => parseConfigBundle(edited, registry)).toThrow(ConfigBundleError);
    try {
      parseConfigBundle(edited, registry);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigBundleError);
      expect((error as ConfigBundleError).issues[0]?.path).toBe("checksum");
      expect((error as ConfigBundleError).status).toBe(400);
    }
  });

  it("refuses a forged checksum when a module schema rejects a value", () => {
    const bundle = bundleFor();
    const forged = rehash({
      ...bundle,
      modules: bundle.modules.map((module) =>
        module.id === "ai"
          ? { ...module, settings: { ...module.settings, monthlyBudgetUsd: 9_999 } }
          : module,
      ),
    });
    expect(() => parseConfigBundle(forged, registry)).toThrow(/ai\.monthlyBudgetUsd/);
  });

  it("refuses missing, unknown and duplicate modules", () => {
    const bundle = bundleFor();
    const missing = rehash({
      ...bundle,
      modules: bundle.modules.filter((module) => module.id !== "logging"),
    });
    expect(() => parseConfigBundle(missing, registry)).toThrow(/logging.*missing/i);

    const unknown = rehash({
      ...bundle,
      modules: [
        ...bundle.modules,
        { id: "not-a-module", version: "1.0.0", settings: {} },
      ],
    });
    expect(() => parseConfigBundle(unknown, registry)).toThrow(/not-a-module/);

    const duplicate = rehash({
      ...bundle,
      modules: [...bundle.modules, bundle.modules[0] as ConfigBundle["modules"][number]],
    });
    expect(() => parseConfigBundle(duplicate, registry)).toThrow(/appears twice/);
  });

  it("refuses an unsupported shape or bad JSON before reading settings", () => {
    const bundle = bundleFor();
    expect(() =>
      parseConfigBundle({ ...bundle, schemaVersion: 2 }, registry),
    ).toThrow(/schemaVersion/);
    expect(() =>
      parseConfigBundle({ ...bundle, kind: "other" }, registry),
    ).toThrow(/kind/);
    expect(() => parseConfigBundleText("{not json", registry)).toThrow(
      /not valid JSON/,
    );
    expect(() => parseConfigBundleText("{}", registry)).toThrow(ConfigBundleError);
  });

  it("does not include credential-shaped keys", () => {
    const bundle = createConfigBundle(
      SOURCE,
      [{ id: "ai", version: "1.0.0", settings: { enabled: true, apiToken: "leak" } }],
      AT,
    );
    expect(JSON.stringify(bundle)).not.toContain("leak");
    expect(bundle.modules[0]?.settings).toEqual({ enabled: true });
  });
});
