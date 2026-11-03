import { describe, expect, it } from "vitest";
import {
  InMemoryAuditStore,
  InMemoryDashboardStore,
  InMemorySavedTemplateStore,
  InMemorySettingsRepository,
  ModuleRegistry,
  SettingsService,
} from "@keystone/kernel";
import { modules } from "@keystone/module-catalog";
import { DashboardService } from "./overview";
import type { DiscordGuild } from "./oauth";

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
  const store = new InMemorySavedTemplateStore();
  const dashboard = new DashboardService(
    registry,
    settings,
    new InMemoryDashboardStore(),
    audit,
    undefined,
    store,
  );
  return { registry, audit, settings, store, dashboard };
}

describe("saved templates", () => {
  it("snapshots every effective module and audits the create without writing settings", async () => {
    const { registry, settings, audit, dashboard } = build();
    await settings.update(GUILD_A.id, "ai", { monthlyBudgetUsd: 9, enabled: true }, {
      actorId: "seed",
      source: "module",
    });
    const before = await settings.get(GUILD_A.id, "ai");
    const auditBefore = audit.records(GUILD_A.id).length;

    const saved = await dashboard.createSavedTemplate(
      GUILD_A,
      { name: "Alpha baseline", description: "AI on" },
      "admin-1",
    );

    expect(saved).toMatchObject({
      name: "Alpha baseline",
      description: "AI on",
      moduleCount: registry.listModules().length,
      invalidCount: 0,
      createdBy: "admin-1",
    });
    expect(await settings.get(GUILD_A.id, "ai")).toEqual(before);
    const rows = audit.records(GUILD_A.id);
    expect(rows).toHaveLength(auditBefore + 1);
    expect(rows.at(-1)).toMatchObject({
      actorId: "admin-1",
      action: "template.create",
      targetId: saved.id,
      data: { source: "dashboard", name: "Alpha baseline" },
    });
  });

  it("applies to two guilds through the preview fingerprint and audits one write per guild", async () => {
    const { settings, audit, dashboard } = build();
    await settings.update(GUILD_A.id, "ai", { monthlyBudgetUsd: 9, enabled: true });
    const saved = await dashboard.createSavedTemplate(
      GUILD_A,
      { name: "Nine dollars", description: "" },
      "admin-1",
    );
    await settings.update(GUILD_A.id, "ai", { monthlyBudgetUsd: 2 });
    await settings.update(GUILD_B.id, "ai", { monthlyBudgetUsd: 5 });

    const record = await dashboard.savedTemplateRecord(GUILD_A, saved.id);
    const guilds = [GUILD_A, GUILD_B];
    const plan = await dashboard.previewSavedTemplate(guilds, record);
    expect(plan.templateIssues).toBeUndefined();
    // Alpha: budget 2 -> 9. Beta: budget 5 -> 9 and enabled false -> true.
    expect(plan.changeCount).toBe(3);
    expect(plan.guilds.map((guild) => guild.modules.map((module) => module.moduleId))).toEqual([
      ["ai"],
      ["ai"],
    ]);
    expect(plan.guilds[0]?.modules[0]?.changes["monthlyBudgetUsd"]).toEqual({
      from: 2,
      to: 9,
    });
    expect(await settings.get(GUILD_A.id, "ai")).toMatchObject({ monthlyBudgetUsd: 2 });

    const result = await dashboard.applySavedTemplate(
      guilds,
      record,
      plan.fingerprint,
      "admin-1",
    );
    expect(result).toEqual({ guilds: 2, modulesWritten: 2, failures: [] });
    expect(await settings.get(GUILD_A.id, "ai")).toMatchObject({ monthlyBudgetUsd: 9 });
    expect(await settings.get(GUILD_B.id, "ai")).toMatchObject({ monthlyBudgetUsd: 9 });

    for (const guild of guilds) {
      const writes = audit
        .records(guild.id)
        .filter((row) => row.action === "settings.update" && row.actorId === "admin-1");
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        targetId: "ai",
        data: { source: "dashboard" },
      });
      expect(
        JSON.stringify((writes[0]?.data as { changes?: unknown } | undefined)?.changes),
      ).toContain("monthlyBudgetUsd");
    }
  });

  it("refuses a stale preview after the template is edited", async () => {
    const { settings, audit, dashboard } = build();
    const saved = await dashboard.createSavedTemplate(GUILD_A, { name: "One" }, "admin-1");
    await settings.update(GUILD_A.id, "ai", { monthlyBudgetUsd: 4 });
    const record = await dashboard.savedTemplateRecord(GUILD_A, saved.id);
    const plan = await dashboard.previewSavedTemplate([GUILD_A], record);

    await dashboard.updateSavedTemplate(GUILD_A, saved.id, { name: "Two" }, "admin-1");
    const auditBefore = audit.records(GUILD_A.id).length;
    const edited = await dashboard.savedTemplateRecord(GUILD_A, saved.id);

    await expect(
      dashboard.applySavedTemplate([GUILD_A], edited, plan.fingerprint, "admin-1"),
    ).rejects.toThrow(/out of date/);
    expect(await settings.get(GUILD_A.id, "ai")).toMatchObject({ monthlyBudgetUsd: 4 });
    expect(audit.records(GUILD_A.id)).toHaveLength(auditBefore);
  });

  it("reports a template that no longer validates and refuses to apply it", async () => {
    const { settings, audit, store, dashboard } = build();
    const saved = await dashboard.createSavedTemplate(GUILD_A, { name: "Broken" }, "admin-1");
    const record = await dashboard.savedTemplateRecord(GUILD_A, saved.id);
    const invalid = record.modules.map((module) =>
      module.id === "ai"
        ? { ...module, settings: { ...module.settings, monthlyBudgetUsd: 5_000 } }
        : module,
    );
    await store.update(GUILD_A.id, saved.id, { modules: invalid, at: Date.now() });

    const broken = await dashboard.savedTemplateRecord(GUILD_A, saved.id);
    const detail = await dashboard.savedTemplate(GUILD_A, saved.id);
    expect(detail.invalidCount).toBeGreaterThan(0);
    expect(detail.issues[0]?.path).toContain("ai.monthlyBudgetUsd");

    const plan = await dashboard.previewSavedTemplate([GUILD_A], broken);
    expect(plan.guilds).toEqual([]);
    expect(plan.templateIssues?.[0]?.path).toContain("ai.monthlyBudgetUsd");

    await expect(
      dashboard.applySavedTemplate([GUILD_A], broken, plan.fingerprint, "admin-1"),
    ).rejects.toThrow(/no longer validates/);
    expect(await settings.get(GUILD_A.id, "ai")).toMatchObject({ monthlyBudgetUsd: 1 });
    expect(
      audit.records(GUILD_A.id).filter((row) => row.action === "settings.update"),
    ).toEqual([]);
  });

  it("audits rename, refresh and delete and removes the row", async () => {
    const { settings, audit, store, dashboard } = build();
    const saved = await dashboard.createSavedTemplate(GUILD_A, { name: "Old" }, "admin-1");
    await settings.update(GUILD_A.id, "ai", { monthlyBudgetUsd: 6 });

    await dashboard.updateSavedTemplate(
      GUILD_A,
      saved.id,
      { name: "New", description: "refreshed", refreshSettings: true },
      "admin-1",
    );
    const detail = await dashboard.savedTemplate(GUILD_A, saved.id);
    expect(detail).toMatchObject({ name: "New", description: "refreshed", invalidCount: 0 });
    expect(detail.modules.find((module) => module.id === "ai")?.settings).toMatchObject({
      monthlyBudgetUsd: 6,
    });

    await dashboard.deleteSavedTemplate(GUILD_A, saved.id, "admin-1");
    expect(await store.get(GUILD_A.id, saved.id)).toBeUndefined();
    expect(await dashboard.listSavedTemplates(GUILD_A)).toEqual([]);

    const actions = audit.records(GUILD_A.id).map((row) => row.action);
    expect(actions).toContain("template.create");
    expect(actions).toContain("template.update");
    expect(actions.at(-1)).toBe("template.delete");
    expect(audit.records(GUILD_A.id).at(-1)).toMatchObject({
      actorId: "admin-1",
      data: { source: "dashboard", name: "New" },
    });
    expect(await settings.get(GUILD_A.id, "ai")).toMatchObject({ monthlyBudgetUsd: 6 });
  });
});
