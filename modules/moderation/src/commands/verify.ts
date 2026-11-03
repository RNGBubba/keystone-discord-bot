import {
  UserError,
  cooldown,
  defineCommand,
  requireGuild,
  requirePanelSigner,
  type CommandContext,
  type MemberVerification,
  type ModerationPort,
} from "@keystone/kernel";
import { verifyButton } from "../cases";
import { moderationSettingsSchema } from "../settings";

function moderationPort(ctx: CommandContext): ModerationPort {
  if (!ctx.moderation) {
    throw new UserError(
      "Verification state is not configured in this process. Run /setup to check the database.",
    );
  }
  return ctx.moderation;
}

interface VerificationView {
  readonly state: string;
  readonly next: string;
  readonly color: number;
}

function verificationView(
  record: MemberVerification | undefined,
  gateEnabled: boolean,
): VerificationView {
  if (record?.verifiedAt) {
    return {
      state: `Verified at ${record.verifiedAt}.`,
      next: "Nothing to do; your verification is on record.",
      color: 0x57f287,
    };
  }

  const state = record?.quarantined
    ? "Quarantined; verification is not complete."
    : record
      ? "Not verified; no quarantine is recorded."
      : "No verification record.";

  if (!gateEnabled) {
    return {
      state: `${state} The join gate is disabled here.`,
      next: "Ask a moderator to enable the join gate.",
      color: 0xfee75c,
    };
  }
  if (record?.quarantined) {
    return {
      state,
      next: "Run `/verify start` to receive the verification button in a DM.",
      color: 0xfee75c,
    };
  }
  return {
    state,
    next: "No quarantine is recorded. Ask a moderator if you are still restricted.",
    color: 0xfee75c,
  };
}

async function startVerification(ctx: CommandContext): Promise<void> {
  const guildId = ctx.guildId!;
  const settings = moderationSettingsSchema.parse(await ctx.settings.get(guildId));
  if (!settings.joinGate.enabled) {
    throw new UserError("The join gate is not enabled in this server.");
  }

  const moderation = moderationPort(ctx);
  const existing = await moderation.members.get(guildId, ctx.userId);
  if (!existing) {
    throw new UserError(
      "No quarantine is recorded for you in this server. If you are restricted, ask a moderator.",
    );
  }
  if (existing.verifiedAt) {
    throw new UserError(`You are already verified (${existing.verifiedAt}).`);
  }
  if (!existing.quarantined) {
    throw new UserError(
      "Your record does not show a quarantine. If you are still restricted, ask a moderator.",
    );
  }

  const signer = requirePanelSigner(ctx.componentSigner);
  const sent = await moderation.actions.directMessage(ctx.userId, {
    content:
      "Keystone verification: click the button below to leave quarantine in this server. If you did not request this, ignore it.",
    components: [verifyButton(guildId, ctx.userId, signer, ctx.now())],
  });
  if (!sent.ok) {
    throw new UserError(
      `I could not DM you (${sent.detail ?? "DMs are closed"}). Open DMs from server members and run /verify start again.`,
    );
  }

  await ctx.interaction.reply({
    ephemeral: true,
    content:
      "Verification instructions sent to your DMs. Click the button there to complete verification; then run `/verify status` to check the persisted result.",
  });
}

async function verificationStatus(ctx: CommandContext): Promise<void> {
  const guildId = ctx.guildId!;
  const settings = moderationSettingsSchema.parse(await ctx.settings.get(guildId));
  const record = await moderationPort(ctx).members.get(guildId, ctx.userId);
  const gateEnabled = settings.joinGate.enabled;
  const view = verificationView(record, gateEnabled);

  await ctx.interaction.reply({
    ephemeral: true,
    content: `Verification status · ${view.state}`,
    embeds: [
      {
        title: "Verification status",
        description: view.state,
        color: view.color,
        fields: [
          { name: "Join gate", value: gateEnabled ? "enabled here" : "disabled here", inline: true },
          {
            name: "Quarantine record",
            value: record ? (record.quarantined ? "quarantined" : "not quarantined") : "no record",
            inline: true,
          },
          { name: "Joined", value: record?.joinedAt ?? "no persisted join record", inline: true },
          { name: "Next step", value: view.next },
        ],
        footer: { text: "Read from the members table; gateway roles are not consulted." },
      },
    ],
  });
}

/**
 * `/verify` starts the join-gate flow and reports its persisted outcome.
 *
 * `start` only sends the existing verification button; the button is the one
 * completion path and writes `members.verified_at` after the quarantine action
 * succeeds. `status` reads that row, so a role change in Discord cannot make
 * the command claim a verification that never happened.
 */
export const verify = defineCommand({
  name: "verify",
  description: "Start the join gate or check your persisted verification status.",
  guards: [requireGuild, cooldown(5_000)],
  subcommands: [
    {
      name: "start",
      description: "Send yourself the verification button by DM.",
    },
    {
      name: "status",
      description: "Read your persisted verification and quarantine state.",
    },
  ],
  async execute(ctx) {
    const selected = ctx.commandPath[0];
    if (selected === "start") {
      await startVerification(ctx);
      return;
    }
    if (selected === "status") {
      await verificationStatus(ctx);
      return;
    }
    throw new UserError("Choose `/verify start` or `/verify status`.");
  },
  notes:
    "The DM button is the only completion path. `start` requires a persisted quarantined row and never marks a member verified; `status` reads that row; the button transitions only a quarantined row.",
});
