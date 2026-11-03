/**
 * The English catalog is the type source. Every other locale is declared as a
 * `Catalog`, so a translation must implement the same arguments as the English
 * message: a translator cannot drop `{field}` or give `count` a different type.
 * That is what keeps interpolation and plural handling identical by construction
 * rather than by review.
 *
 * Only shipped surfaces are here. A key with no call site is dead weight and a
 * promise the bot does not keep.
 */
export const en = {
  // Component router refusals. These are the strings every panel shares.
  "component.expired": () => "That panel has expired. Run the command again to get a fresh one.",
  "component.noPermission": () => "You do not have permission to use that button.",
  "component.guildOnly": () => "That control only works inside a server.",

  // The /form panel and its component routes.
  "form.panel.questions": () => "**Questions**",
  "form.panel.apply": () => "Apply",
  "form.panel.review": () => "Review submissions",
  "form.panel.hint": () =>
    "Press **Apply** to answer in a form. One pending application per member.",
  "form.panel.tooMany": (count: number, key: string) =>
    `This form has ${count} questions; Discord modals hold 5. Use \`/form submit form:${key}\` instead.`,
  "form.apply.noModal": () =>
    "This client cannot open a form. Run `/form submit` instead.",
  "form.apply.tooMany": (count: number, key: string, hints: string) =>
    `This form has ${count} questions and a Discord modal holds five. Submit with \`/form submit form:${key} answers:"${hints}"\`.`,
  "form.panel.privacy": () => "Answers are stored in this server and read only by staff.",
  "form.panel.description": (name: string) =>
    `Applications for **${name}** are open. Staff review every submission.`,
  "form.errors.missing": (fields: string) =>
    `Missing required field${fields.includes(",") ? "s" : ""}: ${fields}.`,
  "form.submit.received": (id: string, answers: number) =>
    `Submission received · \`${id}\` · ${answers} answer${answers === 1 ? "" : "s"}. Staff will review it; do not submit again while it is pending.`,
  "form.review.empty": (key: string) =>
    `No pending applications for \`${key}\`. Review closed ones with \`/form review\`.`,
  "form.review.row": (id: string, key: string, userId: string, answers: number) =>
    `\`${id}\` · ${key} · <@${userId}> · ${answers} answer${answers === 1 ? "" : "s"}`,
  "form.review.pending": (count: number, key: string, lines: string) =>
    `${count} pending application${count === 1 ? "" : "s"} for \`${key}\`:\n${lines}\nDecide with \`/form review submission:<id> decision:accept|deny\`.`,

  // The rank card, shared by `/rank view` and the user context menu.
  "rank.line": (level: number, xp: number, rank?: number) =>
    `Level **${level}** · **${xp} XP**${rank ? ` · rank **#${rank}**` : ""}`,
  "rank.footer": () => "Rank card · levels are stored XP rows, not an image render.",

  // The ticket panel and the button it posts.
  "ticket.panel.title": () => "Support tickets",
  "ticket.panel.description": () =>
    "Open a private thread with the support team. One ticket per open issue.",
  "ticket.panel.open": () => "Open a ticket",
  "ticket.panel.wrongGuild": () => "That panel belongs to another server.",
  "ticket.open.reply": (channelId: string) => `Ticket opened in <#${channelId}>.`,
  "ticket.open.subject": () => "Support request",
  "ticket.open.noChannel": () => "Open a ticket from a server channel.",
  "ticket.open.tooMany": (count: number, max: number) =>
    `You already have ${count} open ticket${count === 1 ? "" : "s"} (limit ${max}). Close one before opening another.`,

  // Command descriptions. The command name is an invocation identifier and is
  // deliberately not translated; the displayed description is.
  "command.ping.description": () => "Check that Keystone is awake.",
  "command.about.description": () => "Show what Keystone is and how this server is configured.",
  "command.form.description": () => "Build application forms, publish a panel and review submissions.",
  "command.form.create.description": () => "Create a draft form from a comma-separated field list.",
  "command.form.edit.description": () => "Change a form's name, description, fields or draft/open/closed state.",
  "command.form.delete.description": () => "Delete a form that has no submissions; history is never deleted.",
  "command.form.list.description": () => "List forms with state, submission counts and panel channel.",
  "command.form.panel.description": () => "Post the application panel for an open form in this channel.",
  "command.form.submit.description": () => "Submit answers to an open form; one pending submission per member.",
  "command.form.review.description": () => "List pending submissions, read one, or accept/deny it.",
  "command.form.export.description": () => "Download forms and submissions as a checksummed JSON file.",
  "command.form.option.name.description": () => "Form name shown on the panel",
  "command.form.option.key.description": () => "Stable slug; defaults from the name",
  "command.form.option.description.description": () => "Short introduction shown on the panel",
  "command.form.option.fields.description": () =>
    "Comma-separated key:Label pairs, e.g. why:Why join, tz:Timezone",
  "command.form.option.form.description": () => "Form key or id",
  "command.form.option.confirm.description": () => "Repeat the form key to confirm deletion",
  "command.form.option.answers.description": () => "key=value pairs separated by ; or newlines",
  "command.form.option.submission.description": () =>
    "Submission id; omit to list the pending queue",
  "command.form.option.decision.description": () => "Accept or deny the selected submission",
  "command.form.option.note.description": () => "Decision note stored on the submission",
  "command.form.option.state.description": () =>
    "Draft hides the panel; open accepts; closed keeps history",
} as const;

export type MessageKey = keyof typeof en;
export type MessageArgs<K extends MessageKey> = Parameters<(typeof en)[K]>;

/** A complete catalog: every key, with the English argument list. */
export type Catalog = {
  [K in MessageKey]: (...args: MessageArgs<K>) => string;
};

/** The loose shape the resolver stores. */
export type MessageFunction = (...args: never[]) => string;
export type MessageCatalog = Partial<Record<string, MessageFunction>>;
