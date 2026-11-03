import type {
  MemberStore,
  ModerationActions,
  ModerationActionResult,
  ModerationCase,
  ModerationCaseState,
  ModuleSettings,
  Logger,
} from "@keystone/kernel";
import { CaseService, appealButton, verifyButton, type ModerationSigner } from "./cases";
import { moderationSettingsSchema, type ModerationSettings } from "./settings";

/**
 * Events the gateway adapter feeds into the security engine.
 *
 * They are structural: no discord.js types, no live guild. The scripted-raid
 * test uses the same shapes the bot adapter produces.
 */
export type SecurityEvent =
  | {
      type: "member.join";
      guildId: string;
      userId: string;
      accountAgeDays: number;
      hasAvatar: boolean;
      at?: number;
    }
  | {
      type: "message.create";
      guildId: string;
      channelId: string;
      messageId: string;
      userId: string;
      content: string;
      isBot?: boolean;
      at?: number;
    }
  | {
      type: "webhook.create";
      guildId: string;
      channelId?: string;
      webhookId: string;
      userId?: string;
      at?: number;
    }
  | {
      type: "audit.action";
      guildId: string;
      userId: string;
      action: "channel.delete" | "role.delete" | "ban.add" | "webhook.create";
      targetId?: string;
      at?: number;
    };

export type SecurityFindingKind =
  | "alert"
  | "quarantine"
  | "timeout"
  | "delete-message"
  | "delete-webhook"
  | "lock"
  | "ban";

export interface SecurityFinding {
  readonly kind: SecurityFindingKind;
  readonly rule: string;
  readonly reason: string;
  readonly targetId?: string;
  readonly channelId?: string;
  readonly messageId?: string;
  readonly webhookId?: string;
  readonly durationSeconds?: number;
  readonly evidence: Record<string, unknown>;
}

interface JoinRecord {
  userId: string;
  at: number;
  accountAgeDays: number;
  hasAvatar: boolean;
}

interface GuildState {
  joins: JoinRecord[];
  invites: Map<string, number[]>;
  messages: Map<string, number[]>;
  audit: { action: string; at: number }[];
  raidUntil: number;
  timedOut: Set<string>;
  quarantined: Set<string>;
}

const INVITE = /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i;
const MENTION = /<@!?\d+>/g;
const LINK = /https?:\/\/[^\s<>]+/gi;
const LINK_TRAILING = /[)\].,;!?'"]+$/;
const COMBINING = /\p{M}/gu;

interface SuspiciousLink {
  readonly host: string;
  readonly reason: string;
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function hostOf(raw: string): string | undefined {
  try {
    const url = new URL(raw.replace(LINK_TRAILING, ""));
    return url.hostname ? normalizeHost(url.hostname) : undefined;
  } catch {
    return undefined;
  }
}

function onBlocklist(host: string, blocklist: readonly string[]): boolean {
  return blocklist.some((entry) => {
    const domain = normalizeHost(entry.replace(/^https?:\/\//i, "").split("/")[0] ?? "");
    return domain.length > 0 && (host === domain || host.endsWith(`.${domain}`));
  });
}

/**
 * The local reputation check. A blocklist entry covers its subdomains; a
 * punycode label is flagged even without an entry because it can hide a
 * lookalike domain. Ordinary links are left to Discord and native AutoMod.
 */
function suspiciousLink(
  content: string,
  blocklist: readonly string[],
): SuspiciousLink | undefined {
  for (const raw of content.match(LINK) ?? []) {
    const host = hostOf(raw);
    if (!host) continue;
    if (onBlocklist(host, blocklist)) {
      return { host, reason: `The link host ${host} is on this server's blocklist.` };
    }
    if (host.split(".").some((label) => label.startsWith("xn--"))) {
      return {
        host,
        reason: `The link host ${host} uses punycode, which can hide a lookalike domain.`,
      };
    }
  }
  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match an operator-owned word or phrase on word edges, not as a substring.
 * `ass` must not match `class`, and a phrase keeps its internal whitespace
 * flexible. The expression is compiled per evaluation because the settings
 * object is parsed per event; the list is capped at 200 entries by the schema.
 */
function bannedWordMatch(content: string, words: readonly string[]): string | undefined {
  const parts = words
    .map((word) => escapeRegex(word.trim()).replace(/\s+/g, "\\s+"))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (parts.length === 0) return undefined;

  try {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])(?:${parts.join("|")})(?![\\p{L}\\p{N}_])`,
      "iu",
    );
    return pattern.exec(content)?.[0];
  } catch {
    return undefined;
  }
}

function combiningMarks(content: string): number {
  return content.match(COMBINING)?.length ?? 0;
}

function freshState(): GuildState {
  return {
    joins: [],
    invites: new Map(),
    messages: new Map(),
    audit: [],
    raidUntil: 0,
    timedOut: new Set(),
    quarantined: new Set(),
  };
}

function prune(times: number[], since: number): number[] {
  return times.filter((at) => at >= since);
}

/**
 * Pure-ish policy engine: it holds only short-lived per-guild heat, and every
 * decision is a value. No Discord call and no database write happens here, so
 * the scripted raid can be replayed exactly.
 *
 * Heat decays by window rather than latching a binary "raid mode" forever. A
 * raid does set a short cooldown window so later joins during the incident are
 * still contained, but it expires on its own.
 */
export class SecurityEngine {
  readonly #guilds = new Map<string, GuildState>();

  evaluate(
    event: SecurityEvent,
    settings: ModerationSettings,
    now = Date.now(),
  ): SecurityFinding[] {
    if (!settings.enabled) return [];
    const state = this.#state(event.guildId);

    switch (event.type) {
      case "member.join":
        return this.#join(event, settings, state, now);
      case "message.create":
        return this.#message(event, settings, state, now);
      case "webhook.create":
        return this.#webhook(event, settings, state, now);
      case "audit.action":
        return this.#audit(event, settings, state, now);
    }
  }

  #state(guildId: string): GuildState {
    const existing = this.#guilds.get(guildId);
    if (existing) return existing;
    const created = freshState();
    this.#guilds.set(guildId, created);
    return created;
  }

  #join(
    event: Extract<SecurityEvent, { type: "member.join" }>,
    settings: ModerationSettings,
    state: GuildState,
    now: number,
  ): SecurityFinding[] {
    const at = event.at ?? now;
    const findings: SecurityFinding[] = [];
    state.joins = state.joins.filter((join) => join.at >= at - settings.antiRaid.windowMs);
    state.joins.push({
      userId: event.userId,
      at,
      accountAgeDays: event.accountAgeDays,
      hasAvatar: event.hasAvatar,
    });

    if (settings.joinGate.enabled && event.accountAgeDays < settings.joinGate.minAccountAgeDays) {
      findings.push(this.#quarantine(
        event.userId,
        "join-gate.account-age",
        `Account is ${event.accountAgeDays} day(s) old; the join gate requires ${settings.joinGate.minAccountAgeDays}.`,
        { accountAgeDays: event.accountAgeDays, hasAvatar: event.hasAvatar },
      ));
    }

    const raidWasActive = state.raidUntil > at;
    if (!raidWasActive && state.joins.length >= settings.antiRaid.joinsPerWindow) {
      state.raidUntil = at + settings.antiRaid.raidMinutes * 60_000;
      findings.push({
        kind: "alert",
        rule: "anti-raid.join-burst",
        reason: `${state.joins.length} joins arrived within ${Math.round(settings.antiRaid.windowMs / 1000)} seconds; raid mode is active.`,
        targetId: event.userId,
        evidence: {
          joins: state.joins.length,
          windowMs: settings.antiRaid.windowMs,
          raidUntil: state.raidUntil,
        },
      });
    }

    if (state.raidUntil > at && settings.antiRaid.quarantine) {
      for (const join of state.joins) {
        findings.push(
          this.#quarantine(
            join.userId,
            "anti-raid.join-burst",
            "Join burst matched the anti-raid threshold; held for review.",
            {
              accountAgeDays: join.accountAgeDays,
              hasAvatar: join.hasAvatar,
              joinedAt: join.at,
              windowMs: settings.antiRaid.windowMs,
            },
          ),
        );
      }
    }

    return findings;
  }

  #quarantine(
    userId: string,
    rule: string,
    reason: string,
    evidence: Record<string, unknown>,
  ): SecurityFinding {
    return { kind: "quarantine", rule, reason, targetId: userId, evidence };
  }

  #message(
    event: Extract<SecurityEvent, { type: "message.create" }>,
    settings: ModerationSettings,
    state: GuildState,
    now: number,
  ): SecurityFinding[] {
    if (event.isBot) return [];
    const at = event.at ?? now;
    const findings: SecurityFinding[] = [];
    const invitesMode = settings.automod.invites;
    const invite = INVITE.test(event.content);

    if (invite && invitesMode !== "off") {
      if (invitesMode === "alert") {
        findings.push({
          kind: "alert",
          rule: "automod.invite",
          reason: "An invite link was posted.",
          targetId: event.userId,
          channelId: event.channelId,
          messageId: event.messageId,
          evidence: { content: event.content.slice(0, 500) },
        });
      } else {
        findings.push({
          kind: "delete-message",
          rule: "automod.invite",
          reason: "Invite links are not allowed in this server.",
          targetId: event.userId,
          channelId: event.channelId,
          messageId: event.messageId,
          evidence: { content: event.content.slice(0, 500) },
        });

        const times = prune(
          [...(state.invites.get(event.userId) ?? []), at],
          at - settings.antiRaid.windowMs,
        );
        state.invites.set(event.userId, times);
        if (invitesMode === "timeout" && times.length >= 3 && !state.timedOut.has(event.userId)) {
          state.timedOut.add(event.userId);
          findings.push({
            kind: "timeout",
            rule: "automod.invite-burst",
            reason: "Repeated invite posts after a warning.",
            targetId: event.userId,
            durationSeconds: 600,
            evidence: { invitePosts: times.length },
          });
        }
      }
    }

    const linkMode = settings.automod.links;
    if (linkMode !== "off") {
      const link = suspiciousLink(event.content, settings.automod.linkBlocklist);
      if (link) {
        findings.push({
          kind: linkMode === "alert" ? "alert" : "delete-message",
          rule: "automod.link",
          reason: link.reason,
          targetId: event.userId,
          channelId: event.channelId,
          messageId: event.messageId,
          evidence: {
            host: link.host,
            match: onBlocklist(link.host, settings.automod.linkBlocklist)
              ? "blocklist"
              : "punycode",
          },
        });
      }
    }

    const profanityMode = settings.automod.profanity;
    if (profanityMode !== "off") {
      const blocked = bannedWordMatch(event.content, settings.automod.bannedWords);
      if (blocked) {
        findings.push({
          kind: profanityMode === "alert" ? "alert" : "delete-message",
          rule: "automod.profanity",
          reason: "The message contains a blocked word or phrase.",
          targetId: event.userId,
          channelId: event.channelId,
          messageId: event.messageId,
          evidence: { match: blocked.slice(0, 64) },
        });
      }
    }

    const zalgoMode = settings.automod.zalgo;
    if (zalgoMode !== "off") {
      const marks = combiningMarks(event.content);
      if (marks >= settings.automod.zalgoThreshold) {
        findings.push({
          kind: zalgoMode === "alert" ? "alert" : "delete-message",
          rule: "automod.zalgo",
          reason: `The message contains ${marks} combining marks; the limit is ${settings.automod.zalgoThreshold}.`,
          targetId: event.userId,
          channelId: event.channelId,
          messageId: event.messageId,
          evidence: { combiningMarks: marks, threshold: settings.automod.zalgoThreshold },
        });
      }
    }

    const mentions = (event.content.match(MENTION) ?? []).length;
    if (mentions > settings.automod.maxMentions) {
      findings.push({
        kind: "delete-message",
        rule: "automod.mention-spam",
        reason: `Message mentioned ${mentions} members; the limit is ${settings.automod.maxMentions}.`,
        targetId: event.userId,
        channelId: event.channelId,
        messageId: event.messageId,
        evidence: { mentions },
      });
    }

    if (!invite) {
      const key = event.content.trim().toLowerCase().slice(0, 200);
      const times = prune(
        [...(state.messages.get(key) ?? []), at],
        at - settings.automod.duplicateWindowMs,
      );
      state.messages.set(key, times);
      if (times.length >= settings.automod.duplicateThreshold) {
        findings.push({
          kind: "delete-message",
          rule: "automod.duplicate",
          reason: "The same message was posted repeatedly.",
          targetId: event.userId,
          channelId: event.channelId,
          messageId: event.messageId,
          evidence: { duplicates: times.length, hash: key.slice(0, 80) },
        });
      }
    }

    return findings;
  }

  #webhook(
    event: Extract<SecurityEvent, { type: "webhook.create" }>,
    settings: ModerationSettings,
    state: GuildState,
    now: number,
  ): SecurityFinding[] {
    const at = event.at ?? now;
    const findings: SecurityFinding[] = [
      {
        kind: "delete-webhook",
        rule: "anti-nuke.webhook",
        reason: "A webhook was created; the anti-nuke webhook threshold is one.",
        targetId: event.userId,
        channelId: event.channelId,
        webhookId: event.webhookId,
        evidence: { webhookId: event.webhookId, threshold: settings.antiNuke.webhookThreshold },
      },
      {
        kind: "alert",
        rule: "anti-nuke.webhook",
        reason: "Webhook creation reviewed by anti-nuke.",
        targetId: event.userId,
        evidence: { webhookId: event.webhookId },
      },
    ];

    if (settings.antiNuke.quarantineActor && event.userId) {
      findings.push(
        this.#quarantine(
          event.userId,
          "anti-nuke.webhook-actor",
          "The webhook creator is held for review.",
          { webhookId: event.webhookId, at },
        ),
      );
    }
    return findings;
  }

  #audit(
    event: Extract<SecurityEvent, { type: "audit.action" }>,
    settings: ModerationSettings,
    state: GuildState,
    now: number,
  ): SecurityFinding[] {
    const at = event.at ?? now;
    state.audit = state.audit.filter((entry) => entry.at >= at - settings.antiNuke.windowMs);
    state.audit.push({ action: event.action, at });
    const count = state.audit.filter((entry) => entry.action === event.action).length;

    if (count < settings.antiNuke.actionsPerWindow) return [];

    const findings: SecurityFinding[] = [
      {
        kind: "alert",
        rule: "anti-nuke.mass-action",
        reason: `${count} ${event.action} actions inside the anti-nuke window.`,
        targetId: event.userId,
        evidence: { action: event.action, count, windowMs: settings.antiNuke.windowMs },
      },
    ];
    if (settings.antiNuke.quarantineActor && !state.quarantined.has(event.userId)) {
      findings.push(
        this.#quarantine(
          event.userId,
          "anti-nuke.mass-action",
          "Actor held after repeated destructive audit-log actions.",
          { action: event.action, count, targetId: event.targetId },
        ),
      );
    }
    return findings;
  }
}

export interface SecurityResult {
  readonly findings: SecurityFinding[];
  readonly cases: ModerationCase[];
  readonly dryRun: boolean;
  readonly actionResults: { finding: SecurityFinding; result?: ModerationActionResult }[];
}

export interface SecurityCoordinatorOptions {
  engine: SecurityEngine;
  cases: CaseService;
  actions: ModerationActions;
  members: MemberStore;
  settings: ModuleSettings;
  logger: Logger;
  /** Mints the signed appeal/verify ids; the same secret the router verifies. */
  signer: ModerationSigner;
  now?: () => number;
}

/**
 * Persist the case first, then execute. If Discord fails, the case survives in
 * the review queue with a `failed` event: the audit trail is never lost because
 * an external call failed.
 */
export class SecurityCoordinator {
  constructor(private readonly options: SecurityCoordinatorOptions) {}

  async handle(event: SecurityEvent): Promise<SecurityResult> {
    const settings = moderationSettingsSchema.parse(
      await this.options.settings.get(event.guildId),
    );
    const findings = this.options.engine.evaluate(
      event,
      settings,
      event.at ?? (this.options.now?.() ?? Date.now()),
    );
    if (findings.length === 0) {
      return { findings, cases: [], dryRun: settings.dryRun, actionResults: [] };
    }

    const cases: ModerationCase[] = [];
    const actionResults: { finding: SecurityFinding; result?: ModerationActionResult }[] = [];

    for (const finding of findings) {
      const record = await this.options.cases.open({
        guildId: event.guildId,
        actorId: "keystone",
        targetId: finding.targetId ?? event.guildId,
        action: `security.${finding.kind}`,
        reason: finding.reason,
        rule: finding.rule,
        state: settings.dryRun ? "alerted" : "pending",
        evidence: { ...finding.evidence, dryRun: settings.dryRun, event: event.type },
      });
      cases.push(record);

      if (settings.dryRun) {
        await this.#notify(event.guildId, record, finding, settings, true);
        actionResults.push({ finding });
        continue;
      }

      const result = await this.#apply(event.guildId, finding, settings);
      actionResults.push({ finding, result });
      await this.options.cases.note(
        record.id,
        "keystone",
        result.ok ? "action completed" : `action failed: ${result.detail ?? "unknown error"}`,
      );
      await this.options.cases.setState(record.id, "open");
      await this.#notify(event.guildId, record, finding, settings, false);
    }

    return { findings, cases, dryRun: settings.dryRun, actionResults };
  }

  async #apply(
    guildId: string,
    finding: SecurityFinding,
    settings: ModerationSettings,
  ): Promise<ModerationActionResult> {
    const target = finding.targetId ?? "";
    switch (finding.kind) {
      case "alert":
        return { ok: true, detail: "alert recorded" };
      case "quarantine": {
        const result = await this.options.actions.quarantine(
          guildId,
          target,
          finding.reason,
          settings.quarantineRoleId,
        );
        if (result.ok && finding.rule.startsWith("join-gate.")) {
          try {
            await this.options.members.markQuarantined(guildId, target);
          } catch (error) {
            this.options.logger.error("member quarantine state failed", {
              guildId,
              userId: target,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return result;
      }
      case "timeout":
        return this.options.actions.timeout(
          guildId,
          target,
          finding.durationSeconds ?? 600,
          finding.reason,
        );
      case "delete-message":
        if (!finding.channelId || !finding.messageId) {
          return { ok: false, detail: "message location missing" };
        }
        return this.options.actions.deleteMessage(
          guildId,
          finding.channelId,
          finding.messageId,
          finding.reason,
        );
      case "delete-webhook":
        if (!finding.webhookId) return { ok: false, detail: "webhook id missing" };
        return this.options.actions.deleteWebhook(guildId, finding.webhookId, finding.reason);
      case "lock":
        if (!finding.channelId) return { ok: false, detail: "channel id missing" };
        return this.options.actions.lock(guildId, finding.channelId, true, finding.reason);
      case "ban":
        return this.options.actions.ban(guildId, target, finding.reason);
    }
  }

  async #notify(
    guildId: string,
    record: ModerationCase,
    finding: SecurityFinding,
    settings: ModerationSettings,
    dryRun: boolean,
  ): Promise<void> {
    const now = this.options.now?.() ?? Date.now();
    const components: import("@keystone/kernel").ActionRow[] = [];
    if (settings.appealsEnabled && record.targetId) {
      components.push(appealButton(record.id, this.options.signer, now));
    }
    if (
      finding.kind === "quarantine" &&
      finding.rule.startsWith("join-gate.") &&
      record.targetId
    ) {
      components.push(verifyButton(record.guildId, record.targetId, this.options.signer, now));
    }

    try {
      await this.options.actions.notify(guildId, settings.modLogChannelId, {
        embeds: [
          {
            title: `${dryRun ? "Dry run" : "Security"} · ${finding.rule}`,
            description: finding.reason,
            color: dryRun ? 0xfee75c : 0xed4245,
            fields: [
              { name: "Case", value: `#${record.caseNumber}`, inline: true },
              { name: "Target", value: record.targetId, inline: true },
              { name: "Action", value: finding.kind, inline: true },
              { name: "Review", value: dryRun ? "No punitive action was taken." : "Case is open for review." },
            ],
            footer: { text: "Use /mod case or /appeal. Every action has a case." },
          },
        ],
        components,
      });
    } catch (error) {
      this.options.logger.error("security notification failed", {
        caseId: record.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
