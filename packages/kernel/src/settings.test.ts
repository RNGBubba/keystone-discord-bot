import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  InMemoryAuditStore,
  InMemorySettingsRepository,
  ModuleRegistry,
  SettingsService,
  defineCommand,
  defineModule,
  diffSettings,
} from "./index";

function buildService(audit?: InMemoryAuditStore): SettingsService {
  const registry = new ModuleRegistry().register(
    defineModule({
      id: "levels",
      name: "Levels",
      description: "Test module",
      version: "0.0.1",
      settingsSchema: z.object({
        enabled: z.boolean().default(true),
        xpPerMessage: z.number().int().min(1).max(100).default(15),
        note: z.string().optional(),
      }),
      defaultSettings: { enabled: true, xpPerMessage: 15 },
      commands: [
        defineCommand({
          name: "levels",
          description: "Levels",
          async execute() {
            /* no-op */
          },
        }),
      ],
    }),
  );
  return new SettingsService(new InMemorySettingsRepository(), registry, audit);
}

describe("SettingsService", () => {
  it("returns schema-parsed defaults for a guild that has never been configured", async () => {
    const settings = await buildService().get("guild-1", "levels");
    expect(settings).toEqual({ enabled: true, xpPerMessage: 15 });
  });

  it("merges a partial update over existing values", async () => {
    const service = buildService();
    await service.update("guild-1", "levels", { xpPerMessage: 30 });
    expect(await service.get("guild-1", "levels")).toEqual({ enabled: true, xpPerMessage: 30 });
  });

  it("rejects an update that violates the module schema", async () => {
    await expect(
      buildService().update("guild-1", "levels", { xpPerMessage: 10_000 }),
    ).rejects.toThrow();
  });

  it("keeps guilds isolated", async () => {
    const service = buildService();
    await service.update("guild-1", "levels", { enabled: false });
    expect((await service.get("guild-2", "levels")).enabled).toBe(true);
  });

  it("hands commands a handle bound to their own module", async () => {
    const handle = buildService().forModule("levels");
    expect(await handle.get("guild-1")).toEqual({ enabled: true, xpPerMessage: 15 });
  });

  it("refuses to read settings for an unregistered module", () => {
    expect(() => buildService().forModule("nope")).toThrow(/Unknown module/);
  });

  it("appends one audit row with the actor, source and dotted-path diff", async () => {
    const audit = new InMemoryAuditStore();
    const service = buildService(audit);

    await service.update("guild-1", "levels", { xpPerMessage: 30 }, { actorId: "mod-1", source: "command" });

    expect(audit.records("guild-1")).toMatchObject([
      {
        actorId: "mod-1",
        action: "settings.update",
        targetId: "levels",
        data: {
          moduleId: "levels",
          source: "command",
          changes: { xpPerMessage: { from: 15, to: 30 } },
        },
      },
    ]);
  });

  it("does not audit a no-op or a rejected write", async () => {
    const audit = new InMemoryAuditStore();
    const service = buildService(audit);

    await service.update("guild-1", "levels", { xpPerMessage: 15 }, { source: "command" });
    await expect(
      service.update("guild-1", "levels", { xpPerMessage: 10_000 }, { source: "command" }),
    ).rejects.toThrow();

    expect(audit.records("guild-1")).toEqual([]);
  });

  it("audits a reset and leaves guilds isolated", async () => {
    const audit = new InMemoryAuditStore();
    const service = buildService(audit);

    await service.update("guild-1", "levels", { enabled: false }, { source: "command" });
    await service.reset("guild-1", "levels", { actorId: "mod-1", source: "command" });

    expect(audit.records("guild-1").map((row) => row.action).sort()).toEqual([
      "settings.reset",
      "settings.update",
    ]);
    expect(audit.records("guild-2")).toEqual([]);
    expect((await service.get("guild-1", "levels")).enabled).toBe(true);
  });

  it("clears an optional setting when a form sends undefined", async () => {
    const service = buildService();
    await service.update("guild-1", "levels", { note: "remember this" });
    expect((await service.get("guild-1", "levels")).note).toBe("remember this");

    await service.update("guild-1", "levels", { note: undefined });
    expect(await service.get("guild-1", "levels")).not.toHaveProperty("note");
  });
});

describe("diffSettings", () => {
  it("flattens nested leaves and treats an array as one setting", () => {
    expect(
      diffSettings(
        { nested: { a: 1, b: true }, words: ["a"] },
        { nested: { a: 2, b: true }, words: ["a", "b"] },
      ),
    ).toEqual({
      "nested.a": { from: 1, to: 2 },
      words: { from: ["a"], to: ["a", "b"] },
    });
  });
});
