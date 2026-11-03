import { randomUUID } from "node:crypto";
import { UserError } from "@keystone/kernel";
import type {
  ActionRow,
  CommunityActions,
  CommunityStore,
  EmbedPayload,
} from "@keystone/kernel";
import { greetingPanel } from "./panels";
import type { CommunitySettings } from "./settings";

function row(buttons: ActionRow["components"]): ActionRow {
  return { type: "action-row", components: buttons };
}

function button(
  customId: string,
  label: string,
  style: "primary" | "secondary" | "success" | "danger" = "primary",
): ActionRow["components"][number] {
  return { type: "button", customId, label, style };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export class WelcomeService {
  constructor(
    private readonly actions: CommunityActions,
    private readonly settings: CommunitySettings,
    private readonly store?: CommunityStore,
    private readonly now: () => number = Date.now,
  ) {}

  async handleJoin(
    guildId: string,
    userId: string,
    serverName = "this server",
  ): Promise<{ sent: boolean; roleAdded: boolean; dmSent: boolean }> {
    const config = this.settings.welcome;
    if (!config.enabled) return { sent: false, roleAdded: false, dmSent: false };

    const text = config.message
      .replaceAll("{user}", `<@${userId}>`)
      .replaceAll("{server}", serverName)
      .slice(0, 1_500);

    let sent = false;
    if (config.channelId) {
      const result = await this.actions.sendMessage(guildId, config.channelId, {
        v2: greetingPanel(text),
      });
      sent = result.ok;
    }

    let roleAdded = false;
    if (config.roleId) {
      if (config.roleDelayMinutes > 0 && this.store) {
        const dueAt = new Date(this.now() + config.roleDelayMinutes * 60_000).toISOString();
        await this.store.putRecord(guildId, "autorole_pending", `${userId}:${dueAt}`, {
          userId,
          roleId: config.roleId,
          dueAt,
          applied: false,
        });
      } else {
        const result = await this.actions.addRole(
          guildId,
          userId,
          config.roleId,
          "Welcome autorole",
        );
        roleAdded = result.ok;
      }
    }

    let dmSent = false;
    if (config.dm) {
      const result = await this.actions.sendDM(userId, { content: text });
      dmSent = result.ok;
    }
    return { sent, roleAdded, dmSent };
  }

  /**
   * Send the goodbye message when a member leaves. It shares the welcome
   * placeholder rules but has no autorole or DM branch: the member is already
   * gone, and a role grant would race Discord's own member removal.
   */
  async handleLeave(
    guildId: string,
    userId: string,
    serverName = "this server",
  ): Promise<{ sent: boolean }> {
    const config = this.settings.goodbye;
    if (!config.enabled || !config.channelId) return { sent: false };

    const text = config.message
      .replaceAll("{user}", `<@${userId}>`)
      .replaceAll("{server}", serverName)
      .slice(0, 1_500);
    const result = await this.actions.sendMessage(guildId, config.channelId, {
      v2: greetingPanel(text),
    });
    return { sent: result.ok };
  }

  /** Process delayed autoroles; repeated ticks cannot apply the same record twice. */
  async applyDueAutoroles(guildId: string): Promise<number> {
    if (!this.store) return 0;
    const records = await this.store.listRecords<{
      userId: string;
      roleId: string;
      dueAt: string;
      applied: boolean;
    }>(guildId, "autorole_pending", 100);
    let applied = 0;
    for (const record of records) {
      if (record.data.applied || new Date(record.data.dueAt).getTime() > this.now()) continue;
      const result = await this.actions.addRole(
        guildId,
        record.data.userId,
        record.data.roleId,
        "Delayed welcome autorole",
      );
      if (!result.ok) continue;
      await this.store.putRecord(guildId, "autorole_pending", record.key, {
        ...record.data,
        applied: true,
      });
      applied += 1;
    }
    return applied;
  }
}

export interface ReactionRole {
  readonly roleId: string;
  readonly label: string;
  readonly emoji?: string;
}

export class ReactionRoleService {
  constructor(
    private readonly store: CommunityStore,
    private readonly actions: CommunityActions,
  ) {}

  async createPanel(
    guildId: string,
    channelId: string,
    title: string,
    roles: ReactionRole[],
  ): Promise<{ messageId: string }> {
    if (roles.length < 1) throw new UserError("A reaction-role panel needs at least one role.");
    if (roles.length > 5) throw new UserError("A panel can hold at most five buttons.");
    const message = {
      embeds: [
        {
          title: truncate(title, 256),
          description: "Press a button to add or remove the role.",
          color: 0x5865f2,
        },
      ],
      components: [
        row(
          roles.map((role) =>
            button(
              `keystone:role:${role.roleId}`,
              `${role.emoji ? `${role.emoji} ` : ""}${role.label}`.slice(0, 80),
              "secondary",
            ),
          ),
        ),
      ],
    };
    const result = await this.actions.sendMessage(guildId, channelId, message);
    if (!result.ok || !result.id) throw new Error(result.detail ?? "Could not post the panel");
    for (const role of roles) {
      await this.store.putRecord(guildId, "reaction_role", role.roleId, {
        messageId: result.id,
        channelId,
        roleId: role.roleId,
        label: role.label,
      });
    }
    return { messageId: result.id };
  }

  async createSelectPanel(
    guildId: string,
    channelId: string,
    title: string,
    roles: ReactionRole[],
    options: { minValues?: number; maxValues?: number } = {},
  ): Promise<{ messageId: string; panelId: string }> {
    if (roles.length < 2) throw new UserError("A select panel needs at least two roles.");
    if (roles.length > 25) throw new UserError("Discord allows at most 25 select options.");
    const panelId = randomUUID();
    const maxValues = Math.min(options.maxValues ?? roles.length, roles.length);
    const minValues = Math.min(options.minValues ?? 0, maxValues);
    const message = {
      embeds: [
        {
          title: truncate(title, 256),
          description: "Choose one or more roles, then submit the menu.",
          color: 0x5865f2,
        },
      ],
      components: [
        row([
          {
            type: "select",
            customId: `keystone:roles:${panelId}`,
            placeholder: "Choose roles",
            minValues,
            maxValues,
            options: roles.map((role) => ({
              label: role.label.slice(0, 100),
              value: role.roleId,
              description: role.emoji ? role.emoji.slice(0, 100) : undefined,
            })),
          },
        ]),
      ],
    };
    const result = await this.actions.sendMessage(guildId, channelId, message);
    if (!result.ok || !result.id) throw new Error(result.detail ?? "Could not post select panel");
    await this.store.putRecord(guildId, "reaction_role_panel", panelId, {
      panelId,
      messageId: result.id,
      channelId,
      roleIds: roles.map((role) => role.roleId),
      minValues,
      maxValues,
    });
    return { messageId: result.id, panelId };
  }

  async applySelection(
    guildId: string,
    userId: string,
    panelId: string,
    selectedRoleIds: string[],
  ): Promise<{ added: number; removed: number }> {
    const panel = await this.store.getRecord<{ roleIds: string[] }>(
      guildId,
      "reaction_role_panel",
      panelId,
    );
    if (!panel) throw new UserError("That role panel is no longer configured.");
    const managed = new Set(panel.data.roleIds);
    for (const roleId of selectedRoleIds) {
      if (!managed.has(roleId)) throw new UserError("That role is not part of this panel.");
    }
    let added = 0;
    let removed = 0;
    for (const roleId of managed) {
      const selected = selectedRoleIds.includes(roleId);
      const has = await this.actions.hasRole(guildId, userId, roleId);
      if (selected && !has) {
        await this.actions.addRole(guildId, userId, roleId, "Reaction role");
        added += 1;
      } else if (!selected && has) {
        await this.actions.removeRole(guildId, userId, roleId, "Reaction role");
        removed += 1;
      }
    }
    return { added, removed };
  }

  async toggle(
    guildId: string,
    userId: string,
    roleId: string,
  ): Promise<{ added: boolean; label: string }> {
    const record = await this.store.getRecord<{ label: string }>(
      guildId,
      "reaction_role",
      roleId,
    );
    if (!record) throw new UserError("That reaction role is no longer configured.");
    const result = await this.actions.toggleRole(guildId, userId, roleId);
    if (!result.ok) throw new UserError(result.detail ?? "Could not change that role.");
    return { added: result.added ?? false, label: record.data.label };
  }
}

export class StarboardService {
  constructor(
    private readonly store: CommunityStore,
    private readonly actions: CommunityActions,
    private readonly settings: CommunitySettings,
  ) {}

  async onReaction(input: {
    guildId: string;
    channelId: string;
    messageId: string;
    authorId: string;
    content: string;
    emoji: string;
    count: number;
  }): Promise<{ posted: boolean; edited: boolean }> {
    const config = this.settings.starboard;
    const override = config.overrides[input.channelId];
    const destination = override?.channelId ?? config.channelId;
    const threshold = override?.threshold ?? config.threshold;
    if (!destination || input.channelId === destination) {
      return { posted: false, edited: false };
    }
    if (input.emoji !== config.emoji || input.count < threshold) {
      return { posted: false, edited: false };
    }

    const existing = await this.store.getRecord<{
      starboardMessageId: string;
      channelId: string;
    }>(input.guildId, "starboard", input.messageId);
    const embed: EmbedPayload = {
      title: `${config.emoji} ${input.count}`,
      description: truncate(input.content || "(no text)", 1_500),
      color: 0xfaa61a,
      fields: [{ name: "Author", value: `<@${input.authorId}>`, inline: true }],
      footer: { text: `Message ${input.messageId}` },
    };

    if (existing) {
      const result = await this.actions.editMessage(
        input.guildId,
        existing.data.channelId,
        existing.data.starboardMessageId,
        { embeds: [embed] },
      );
      return { posted: false, edited: result.ok };
    }

    const result = await this.actions.sendMessage(input.guildId, destination, {
      embeds: [embed],
    });
    if (!result.ok || !result.id) return { posted: false, edited: false };
    await this.store.putRecord(input.guildId, "starboard", input.messageId, {
      starboardMessageId: result.id,
      channelId: destination,
      count: input.count,
      authorId: input.authorId,
    });
    return { posted: true, edited: false };
  }
}

export interface GiveawayRecord {
  readonly id: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly prize: string;
  readonly endsAt: string;
  readonly winners: number;
  readonly entries: string[];
  readonly ended: boolean;
  readonly winnerIds?: string[];
}

export class GiveawayService {
  constructor(
    private readonly store: CommunityStore,
    private readonly actions: CommunityActions,
    private readonly settings: CommunitySettings,
    private readonly now: () => number = Date.now,
    private readonly rng: () => number = Math.random,
  ) {}

  async start(
    guildId: string,
    channelId: string,
    prize: string,
    durationMinutes: number,
    winners = 1,
  ): Promise<GiveawayRecord> {
    if (durationMinutes < 1 || durationMinutes > this.settings.giveaways.maxDurationMinutes) {
      throw new UserError(
        `Duration must be between 1 and ${this.settings.giveaways.maxDurationMinutes} minutes.`,
      );
    }
    if (!Number.isInteger(winners) || winners < 1 || winners > this.settings.giveaways.maxWinners) {
      throw new UserError(`Winners must be between 1 and ${this.settings.giveaways.maxWinners}.`);
    }
    const id = randomUUID();
    const endsAt = new Date(this.now() + durationMinutes * 60_000).toISOString();
    const message = await this.actions.sendMessage(guildId, channelId, {
      embeds: [
        {
          title: "🎉 Giveaway",
          description: `**${truncate(prize, 200)}**\nEnds <t:${Math.floor(
            new Date(endsAt).getTime() / 1_000,
          )}:R>\nWinners: ${winners}`,
          color: 0x57f287,
        },
      ],
      components: [row([button(`keystone:giveaway:enter:${id}`, "Enter", "success")])],
    });
    if (!message.ok || !message.id) throw new Error(message.detail ?? "Could not start giveaway");
    const record: GiveawayRecord = {
      id,
      channelId,
      messageId: message.id,
      prize,
      endsAt,
      winners,
      entries: [],
      ended: false,
    };
    await this.store.putRecord(guildId, "giveaway", id, record);
    return record;
  }

  async enter(
    guildId: string,
    giveawayId: string,
    userId: string,
  ): Promise<{ entered: boolean; entries: number; reason?: string }> {
    const record = await this.store.getRecord<GiveawayRecord>(guildId, "giveaway", giveawayId);
    if (!record) throw new UserError("That giveaway does not exist.");
    if (record.data.ended || this.now() > new Date(record.data.endsAt).getTime()) {
      return { entered: false, entries: record.data.entries.length, reason: "This giveaway has ended." };
    }
    if (record.data.entries.includes(userId)) {
      return { entered: false, entries: record.data.entries.length, reason: "You are already entered." };
    }
    const entries = [...record.data.entries, userId];
    await this.store.putRecord(guildId, "giveaway", giveawayId, { ...record.data, entries });
    return { entered: true, entries: entries.length };
  }

  async end(
    guildId: string,
    giveawayId: string,
  ): Promise<{ ended: boolean; winners: string[]; reason?: string }> {
    const record = await this.store.getRecord<GiveawayRecord>(guildId, "giveaway", giveawayId);
    if (!record) throw new UserError("That giveaway does not exist.");
    if (record.data.ended) return { ended: false, winners: record.data.winnerIds ?? [], reason: "Already ended." };
    if (this.now() < new Date(record.data.endsAt).getTime()) {
      return { ended: false, winners: [], reason: "The giveaway is still running." };
    }

    const pool = [...record.data.entries];
    const winners: string[] = [];
    while (pool.length > 0 && winners.length < record.data.winners) {
      const index = Math.floor(this.rng() * pool.length);
      const [picked] = pool.splice(index, 1);
      if (picked) winners.push(picked);
    }
    const updated = { ...record.data, ended: true, winnerIds: winners };
    await this.store.putRecord(guildId, "giveaway", giveawayId, updated);
    await this.actions.editMessage(guildId, record.data.channelId, record.data.messageId, {
      embeds: [
        {
          title: "🎉 Giveaway ended",
          description: `**${truncate(record.data.prize, 200)}**\n${
            winners.length
              ? `Winners: ${winners.map((id) => `<@${id}>`).join(", ")}`
              : "No valid entries."
          }`,
          color: 0xfaa61a,
        },
      ],
      components: [
        row([button(`keystone:giveaway:enter:${giveawayId}`, "Ended", "secondary")]),
      ],
    });
    for (const winner of winners) {
      await this.actions.sendDM(winner, {
        content: `You won **${record.data.prize}** in the giveaway!`,
      });
    }
    return { ended: true, winners };
  }

  async reroll(
    guildId: string,
    giveawayId: string,
  ): Promise<{ winners: string[]; reason?: string }> {
    const record = await this.store.getRecord<GiveawayRecord>(guildId, "giveaway", giveawayId);
    if (!record) throw new UserError("That giveaway does not exist.");
    if (!record.data.ended) return { winners: [], reason: "The giveaway has not ended yet." };
    const pool = record.data.entries.filter((id) => !(record.data.winnerIds ?? []).includes(id));
    if (pool.length === 0) return { winners: [], reason: "No eligible entries remain." };
    const winners = pool.slice(0, record.data.winners);
    await this.store.putRecord(guildId, "giveaway", giveawayId, {
      ...record.data,
      winnerIds: winners,
    });
    return { winners };
  }

  /** Called by the bot tick: end every giveaway whose clock has passed. */
  async endDue(guildId: string): Promise<number> {
    const records = await this.store.listRecords<GiveawayRecord>(guildId, "giveaway", 100);
    let ended = 0;
    for (const record of records) {
      if (record.data.ended) continue;
      if (this.now() < new Date(record.data.endsAt).getTime()) continue;
      const result = await this.end(guildId, record.key);
      if (result.ended) ended += 1;
    }
    return ended;
  }
}

export class TempVoiceService {
  constructor(
    private readonly store: CommunityStore,
    private readonly actions: CommunityActions,
    private readonly settings: CommunitySettings,
  ) {}

  async onVoice(input: {
    guildId: string;
    userId: string;
    channelId?: string;
    previousChannelId?: string;
    displayName?: string;
  }): Promise<{ created?: string; deleted?: string }> {
    const config = this.settings.tempVoice;
    if (config.hubChannelId && input.channelId === config.hubChannelId) {
      const name = config.nameTemplate
        .replaceAll("{user}", input.displayName ?? "Member")
        .slice(0, 90);
      const created = await this.actions.createVoiceChannel(input.guildId, name, {
        parentId: config.categoryId,
        userLimit: config.userLimit,
      });
      if (created.ok && created.id) {
        await this.store.putRecord(input.guildId, "temp_voice", created.id, {
          ownerId: input.userId,
          hubId: config.hubChannelId,
        });
        return { created: created.id };
      }
      return {};
    }

    if (!input.previousChannelId) return {};
    const record = await this.store.getRecord<{ ownerId: string }>(
      input.guildId,
      "temp_voice",
      input.previousChannelId,
    );
    if (!record || record.data.ownerId !== input.userId) return {};
    const members = await this.actions.countMembers(input.guildId, input.previousChannelId);
    if (members > 0) return {};
    await this.actions.deleteChannel(
      input.guildId,
      input.previousChannelId,
      "Temporary voice channel empty",
    );
    await this.store.deleteRecord(input.guildId, "temp_voice", input.previousChannelId);
    return { deleted: input.previousChannelId };
  }
}
