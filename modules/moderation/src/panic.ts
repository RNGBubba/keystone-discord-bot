import type {
  ChannelLock,
  ModerationActions,
  PanicState,
  PanicStore,
} from "@keystone/kernel";
import type { ModerationSettings } from "./settings";

export type PanicStartOutcome =
  | { status: "started"; state: PanicState; locked: number }
  | { status: "already-active"; state: PanicState }
  | { status: "partial"; state: PanicState; locked: number; detail: string }
  | { status: "failed"; detail: string };

export type PanicEndOutcome =
  | { status: "ended"; restored: number }
  | { status: "not-active" }
  | { status: "partial"; restored: number; failed: number; detail: string };

/** One snapshot per guild; the store is the durable source of truth. */
export class InMemoryPanicStore implements PanicStore {
  readonly #states = new Map<string, PanicState>();

  async get(guildId: string): Promise<PanicState | undefined> {
    return this.#states.get(guildId);
  }

  async save(guildId: string, state: PanicState): Promise<void> {
    this.#states.set(guildId, state);
  }

  async clear(guildId: string): Promise<void> {
    this.#states.delete(guildId);
  }
}

/**
 * The panic switch, kept deliberately small.
 *
 * Turning it on calls one action that snapshots every text channel's @everyone
 * overwrite before denying SendMessages. The snapshot is persisted before the
 * command replies, so a bot restart cannot lose the way back. Turning it off
 * restores exactly those overwrites and keeps any channel that failed, so a
 * retry is possible without guessing.
 *
 * There is no automatic expiry in this slice: the promised surface is a manual
 * switch plus a way out, and a timer would add another recovery path for the
 * snapshot without making the switch more reliable.
 */
export class PanicService {
  constructor(
    private readonly store: PanicStore,
    private readonly actions: ModerationActions,
    private readonly settings: ModerationSettings,
    private readonly now: () => number = Date.now,
  ) {}

  status(guildId: string): Promise<PanicState | undefined> {
    return this.store.get(guildId);
  }

  async start(guildId: string, actorId: string, reason: string): Promise<PanicStartOutcome> {
    const existing = await this.store.get(guildId);
    if (existing?.active) return { status: "already-active", state: existing };

    const result = await this.actions.lockdown(guildId, reason);
    const locks: readonly ChannelLock[] = result.locks ?? [];
    if (!result.ok && locks.length === 0) {
      return { status: "failed", detail: result.detail ?? "No channel could be locked." };
    }

    const state: PanicState = {
      active: true,
      startedAt: new Date(this.now()).toISOString(),
      startedBy: actorId,
      reason,
      channels: locks,
    };
    // Persist before notifying. If the process dies after this point, the
    // snapshot still restores every channel the action actually changed.
    await this.store.save(guildId, state);
    await this.#notify(guildId, state, result.ok ? "enabled" : "partially enabled");

    if (!result.ok) {
      return {
        status: "partial",
        state,
        locked: locks.length,
        detail: result.detail ?? "Some channels could not be locked.",
      };
    }
    return { status: "started", state, locked: locks.length };
  }

  async end(guildId: string, reason: string): Promise<PanicEndOutcome> {
    const state = await this.store.get(guildId);
    if (!state?.active) return { status: "not-active" };

    const result = await this.actions.restoreLockdown(guildId, state.channels, reason);
    const restored = result.restored?.length ?? (result.ok ? state.channels.length : 0);

    if (result.ok) {
      await this.store.clear(guildId);
      await this.#notify(guildId, state, "disabled", restored);
      return { status: "ended", restored };
    }

    // Keep only the channels whose restore failed. Running `off` again retries
    // them; a channel already restored is never touched twice.
    const failedIds = new Set(
      result.failed ?? state.channels.map((lock) => lock.channelId),
    );
    const remaining = state.channels.filter((lock) => failedIds.has(lock.channelId));
    if (remaining.length > 0) {
      await this.store.save(guildId, { ...state, channels: remaining });
    } else {
      await this.store.clear(guildId);
    }
    await this.#notify(guildId, state, "partially disabled", restored);

    return {
      status: "partial",
      restored,
      failed: remaining.length,
      detail: result.detail ?? "Some channels could not be restored.",
    };
  }

  async #notify(
    guildId: string,
    state: PanicState,
    change: "enabled" | "partially enabled" | "disabled" | "partially disabled",
    restored?: number,
  ): Promise<void> {
    const fields = [
      { name: "By", value: `<@${state.startedBy}>`, inline: true },
      { name: "Started", value: `<t:${Math.floor(new Date(state.startedAt).getTime() / 1000)}:R>`, inline: true },
      { name: "Channels", value: `${restored ?? state.channels.length}`, inline: true },
    ];
    await this.actions.notify(guildId, this.settings.modLogChannelId, {
      embeds: [
        {
          title: `Panic mode ${change}`,
          description: state.reason,
          color: change === "enabled" || change === "partially enabled" ? 0xed4245 : 0x57f287,
          fields,
          footer: { text: "The snapshot is persisted; /mod panic state:off restores it." },
        },
      ],
    });
  }
}
