import { describe, expect, it } from "vitest";
import type {
  ModerationActions,
  ModerationActionResult,
  ModerationCase,
  ModerationNotice,
} from "@keystone/kernel";
import { RecordingJobQueue } from "@keystone/testing";
import { CaseService, InMemoryCaseStore } from "./cases";
import { moderationSettingsSchema } from "./settings";
import { TemporaryActionService } from "./temporary";

class RecordingActions implements ModerationActions {
  readonly calls: string[] = [];
  readonly notices: ModerationNotice[] = [];
  unbanResult: ModerationActionResult = { ok: true };

  ban(): Promise<ModerationActionResult> {
    this.calls.push("ban");
    return Promise.resolve({ ok: true });
  }
  kick(): Promise<ModerationActionResult> {
    this.calls.push("kick");
    return Promise.resolve({ ok: true });
  }
  timeout(): Promise<ModerationActionResult> {
    this.calls.push("timeout");
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
    return Promise.resolve(this.unbanResult);
  }
  addRole(): Promise<ModerationActionResult> {
    this.calls.push("add-role");
    return Promise.resolve({ ok: true });
  }
  removeRole(guildId: string, userId: string, roleId: string): Promise<ModerationActionResult> {
    this.calls.push(`remove-role:${guildId}:${userId}:${roleId}`);
    return Promise.resolve({ ok: true });
  }

  lockdown() {
    return Promise.resolve({ ok: true, locks: [] });
  }

  restoreLockdown() {
    return Promise.resolve({ ok: true, restored: [], failed: [] });
  }
  async notify(guildId: string, _channelId: string | null | undefined, notice: ModerationNotice) {
    this.calls.push(`notify:${guildId}`);
    this.notices.push(notice);
  }
  directMessage(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
}

function fixture(start = "2026-11-02T12:00:00.000Z") {
  let now = new Date(start).getTime();
  const store = new InMemoryCaseStore();
  const cases = new CaseService(store);
  const actions = new RecordingActions();
  const settings = moderationSettingsSchema.parse({
    dryRun: false,
    modLogChannelId: "mod-log",
  });
  const service = new TemporaryActionService(cases, actions, settings, () => now);
  return {
    store,
    cases,
    actions,
    service,
    clock: {
      now: () => now,
      advance: (ms: number) => {
        now += ms;
      },
    },
  };
}

async function openCase(
  cases: CaseService,
  input: {
    action: string;
    expiresAt: string;
    evidence?: unknown;
  },
): Promise<ModerationCase> {
  const record = await cases.open({
    guildId: "guild-a",
    actorId: "mod-1",
    targetId: "user-1",
    action: input.action,
    reason: "test",
    rule: "manual",
    evidence: input.evidence,
    state: "open",
  });
  return (await cases.setExpiry(record.id, input.expiresAt)) ?? record;
}

describe("temporary moderation", () => {
  it("schedules one delayed job with the case as the idempotency key", async () => {
    const { cases, service } = fixture();
    const record = await openCase(cases, {
      action: "ban",
      expiresAt: "2026-11-02T12:10:00.000Z",
    });
    const queue = new RecordingJobQueue();

    const id = await service.schedule(queue, record);
    expect(id).toBe(`moderation:expire:${record.id}`);
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]).toMatchObject({
      name: "moderation.expire",
      payload: { caseId: record.id, guildId: "guild-a" },
      options: {
        delayMs: 10 * 60_000,
        idempotencyKey: `moderation:expire:${record.id}`,
      },
    });
    // BullMQ accepts a custom job id only when it has no colon or exactly three
    // colon-separated parts; a two-part key throws at enqueue in production.
    expect(queue.enqueued[0]?.options?.idempotencyKey?.split(":")).toHaveLength(3);
  });

  it("does not release early, then unbans once and closes the case with an event", async () => {
    const { cases, actions, service, clock } = fixture();
    const record = await openCase(cases, {
      action: "ban",
      expiresAt: "2026-11-02T12:05:00.000Z",
    });
    const queue = new RecordingJobQueue();
    await service.schedule(queue, record);

    expect(await service.expire(record.id)).toMatchObject({ status: "not-due" });
    expect(actions.calls).toEqual([]);

    clock.advance(6 * 60_000);
    expect(await service.expire(record.id)).toMatchObject({ status: "expired" });
    expect(actions.calls).toContain("unban:guild-a:user-1");
    expect((await cases.getById(record.id))?.state).toBe("closed");
    expect((await cases.listEvents(record.id)).map((event) => event.type)).toEqual([
      "created",
      "expired",
    ]);
    expect(actions.notices).toHaveLength(1);

    expect(await service.expire(record.id)).toMatchObject({ status: "already-final" });
    expect(actions.calls.filter((call) => call.startsWith("unban:"))).toHaveLength(1);
  });

  it("lets only one of two concurrent workers release the action", async () => {
    const { cases, actions, service, clock } = fixture();
    const record = await openCase(cases, {
      action: "ban",
      expiresAt: "2026-11-02T12:01:00.000Z",
    });
    clock.advance(2 * 60_000);

    const results = await Promise.all([service.expire(record.id), service.expire(record.id)]);
    expect(results.map((result) => result.status).sort()).toEqual(["expired", "in-progress"]);
    expect(actions.calls.filter((call) => call.startsWith("unban:"))).toHaveLength(1);
  });

  it("removes the recorded role for a temporary role, not a guessed one", async () => {
    const { cases, actions, service, clock } = fixture();
    const record = await openCase(cases, {
      action: "temp-role",
      evidence: { roleId: "role-vip" },
      expiresAt: "2026-11-02T12:01:00.000Z",
    });

    clock.advance(2 * 60_000);
    expect(await service.expire(record.id)).toMatchObject({ status: "expired" });
    expect(actions.calls).toContain("remove-role:guild-a:user-1:role-vip");
  });

  it("keeps the case open and records a note when the release action fails", async () => {
    const { cases, actions, service, clock } = fixture();
    const record = await openCase(cases, {
      action: "ban",
      expiresAt: "2026-11-02T12:01:00.000Z",
    });
    actions.unbanResult = { ok: false, detail: "Missing permissions" };

    clock.advance(2 * 60_000);
    expect(await service.expire(record.id)).toEqual({
      status: "failed",
      detail: "Missing permissions",
    });
    expect((await cases.getById(record.id))?.state).toBe("open");
    expect((await cases.listEvents(record.id)).some((event) => event.type === "note")).toBe(true);

    actions.unbanResult = { ok: true };
    expect(await service.expire(record.id)).toMatchObject({ status: "expired" });
  });

  it("recovers overdue cases and reschedules future ones after a restart", async () => {
    const { cases, actions, service, clock } = fixture();
    const overdue = await openCase(cases, {
      action: "ban",
      expiresAt: "2026-11-02T11:59:00.000Z",
    });
    const future = await openCase(cases, {
      action: "temp-role",
      evidence: { roleId: "role-vip" },
      expiresAt: "2026-11-02T12:15:00.000Z",
    });
    const queue = new RecordingJobQueue();

    const result = await service.recover("guild-a", queue);
    expect(result).toEqual({ expired: 1, failed: 0, scheduled: 1 });
    expect((await cases.getById(overdue.id))?.state).toBe("closed");
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]?.payload).toMatchObject({
      caseId: future.id,
      guildId: "guild-a",
    });
    expect(actions.calls).toContain("unban:guild-a:user-1");

    clock.advance(20 * 60_000);
    expect(await service.expire(future.id)).toMatchObject({ status: "expired" });
    expect(actions.calls).toContain("remove-role:guild-a:user-1:role-vip");
  });

  it("leaves an unsupported temporary action open for an operator", async () => {
    const { cases, service, clock } = fixture();
    const record = await openCase(cases, {
      action: "warn",
      expiresAt: "2026-11-02T12:01:00.000Z",
    });
    clock.advance(2 * 60_000);
    expect(await service.expire(record.id)).toEqual({ status: "unsupported", action: "warn" });
    expect((await cases.getById(record.id))?.state).toBe("open");
  });
});
