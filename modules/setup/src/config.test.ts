import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  InMemoryAuditStore,
  InMemoryCooldownStore,
  InMemorySettingsRepository,
  ModuleRegistry,
  SettingsService,
  auditBudget,
  createSilentLogger,
  defineCommand,
  defineModule,
  dispatchCommand,
} from "@keystone/kernel";
import { FakeInteraction, noopQueue, staticHealth } from "@keystone/testing";
import { setupModule } from "./manifest";

/**
 * A fixture module gives `/config` a nested schema to validate against without
 * importing a real module (and its commands) into the setup package's tests.
 * The schema is the point: `/config` must never store a value this rejects.
 */
const fixtureModule = defineModule({
  id: "fixture",
  name: "Fixture",
  description: "Test-only module with a nested settings schema.",
  version: "0.1.0",
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    mode: z.enum(["alert", "delete"]).default("alert"),
    threshold: z.number().int().min(0).default(5),
    channelId: z.string().nullable().default(null),
    nested: z
      .object({
        flag: z.boolean().default(true),
        label: z.string().default("keep"),
      })
      .default({ flag: true, label: "keep" }),
  }),
  defaultSettings: {},
  commands: [
    defineCommand({
      name: "fixture",
      description: "Test-only command so the fixture module is valid.",
      async execute() {
        /* nothing to do */
      },
    }),
  ],
});

interface RunOptions {
  permissions?: string[];
  options?: Record<string, string>;
}

async function harness() {
  const registry = new ModuleRegistry().register(setupModule).register(fixtureModule);
  const repository = new InMemorySettingsRepository();
  const audit = new InMemoryAuditStore();
  const settings = new SettingsService(repository, registry, audit);
  return { registry, repository, settings, audit };
}

async function run(
  subcommand: string,
  { permissions = ["ManageGuild"], options = {} }: RunOptions = {},
) {
  const { registry, repository, settings, audit } = await harness();
  const interaction = new FakeInteraction({
    commandName: "config",
    guildId: "guild-1",
    subcommand,
    permissions,
    options,
  });

  const outcome = await dispatchCommand(
    {
      registry,
      settings,
      config: settings,
      logger: createSilentLogger(),
      cooldowns: new InMemoryCooldownStore(),
      queue: noopQueue,
      health: staticHealth(),
    },
    interaction,
  );

  return { outcome, interaction, repository, settings, audit };
}

describe("/config command", () => {
  it("adds one root with four subcommands and stays inside the budget", () => {
    const registry = new ModuleRegistry().register(setupModule);
    const config = registry.getCommand("config");
    expect(config?.moduleId).toBe("setup");
    expect(config?.definition.subcommands?.map((entry) => entry.name)).toEqual([
      "list",
      "get",
      "set",
      "export",
    ]);
    // The setup module now owns /setup, /config and /export.
    expect(auditBudget(registry).commands).toBe(3);
    expect(auditBudget(registry).status).toBe("ok");
  });

  it("lists every module with its effective settings", async () => {
    const { outcome, interaction } = await run("list");

    expect(outcome.status).toBe("ok");
    expect(interaction.lastReply?.content).toContain("2 modules");
    const embed = interaction.lastReply?.embeds?.[0];
    expect(embed?.fields?.map((field) => field.name)).toEqual(["setup", "fixture"]);
  });

  it("blocks a caller without ManageGuild before any read or write", async () => {
    const { outcome, interaction, repository } = await run("set", {
      permissions: ["SendMessages"],
      options: { module: "fixture", key: "mode", value: "delete" },
    });

    expect(outcome.status).toBe("blocked");
    expect(interaction.lastReply?.content).toContain("ManageGuild");
    expect(await repository.get("guild-1", "fixture")).toBeUndefined();
  });

  it("writes a nested dotted key through the owner's schema and preserves siblings", async () => {
    const { outcome, interaction, settings, audit } = await run("set", {
      options: { module: "fixture", key: "nested.flag", value: "false" },
    });

    expect(outcome.status).toBe("ok");
    expect(interaction.lastReply?.content).toContain("`fixture.nested.flag` to `false`");
    expect(await settings.get("guild-1", "fixture")).toMatchObject({
      enabled: true,
      mode: "alert",
      nested: { flag: false, label: "keep" },
    });
    expect(audit.records("guild-1")).toMatchObject([
      {
        actorId: "42",
        action: "settings.update",
        targetId: "fixture",
        data: {
          source: "command",
          changes: { "nested.flag": { from: true, to: false } },
        },
      },
    ]);
  });

  it("keeps a snowflake id as a string instead of rounding it through JSON", async () => {
    const snowflake = "1450130465146142785";
    const { outcome, settings } = await run("set", {
      options: { module: "fixture", key: "channelId", value: snowflake },
    });

    expect(outcome.status).toBe("ok");
    expect((await settings.get("guild-1", "fixture")).channelId).toBe(snowflake);
  });

  it("rejects a value the module schema does not accept and stores nothing", async () => {
    const { outcome, interaction, repository } = await run("set", {
      options: { module: "fixture", key: "mode", value: "bogus" },
    });

    expect(outcome.status).toBe("error");
    expect(interaction.lastReply?.content).toContain("schema rejected");
    expect(interaction.lastReply?.content).toContain("mode");
    expect(await repository.get("guild-1", "fixture")).toBeUndefined();
  });

  it("reads one dotted key and refuses an unknown module with the valid ids", async () => {
    const read = await run("get", { options: { module: "fixture", key: "nested.label" } });
    expect(read.outcome.status).toBe("ok");
    expect(read.interaction.lastReply?.content).toContain("`fixture.nested.label` = `\"keep\"`");

    const unknown = await run("get", { options: { module: "nope" } });
    expect(unknown.outcome.status).toBe("error");
    expect(unknown.interaction.lastReply?.content).toContain("Unknown module");
    expect(unknown.interaction.lastReply?.content).toContain("fixture");
  });

  it("exports effective settings as JSON without environment values", async () => {
    const { outcome, interaction } = await run("export");

    expect(outcome.status).toBe("ok");
    const body = interaction.lastReply?.embeds?.[0]?.description ?? "";
    expect(body).toContain('"version":1');
    expect(body).toContain('"fixture"');
    expect(body).not.toContain("DISCORD_TOKEN");
  });
});
