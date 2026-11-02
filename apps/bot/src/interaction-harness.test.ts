import { describe, expect, it } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import {
  InMemoryCooldownStore,
  InMemorySettingsRepository,
  ModuleRegistry,
  SettingsService,
  dispatchCommand,
  type ModerationActions,
  type ModerationActionResult,
  type ModerationNotice,
} from "@keystone/kernel";
import { noopQueue, staticHealth } from "@keystone/testing";
import { createSilentLogger } from "@keystone/kernel";
import { CaseService, InMemoryCaseStore, InMemoryMemberStore } from "@keystone/module-moderation";
import { modules } from "./modules";
import { asInteractionLike } from "./adapt";

/**
 * A synthetic ChatInputCommandInteraction with Discord's nested option shape.
 *
 * This is deliberately not a FakeInteraction: the point is to cross the real
 * `asInteractionLike` adapter and the real registry, so a regression in either
 * one fails here. It is still a structural harness, not a gateway connection.
 */
class RecordingModerationActions implements ModerationActions {
  readonly calls: string[] = [];
  readonly notifications: ModerationNotice[] = [];

  ban(guildId: string, userId: string, reason: string): Promise<ModerationActionResult> {
    this.calls.push(`ban:${guildId}:${userId}:${reason}`);
    return Promise.resolve({ ok: true });
  }

  unban(): Promise<ModerationActionResult> {
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

  async notify(
    _guildId: string,
    _channelId: string | null | undefined,
    notice: ModerationNotice,
  ): Promise<void> {
    this.notifications.push(notice);
  }

  directMessage(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }
}

function syntheticBanInteraction(): {
  interaction: ChatInputCommandInteraction;
  replies: Array<{ content?: string; embeds?: unknown[] }>;
} {
  const replies: Array<{ content?: string; embeds?: unknown[] }> = [];
  const interaction = {
    id: "synthetic-slash-1",
    commandName: "mod",
    guildId: "guild-1",
    channelId: "channel-1",
    user: { id: "mod-1" },
    memberPermissions: { toArray: () => ["ModerateMembers"] },
    isChatInputCommand: () => true,
    replied: false,
    deferred: false,
    options: {
      // Exactly what Discord sends for `/mod ban user:@target reason:... dry_run:false`.
      data: [
        {
          name: "ban",
          type: 1,
          options: [
            { name: "user", type: 6, value: "target-1" },
            { name: "reason", type: 3, value: "posting raid invites" },
            { name: "dry_run", type: 5, value: false },
          ],
        },
      ],
      getSubcommand: () => "ban",
      getSubcommandGroup: () => null,
    },
    async reply(input: { content?: string; embeds?: unknown[] }) {
      replies.push(input);
      return undefined;
    },
    async deferReply() {
      return undefined;
    },
    async editReply(input: { content?: string; embeds?: unknown[] }) {
      replies.push(input);
      return undefined;
    },
    async followUp(input: { content?: string; embeds?: unknown[] }) {
      replies.push(input);
      return undefined;
    },
  } as unknown as ChatInputCommandInteraction;

  return { interaction, replies };
}

describe("synthetic slash interaction", () => {
  it("drives /mod ban through the real adapter, registry and dispatch", async () => {
    const registry = new ModuleRegistry().registerAll(modules);
    const settings = new SettingsService(new InMemorySettingsRepository(), registry);
    await settings.update("guild-1", "moderation", { dryRun: false });

    const cases = new CaseService(new InMemoryCaseStore());
    const actions = new RecordingModerationActions();
    const { interaction, replies } = syntheticBanInteraction();

    const outcome = await dispatchCommand(
      {
        registry,
        settings,
        logger: createSilentLogger(),
        cooldowns: new InMemoryCooldownStore(),
        queue: noopQueue,
        health: staticHealth(),
        moderation: { cases, actions, members: new InMemoryMemberStore() },
        now: () => 1_700_000_000_000,
      },
      asInteractionLike(interaction),
    );

    expect(outcome.status).toBe("ok");
    expect(actions.calls).toEqual([
      "ban:guild-1:target-1:posting raid invites",
    ]);

    const records = await cases.list("guild-1");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "ban",
      targetId: "target-1",
      reason: "posting raid invites",
      state: "open",
    });
    expect(replies.at(-1)?.content).toContain("Case #1 recorded and action applied.");
  });

  it("rejects an unknown subcommand before executing anything", async () => {
    const registry = new ModuleRegistry().registerAll(modules);
    const settings = new SettingsService(new InMemorySettingsRepository(), registry);
    const actions = new RecordingModerationActions();
    const { interaction, replies } = syntheticBanInteraction();
    (interaction as unknown as { options: { getSubcommand: () => string } }).options.getSubcommand =
      () => "not-a-command";

    const outcome = await dispatchCommand(
      {
        registry,
        settings,
        logger: createSilentLogger(),
        cooldowns: new InMemoryCooldownStore(),
        queue: noopQueue,
        health: staticHealth(),
        moderation: {
          cases: new CaseService(new InMemoryCaseStore()),
          actions,
          members: new InMemoryMemberStore(),
        },
      },
      asInteractionLike(interaction),
    );

    expect(outcome.status).toBe("unknown-command");
    expect(actions.calls).toEqual([]);
    expect(replies).toEqual([]);
  });
});
