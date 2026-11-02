import { describe, expect, it } from "vitest";
import {
  InMemoryIdempotencyStore,
  InMemorySettingsRepository,
  ModuleRegistry,
  SettingsService,
  createSilentLogger,
  noopTelemetry,
  type ModerationActions,
  type ModerationActionResult,
  type ModerationNotice,
} from "@keystone/kernel";
import { communityModule, InMemoryCommunityStore } from "@keystone/module-community";
import { RecordingCommunityActions } from "@keystone/module-community/testing";
import {
  CaseService,
  InMemoryCaseStore,
  InMemoryMemberStore,
  moderationModule,
} from "@keystone/module-moderation";
import { createTimerRuntime } from "./timers";

class RecordingActions implements ModerationActions {
  readonly calls: string[] = [];

  ban(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  kick(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  timeout(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  purge(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  lock(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  slowmode(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  deleteMessage(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  deleteWebhook(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  quarantine(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  unquarantine(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  unban(guildId: string, userId: string): Promise<ModerationActionResult> {
    this.calls.push(`unban:${guildId}:${userId}`);
    return Promise.resolve({ ok: true });
  }
  addRole(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
  removeRole(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }

  lockdown() {
    return Promise.resolve({ ok: true, locks: [] });
  }

  restoreLockdown() {
    return Promise.resolve({ ok: true, restored: [], failed: [] });
  }
  async notify(): Promise<void> {
    /* delivery is asserted by the module service tests */
  }
  directMessage(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
}

async function fixture() {
  const registry = new ModuleRegistry().registerAll([moderationModule, communityModule]);
  const settings = new SettingsService(new InMemorySettingsRepository(), registry);
  await settings.update("guild-1", "moderation", { dryRun: false, modLogChannelId: "mod-log" });

  const caseStore = new InMemoryCaseStore();
  const cases = new CaseService(caseStore);
  const moderationActions = new RecordingActions();
  const communityStore = new InMemoryCommunityStore();
  const communityActions = new RecordingCommunityActions();

  const timers = await createTimerRuntime({
    redisUrl: undefined,
    queueName: "timers-test",
    idempotency: new InMemoryIdempotencyStore(),
    settings,
    moderation: {
      cases,
      actions: moderationActions,
      members: new InMemoryMemberStore(),
    },
    community: { store: communityStore, actions: communityActions },
    logger: createSilentLogger(),
    telemetry: noopTelemetry,
  });

  return { timers, settings, cases, moderationActions, communityStore, communityActions };
}

describe("bot timer consumer", () => {
  it("runs a due moderation expiry through the real service and ignores a redelivery", async () => {
    const { timers, cases, moderationActions } = await fixture();
    const record = await cases.open({
      guildId: "guild-1",
      actorId: "mod-1",
      targetId: "user-1",
      action: "ban",
      reason: "temporary",
      state: "open",
    });
    await cases.setExpiry(record.id, new Date(Date.now() - 60_000).toISOString());

    const payload = { caseId: record.id, guildId: "guild-1" };
    const key = `moderation:expire:${record.id}`;
    await timers.queue.enqueue("moderation.expire", payload, {
      idempotencyKey: key,
      delayMs: 0,
    });
    await timers.queue.enqueue("moderation.expire", payload, {
      idempotencyKey: key,
      delayMs: 0,
    });
    await timers.queue.close();

    expect(moderationActions.calls).toEqual(["unban:guild-1:user-1"]);
    expect((await cases.getById(record.id))?.state).toBe("closed");
  });

  it("delivers a due reminder once and can send a scheduled message", async () => {
    const {
      timers,
      settings,
      communityStore,
      communityActions,
    } = await fixture();
    const due = new Date(Date.now() - 60_000).toISOString();
    const reminder = {
      id: "reminder-1",
      userId: "user-1",
      dueAt: due,
      text: "drink water",
      sent: false,
    };
    const scheduled = {
      id: "scheduled-1",
      userId: "server",
      channelId: "general",
      dueAt: due,
      text: "Scheduled hello",
      sent: false,
    };
    await communityStore.putRecord("guild-1", "reminder", reminder.id, reminder);
    await communityStore.putRecord("guild-1", "scheduled_message", scheduled.id, scheduled);

    await timers.queue.enqueue(
      "content.deliver",
      { guildId: "guild-1", kind: "reminder", id: reminder.id },
      { idempotencyKey: "content.deliver:reminder:reminder-1" },
    );
    await timers.queue.enqueue(
      "content.deliver",
      { guildId: "guild-1", kind: "scheduled_message", id: scheduled.id },
      { idempotencyKey: "content.deliver:scheduled_message:scheduled-1" },
    );
    await timers.queue.close();

    expect(communityActions.dms[0]?.message.content).toContain("drink water");
    expect(communityActions.sent.some((entry) => entry.message.content === "Scheduled hello")).toBe(
      true,
    );
    expect(
      (await communityStore.getRecord("guild-1", "reminder", "reminder-1"))?.data,
    ).toMatchObject({ sent: true });
    expect(
      (await communityStore.getRecord("guild-1", "scheduled_message", "scheduled-1"))?.data,
    ).toMatchObject({ sent: true });

    // The command path passes the same settings object to ContentService; this
    // asserts the timer handler can parse it, not only that the store works.
    const config = await settings.forModule("community").get("guild-1");
    expect(config.enabled).toBe(true);
  });

  it("does not throw for an already-final case", async () => {
    const { timers, cases } = await fixture();
    const record = await cases.open({
      guildId: "guild-1",
      actorId: "mod-1",
      targetId: "user-1",
      action: "ban",
      reason: "already closed",
      state: "closed",
    });
    await timers.queue.enqueue("moderation.expire", {
      caseId: record.id,
      guildId: "guild-1",
    });
    await timers.queue.close();
    expect((await cases.getById(record.id))?.state).toBe("closed");
  });
});
