import { createHash } from "node:crypto";
import {
  UserError,
  cooldown,
  defineCommand,
  requireGuild,
  type CommandContext,
  type CommandOption,
  type FormDefinition,
  type FormFieldDefinition,
  type FormSubmission,
} from "@keystone/kernel";
import { guildLocale } from "@keystone/i18n";
import { FormService, type FormExport, type FormSummary } from "../forms";
import { FORM_MODAL_TTL_MS, formPanel } from "../panel";
import { formSettingsSchema } from "../settings";

const OPTIONS = {
  name: { type: "string", name: "name", description: "Form name shown on the panel" },
  key: { type: "string", name: "key", description: "Stable slug; defaults from the name" },
  description: {
    type: "string",
    name: "description",
    description: "Short introduction shown on the panel",
  },
  fields: {
    type: "string",
    name: "fields",
    description: "Comma-separated key:Label pairs, e.g. why:Why join, tz:Timezone",
  },
  form: {
    type: "string",
    name: "form",
    description: "Form key or id",
  },
  confirm: {
    type: "string",
    name: "confirm",
    description: "Repeat the form key to confirm deletion",
  },
  answers: {
    type: "string",
    name: "answers",
    description: "key=value pairs separated by ; or newlines",
  },
  submission: {
    type: "string",
    name: "submission",
    description: "Submission id; omit to list the pending queue",
  },
  decision: {
    type: "string",
    name: "decision",
    description: "Accept or deny the selected submission",
    choices: [
      { name: "accept", value: "accepted" },
      { name: "deny", value: "denied" },
    ],
  },
  note: {
    type: "string",
    name: "note",
    description: "Decision note stored on the submission",
  },
  state: {
    type: "string",
    name: "state",
    description: "Draft hides the panel; open accepts; closed keeps history",
    choices: [
      { name: "draft", value: "draft" },
      { name: "open", value: "open" },
      { name: "closed", value: "closed" },
    ],
  },
} satisfies Record<string, CommandOption>;

function opts(...names: (keyof typeof OPTIONS)[]): CommandOption[] {
  return names.map((name) => OPTIONS[name]);
}

function text(ctx: CommandContext, key: keyof typeof OPTIONS): string | undefined {
  const value = ctx.interaction.options[OPTIONS[key].name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function manage(ctx: CommandContext): void {
  const held = ctx.interaction.permissions;
  if (!held.includes("ManageGuild") && !held.includes("Administrator")) {
    throw new UserError("Missing permission: ManageGuild");
  }
}

function guard(ctx: CommandContext) {
  const form = ctx.forms;
  if (!form) throw new UserError("Forms are not wired in this process.");
  return form;
}

function clip(value: string, max = 1_024): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function fieldLines(fields: readonly FormFieldDefinition[]): string {
  return fields.map((field) => `\`${field.key}\` — ${field.label}`).join("\n");
}

function formLine(entry: FormSummary): string {
  const panel = entry.form.panelChannelId ? ` · panel <#${entry.form.panelChannelId}>` : "";
  return `\`${entry.form.key}\` · **${entry.form.name}** · ${entry.form.state} · ${entry.submissions} submission${entry.submissions === 1 ? "" : "s"}${panel}`;
}

function submissionLine(submission: FormSubmission, form: FormDefinition): string {
  const at = Math.floor(new Date(submission.createdAt).getTime() / 1_000);
  return `\`${submission.id}\` · \`${form.key}\` · <@${submission.userId}> · <t:${at}:R>`;
}

function answerFields(entry: { submission: FormSubmission; form: FormDefinition }) {
  return entry.form.fields
    .filter((field) => entry.submission.answers[field.key])
    .map((field) => ({
      name: field.label,
      value: clip(entry.submission.answers[field.key] as string),
      inline: false,
    }));
}

function exportFile(payload: FormExport, checksum: string): { content: string } {
  return { content: JSON.stringify({ ...payload, checksum }, null, 2) };
}

export const form = defineCommand({
  name: "form",
  description: "Build application forms, publish a panel and review submissions.",
  subcommands: [
    {
      name: "create",
      description: "Create a draft form from a comma-separated field list.",
      options: opts("name", "key", "description", "fields"),
    },
    {
      name: "edit",
      description: "Change a form's name, description, fields or draft/open/closed state.",
      options: opts("form", "name", "description", "fields", "state"),
    },
    {
      name: "delete",
      description: "Delete a form that has no submissions; history is never deleted.",
      options: [OPTIONS.form, OPTIONS.confirm],
    },
    {
      name: "list",
      description: "List forms with state, submission counts and panel channel.",
    },
    {
      name: "panel",
      description: "Post the application panel for an open form in this channel.",
      options: [OPTIONS.form],
    },
    {
      name: "submit",
      description: "Submit answers to an open form; one pending submission per member.",
      options: [OPTIONS.form, OPTIONS.answers],
    },
    {
      name: "review",
      description: "List pending submissions, read one, or accept/deny it.",
      options: opts("submission", "decision", "note"),
    },
    {
      name: "export",
      description: "Download forms and submissions as a checksummed JSON file.",
      options: [OPTIONS.form],
    },
  ],
  guards: [requireGuild, cooldown(3_000)],
  async execute(ctx: CommandContext): Promise<void> {
    const settings = formSettingsSchema.parse(await ctx.settings.get(ctx.guildId as string));
    const forms = guard(ctx);
    const svc = new FormService(forms, settings, ctx.now);
    const guildId = ctx.guildId as string;
    const selected = ctx.commandPath[0];

    if (selected === "create") {
      manage(ctx);
      const created = await svc.create(guildId, ctx.userId, {
        name: text(ctx, "name") ?? "",
        key: text(ctx, "key"),
        description: text(ctx, "description"),
        fields: text(ctx, "fields") ?? "",
      });
      await ctx.interaction.reply({
        content: `Form \`${created.key}\` created in draft with ${created.fields.length} field${created.fields.length === 1 ? "" : "s"}. Open it with \`/form edit form:${created.key} state:open\`, then post the panel with \`/form panel form:${created.key}\`.`,
        ephemeral: true,
        embeds: [
          {
            title: `Draft: ${created.name}`,
            description: created.description || "No description yet.",
            color: 0x5865f2,
            fields: [{ name: "Fields", value: clip(fieldLines(created.fields)), inline: false }],
          },
        ],
      });
      return;
    }

    if (selected === "edit") {
      manage(ctx);
      const reference = text(ctx, "form");
      if (!reference) throw new UserError("Choose a form with the `form` option.");
      const before = await forms.getForm(guildId, reference);
      if (!before) throw new UserError(`Form \`${reference}\` was not found. Use \`/form list\`.`);

      const patch = {
        name: text(ctx, "name"),
        description: text(ctx, "description"),
        fields: text(ctx, "fields"),
        state: text(ctx, "state"),
      };
      if (!patch.name && !patch.description && !patch.fields && !patch.state) {
        await ctx.interaction.reply({
          content: `Form \`${before.key}\` · ${before.state} · ${before.fields.length} fields · ${before.name}. Change one of name, description, fields or state.`,
          ephemeral: true,
          embeds: [
            {
              title: before.name,
              description: before.description || "No description yet.",
              color: 0x5865f2,
              fields: [{ name: "Fields", value: clip(fieldLines(before.fields)), inline: false }],
            },
          ],
        });
        return;
      }

      const updated = await svc.edit(guildId, reference, patch);
      await ctx.interaction.reply({
        content: `Form \`${updated.key}\` updated · state ${updated.state} · ${updated.fields.length} fields.`,
        ephemeral: true,
        embeds: [
          {
            title: updated.name,
            description: updated.description || "No description yet.",
            color: 0x5865f2,
            fields: [{ name: "Fields", value: clip(fieldLines(updated.fields)), inline: false }],
          },
        ],
      });
      return;
    }

    if (selected === "delete") {
      manage(ctx);
      const reference = text(ctx, "form");
      const confirm = text(ctx, "confirm");
      if (!reference) throw new UserError("Choose a form with the `form` option.");
      if (!confirm) throw new UserError(`Pass confirm:${reference} to delete this form.`);
      const removed = await svc.remove(guildId, reference, confirm);
      await ctx.interaction.reply({
        content: `Form \`${removed.key}\` deleted. It had no submissions, so no history was lost.`,
        ephemeral: true,
      });
      return;
    }

    if (selected === "list") {
      manage(ctx);
      const list = await svc.list(guildId);
      await ctx.interaction.reply({
        ephemeral: true,
        content: `${list.length} form${list.length === 1 ? "" : "s"} in this server.`,
        embeds: [
          {
            title: "Forms",
            description:
              list.length > 0
                ? list.map(formLine).join("\n")
                : "No forms yet. Create one with `/form create name:<name> fields:<key:Label, ...>`.",
            color: 0x5865f2,
            footer: { text: "Submission counts are read from form_submissions, not a counter." },
          },
        ],
      });
      return;
    }

    if (selected === "panel") {
      manage(ctx);
      const reference = text(ctx, "form");
      if (!reference) throw new UserError("Choose a form with the `form` option.");
      const published = await svc.panelForm(guildId, reference);
      const channelId = ctx.interaction.channelId;
      if (!channelId) throw new UserError("Post the panel from a server channel.");
      const signer = ctx.componentSigner;
      if (!signer) throw new UserError("Interactive panels are not configured on this bot.");

      // V2 is a layout, so the message must be created by an edit: deferring
      // first also keeps the 3-second acknowledgement inside the budget.
      const panelActions = {
        apply: signer.sign({
          namespace: "form",
          action: "apply",
          payload: published.key,
          ttlMs: FORM_MODAL_TTL_MS,
        }),
        review: signer.sign({
          namespace: "form",
          action: "review",
          payload: published.key,
          ttlMs: FORM_MODAL_TTL_MS,
        }),
      };
      const locale = await guildLocale(ctx.config, guildId);
      await ctx.interaction.deferReply();
      await ctx.interaction.editReply({ v2: formPanel(published, panelActions, locale) });
      await svc.markPanel(guildId, published.id, channelId);
      return;
    }

    if (selected === "submit") {
      const reference = text(ctx, "form");
      const answers = text(ctx, "answers");
      if (!reference) throw new UserError("Choose a form with the `form` option.");
      if (!answers) throw new UserError("Provide answers as `key=value; key=value`.");
      const submission = await svc.submit(guildId, ctx.userId, reference, answers);
      await ctx.interaction.reply({
        content: `Submission received · \`${submission.id}\` · ${Object.keys(submission.answers).length} answers. Staff will review it; do not submit again while it is pending.`,
        ephemeral: true,
      });
      return;
    }

    if (selected === "review") {
      manage(ctx);
      const submissionId = text(ctx, "submission");
      if (!submissionId) {
        const pending = await svc.pending(guildId);
        await ctx.interaction.reply({
          ephemeral: true,
          content: `${pending.length} pending submission${pending.length === 1 ? "" : "s"}.`,
          embeds: [
            {
              title: "Review queue",
              description:
                pending.length > 0
                  ? pending.map((entry) => submissionLine(entry.submission, entry.form)).join("\n")
                  : "Nothing is pending. `/form submit` creates a real row here.",
              color: pending.length > 0 ? 0xfee75c : 0x57f287,
              footer: {
                text: "Use /form review submission:<id> to read it, or add decision:accept|deny.",
              },
            },
          ],
        });
        return;
      }

      const found = await svc.submissionFor(guildId, submissionId);
      const decision = text(ctx, "decision");
      if (!decision) {
        await ctx.interaction.reply({
          ephemeral: true,
          content: `Submission \`${found.submission.id}\` · \`${found.form.key}\` · ${found.submission.state} · <@${found.submission.userId}>`,
          embeds: [
            {
              title: `Application: ${found.form.name}`,
              color: 0x5865f2,
              fields: answerFields(found),
              footer: { text: "Add decision:accept or decision:deny to close this submission." },
            },
          ],
        });
        return;
      }
      if (decision !== "accepted" && decision !== "denied") {
        throw new UserError("Decision must be accept or deny.");
      }

      const reviewed = await svc.review(
        guildId,
        ctx.userId,
        submissionId,
        decision,
        text(ctx, "note"),
      );
      await ctx.interaction.reply({
        ephemeral: true,
        content: `Submission \`${reviewed.id}\` ${reviewed.state} by <@${ctx.userId}>.`,
        embeds: [
          {
            title: `Application ${reviewed.state}: ${found.form.name}`,
            color: reviewed.state === "accepted" ? 0x57f287 : 0xed4245,
            fields: [
              ...answerFields({ submission: reviewed, form: found.form }),
              ...(reviewed.decisionNote
                ? [{ name: "Decision note", value: clip(reviewed.decisionNote), inline: false }]
                : []),
            ],
          },
        ],
      });
      return;
    }

    if (selected === "export") {
      manage(ctx);
      const reference = text(ctx, "form");
      const payload = await svc.export(guildId, reference);
      const checksum = createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");
      const file = exportFile(payload, checksum);
      const name = reference
        ? `keystone.forms.${guildId}.${payload.forms[0]?.key ?? "form"}.json`
        : `keystone.forms.${guildId}.json`;
      await ctx.interaction.reply({
        ephemeral: true,
        content: `Form export · ${payload.counts.forms} form${payload.counts.forms === 1 ? "" : "s"} · ${payload.counts.submissions} submission${payload.counts.submissions === 1 ? "" : "s"} · ${file.content.length} bytes · checksum \`${checksum.slice(0, 16)}…\``,
        files: [
          {
            name,
            content: file.content,
            description: "Keystone forms export. Contains member ids and answers; keep it private.",
          },
        ],
        embeds: [
          {
            title: "Forms export",
            description:
              "The attached JSON is the same rows `/form list` and `/form review` read, plus the field definitions. The checksum is SHA-256 over the payload.",
            color: 0x5865f2,
            fields: [
              { name: "Checksum", value: `\`${checksum}\``, inline: false },
              { name: "Format", value: `\`${payload.format}\` version ${payload.version}`, inline: false },
            ],
            footer: { text: "Contains member ids and answers. Treat it as private." },
          },
        ],
      });
      return;
    }

    throw new UserError("Unknown form action. Use `/form list`.");
  },
  help: {
    category: "Community",
    permissions: ["ManageGuild"],
    examples: [
      "/form create name:Staff application fields:why:Why join, tz:Timezone",
      "/form edit form:staff-application state:open",
      "/form panel form:staff-application",
      "/form submit form:staff-application answers:\"why=...; tz=...\"",
      "/form review",
      "/form review submission:<id> decision:accept note:Strong application",
      "/form export",
    ],
  },
  notes:
    "One pending submission per member per form, enforced by a partial unique index. Deleting a form is refused once it has submissions; close it instead. `/form panel` posts a Components V2 panel whose Apply button opens a modal when the form holds five questions or fewer; `submit` keeps the answers-option path for longer forms and for scripting.",
});
