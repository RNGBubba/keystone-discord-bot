import { randomUUID } from "node:crypto";
import { UserError } from "@keystone/kernel";
import type {
  ActionRow,
  CommunityActions,
  CommunityStore,
  LevelProfile,
} from "@keystone/kernel";
import {
  COMMUNITY_PANEL_TTL_MS,
  requirePanelSigner,
  type PanelSigner,
} from "./panels";
import type { CommunitySettings } from "./settings";

function button(
  customId: string,
  label: string,
  style: "primary" | "secondary" | "success" | "danger" = "primary",
  disabled = false,
): ActionRow {
  return {
    type: "action-row",
    components: [{ type: "button", customId, label, style, disabled }],
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/* ------------------------------------------------------------------ birthdays */

export interface BirthdayRecord {
  month: number;
  day: number;
  lastAnnouncedYear?: number;
}

export function parseBirthday(value: string): { month: number; day: number } {
  const match = value.trim().match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (!match) throw new UserError("Birthday must look like `MM-DD`.");
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new UserError("Birthday must be a real month and day.");
  }
  const probe = new Date(Date.UTC(2024, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new UserError("Birthday must be a real calendar date.");
  }
  return { month, day };
}

function localDateParts(now: number, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const pick = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

export class BirthdayService {
  constructor(
    private readonly store: CommunityStore,
    private readonly actions: CommunityActions,
    private readonly settings: CommunitySettings,
    private readonly now: () => number = Date.now,
  ) {}

  async set(guildId: string, userId: string, value: string): Promise<BirthdayRecord> {
    const { month, day } = parseBirthday(value);
    const record = { month, day };
    await this.store.putRecord(guildId, "birthday", userId, record);
    return record;
  }

  get(guildId: string, userId: string): Promise<BirthdayRecord | undefined> {
    return this.store.getRecord<BirthdayRecord>(guildId, "birthday", userId).then((r) => r?.data);
  }

  async remove(guildId: string, userId: string): Promise<void> {
    await this.store.deleteRecord(guildId, "birthday", userId);
  }

  async announceDue(guildId: string): Promise<number> {
    const config = this.settings.birthdays;
    if (!config.enabled || !config.channelId) return 0;
    let date: { year: number; month: number; day: number };
    try {
      date = localDateParts(this.now(), config.timezone);
    } catch {
      throw new UserError(`Unknown birthday timezone: ${config.timezone}`);
    }

    const records = await this.store.listRecords<BirthdayRecord>(guildId, "birthday", 100);
    let sent = 0;
    for (const record of records) {
      if (record.data.month !== date.month || record.data.day !== date.day) continue;
      if (record.data.lastAnnouncedYear === date.year) continue;
      const result = await this.actions.sendMessage(guildId, config.channelId, {
        content: `🎂 Happy birthday <@${record.key}>!`,
      });
      if (!result.ok) continue;
      if (config.roleId) {
        await this.actions.addRole(guildId, record.key, config.roleId, "Birthday role");
      }
      await this.store.putRecord(guildId, "birthday", record.key, {
        ...record.data,
        lastAnnouncedYear: date.year,
      });
      sent += 1;
    }
    return sent;
  }
}

/* ----------------------------------------------------------------- suggestions */

export type SuggestionStatus = "open" | "approved" | "rejected";

export interface SuggestionRecord {
  id: string;
  authorId: string;
  content: string;
  status: SuggestionStatus;
  channelId: string;
  messageId: string;
  votes: { up: string[]; down: string[] };
  moderatorId?: string;
  createdAt: string;
}

export class SuggestionService {
  constructor(
    private readonly store: CommunityStore,
    private readonly actions: CommunityActions,
    private readonly settings: CommunitySettings,
    private readonly now: () => number = Date.now,
    /** Required to post or re-render a suggestion's vote buttons. */
    private readonly signer?: PanelSigner,
  ) {}

  async submit(
    guildId: string,
    authorId: string,
    content: string,
    channelId?: string,
  ): Promise<SuggestionRecord> {
    const config = this.settings.suggestions;
    if (!config.enabled) throw new UserError("Suggestions are disabled in this server.");
    const target = channelId ?? config.channelId;
    if (!target) throw new UserError("No suggestions channel is configured.");
    const clean = content.trim();
    if (clean.length < config.minLength || clean.length > config.maxLength) {
      throw new UserError(`Suggestion must be ${config.minLength}–${config.maxLength} characters.`);
    }
    const id = randomUUID();
    const record: SuggestionRecord = {
      id,
      authorId,
      content: clean,
      status: "open",
      channelId: target,
      messageId: "",
      votes: { up: [], down: [] },
      createdAt: new Date(this.now()).toISOString(),
    };
    const result = await this.actions.sendMessage(guildId, target, this.render(record));
    if (!result.ok || !result.id) throw new Error(result.detail ?? "Could not post suggestion");
    record.messageId = result.id;
    await this.store.putRecord(guildId, "suggestion", id, record);
    return record;
  }

  async vote(
    guildId: string,
    suggestionId: string,
    userId: string,
    kind: "up" | "down",
  ): Promise<{ up: number; down: number; changed: boolean }> {
    const record = await this.store.getRecord<SuggestionRecord>(
      guildId,
      "suggestion",
      suggestionId,
    );
    if (!record) throw new UserError("That suggestion does not exist.");
    if (record.data.status !== "open") {
      throw new UserError("That suggestion is already decided.");
    }
    if (record.data.votes[kind].includes(userId)) {
      return {
        up: record.data.votes.up.length,
        down: record.data.votes.down.length,
        changed: false,
      };
    }
    const votes = {
      up: record.data.votes.up.filter((id) => id !== userId),
      down: record.data.votes.down.filter((id) => id !== userId),
    };
    votes[kind].push(userId);
    const updated = { ...record.data, votes };
    await this.store.putRecord(guildId, "suggestion", suggestionId, updated);
    await this.actions.editMessage(guildId, record.data.channelId, record.data.messageId, this.render(updated));
    return { up: votes.up.length, down: votes.down.length, changed: true };
  }

  async decide(
    guildId: string,
    suggestionId: string,
    moderatorId: string,
    status: Exclude<SuggestionStatus, "open">,
  ): Promise<{ record: SuggestionRecord; changed: boolean }> {
    const record = await this.store.getRecord<SuggestionRecord>(
      guildId,
      "suggestion",
      suggestionId,
    );
    if (!record) throw new UserError("That suggestion does not exist.");
    if (record.data.status === status) return { record: record.data, changed: false };
    const updated = { ...record.data, status, moderatorId };
    await this.store.putRecord(guildId, "suggestion", suggestionId, updated);
    await this.actions.editMessage(guildId, record.data.channelId, record.data.messageId, this.render(updated));
    return { record: updated, changed: true };
  }

  private render(record: SuggestionRecord) {
    const closed = record.status !== "open";
    const signer = requirePanelSigner(this.signer);
    const voteId = (kind: "up" | "down"): string =>
      signer.sign(
        { namespace: "suggest", action: kind, payload: record.id, ttlMs: COMMUNITY_PANEL_TTL_MS },
        this.now(),
      );
    return {
      embeds: [
        {
          title: `Suggestion · ${record.status}`,
          description: truncate(record.content, 1_500),
          color: record.status === "approved" ? 0x57f287 : record.status === "rejected" ? 0xed4245 : 0x5865f2,
          footer: {
            text: `👍 ${record.votes.up.length} · 👎 ${record.votes.down.length} · by ${record.authorId}`,
          },
        },
      ],
      components: [
        {
          type: "action-row" as const,
          components: [
            {
              type: "button" as const,
              customId: voteId("up"),
              label: "Upvote",
              style: "success" as const,
              disabled: closed,
            },
            {
              type: "button" as const,
              customId: voteId("down"),
              label: "Downvote",
              style: "danger" as const,
              disabled: closed,
            },
          ],
        },
      ],
    };
  }
}

/* ---------------------------------------------------------------------- sticky */

export interface StickyRecord {
  channelId: string;
  message: string;
  afterMessages: number;
  count: number;
  lastMessageId?: string;
  stickyMessageId?: string;
}

export class StickyService {
  constructor(
    private readonly store: CommunityStore,
    private readonly actions: CommunityActions,
  ) {}

  async configure(
    guildId: string,
    channelId: string,
    message: string,
    afterMessages: number,
  ): Promise<StickyRecord> {
    if (!message.trim()) throw new UserError("A sticky message cannot be empty.");
    if (!Number.isInteger(afterMessages) || afterMessages < 1 || afterMessages > 50) {
      throw new UserError("Sticky refresh must be between 1 and 50 messages.");
    }
    const existing = await this.store.getRecord<StickyRecord>(guildId, "sticky", channelId);
    const record: StickyRecord = {
      channelId,
      message: message.slice(0, 1_500),
      afterMessages,
      count: 0,
      stickyMessageId: existing?.data.stickyMessageId,
    };
    await this.store.putRecord(guildId, "sticky", channelId, record);
    return record;
  }

  get(guildId: string, channelId: string): Promise<StickyRecord | undefined> {
    return this.store
      .getRecord<StickyRecord>(guildId, "sticky", channelId)
      .then((record) => record?.data);
  }

  async onMessage(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<{ posted: boolean; count: number }> {
    const record = await this.store.getRecord<StickyRecord>(guildId, "sticky", channelId);
    if (!record) return { posted: false, count: 0 };
    if (record.data.lastMessageId === messageId) {
      return { posted: false, count: record.data.count };
    }
    const count = record.data.count + 1;
    if (count < record.data.afterMessages) {
      await this.store.putRecord(guildId, "sticky", channelId, {
        ...record.data,
        count,
        lastMessageId: messageId,
      });
      return { posted: false, count };
    }

    const sent = await this.actions.sendMessage(guildId, channelId, {
      content: record.data.message,
    });
    if (!sent.ok) return { posted: false, count: record.data.count };
    if (record.data.stickyMessageId) {
      await this.actions.deleteMessage(guildId, channelId, record.data.stickyMessageId);
    }
    await this.store.putRecord(guildId, "sticky", channelId, {
      ...record.data,
      count: 0,
      lastMessageId: messageId,
      stickyMessageId: sent.id,
    });
    return { posted: true, count: 0 };
  }
}

/* --------------------------------------------------------------------- seasons */

export interface SeasonState {
  key: string;
  days: number;
  nextResetAt: string;
}

export class SeasonService {
  constructor(
    private readonly store: CommunityStore,
    private readonly now: () => number = Date.now,
  ) {}

  async start(
    guildId: string,
    key: string,
    days = 30,
  ): Promise<{ archived: number; alreadyReset: boolean; state: SeasonState }> {
    const clean = key.trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(clean)) {
      throw new UserError("Season key must be 2–32 letters, digits, `_` or `-`.");
    }
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new UserError("Season length must be 1–365 days.");
    }
    const result = await this.store.resetLevels(guildId, clean);
    const state: SeasonState = {
      key: clean,
      days,
      nextResetAt: new Date(this.now() + days * 86_400_000).toISOString(),
    };
    await this.store.putRecord(guildId, "season_state", "current", state);
    return { ...result, state };
  }

  async rollover(guildId: string): Promise<{ rotated: boolean; key?: string; archived?: number }> {
    const state = await this.store.getRecord<SeasonState>(guildId, "season_state", "current");
    if (!state) return { rotated: false };
    if (this.now() < new Date(state.data.nextResetAt).getTime()) return { rotated: false };
    const date = new Date(this.now()).toISOString().slice(0, 10);
    const key = `${state.data.key}-${date}`;
    const result = await this.store.resetLevels(guildId, key);
    await this.store.putRecord(guildId, "season_state", "current", {
      key,
      days: state.data.days,
      nextResetAt: new Date(this.now() + state.data.days * 86_400_000).toISOString(),
    });
    return { rotated: true, key, archived: result.archived };
  }

  async status(guildId: string): Promise<SeasonState | undefined> {
    return this.store
      .getRecord<SeasonState>(guildId, "season_state", "current")
      .then((record) => record?.data);
  }
}

export function archivedProfile(
  record: { data: unknown },
): LevelProfile | undefined {
  return record.data as LevelProfile | undefined;
}
