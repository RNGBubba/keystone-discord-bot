import {
  UserError,
  defineCommand,
  requireGuild,
  requirePermissions,
  type ActionRow,
  type CommandContext,
  type CommandOption,
  type ModerationActions,
  type ModerationActionResult,
  type ModerationCase,
  type ModerationPort,
} from "@keystone/kernel";
import { caseEmbed, caseListEmbed } from "../format";
import { appealButton } from "../cases";
import { TemporaryActionService } from "../temporary";
import { moderationSettingsSchema, type ModerationSettings } from "../settings";

const ACTIONS = [
  "ban",
  "temp-role",
  "kick",
  "timeout",
  "warn",
  "purge",
  "lock",
  "unlock",
  "slowmode",
  "case",
  "note",
  "history",
  "links",
  "filters",
  "review",
] as const;

const LINK_RULES = new Set(["automod.link"]);
const FILTER_RULES = new Set(["automod.link", "automod.profanity", "automod.zalgo"]);

const OPTIONS = {
  user: { type: "user", name: "user", description: "Member to act on (or filter history)" },
  reason: { type: "string", name: "reason", description: "Why; required for punitive actions" },
  case: { type: "integer", name: "case", description: "Case number for case, note or review" },
  duration: {
    type: "integer",
    name: "duration",
    description: "Minutes for ban/temp-role/timeout, or seconds for slowmode",
    minValue: 1,
  },
  limit: { type: "integer", name: "limit", description: "Purge count, 1-100 (default 10)" },
  channel: { type: "channel", name: "channel", description: "Channel for purge, lock or slowmode" },
  role: { type: "role", name: "role", description: "Role for a temporary role grant" },
  dry_run: { type: "boolean", name: "dry_run", description: "Preview only; never overrides a safe default" },
} satisfies Record<string, CommandOption>;

function opts(...names: (keyof typeof OPTIONS)[]): CommandOption[] {
  return names.map((name) => OPTIONS[name]);
}

type ModAction = (typeof ACTIONS)[number];

function optionText(ctx: CommandContext, name: string): string | undefined {
  const value = ctx.interaction.options[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionInteger(ctx: CommandContext, name: string): number | undefined {
  const value = ctx.interaction.options[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireModeration(ctx: CommandContext): ModerationPort {
  if (!ctx.moderation) {
    throw new UserError("Moderation is not configured. Run /setup to check the database.");
  }
  return ctx.moderation;
}

function requireTarget(ctx: CommandContext): string {
  const target = optionText(ctx, "user");
  if (!target) throw new UserError("Choose a member with the `user` option.");
  return target;
}

function requireReason(ctx: CommandContext): string {
  const reason = optionText(ctx, "reason");
  if (!reason) throw new UserError("A reason is required. It is shown on the case and to the member.");
  return reason;
}

function requireChannel(ctx: CommandContext): string {
  const channel = optionText(ctx, "channel") ?? ctx.interaction.channelId;
  if (!channel) throw new UserError("Choose a channel with the `channel` option.");
  return channel;
}

function isAction(value: string | undefined): value is ModAction {
  return value !== undefined && (ACTIONS as readonly string[]).includes(value);
}

function appealComponents(settings: ModerationSettings, record: ModerationCase): ActionRow[] {
  return settings.appealsEnabled ? [appealButton(record.id)] : [];
}

async function notify(
  ctx: CommandContext,
  actions: ModerationActions,
  settings: ModerationSettings,
  record: ModerationCase,
): Promise<void> {
  await actions.notify(ctx.guildId!, settings.modLogChannelId, {
    embeds: [caseEmbed(record)],
    components: appealComponents(settings, record),
  });
}

async function runAction(
  ctx: CommandContext,
  ports: ModerationPort,
  settings: ModerationSettings,
  input: {
    action: string;
    targetId: string;
    reason: string;
    rule?: string;
    evidence?: unknown;
    /** Set only after the action succeeds; the case is the durable record. */
    expiresAt?: string;
    run: () => Promise<ModerationActionResult>;
  },
): Promise<{ record: ModerationCase; result: ModerationActionResult }> {
  let record = await ports.cases.open({
    guildId: ctx.guildId!,
    actorId: ctx.userId,
    targetId: input.targetId,
    action: input.action,
    reason: input.reason,
    rule: input.rule ?? "manual",
    state: "pending",
    evidence: input.evidence,
  });

  const result = await input.run();
  if (result.ok && input.expiresAt) {
    record = (await ports.cases.setExpiry(record.id, input.expiresAt)) ?? record;
  }
  await ports.cases.note(
    record.id,
    ctx.userId,
    result.ok ? "action completed" : `action failed: ${result.detail ?? "unknown error"}`,
  );
  await ports.cases.setState(record.id, "open");
  record = { ...record, state: "open" };
  await notify(ctx, ports.actions, settings, record);

  return { record, result };
}

/**
 * Queue the release after the case exists. If enqueueing fails, the case still
 * carries `expiresAt` and the next startup recovery sweep will schedule it.
 */
async function scheduleExpiry(
  ctx: CommandContext,
  ports: ModerationPort,
  settings: ModerationSettings,
  record: ModerationCase,
): Promise<void> {
  if (!record.expiresAt) return;
  const service = new TemporaryActionService(ports.cases, ports.actions, settings, ctx.now);
  await service.schedule(ctx.timers ?? ctx.queue, record);
}

export const mod = defineCommand({
  name: "mod",
  description: "Moderate members, inspect cases and review the queue.",
  guards: [requireGuild, requirePermissions("ModerateMembers")],
  subcommands: [
    { name: "ban", description: "Ban a member; add duration for a temporary ban.", options: opts("user", "reason", "duration", "dry_run") },
    { name: "temp-role", description: "Grant a role for a number of minutes, then remove it.", options: opts("user", "role", "reason", "duration", "dry_run") },
    { name: "kick", description: "Kick a member with a case and reason.", options: opts("user", "reason", "dry_run") },
    { name: "timeout", description: "Time out a member for a number of minutes.", options: opts("user", "reason", "duration", "dry_run") },
    { name: "warn", description: "Record a warning on a member's case history.", options: opts("user", "reason") },
    { name: "purge", description: "Bulk-delete recent messages in a channel.", options: opts("channel", "limit", "reason", "dry_run") },
    { name: "lock", description: "Lock a channel so members cannot post.", options: opts("channel", "reason", "dry_run") },
    { name: "unlock", description: "Unlock a channel again.", options: opts("channel", "reason", "dry_run") },
    { name: "slowmode", description: "Set channel slowmode in seconds.", options: opts("channel", "duration", "reason", "dry_run") },
    { name: "case", description: "Show one case by number.", options: opts("case") },
    { name: "note", description: "Append a moderator note to a case.", options: opts("case", "reason") },
    { name: "history", description: "List recent cases, optionally for one member.", options: opts("user") },
    { name: "links", description: "Review recent link-filter findings." },
    { name: "filters", description: "Review link, profanity and zalgo findings." },
    { name: "review", description: "Show the review queue or close one case.", options: opts("case") },
  ],
  async execute(ctx) {
    const ports = requireModeration(ctx);
    const guildId = ctx.guildId!;
    const settings = moderationSettingsSchema.parse(await ctx.settings.get(guildId)) as ModerationSettings;
    const action = ctx.commandPath[0] ?? optionText(ctx, "action");
    if (!isAction(action)) throw new UserError("Choose a valid action.");
    const dryRun = ctx.interaction.options.dry_run === false ? false : settings.dryRun;

    // A temporary role can grant any role the bot can manage. ModerateMembers
    // alone must not let a moderator escalate through a role above their own
    // rank, so this subcommand also requires ManageRoles from the caller.
    if (action === "temp-role" && !ctx.interaction.permissions.includes("ManageRoles")) {
      throw new UserError("Temporary roles require the ManageRoles permission.");
    }

    // Read-only paths first: they cannot create a case by accident.
    if (action === "case") {
      const number = optionInteger(ctx, "case");
      if (!number) throw new UserError("Provide a case number.");
      const record = await ports.cases.get(guildId, number);
      if (!record) throw new UserError(`Case #${number} does not exist.`);
      await ctx.interaction.reply({
        ephemeral: true,
        embeds: [caseEmbed(record)],
        components: appealComponents(settings, record),
      });
      return;
    }

    if (action === "history") {
      const target = optionText(ctx, "user");
      const records = await ports.cases.list(guildId, { targetId: target, limit: 10 });
      await ctx.interaction.reply({
        ephemeral: true,
        embeds: [caseListEmbed(records, target ? `Cases for ${target}` : "Recent cases")],
      });
      return;
    }

    if (action === "links" || action === "filters") {
      const rules = action === "links" ? LINK_RULES : FILTER_RULES;
      const records = await ports.cases.list(guildId, { limit: 25 });
      const findings = records.filter(
        (record) => record.rule !== undefined && rules.has(record.rule),
      );
      if (findings.length === 0) {
        await ctx.interaction.reply({
          content: `No ${action === "links" ? "link-filter" : "content-filter"} findings in the last 25 cases.`,
          ephemeral: true,
        });
        return;
      }
      const lines = findings
        .slice(0, 10)
        .map(
          (record) =>
            `#${record.caseNumber} · ${record.state} · ${record.rule} · <@${record.targetId}> · ${record.reason}`,
        );
      await ctx.interaction.reply({
        content: `${action === "links" ? "Link-filter" : "Content-filter"} findings (newest first):\n${lines.join("\n")}`.slice(0, 2_000),
        ephemeral: true,
      });
      return;
    }

    if (action === "review") {
      const number = optionInteger(ctx, "case");
      if (number) {
        const record = await ports.cases.get(guildId, number);
        if (!record) throw new UserError(`Case #${number} does not exist.`);
        const reviewed = await ports.cases.review(record.id, ctx.userId);
        await ctx.interaction.reply({ ephemeral: true, embeds: [caseEmbed(reviewed)] });
        return;
      }
      const [open, alerted] = await Promise.all([
        ports.cases.list(guildId, { state: "open", limit: 10 }),
        ports.cases.list(guildId, { state: "alerted", limit: 10 }),
      ]);
      const records = [...open, ...alerted]
        .sort((a, b) => b.caseNumber - a.caseNumber)
        .slice(0, 10);
      await ctx.interaction.reply({
        ephemeral: true,
        embeds: [caseListEmbed(records, "Review queue — open cases")],
      });
      return;
    }

    if (action === "note") {
      const number = optionInteger(ctx, "case");
      if (!number) throw new UserError("Provide a case number for the note.");
      const reason = requireReason(ctx);
      const record = await ports.cases.get(guildId, number);
      if (!record) throw new UserError(`Case #${number} does not exist.`);
      await ports.cases.note(record.id, ctx.userId, reason);
      await ctx.interaction.reply({
        content: `Note appended to case #${number}.`,
        ephemeral: true,
      });
      return;
    }

    if (dryRun) {
      const preview = describeAction(ctx, action);
      await ctx.interaction.reply({
        content: `Dry run — ${preview}. No case or action was created. Set \`dryRun: false\` in moderation settings (or pass \`dry_run: false\`) to enforce.`,
        ephemeral: true,
      });
      return;
    }

    if (action === "warn") {
      const target = requireTarget(ctx);
      const reason = requireReason(ctx);
      const record = await ports.cases.open({
        guildId,
        actorId: ctx.userId,
        targetId: target,
        action: "warn",
        reason,
        rule: "manual",
        state: "open",
      });
      await notify(ctx, ports.actions, settings, record);
      await ctx.interaction.reply({ ephemeral: true, embeds: [caseEmbed(record)] });
      return;
    }

    if (action === "purge") {
      const channelId = requireChannel(ctx);
      const limit = Math.min(Math.max(optionInteger(ctx, "limit") ?? 10, 1), 100);
      const reason = optionText(ctx, "reason") ?? "Bulk purge requested";
      const { record, result } = await runAction(ctx, ports, settings, {
        action: "purge",
        targetId: channelId,
        reason,
        run: () => ports.actions.purge(guildId, channelId, limit, reason),
      });
      await replyResult(ctx, record, result);
      return;
    }

    if (action === "lock" || action === "unlock") {
      const channelId = requireChannel(ctx);
      const reason = optionText(ctx, "reason") ?? `Channel ${action}ed by /mod`;
      const { record, result } = await runAction(ctx, ports, settings, {
        action,
        targetId: channelId,
        reason,
        run: () => ports.actions.lock(guildId, channelId, action === "lock", reason),
      });
      await replyResult(ctx, record, result);
      return;
    }

    if (action === "slowmode") {
      const channelId = requireChannel(ctx);
      const seconds = Math.min(Math.max(optionInteger(ctx, "duration") ?? 10, 0), 21_600);
      const reason = optionText(ctx, "reason") ?? "Slowmode changed by /mod";
      const { record, result } = await runAction(ctx, ports, settings, {
        action: "slowmode",
        targetId: channelId,
        reason,
        run: () => ports.actions.slowmode(guildId, channelId, seconds, reason),
      });
      await replyResult(ctx, record, result);
      return;
    }

    if (action === "temp-role") {
      const target = requireTarget(ctx);
      const reason = requireReason(ctx);
      const roleId = optionText(ctx, "role");
      const minutes = optionInteger(ctx, "duration");
      if (!roleId) throw new UserError("Choose the role to grant with the `role` option.");
      if (!minutes) throw new UserError("A temporary role needs a `duration` in minutes.");
      const expiresAt = new Date(ctx.now() + Math.min(minutes, 525_600) * 60_000).toISOString();
      const { record, result } = await runAction(ctx, ports, settings, {
        action: "temp-role",
        targetId: target,
        reason,
        evidence: { roleId },
        expiresAt,
        run: () => ports.actions.addRole(guildId, target, roleId, reason),
      });
      if (result.ok) await scheduleExpiry(ctx, ports, settings, record);
      await replyResult(ctx, record, result);
      return;
    }

    // ban / kick / timeout: each needs a member and a reason.
    const target = requireTarget(ctx);
    const reason = requireReason(ctx);
    const actionName = action;
    const banMinutes = actionName === "ban" ? optionInteger(ctx, "duration") : undefined;
    const expiresAt =
      banMinutes !== undefined
        ? new Date(ctx.now() + Math.min(banMinutes, 525_600) * 60_000).toISOString()
        : undefined;
    const { record, result } = await runAction(ctx, ports, settings, {
      action: actionName,
      targetId: target,
      reason,
      expiresAt,
      run: () => {
        if (actionName === "ban") return ports.actions.ban(guildId, target, reason);
        if (actionName === "kick") return ports.actions.kick(guildId, target, reason);
        const minutes = Math.min(Math.max(optionInteger(ctx, "duration") ?? 10, 1), 40_320);
        return ports.actions.timeout(guildId, target, minutes * 60, reason);
      },
    });
    if (result.ok && record.expiresAt) {
      await scheduleExpiry(ctx, ports, settings, record);
    }
    await replyResult(ctx, record, result);
  },
  notes:
    "One hub command for manual moderation. Every enforced action creates a case before the external call, so a failed ban still leaves a reviewable record. `links` and `filters` read the newest local content-filter findings without widening the command budget.",
});

function describeAction(ctx: CommandContext, action: ModAction): string {
  const target = optionText(ctx, "user") ?? optionText(ctx, "channel") ?? "the target";
  if (action === "purge") return `would purge up to ${optionInteger(ctx, "limit") ?? 10} messages`;
  if (action === "lock") return `would lock ${target}`;
  if (action === "unlock") return `would unlock ${target}`;
  if (action === "slowmode") return `would set slowmode on ${target}`;
  if (action === "timeout") return `would time out ${target} for ${optionInteger(ctx, "duration") ?? 10} minutes`;
  if (action === "temp-role")
    return `would grant ${optionText(ctx, "role") ?? "a role"} to ${target} for ${optionInteger(ctx, "duration") ?? 10} minutes`;
  if (action === "ban" && optionInteger(ctx, "duration") !== undefined)
    return `would temporarily ban ${target} for ${optionInteger(ctx, "duration")} minutes`;
  return `would ${action} ${target}`;
}

async function replyResult(
  ctx: CommandContext,
  record: ModerationCase,
  result: ModerationActionResult,
): Promise<void> {
  await ctx.interaction.reply({
    ephemeral: true,
    embeds: [caseEmbed(record)],
    content: result.ok
      ? `Case #${record.caseNumber} recorded and action applied.`
      : `Case #${record.caseNumber} recorded; the action failed: ${result.detail ?? "unknown error"}`,
  });
}
