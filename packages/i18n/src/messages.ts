import { commandCopyEn } from "./command-copy";

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

  // Refusals shared by the covered command flows.
  "error.guildOnly": () => "This command only works in a server.",
  "error.permission": (permission: string) => `You need the ${permission} permission for that.`,

  // Member-facing command replies for the main flows. Admin-only module copy
  // is still English and is named in the pass journal.
  "ping.reply": (uptime: string) => `Pong! Keystone has been up for ${uptime}.`,
  "about.description": () =>
    "An open-source, teach-by-default all-in-one Discord bot. Free forever, no feature is ever moved behind a paywall.",
  "about.field.version": () => "Version",
  "about.field.module": () => "Module",
  "about.field.enabled": () => "Enabled here",
  "about.enabled.yes": () => "yes",
  "about.enabled.no": () => "no",
  "about.field.learn": () => "Learn how this works",
  "about.footer": () => "Settings are validated by this module's Zod schema.",

  "help.catalogMissing": () => "The command catalog is not wired in this process.",
  "help.noModule": (moduleId: string) => `No module named \`${moduleId}\` is registered.`,
  "help.browse.title": () => "Keystone commands",
  "help.browse.description": (roots: number, subcommands: number) =>
    `${roots} roots · ${subcommands} subcommands. Pick a root, then a subcommand. Use \`/help commands\` for the full list.`,
  "help.browse.contextHint": () => " Context menus live under right-click → Apps.",
  "help.commands.title": () => "Command catalog",
  "help.commands.description": (roots: number, subcommands: number) =>
    `${roots} roots · ${subcommands} subcommands. Type \`/\` and choose a root to see these actions.`,
  "help.commands.footer.limit": (shown: number, total: number) =>
    `Showing ${shown} of ${total} roots; filter with /help browse module:id.`,
  "help.commands.footer.generated": () =>
    "Generated from the live registry, never a hand-edited list.",
  "help.root.name": (name: string, subcommands: number) =>
    `/${name} · ${subcommands} subcommands`,
  "help.search.noQuery": () => "Give a word to search for.",
  "help.search.empty": (query: string) =>
    `No command matches \`${query}\`. Try \`/help browse\`.`,
  "help.search.matches": (query: string, lines: string) =>
    `Matches for \`${query}\`:\n${lines}`,
  "help.privacy.title": () => "Data and privacy",
  "help.privacy.body": () =>
    "Keystone stores guild configuration, cases, tickets, levels, ledger entries, invite joins and AI usage counters.\n\nPrompts and completions are **not** stored by default. Message content is only stored when a feature cannot work without it, such as a ticket transcript.\n\nEvery stored domain has a retention window in `memory/vault/01-Mission/Master-Plan.md`.\n\n`/export guild` and `/export delete` are the data-portability path; a deletion receipt keeps counts, not content.",
  "help.changelog.title": () => "Keystone changelog",
  "help.changelog.latest": (version: string, pass: string) =>
    `**${version}** · latest: ${pass}`,
  "help.changelog.entry": (pass: string, date: string, summary: string) =>
    `**${pass}** (${date}) — ${summary}`,
  "help.unknown": () => "Unknown help action. Use /help browse.",

  "rank.card.noTarget": () => "That menu did not include a member.",
  "rank.leaderboard.title": () => "XP leaderboard",
  "rank.leaderboard.empty": () => "No XP recorded yet.",
  "rank.leaderboard.row": (position: number, userId: string, level: number, xp: number) =>
    `${position}. <@${userId}> — level ${level} (${xp} XP)`,
  "rank.rewards.empty": () => "No role rewards configured.",
  "rank.rewards.row": (level: number, roleId: string) => `Level ${level}: <@&${roleId}>`,
  "rank.rewards.invalid": () => "Rewards look like `5:123456789,10:987654321`.",
  "rank.rewards.updated": () => "XP role rewards updated.",
  "rank.admin.missing": () => "Admin needs a user and a level.",
  "rank.admin.updated": (target: string, level: number, xp: number) =>
    `<@${target}> is now level ${level} with ${xp} XP.`,
  "rank.balance": (target: string, balance: number, currency: string) =>
    `<@${target}> has **${balance} ${currency}**.`,
  "rank.daily.ok": (amount: number, currency: string, balance: number) =>
    `You claimed **${amount} ${currency}**. Balance: **${balance}**.`,
  "rank.daily.failed": (reason: string, balance: number) => `${reason} Balance: **${balance}**.`,
  "rank.daily.balance": (balance: number) => `Balance: **${balance}**.`,
  "rank.pay.missing": () => "Pay needs a user and an amount.",
  "rank.pay.ok": (amount: number, currency: string, target: string) =>
    `Sent **${amount} ${currency}** to <@${target}>.`,
  "rank.shop.title": (currency: string) => `${currency} shop`,
  "rank.shop.empty": () => "The shop is empty.",
  "rank.shop.item": (name: string, price: number, id: string) =>
    `**${name}** — ${price} (id: \`${id}\`)`,
  "rank.shop.itemWithDescription": (name: string, price: number, id: string, description: string) =>
    `**${name}** — ${price} (id: \`${id}\`)\n${description}`,
  "rank.buy.missingItem": () => "Name the shop item to buy.",
  "rank.buy.ok": (name: string, balance: number) =>
    `Bought **${name}**. Balance: **${balance}**.`,
  "rank.gamble.missingAmount": () => "Name the amount to gamble.",
  "rank.gamble.won": (amount: number, balance: number) =>
    `You won **${amount}**. Balance: **${balance}**.`,
  "rank.gamble.lost": (amount: number, balance: number) =>
    `You lost **${amount}**. Balance: **${balance}**.`,
  "rank.ledger.title": () => "Your ledger",
  "rank.ledger.empty": () => "No movements yet.",
  "rank.season.already": (key: string) =>
    `Season **${key}** was already started; no profiles were archived again.`,
  "rank.season.started": (key: string, archived: number) =>
    `Season **${key}** started. Archived **${archived}** profile(s); the XP ledger remains intact.`,

  "ticket.panel.noChannel": () => "Choose a channel for the panel.",
  "ticket.panel.noSigner": () => "Interactive panels are not configured on this bot.",
  "ticket.panel.posted": (messageId: string) => `Ticket panel posted (${messageId}).`,
  "ticket.open.noChannelHere": () => "Open a ticket from a normal channel, not a DM.",
  "ticket.stats.title": () => "Ticket statistics",
  "ticket.stats.body": (open: number, claimed: number, closed: number, average: string) =>
    `Open **${open}** · Claimed **${claimed}** · Closed **${closed}**\nAverage close: **${average} minutes**`,
  "ticket.missingThread": () => "Use this inside a ticket thread or pass a ticket id.",
  "ticket.claim.done": (id: string) => `Claimed ticket ${id}.`,
  "ticket.close.missing": () => "That ticket does not exist.",
  "ticket.close.notAllowed": () =>
    "Only the opener or a support member can close this ticket.",
  "ticket.close.done": (id: string) => `Closed ticket ${id}.`,
  "ticket.add.missing": () => "Choose a member to add.",
  "ticket.add.done": (userId: string) => `Added <@${userId}>.`,
  "ticket.summary.noAi": () => "AI services are not wired.",
  "ticket.summary.title": () => "Ticket summary",
  "ticket.summary.body": (summary: string) =>
    `${summary}\n\nAI can be wrong. A human decides any action.`,
  "ticket.summary.model": (model: string) => `model ${model}`,

  // Every registered root, subcommand and option description. The
  // coverage test derives these keys from the manifests.
  ...commandCopyEn,
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
