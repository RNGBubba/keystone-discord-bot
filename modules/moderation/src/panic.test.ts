import { describe, expect, it, vi } from "vitest";
import type { ChannelLock, ModerationActions } from "@keystone/kernel";
import { moderationSettingsSchema } from "./settings";
import { InMemoryPanicStore, PanicService } from "./panic";

const guild = "guild-a";
const fixedNow = 1_700_000_000_000;
const settings = moderationSettingsSchema.parse({ modLogChannelId: "mod-log" });

function fixture(lockdownResult: unknown, restoreResult: unknown = { ok: true, restored: [] }) {
  const actions = {
    lockdown: vi.fn().mockResolvedValue(lockdownResult),
    restoreLockdown: vi.fn().mockResolvedValue(restoreResult),
    notify: vi.fn().mockResolvedValue(undefined),
  } as unknown as ModerationActions;
  const store = new InMemoryPanicStore();
  const service = new PanicService(store, actions, settings, () => fixedNow);
  return { actions, store, service };
}

const locks: ChannelLock[] = [
  { channelId: "channel-1", existed: true, previous: "neutral" },
  { channelId: "channel-2", existed: false, previous: "neutral" },
];

describe("panic mode", () => {
  it("persists the snapshot before replying and is idempotent while active", async () => {
    const { actions, store, service } = fixture({ ok: true, locks });

    const result = await service.start(guild, "mod-1", "raid in progress");
    expect(result).toMatchObject({ status: "started", locked: 2 });
    expect(await store.get(guild)).toMatchObject({
      active: true,
      startedBy: "mod-1",
      reason: "raid in progress",
      channels: locks,
    });
    expect(actions.lockdown).toHaveBeenCalledTimes(1);
    expect(actions.notify).toHaveBeenCalledTimes(1);

    expect((await service.start(guild, "mod-2", "again")).status).toBe("already-active");
    expect(actions.lockdown).toHaveBeenCalledTimes(1);
  });

  it("restores every snapshot lock and clears the record", async () => {
    const { actions, store, service } = fixture({ ok: true, locks });
    await service.start(guild, "mod-1", "raid");

    actions.restoreLockdown = vi.fn().mockResolvedValue({
      ok: true,
      restored: ["channel-1", "channel-2"],
      failed: [],
    }) as never;
    expect(await service.end(guild, "all clear")).toEqual({ status: "ended", restored: 2 });
    expect(await store.get(guild)).toBeUndefined();
    expect((await service.end(guild, "again")).status).toBe("not-active");
  });

  it("keeps only the channels that failed to restore, so off can be retried", async () => {
    const { store, service } = fixture(
      { ok: true, locks },
      { ok: false, restored: ["channel-1"], failed: ["channel-2"], detail: "unknown channel" },
    );
    await service.start(guild, "mod-1", "raid");

    const partial = await service.end(guild, "all clear");
    expect(partial).toMatchObject({ status: "partial", restored: 1, failed: 1 });
    expect((await store.get(guild))?.channels).toEqual([locks[1]]);

    // A second off retries only the remaining lock.
    const retry = new PanicService(
      store,
      {
        restoreLockdown: vi.fn().mockResolvedValue({
          ok: true,
          restored: ["channel-2"],
          failed: [],
        }),
        notify: vi.fn().mockResolvedValue(undefined),
      } as unknown as ModerationActions,
      settings,
      () => fixedNow,
    );
    expect(await retry.end(guild, "retry")).toEqual({ status: "ended", restored: 1 });
    expect(await store.get(guild)).toBeUndefined();
  });

  it("does not create state when no channel could be locked", async () => {
    const { store, service } = fixture({ ok: false, detail: "Missing ManageChannels" });
    expect(await service.start(guild, "mod-1", "raid")).toEqual({
      status: "failed",
      detail: "Missing ManageChannels",
    });
    expect(await store.get(guild)).toBeUndefined();
  });

  it("keeps a partial start recoverable and reports the count it changed", async () => {
    const { store, service } = fixture({
      ok: false,
      locks: [locks[0]],
      detail: "channel-2 failed",
    });
    const result = await service.start(guild, "mod-1", "raid");
    expect(result).toMatchObject({ status: "partial", locked: 1, detail: "channel-2 failed" });
    expect((await store.get(guild))?.channels).toEqual([locks[0]]);
  });
});
