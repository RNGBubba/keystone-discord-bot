import { describe, expect, it } from "vitest";
import {
  ComponentRouter,
  createComponentSigner,
  type ComponentInteractionLike,
  type ModerationActions,
  type ModerationActionResult,
  type ModuleSettings,
  type ReplyInput,
} from "@keystone/kernel";
import {
  APPEAL_PANEL_TTL_MS,
  VERIFY_PANEL_TTL_MS,
  CaseService,
  InMemoryCaseStore,
  InMemoryMemberStore,
  appealCustomId,
  moderationSettingsSchema,
  verifyCustomId,
} from "@keystone/module-moderation";
import { registerModerationRoutes, type ModerationButtonDeps } from "./moderation-buttons";

const NOW = 1_800_000_000_000;
const SECRET = "moderation-test-secret";
const signer = createComponentSigner(SECRET);

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
      lockdown: ok,
      restoreLockdown: ok,
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
  } = {},
): Promise<{
  record: Awaited<ReturnType<InMemoryCaseStore["create"]>>;
  store: InMemoryCaseStore;
  members: InMemoryMemberStore;
  actionCalls: string[];
  router: ComponentRouter;
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
  await members.markQuarantined("guild-1", "user-1");
  const { calls, port } = actions();

  const deps: ModerationButtonDeps = {
    settings: settings({
      appealsEnabled: options.appealsEnabled ?? true,
      joinGate: { enabled: options.joinGate ?? true },
    }),
    moderation: { cases, actions: port, members },
  };
  return { record, store, members, actionCalls: calls, router: registerModerationRoutes(new ComponentRouter(), deps) };
}

class FakeButton implements ComponentInteractionLike {
  readonly kind = "button" as const;
  readonly channelId = "chan-1";
  readonly permissions: readonly string[] = [];
  readonly replies: ReplyInput[] = [];
  #replied = false;

  constructor(
    readonly customId: string,
    readonly guildId: string | null = "guild-1",
    readonly userId = "user-1",
  ) {}

  get replied(): boolean {
    return this.#replied;
  }

  async reply(input: ReplyInput): Promise<unknown> {
    this.#replied = true;
    this.replies.push(input);
    return undefined;
  }
}

describe("signed moderation buttons", () => {
  it("opens an appeal from a signed case panel and writes the event", async () => {
    const { record, store, router } = await fixture();
    const button = new FakeButton(appealCustomId(record.id, signer, NOW));

    expect(await router.dispatch(button, signer, NOW)).toBe(true);

    expect(button.replies).toEqual([
      {
        content: "Appeal opened for case #1. A moderator can review it with /mod review.",
        ephemeral: true,
      },
    ]);
    expect((await store.getById(record.id))?.state).toBe("appealed");
    expect((await store.listEvents(record.id)).map((event) => event.type)).toEqual(["appealed"]);
  });

  it("refuses an appeal when the operator disabled appeals", async () => {
    const { record, store, router } = await fixture({ appealsEnabled: false });
    const button = new FakeButton(appealCustomId(record.id, signer, NOW));

    await router.dispatch(button, signer, NOW);

    expect(button.replies).toEqual([
      { content: "Appeals are disabled in this server.", ephemeral: true },
    ]);
    expect((await store.getById(record.id))?.state).toBe("open");
    expect(await store.listEvents(record.id)).toEqual([]);
  });

  it("refuses an appeal from a member the case is not against", async () => {
    const { record, store, router } = await fixture({ caseTarget: "someone-else" });
    const button = new FakeButton(appealCustomId(record.id, signer, NOW));

    await router.dispatch(button, signer, NOW);

    expect(button.replies).toEqual([
      { content: "You can only appeal a case against you.", ephemeral: true },
    ]);
    expect((await store.getById(record.id))?.state).toBe("open");
  });

  it("refuses a case panel clicked in another guild", async () => {
    const { record, store, router } = await fixture();
    const button = new FakeButton(appealCustomId(record.id, signer, NOW), "guild-2");

    await router.dispatch(button, signer, NOW);

    expect(button.replies).toEqual([{ content: "That case does not exist.", ephemeral: true }]);
    expect((await store.getById(record.id))?.state).toBe("open");
    expect(await store.listEvents(record.id)).toEqual([]);
  });

  it("refuses an expired id before any store read", async () => {
    const { record, store, router } = await fixture();
    const button = new FakeButton(appealCustomId(record.id, signer, NOW));

    await router.dispatch(button, signer, NOW + APPEAL_PANEL_TTL_MS + 1_000);

    expect(button.replies[0]?.content).toMatch(/expired/);
    expect((await store.getById(record.id))?.state).toBe("open");
  });

  it("refuses a forged id with no write", async () => {
    const { record, store, router } = await fixture();
    const forged = appealCustomId(record.id, signer, NOW).replace(record.id, "someone-elses-case");
    const button = new FakeButton(forged);

    await router.dispatch(button, signer, NOW);

    expect(button.replies[0]?.content).toMatch(/expired/);
    expect(await store.listEvents(record.id)).toEqual([]);
  });

  it("leaves a legacy unsigned appeal id unhandled", async () => {
    const { record, store, router } = await fixture();
    const button = new FakeButton(`keystone:appeal:${record.id}`);

    expect(await router.dispatch(button, signer, NOW)).toBe(false);
    expect(button.replies).toEqual([]);
    expect(await store.listEvents(record.id)).toEqual([]);
  });

  it("verifies a quarantined member from a DM using the guild inside the payload", async () => {
    const { members, actionCalls, router } = await fixture();
    const button = new FakeButton(verifyCustomId("guild-1", "user-1", signer, NOW), null);

    expect(await router.dispatch(button, signer, NOW)).toBe(true);

    expect(button.replies).toEqual([
      { content: "Verified. Quarantine has been lifted.", ephemeral: false },
    ]);
    expect(actionCalls).toEqual(["guild-1:user-1:Verification completed"]);
    expect(await members.get("guild-1", "user-1")).toMatchObject({
      quarantined: false,
      verifiedAt: expect.any(String),
    });
  });

  it("refuses a verify click from another member before any action", async () => {
    const { members, actionCalls, router } = await fixture();
    const button = new FakeButton(verifyCustomId("guild-1", "user-1", signer, NOW), "guild-1", "intruder");

    await router.dispatch(button, signer, NOW);

    expect(button.replies).toEqual([
      { content: "This verification belongs to another member.", ephemeral: true },
    ]);
    expect(actionCalls).toEqual([]);
    expect((await members.get("guild-1", "user-1"))?.quarantined).toBe(true);
  });

  it("refuses a verify id minted for another guild", async () => {
    const { actionCalls, router } = await fixture();
    const button = new FakeButton(verifyCustomId("guild-2", "user-1", signer, NOW), "guild-1");

    await router.dispatch(button, signer, NOW);

    expect(button.replies).toEqual([
      { content: "That panel belongs to another server.", ephemeral: true },
    ]);
    expect(actionCalls).toEqual([]);
  });

  it("refuses an expired verify link and a legacy in-guild verify id", async () => {
    const { members, actionCalls, router } = await fixture();
    const expired = new FakeButton(verifyCustomId("guild-1", "user-1", signer, NOW), null);
    await router.dispatch(expired, signer, NOW + VERIFY_PANEL_TTL_MS + 1_000);
    expect(expired.replies[0]?.content).toMatch(/expired/);

    const legacy = new FakeButton("keystone:verify:user-1");
    expect(await router.dispatch(legacy, signer, NOW)).toBe(false);
    expect(legacy.replies).toEqual([]);

    expect(actionCalls).toEqual([]);
    expect((await members.get("guild-1", "user-1"))?.quarantined).toBe(true);
  });
});
