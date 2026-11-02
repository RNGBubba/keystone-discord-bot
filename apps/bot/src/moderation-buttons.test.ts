import { describe, expect, it } from "vitest";
import type {
  ModerationActions,
  ModerationActionResult,
  ModuleSettings,
  ReplyInput,
} from "@keystone/kernel";
import {
  CaseService,
  InMemoryCaseStore,
  InMemoryMemberStore,
  moderationSettingsSchema,
} from "@keystone/module-moderation";
import {
  handleModerationButton,
  parseModerationButtonId,
  type ButtonInteractionLike,
  type ModerationButtonDeps,
} from "./moderation-buttons";

function settings(values: Record<string, unknown>): ModuleSettings {
  const parsed = moderationSettingsSchema.parse(values) as unknown as Record<string, unknown>;
  return {
    async get() {
      return parsed;
    },
    async update() {
      throw new Error("button handlers must never write settings");
    },
  };
}

function actions(): { calls: string[]; port: ModerationActions } {
  const calls: string[] = [];
  const ok = async (): Promise<ModerationActionResult> => ({ ok: true });
  return {
    calls,
    port: {
      ban: ok,
      unban: ok,
      addRole: ok,
      removeRole: ok,
      kick: ok,
      timeout: ok,
      purge: ok,
      lock: ok,
      slowmode: ok,
      deleteMessage: ok,
      deleteWebhook: ok,
      quarantine: ok,
      async unquarantine(guildId, userId, reason) {
        calls.push(`${guildId}:${userId}:${reason}`);
        return { ok: true };
      },
      async notify() {
        /* buttons do not notify */
      },
      directMessage: ok,
    },
  };
}

async function fixture(
  options: {
    readonly caseTarget?: string;
    readonly appealsEnabled?: boolean;
    readonly joinGate?: boolean;
    readonly quarantined?: boolean;
  } = {},
): Promise<{
  record: Awaited<ReturnType<InMemoryCaseStore["create"]>>;
  store: InMemoryCaseStore;
  members: InMemoryMemberStore;
  actionCalls: string[];
  deps: ModerationButtonDeps;
}> {
  const store = new InMemoryCaseStore();
  const cases = new CaseService(store);
  const record = await store.create({
    guildId: "guild-1",
    caseNumber: await store.nextCaseNumber("guild-1"),
    actorId: "moderator-1",
    targetId: options.caseTarget ?? "user-1",
    action: "warn",
    reason: "spam",
    state: "open",
  });
  const members = new InMemoryMemberStore();
  if (options.quarantined ?? true) await members.markQuarantined("guild-1", "user-1");
  const { calls, port } = actions();

  return {
    record,
    store,
    members,
    actionCalls: calls,
    deps: {
      settings: settings({
        appealsEnabled: options.appealsEnabled ?? true,
        joinGate: { enabled: options.joinGate ?? true },
      }),
      moderation: { cases, actions: port, members },
    },
  };
}

function button(
  customId: string,
  overrides: { readonly guildId?: string | null; readonly userId?: string } = {},
): { interaction: ButtonInteractionLike; replies: ReplyInput[] } {
  const replies: ReplyInput[] = [];
  return {
    replies,
    interaction: {
      customId,
      guildId: overrides.guildId === undefined ? "guild-1" : overrides.guildId,
      userId: overrides.userId ?? "user-1",
      async reply(input) {
        replies.push(input);
      },
    },
  };
}

describe("parseModerationButtonId", () => {
  it("parses an appeal id", () => {
    expect(parseModerationButtonId("keystone:appeal:case-1", "guild-1")).toEqual({
      kind: "appeal",
      caseId: "case-1",
    });
  });

  it("parses a guild-scoped verify id without falling back", () => {
    expect(parseModerationButtonId("keystone:verify:guild-9:user-1", "guild-1")).toEqual({
      kind: "verify",
      guildId: "guild-9",
      userId: "user-1",
      legacy: false,
    });
  });

  it("parses the legacy in-guild verify id with the interaction guild", () => {
    expect(parseModerationButtonId("keystone:verify:user-1", "guild-1")).toEqual({
      kind: "verify",
      guildId: "guild-1",
      userId: "user-1",
      legacy: true,
    });
  });

  it("rejects malformed or foreign ids instead of guessing", () => {
    expect(parseModerationButtonId("keystone:appeal:", "guild-1")).toBeUndefined();
    expect(parseModerationButtonId("keystone:verify:", "guild-1")).toBeUndefined();
    expect(parseModerationButtonId("keystone:verify::user-1", "guild-1")).toBeUndefined();
    expect(parseModerationButtonId("keystone:verify:user-1", null)).toBeUndefined();
    expect(parseModerationButtonId("keystone:verify:a:b:c", "guild-1")).toBeUndefined();
    expect(parseModerationButtonId("keystone:roles:panel-1", "guild-1")).toBeUndefined();
  });
});

describe("handleModerationButton", () => {
  it("opens an appeal for the member named on the case", async () => {
    const { record, store, deps } = await fixture();
    const { interaction, replies } = button(`keystone:appeal:${record.id}`);

    expect(await handleModerationButton(interaction, deps)).toBe(true);

    expect(replies).toEqual([
      {
        content: "Appeal opened for case #1. A moderator can review it with /mod review.",
        ephemeral: true,
      },
    ]);
    expect((await store.getById(record.id))?.state).toBe("appealed");
    expect((await store.listEvents(record.id)).map((event) => event.type)).toEqual(["appealed"]);
  });

  it("refuses an appeal when the operator disabled appeals", async () => {
    const { record, store, deps } = await fixture({ appealsEnabled: false });
    const { interaction, replies } = button(`keystone:appeal:${record.id}`);

    await handleModerationButton(interaction, deps);

    expect(replies).toEqual([
      { content: "Appeals are disabled in this server.", ephemeral: true },
    ]);
    expect((await store.getById(record.id))?.state).toBe("open");
    expect(await store.listEvents(record.id)).toEqual([]);
  });

  it("refuses an appeal from a member the case is not against", async () => {
    const { record, store, deps } = await fixture({ caseTarget: "someone-else" });
    const { interaction, replies } = button(`keystone:appeal:${record.id}`);

    await handleModerationButton(interaction, deps);

    expect(replies).toEqual([
      { content: "You can only appeal a case against you.", ephemeral: true },
    ]);
    expect((await store.getById(record.id))?.state).toBe("open");
  });

  it("ignores a malformed id without replying", async () => {
    const { deps } = await fixture();
    const { interaction, replies } = button("keystone:verify:");

    expect(await handleModerationButton(interaction, deps)).toBe(false);
    expect(replies).toEqual([]);
  });

  it("verifies a quarantined member with a guild-scoped id", async () => {
    const { members, actionCalls, deps } = await fixture();
    const { interaction, replies } = button("keystone:verify:guild-1:user-1");

    await handleModerationButton(interaction, deps);

    expect(replies).toEqual([
      { content: "Verified. Quarantine has been lifted.", ephemeral: true },
    ]);
    expect(actionCalls).toEqual(["guild-1:user-1:Verification completed"]);
    expect(await members.get("guild-1", "user-1")).toMatchObject({
      quarantined: false,
      verifiedAt: expect.any(String),
    });
  });

  it("verifies through the legacy one-part id using the interaction guild", async () => {
    const { members, actionCalls, deps } = await fixture();
    const { interaction, replies } = button("keystone:verify:user-1");

    await handleModerationButton(interaction, deps);

    expect(replies).toEqual([
      { content: "Verified. Quarantine has been lifted.", ephemeral: true },
    ]);
    expect(actionCalls).toEqual(["guild-1:user-1:Verification completed"]);
    expect((await members.get("guild-1", "user-1"))?.verifiedAt).toBeDefined();
  });

  it("verifies from a DM with the encoded guild and a non-ephemeral reply", async () => {
    const { members, actionCalls, deps } = await fixture();
    const { interaction, replies } = button("keystone:verify:guild-1:user-1", {
      guildId: null,
    });

    await handleModerationButton(interaction, deps);

    expect(replies).toEqual([
      { content: "Verified. Quarantine has been lifted.", ephemeral: false },
    ]);
    expect(actionCalls).toEqual(["guild-1:user-1:Verification completed"]);
    expect((await members.get("guild-1", "user-1"))?.verifiedAt).toBeDefined();
  });

  it("refuses a verify click from another member before any action", async () => {
    const { members, actionCalls, deps } = await fixture();
    const { interaction, replies } = button("keystone:verify:guild-1:user-1", {
      userId: "intruder",
    });

    await handleModerationButton(interaction, deps);

    expect(replies).toEqual([
      { content: "This verification belongs to another member.", ephemeral: true },
    ]);
    expect(actionCalls).toEqual([]);
    expect((await members.get("guild-1", "user-1"))?.quarantined).toBe(true);
  });

  it("refuses verification when the join gate is disabled", async () => {
    const { members, actionCalls, deps } = await fixture({ joinGate: false });
    const { interaction, replies } = button("keystone:verify:guild-1:user-1");

    await handleModerationButton(interaction, deps);

    expect(replies).toEqual([
      { content: "The join gate is not enabled in this server.", ephemeral: true },
    ]);
    expect(actionCalls).toEqual([]);
    expect((await members.get("guild-1", "user-1"))?.quarantined).toBe(true);
  });
});
