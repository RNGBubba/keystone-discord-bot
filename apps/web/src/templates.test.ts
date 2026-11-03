import { describe, expect, it } from "vitest";
import {
  InMemoryAuditStore,
  InMemoryDashboardStore,
  InMemorySettingsRepository,
  ModuleRegistry,
  SettingsService,
} from "@keystone/kernel";
import { modules } from "@keystone/module-catalog";
import { DashboardService } from "./overview";
import type { DiscordGuild } from "./oauth";
import {
  CONFIG_TEMPLATES,
  findTemplate,
  mergeSettings,
  templateFingerprint,
  type ConfigTemplate,
} from "./templates";

const GUILD_A: DiscordGuild = {
  id: "111111111111111111",
  name: "Alpha",
  icon: null,
  owner: true,
  permissions: "0",
};
const GUILD_B: DiscordGuild = {
  id: "222222222222222222",
  name: "Beta",
  icon: null,
  owner: true,
  permissions: "0",
};

function build() {
  const registry = new ModuleRegistry().registerAll(modules);
  const audit = new InMemoryAuditStore();
  const settings = new SettingsService(new InMemorySettingsRepository(), registry, audit);
  const dashboard = new DashboardService(registry, settings, new InMemoryDashboardStore(), audit);
  return { registry, audit, settings, dashboard };
}

function strict(): ConfigTemplate {
  const template = findTemplate("strict-moderation");
  if (!template) throw new Error("strict-moderation template is missing");
  return template;
}

describe("schema-driven config templates", () => {
  it("names only registered modules and every built-in template has a patch", () => {
    const { registry } = build();
    for (const template of CONFIG_TEMPLATES) {
      expect(template.modules.length).toBeGreaterThan(0);
      for (const entry of template.modules) {
        expect(registry.getModule(entry.moduleId)).toBeDefined();
        expect(Object.keys(entry.patch).length).toBeGreaterThan(0);
      }
    }
    expect(findTemplate("strict-moderation")?.name).toBe("Strict moderation");
    expect(findTemplate("not-a-template")).toBeUndefined();
  });

  it("deep-merges records but replaces an array as one value", () => {
    const merged = mergeSettings(
      { automod: { links: "off", invites: "delete", bannedWords: ["pineapple"] } },
      { automod: { links: "delete" } },
    );
    expect(merged).toEqual({
      automod: { links: "delete", invites: "delete", bannedWords: ["pineapple"] },
    });
    expect(mergeSettings({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] });
  });

  it("previews only changed leaves and writes nothing", async () => {
    const { dashboard, settings, audit } = build();
    const plan = await dashboard.previewTemplate([GUILD_A], strict());

    expect(plan.issueCount).toBe(0);
    expect(plan.changeCount).toBeGreaterThan(0);
    const changes = plan.guilds[0]?.modules[0]?.changes ?? {};
    expect(changes["automod.links"]).toEqual({ from: "off", to: "delete" });
    expect(changes["automod.invites"]).toEqual({ from: "delete", to: "timeout" });
    expect(changes.dryRun).toEqual({ from: true, to: false });

    const stored = await settings.get(GUILD_A.id, "moderation");
    expect(stored).toMatchObject({ dryRun: true });
    expect((stored.automod as Record<string, unknown>).links).toBe("off");
    expect(audit.records(GUILD_A.id)).toEqual([]);
  });

  it("keeps a configured word list when a template changes only modes", async () => {
    const { dashboard, settings } = build();
    await settings.update(GUILD_A.id, "moderation", {
      automod: { bannedWords: ["pineapple"] },
    });

    const plan = await dashboard.previewTemplate([GUILD_A], strict());
    const target = plan.guilds[0]?.modules[0]?.target as
      | { automod?: { bannedWords?: string[] } }
      | undefined;
    expect(target?.automod?.bannedWords).toEqual(["pineapple"]);
  });

  it("turns a schema rejection into a preview issue with no target", async () => {
    const { dashboard } = build();
    const invalid: ConfigTemplate = {
      id: "invalid",
      name: "Invalid",
      description: "Deliberately invalid",
      modules: [
        { moduleId: "moderation", patch: { automod: { zalgoThreshold: 500 } } },
      ],
    };

    const plan = await dashboard.previewTemplate([GUILD_A], invalid);
    expect(plan.issueCount).toBe(1);
    expect(plan.guilds[0]?.modules[0]?.target).toBeUndefined();
    expect(plan.guilds[0]?.modules[0]?.issues[0]?.path).toBe("automod.zalgoThreshold");
  });

  it("binds the fingerprint to the guild selection and current settings", async () => {
    const { dashboard, settings } = build();
    const template = strict();
    const forward = await dashboard.previewTemplate([GUILD_A, GUILD_B], template);
    const reverse = await dashboard.previewTemplate([GUILD_B, GUILD_A], template);
    expect(forward.fingerprint).toBe(reverse.fingerprint);

    const changed = await dashboard.previewTemplate([GUILD_A], template);
    expect(changed.fingerprint).not.toBe(forward.fingerprint);

    await settings.update(GUILD_A.id, "moderation", { dryRun: false });
    const after = await dashboard.previewTemplate([GUILD_A], template);
    expect(after.fingerprint).not.toBe(changed.fingerprint);
  });

  it("applies one audited write per module and refuses a stale fingerprint", async () => {
    const { dashboard, settings, audit } = build();
    const template = strict();
    const plan = await dashboard.previewTemplate([GUILD_A], template);

    await expect(
      dashboard.applyTemplate([GUILD_A], template, "0".repeat(64), "admin-1"),
    ).rejects.toThrow(/out of date/);
    expect((await settings.get(GUILD_A.id, "moderation")).dryRun).toBe(true);
    expect(audit.records(GUILD_A.id)).toEqual([]);

    const result = await dashboard.applyTemplate([GUILD_A], template, plan.fingerprint, "admin-1");
    expect(result).toEqual({ guilds: 1, modulesWritten: 1, failures: [] });

    const stored = await settings.get(GUILD_A.id, "moderation");
    expect(stored).toMatchObject({ dryRun: false });
    expect((stored.automod as Record<string, unknown>).links).toBe("delete");

    expect(audit.records(GUILD_A.id)).toMatchObject([
      {
        actorId: "admin-1",
        action: "settings.update",
        targetId: "moderation",
        data: {
          source: "dashboard",
          changes: { "automod.links": { from: "off", to: "delete" } },
        },
      },
    ]);
  });

  it("refuses a template that does not validate and writes nothing", async () => {
    const { dashboard, audit } = build();
    const invalid: ConfigTemplate = {
      id: "invalid",
      name: "Invalid",
      description: "Deliberately invalid",
      modules: [{ moduleId: "moderation", patch: { automod: { zalgoThreshold: 500 } } }],
    };
    const plan = await dashboard.previewTemplate([GUILD_A], invalid);

    await expect(
      dashboard.applyTemplate([GUILD_A], invalid, plan.fingerprint, "admin-1"),
    ).rejects.toThrow(/does not validate/);
    expect(audit.records(GUILD_A.id)).toEqual([]);
  });

  it("reports a no-change template as empty instead of writing an audit row", async () => {
    const { dashboard, audit } = build();
    const quiet = findTemplate("quiet-optional");
    if (!quiet) throw new Error("quiet-optional template is missing");

    const plan = await dashboard.previewTemplate([GUILD_A], quiet);
    expect(plan.changeCount).toBe(0);
    expect(plan.guilds[0]?.modules).toEqual([]);
    expect(plan.fingerprint).toBe(templateFingerprint(quiet.id, plan.guilds));

    const result = await dashboard.applyTemplate([GUILD_A], quiet, plan.fingerprint, "admin-1");
    expect(result).toEqual({ guilds: 1, modulesWritten: 0, failures: [] });
    expect(audit.records(GUILD_A.id)).toEqual([]);
  });
});
