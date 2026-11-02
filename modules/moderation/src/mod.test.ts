import { describe, expect, it } from "vitest";
import {
  InMemoryCooldownStore,
  ModuleRegistry,
  SettingsService,
  auditBudget,
  dispatchCommand,
  type LockdownResult,
  type ModerationActions,
  type ModerationActionResult,
  type ModerationDirectMessage,
  type ModerationNotice,
  type RestoreLockdownResult,
} from "@keystone/kernel";
import {
  RecordingJobQueue,
  createTestContext,
  FakeInteraction,
  noopQueue,
  staticHealth,
} from "@keystone/testing";
import { appeal } from "./commands/appeal";
import { mod } from "./commands/mod";
import { verify } from "./commands/verify";
import { CaseService, InMemoryCaseStore, appealCustomId } from "./cases";
import { InMemoryMemberStore } from "./members";
import { InMemoryPanicStore } from "./panic";
import { moderationModule } from "./manifest";

class RecordingActions implements ModerationActions {
  readonly calls: string[] = [];
  readonly notifications: ModerationNotice[] = [];
  readonly dms: { userId: string; content?: string; customId?: string }[] = [];
  dmResult: ModerationActionResult = { ok: true };

  private ok(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }

  ban(guildId: string, userId: string): Promise<ModerationActionResult> {
    this.calls.push(`ban:${guildId}:${userId}`);
    return this.ok();
  }

  unban(guildId: string, userId: string): Promise<ModerationActionResult> {
    this.calls.push(`unban:${guildId}:${userId}`);
    return this.ok();
  }

  addRole(_guildId: string, _userId: string, roleId: string): Promise<ModerationActionResult> {
    this.calls.push(`addRole:${roleId}`);
    return this.ok();
  }

  removeRole(_guildId: string, userId: string, roleId: string): Promise<ModerationActionResult> {
    this.calls.push(`removeRole:${userId}:${roleId}`);
    return this.ok();
  }

  lockdownResult: LockdownResult = { ok: true, locks: [] };
  restoreResult: RestoreLockdownResult = { ok: true, restored: [], failed: [] };

  lockdown(guildId: string, reason: string): Promise<LockdownResult> {
    this.calls.push(`lockdown:${guildId}:${reason}`);
    return Promise.resolve(this.lockdownResult);
  }

  restoreLockdown(
    guildId: string,
    locks: readonly { channelId: string }[],
    reason: string,
  ): Promise<RestoreLockdownResult> {
    this.calls.push(`restore:${guildId}:${locks.length}:${reason}`);
    return Promise.resolve(this.restoreResult);
  }

  kick(): Promise<ModerationActionResult> {
    this.calls.push("kick");
    return this.ok();
  }

  timeout(): Promise<ModerationActionResult> {
    this.calls.push("timeout");
    return this.ok();
  }

  purge(): Promise<ModerationActionResult> {
    this.calls.push("purge");
    return this.ok();
  }

  lock(): Promise<ModerationActionResult> {
    this.calls.push("lock");
    return this.ok();
  }

  slowmode(): Promise<ModerationActionResult> {
    this.calls.push("slowmode");
    return this.ok();
  }

  deleteMessage(): Promise<ModerationActionResult> {
    return this.ok();
  }

  deleteWebhook(): Promise<ModerationActionResult> {
    return this.ok();
  }

  quarantine(): Promise<ModerationActionResult> {
    this.calls.push("quarantine");
    return this.ok();
  }

  unquarantine(): Promise<ModerationActionResult> {
    this.calls.push("unquarantine");
    return this.ok();
  }

  async notify(_guildId: string, _channelId: string | null | undefined, notice: ModerationNotice): Promise<void> {
    this.notifications.push(notice);
  }

  async directMessage(
    userId: string,
    message: ModerationDirectMessage,
  ): Promise<ModerationActionResult> {
    this.dms.push({
      userId,
      content: message.content,
      customId: message.components?.[0]?.components[0]?.customId,
    });
    return this.dmResult;
  }
}

type OptionValues = Record<string, string | number | boolean | null>;

function buildContext(
  options: OptionValues,
  userId = "mod-1",
  timers?: import("@keystone/kernel").JobQueue,
  permissions: string[] = ["ModerateMembers", "ManageRoles"],
  panic = new InMemoryPanicStore(),
) {
  const store = new InMemoryCaseStore();
  const cases = new CaseService(store);
  const actions = new RecordingActions();
  const members = new InMemoryMemberStore();
  const interaction = new FakeInteraction({
    commandName: "mod",
    guildId: "guild-1",
    userId,
    permissions,
    options,
    subcommand: typeof options.action === "string" ? options.action : undefined,
  });
  const ctx = createTestContext({
    interaction,
    moduleId: "moderation",
    settings: { dryRun: false, ...options },
    moderation: { cases, actions, members, panic },
    timers,
  });
  return { ctx, cases, actions, store, members, panic };
}

function verificationStart(options: {
  members: InMemoryMemberStore;
  gateEnabled?: boolean;
  dmResult?: ModerationActionResult;
}) {
  const actions = new RecordingActions();
  if (options.dmResult) actions.dmResult = options.dmResult;
  const interaction = new FakeInteraction({
    commandName: "verify",
    guildId: "guild-1",
    userId: "new-member",
    subcommand: "start",
  });
  const ctx = createTestContext({
    interaction,
    moduleId: "moderation",
    settings: { joinGate: { enabled: options.gateEnabled ?? true } },
    moderation: {
      cases: new CaseService(new InMemoryCaseStore()),
      actions,
      members: options.members,
    },
  });
  return { ctx, interaction, actions };
}

describe("moderation module", () => {
  it("registers through the normal registry and stays inside the command budget", () => {
    const registry = new ModuleRegistry().register(moderationModule);
    expect(registry.getCommand("mod")?.moduleId).toBe("moderation");
    expect(registry.getCommand("appeal")?.moduleId).toBe("moderation");
    expect(registry.getCommand("appeal")?.definition.subcommands?.map((entry) => entry.name)).toEqual(
      ["open", "status"],
    );
    expect(registry.getCommand("verify")?.moduleId).toBe("moderation");
    expect(auditBudget(registry).status).toBe("ok");
  });

  it("blocks a caller without ModerateMembers through dispatch", async () => {
    const registry = new ModuleRegistry().register(moderationModule);
    const interaction = new FakeInteraction({
      commandName: "mod",
      permissions: ["SendMessages"],
      options: { user: "target", reason: "raid" },
      subcommand: "ban",
    });
    const outcome = await dispatchCommand(
      {
        registry,
        settings: new SettingsService(new (await import("@keystone/kernel")).InMemorySettingsRepository(), registry),
        logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
        cooldowns: new InMemoryCooldownStore(),
        queue: noopQueue,
        health: staticHealth(),
      },
      interaction,
    );
    expect(outcome.status).toBe("blocked");
    expect(interaction.lastReply?.content).toContain("ModerateMembers");
  });

  it("runs an enforced ban only after creating its case and reason", async () => {
    const { ctx, cases, actions } = buildContext({
      action: "ban",
      user: "target-1",
      reason: "posting raid invites",
    });

    await mod.execute(ctx);

    expect(actions.calls).toContain("ban:guild-1:target-1");
    const records = await cases.list("guild-1");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "ban",
      targetId: "target-1",
      reason: "posting raid invites",
      state: "open",
    });
    expect(actions.notifications).toHaveLength(1);
    expect(actions.notifications[0]?.components?.[0]?.components[0]?.customId).toBe(
      appealCustomId(records[0]!.id),
    );
  });

  it("records a temporary ban's expiry and schedules exactly one release", async () => {
    const queue = new RecordingJobQueue();
    const { ctx, cases } = buildContext(
      { action: "ban", user: "target-1", reason: "cool off", duration: 30 },
      "mod-1",
      queue,
    );

    await mod.execute(ctx);

    const [record] = await cases.list("guild-1");
    expect(record?.expiresAt).toBe(new Date(1_700_000_000_000 + 30 * 60_000).toISOString());
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]).toMatchObject({
      name: "moderation.expire",
      payload: { caseId: record?.id, guildId: "guild-1" },
      options: { idempotencyKey: `moderation:expire:${record?.id}` },
    });
  });

  it("turns panic on through /mod panic and restores the same snapshot off", async () => {
    const panic = new InMemoryPanicStore();
    const lock = { channelId: "channel-1", existed: true, previous: "neutral" as const };
    const on = buildContext(
      { action: "panic", state: "on", reason: "raid in progress" },
      "mod-1",
      undefined,
      ["ModerateMembers", "Administrator"],
      panic,
    );
    on.actions.lockdownResult = { ok: true, locks: [lock] };

    await mod.execute(on.ctx);

    expect(on.actions.calls).toContain("lockdown:guild-1:raid in progress");
    expect(await panic.get("guild-1")).toMatchObject({
      startedBy: "mod-1",
      reason: "raid in progress",
      channels: [lock],
    });
    expect(on.ctx.interaction.lastReply?.content).toContain("1 channel(s) locked");

    const off = buildContext(
      { action: "panic", state: "off", reason: "all clear" },
      "mod-2",
      undefined,
      ["ModerateMembers", "Administrator"],
      panic,
    );
    off.actions.restoreResult = { ok: true, restored: ["channel-1"], failed: [] };

    await mod.execute(off.ctx);

    expect(off.actions.calls).toContain("restore:guild-1:1:all clear");
    expect(await panic.get("guild-1")).toBeUndefined();
    expect(off.ctx.interaction.lastReply?.content).toContain("1 channel(s) restored");
  });

  it("reports panic status without Administrator and refuses the switch", async () => {
    const status = buildContext({ action: "panic", state: "status" });
    await mod.execute(status.ctx);
    expect(status.ctx.interaction.lastReply?.content).toContain("Panic mode is **off**");

    const on = buildContext({ action: "panic", state: "on", reason: "raid" });
    await expect(mod.execute(on.ctx)).rejects.toThrow(/Administrator/);
    expect(on.actions.calls).toHaveLength(0);
  });

  it("grants a temporary role, records the role and schedules its removal", async () => {
    const queue = new RecordingJobQueue();
    const { ctx, cases, actions } = buildContext(
      {
        action: "temp-role",
        user: "target-1",
        role: "role-vip",
        reason: "event winner",
        duration: 60,
      },
      "mod-1",
      queue,
    );

    await mod.execute(ctx);

    expect(actions.calls).toContain("addRole:role-vip");
    const [record] = await cases.list("guild-1");
    expect(record).toMatchObject({
      action: "temp-role",
      targetId: "target-1",
      evidence: { roleId: "role-vip" },
    });
    expect(record?.expiresAt).toBe(new Date(1_700_000_000_000 + 60 * 60_000).toISOString());
    expect(queue.enqueued).toHaveLength(1);
  });

  it("refuses a temporary role without ManageRoles, even for a moderator", async () => {
    const { ctx, cases } = buildContext(
      {
        action: "temp-role",
        user: "target-1",
        role: "role-admin",
        reason: "escalation attempt",
        duration: 60,
      },
      "mod-1",
      undefined,
      ["ModerateMembers"],
    );

    await expect(mod.execute(ctx)).rejects.toThrow(/ManageRoles/);
    expect(await cases.list("guild-1")).toEqual([]);
  });

  it("takes no action and writes no case in the default dry-run", async () => {
    const store = new InMemoryCaseStore();
    const cases = new CaseService(store);
    const actions = new RecordingActions();
    const interaction = new FakeInteraction({
      commandName: "mod",
      guildId: "guild-1",
      permissions: ["ModerateMembers"],
      options: { user: "target-1", reason: "raid" },
      subcommand: "ban",
    });
    const ctx = createTestContext({
      interaction,
      moduleId: "moderation",
      settings: {},
      moderation: { cases, actions, members: new InMemoryMemberStore() },
    });

    await mod.execute(ctx);

    expect(actions.calls).toEqual([]);
    expect(await cases.list("guild-1")).toEqual([]);
    expect(interaction.lastReply?.content).toContain("Dry run");
  });

  it("lists recent link-filter findings through /mod links", async () => {
    const { ctx, cases, actions } = buildContext({ action: "links" });
    await cases.open({
      guildId: "guild-1",
      actorId: "keystone",
      targetId: "target-1",
      action: "security.alert",
      reason: "The link host phish.test is on this server's blocklist.",
      rule: "automod.link",
      state: "alerted",
    });

    await mod.execute(ctx);

    expect(actions.calls).toEqual([]);
    expect(ctx.interaction.lastReply?.content).toContain("Link-filter findings");
    expect(ctx.interaction.lastReply?.content).toContain("phish.test");
    expect(ctx.interaction.lastReply?.content).toContain("#1");
  });

  it("lists profanity and zalgo cases through /mod filters", async () => {
    const { ctx, cases, actions } = buildContext({ action: "filters" });
    await cases.open({
      guildId: "guild-1",
      actorId: "keystone",
      targetId: "target-1",
      action: "security.alert",
      reason: "The message contains a blocked word or phrase.",
      rule: "automod.profanity",
      state: "alerted",
    });
    await cases.open({
      guildId: "guild-1",
      actorId: "keystone",
      targetId: "target-1",
      action: "security.alert",
      reason: "The message contains 12 combining marks.",
      rule: "automod.zalgo",
      state: "alerted",
    });

    await mod.execute(ctx);

    expect(actions.calls).toEqual([]);
    expect(ctx.interaction.lastReply?.content).toContain("Content-filter findings");
    expect(ctx.interaction.lastReply?.content).toContain("automod.profanity");
    expect(ctx.interaction.lastReply?.content).toContain("automod.zalgo");
  });

  it("requires a reason for a punitive action", async () => {
    const { ctx } = buildContext({ action: "kick", user: "target-1" });
    await expect(mod.execute(ctx)).rejects.toThrow(/reason is required/i);
  });

  it("opens and verifies an appeal for the target only", async () => {
    const { ctx, cases, store } = buildContext({ action: "warn", user: "target-1", reason: "first warning" });
    await mod.execute(ctx);
    const record = (await cases.list("guild-1"))[0]!;

    const targetInteraction = new FakeInteraction({
      commandName: "appeal",
      guildId: "guild-1",
      userId: "target-1",
      subcommand: "open",
      options: { case: record.caseNumber, message: "I did not post that." },
    });
    const targetCtx = createTestContext({
      interaction: targetInteraction,
      moduleId: "moderation",
      settings: { appealsEnabled: true },
      moderation: { cases, actions: new RecordingActions(), members: new InMemoryMemberStore() },
    });
    await appeal.execute(targetCtx);

    expect((await store.getById(record.id))?.state).toBe("appealed");
    expect(store.events(record.id).some((event) => event.type === "appealed")).toBe(true);

    const otherInteraction = new FakeInteraction({
      commandName: "appeal",
      guildId: "guild-1",
      userId: "someone-else",
      subcommand: "open",
      options: { case: record.caseNumber },
    });
    const otherCtx = createTestContext({
      interaction: otherInteraction,
      moduleId: "moderation",
      settings: { appealsEnabled: true },
      moderation: { cases, actions: new RecordingActions(), members: new InMemoryMemberStore() },
    });
    await expect(appeal.execute(otherCtx)).rejects.toThrow(/only appeal a case against you/i);
  });

  it("reports an appeal from the append-only event after the state changes", async () => {
    const { ctx, cases } = buildContext({ action: "warn", user: "target-1", reason: "first warning" });
    await mod.execute(ctx);
    const record = (await cases.list("guild-1"))[0]!;

    const openCtx = createTestContext({
      interaction: new FakeInteraction({
        commandName: "appeal",
        guildId: "guild-1",
        userId: "target-1",
        subcommand: "open",
        options: { case: record.caseNumber, message: "Please review the evidence." },
      }),
      moduleId: "moderation",
      settings: { appealsEnabled: true },
      moderation: { cases, actions: new RecordingActions(), members: new InMemoryMemberStore() },
    });
    await appeal.execute(openCtx);
    await cases.review(record.id, "mod-1");

    const status = new FakeInteraction({
      commandName: "appeal",
      guildId: "guild-1",
      userId: "target-1",
      subcommand: "status",
      options: { case: record.caseNumber },
    });
    await appeal.execute(
      createTestContext({
        interaction: status,
        moduleId: "moderation",
        moderation: { cases, actions: new RecordingActions(), members: new InMemoryMemberStore() },
      }),
    );

    const field = status.lastReply?.embeds?.[0]?.fields?.[0];
    expect(field?.name).toContain("reviewed");
    expect(field?.value).toContain("Appeals on record: 1");
    expect(field?.value).toContain("Please review the evidence.");
    expect(status.lastReply?.content).toContain("#1 · warn · reviewed · 1 appeal");
  });

  it("reports no appeals for a member with no appeal events", async () => {
    const { cases } = buildContext({});
    const status = new FakeInteraction({
      commandName: "appeal",
      guildId: "guild-1",
      userId: "target-1",
      subcommand: "status",
      options: {},
    });
    await appeal.execute(
      createTestContext({
        interaction: status,
        moduleId: "moderation",
        moderation: { cases, actions: new RecordingActions(), members: new InMemoryMemberStore() },
      }),
    );
    expect(status.lastReply?.content).toContain("No appeal events are on record");
    expect(status.lastReply?.embeds?.[0]?.description).toContain("No appeal events are on record");
  });

  it("does not show one member another member's case status", async () => {
    const { ctx, cases } = buildContext({ action: "warn", user: "target-1", reason: "first warning" });
    await mod.execute(ctx);
    const record = (await cases.list("guild-1"))[0]!;
    const status = new FakeInteraction({
      commandName: "appeal",
      guildId: "guild-1",
      userId: "someone-else",
      subcommand: "status",
      options: { case: record.caseNumber },
    });

    await expect(
      appeal.execute(
        createTestContext({
          interaction: status,
          moduleId: "moderation",
          moderation: { cases, actions: new RecordingActions(), members: new InMemoryMemberStore() },
        }),
      ),
    ).rejects.toThrow(/not one of your cases/i);
  });

  it("starts verification with a DM through the moderation port and leaves the member quarantined", async () => {
    const members = new InMemoryMemberStore();
    await members.markQuarantined("guild-1", "new-member");
    const { ctx, interaction, actions } = verificationStart({ members });

    await verify.execute(ctx);

    expect(actions.dms).toHaveLength(1);
    expect(actions.dms[0]?.userId).toBe("new-member");
    expect(actions.dms[0]?.content).toBe(
      "Keystone verification: click the button below to leave quarantine in this server. If you did not request this, ignore it.",
    );
    expect(actions.dms[0]?.customId).toMatch(/^keystone:verify:guild-1:new-member$/);
    expect(interaction.lastReply?.content).toContain("DMs");
    expect(await members.get("guild-1", "new-member")).toMatchObject({
      quarantined: true,
      verifiedAt: undefined,
    });
  });

  it("refuses to start when no quarantine is recorded", async () => {
    const { ctx, actions } = verificationStart({ members: new InMemoryMemberStore() });

    await expect(verify.execute(ctx)).rejects.toThrow(/No quarantine is recorded/i);
    expect(actions.dms).toHaveLength(0);
  });

  it("refuses to start when the join gate is disabled", async () => {
    const { ctx, actions } = verificationStart({
      members: new InMemoryMemberStore(),
      gateEnabled: false,
    });

    await expect(verify.execute(ctx)).rejects.toThrow(/join gate is not enabled/i);
    expect(actions.dms).toHaveLength(0);
  });

  it("refuses to start for an already verified member", async () => {
    const members = new InMemoryMemberStore();
    await members.markVerified("guild-1", "new-member", "2026-11-01T00:00:00.000Z");
    const { ctx, actions } = verificationStart({ members });

    await expect(verify.execute(ctx)).rejects.toThrow(/already verified/i);
    expect(actions.dms).toHaveLength(0);
  });

  it("refuses to start when the member's DMs are closed", async () => {
    const members = new InMemoryMemberStore();
    await members.markQuarantined("guild-1", "new-member");
    const { ctx, actions } = verificationStart({
      members,
      dmResult: { ok: false, detail: "Cannot send messages to this user" },
    });

    await expect(verify.execute(ctx)).rejects.toThrow(
      /could not DM you.*Cannot send messages to this user/i,
    );
    expect(actions.dms).toHaveLength(1);
  });

  it("reports the persisted status row rather than gateway presence", async () => {
    const members = new InMemoryMemberStore();
    await members.markVerified("guild-1", "new-member", "2026-11-01T00:00:00.000Z");
    const status = new FakeInteraction({
      commandName: "verify",
      guildId: "guild-1",
      userId: "new-member",
      subcommand: "status",
    });

    await verify.execute(
      createTestContext({
        interaction: status,
        moduleId: "moderation",
        settings: { joinGate: { enabled: true } },
        moderation: {
          cases: new CaseService(new InMemoryCaseStore()),
          actions: new RecordingActions(),
          members,
        },
      }),
    );

    expect(status.lastReply?.content).toContain("Verified at 2026-11-01T00:00:00.000Z");
    expect(status.lastReply?.embeds?.[0]?.footer?.text).toContain("members table");
    expect(status.lastReply?.embeds?.[0]?.fields?.find((field) => field.name === "Quarantine record")?.value).toBe(
      "not quarantined",
    );
  });

  it("reports a quarantined row with the start step", async () => {
    const members = new InMemoryMemberStore();
    await members.markQuarantined("guild-1", "new-member");
    const status = new FakeInteraction({
      commandName: "verify",
      guildId: "guild-1",
      userId: "new-member",
      subcommand: "status",
    });

    await verify.execute(
      createTestContext({
        interaction: status,
        moduleId: "moderation",
        settings: { joinGate: { enabled: true } },
        moderation: {
          cases: new CaseService(new InMemoryCaseStore()),
          actions: new RecordingActions(),
          members,
        },
      }),
    );

    expect(status.lastReply?.content).toContain("Quarantined; verification is not complete");
    expect(status.lastReply?.embeds?.[0]?.fields?.find((field) => field.name === "Next step")?.value).toContain(
      "/verify start",
    );
  });

  it("reports no record without offering a dead-end start", async () => {
    const status = new FakeInteraction({
      commandName: "verify",
      guildId: "guild-1",
      userId: "new-member",
      subcommand: "status",
    });

    await verify.execute(
      createTestContext({
        interaction: status,
        moduleId: "moderation",
        settings: { joinGate: { enabled: true } },
        moderation: {
          cases: new CaseService(new InMemoryCaseStore()),
          actions: new RecordingActions(),
          members: new InMemoryMemberStore(),
        },
      }),
    );

    expect(status.lastReply?.content).toContain("No verification record");
    expect(status.lastReply?.embeds?.[0]?.fields?.find((field) => field.name === "Quarantine record")?.value).toBe(
      "no record",
    );
    const next = status.lastReply?.embeds?.[0]?.fields?.find((field) => field.name === "Next step")?.value;
    expect(next).toContain("Ask a moderator");
    expect(next).not.toContain("/verify start");
  });

  it("reports a disabled gate without offering a start step", async () => {
    const members = new InMemoryMemberStore();
    await members.markQuarantined("guild-1", "new-member");
    const status = new FakeInteraction({
      commandName: "verify",
      guildId: "guild-1",
      userId: "new-member",
      subcommand: "status",
    });

    await verify.execute(
      createTestContext({
        interaction: status,
        moduleId: "moderation",
        settings: { joinGate: { enabled: false } },
        moderation: {
          cases: new CaseService(new InMemoryCaseStore()),
          actions: new RecordingActions(),
          members,
        },
      }),
    );

    expect(status.lastReply?.content).toContain("join gate is disabled here");
    const next = status.lastReply?.embeds?.[0]?.fields?.find((field) => field.name === "Next step")?.value;
    expect(next).toContain("enable the join gate");
    expect(next).not.toContain("/verify start");
  });
});
