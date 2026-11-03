/**
 * Command description copy. The English keys are the type source for the
 * German catalog and for every option or subcommand the registry exposes.
 *
 * Generated from the live registry once, then reviewed by hand: the German is
 * written prose, not a machine translation, and the coverage test derives the
 * same keys from the manifests so a new command cannot ship English-only.
 */
export const commandCopyEn = {
  "command.ping.description": () =>
    `Check that Keystone is awake.`,
  "command.about.description": () =>
    `Show what Keystone is and how this server is configured.`,
  "command.help.description": () =>
    `Browse every Keystone command, search the catalog and check data retention.`,
  "command.help.browse.description": () =>
    `List the command roots, grouped by module.`,
  "command.help.commands.description": () =>
    `Show every root and its subcommands.`,
  "command.help.search.description": () =>
    `Find a command by name, description or module.`,
  "command.help.privacy.description": () =>
    `Explain what Keystone stores and what it does not.`,
  "command.help.changelog.description": () =>
    `Show the current version and the latest pass.`,
  "command.help.option.module.description": () =>
    `Only show one module id`,
  "command.help.option.query.description": () =>
    `Word to search for`,
  "command.setup.description": () =>
    `Check readiness, manage modules, preview an import or reset settings.`,
  "command.setup.status.description": () =>
    `Check database, migrations, cache and module readiness.`,
  "command.setup.module.description": () =>
    `List modules, inspect one, or enable/disable it.`,
  "command.setup.verify.description": () =>
    `Verify settings, schema parsing and the command catalog.`,
  "command.setup.import.description": () =>
    `Preview a keystone.export bundle before /export import applies it.`,
  "command.setup.reset.description": () =>
    `Reset one module's stored settings to its schema defaults.`,
  "command.setup.option.module.description": () =>
    `Module id, for example music`,
  "command.setup.option.enabled.description": () =>
    `Set enablement; omit to inspect one module`,
  "command.setup.option.bundle.description": () =>
    `A .json keystone.export bundle`,
  "command.setup.option.mode.description": () =>
    `How an apply would merge`,
  "command.config.description": () =>
    `Inspect and change any module's per-guild settings through the bot's own schema.`,
  "command.config.list.description": () =>
    `List every module and whether it is enabled here.`,
  "command.config.get.description": () =>
    `Show one module's effective settings, or one dotted key.`,
  "command.config.set.description": () =>
    `Validate and write one dotted key; the module's Zod schema is the gate.`,
  "command.config.export.description": () =>
    `Export every module's effective settings as JSON.`,
  "command.config.option.module.description": () =>
    `Module id, for example ai or moderation`,
  "command.config.option.key.description": () =>
    `Setting key; dotted paths such as automod.links are supported`,
  "command.config.option.value.description": () =>
    `JSON value, for example true, 7, "text" or ["a","b"]`,
  "command.export.description": () =>
    `Export, inspect or restore this server's data without leaving Discord.`,
  "command.export.guild.description": () =>
    `Download the full server bundle with settings, cases and history.`,
  "command.export.user.description": () =>
    `Download one member's cases, tickets, XP and ledger rows.`,
  "command.export.import.description": () =>
    `Preview or restore a keystone.export bundle attachment.`,
  "command.export.delete.description": () =>
    `Delete this server's stored data and leave a count-only receipt.`,
  "command.export.drift.description": () =>
    `Compare stored channel and role ids with the live server.`,
  "command.export.rollback.description": () =>
    `Restore the pre-import backup of an applied import.`,
  "command.export.option.user.description": () =>
    `Member whose rows to export`,
  "command.export.option.bundle.description": () =>
    `A .json keystone.export bundle`,
  "command.export.option.mode.description": () =>
    `replace restores everything; merge keeps cases and history`,
  "command.export.option.dry_run.description": () =>
    `Preview by default; set false to write`,
  "command.export.option.confirm.description": () =>
    `Type this server's id to confirm irreversible deletion`,
  "command.export.option.import_id.description": () =>
    `The id printed by /export import`,
  "command.mod.description": () =>
    `Moderate members, inspect cases and review the queue.`,
  "command.mod.ban.description": () =>
    `Ban a member; add duration for a temporary ban.`,
  "command.mod.temp-role.description": () =>
    `Grant a role for a number of minutes, then remove it.`,
  "command.mod.panic.description": () =>
    `Lock down every text channel, or restore the last snapshot.`,
  "command.mod.kick.description": () =>
    `Kick a member with a case and reason.`,
  "command.mod.timeout.description": () =>
    `Time out a member for a number of minutes.`,
  "command.mod.warn.description": () =>
    `Record a warning on a member's case history.`,
  "command.mod.purge.description": () =>
    `Bulk-delete recent messages in a channel.`,
  "command.mod.lock.description": () =>
    `Lock a channel so members cannot post.`,
  "command.mod.unlock.description": () =>
    `Unlock a channel again.`,
  "command.mod.slowmode.description": () =>
    `Set channel slowmode in seconds.`,
  "command.mod.case.description": () =>
    `Show one case by number.`,
  "command.mod.note.description": () =>
    `Append a moderator note to a case.`,
  "command.mod.history.description": () =>
    `List recent cases, optionally for one member.`,
  "command.mod.links.description": () =>
    `Review recent link-filter findings.`,
  "command.mod.filters.description": () =>
    `Review link, profanity and zalgo findings.`,
  "command.mod.review.description": () =>
    `Show the review queue or close one case.`,
  "command.mod.option.user.description": () =>
    `Member to act on (or filter history)`,
  "command.mod.option.reason.description": () =>
    `Why; required for punitive actions`,
  "command.mod.option.duration.description": () =>
    `Minutes for ban/temp-role/timeout, or seconds for slowmode`,
  "command.mod.option.dry_run.description": () =>
    `Preview only; never overrides a safe default`,
  "command.mod.option.role.description": () =>
    `Role for a temporary role grant`,
  "command.mod.option.state.description": () =>
    `Panic mode switch`,
  "command.mod.option.channel.description": () =>
    `Channel for purge, lock or slowmode`,
  "command.mod.option.limit.description": () =>
    `Purge count, 1-100 (default 10)`,
  "command.mod.option.case.description": () =>
    `Case number for case, note or review`,
  "command.appeal.description": () =>
    `Appeal a case against you, or check an appeal's status.`,
  "command.appeal.open.description": () =>
    `Appeal a moderation case against you.`,
  "command.appeal.status.description": () =>
    `Read your appeal events and the current case states.`,
  "command.appeal.option.case.description": () =>
    `Case number to appeal`,
  "command.appeal.option.message.description": () =>
    `Why the case should be reviewed`,
  "command.verify.description": () =>
    `Start the join gate or check your persisted verification status.`,
  "command.verify.start.description": () =>
    `Send yourself the verification button by DM.`,
  "command.verify.status.description": () =>
    `Read your persisted verification and quarantine state.`,
  "command.rank.description": () =>
    `View levels, leaderboards, rewards, currency, shop and transfers.`,
  "command.rank.view.description": () =>
    `Show your or another member's level and XP.`,
  "command.rank.leaderboard.description": () =>
    `Show the server XP leaderboard.`,
  "command.rank.rewards.description": () =>
    `List or set level role rewards.`,
  "command.rank.admin.description": () =>
    `Set a member's level directly.`,
  "command.rank.balance.description": () =>
    `Show a member's currency balance.`,
  "command.rank.daily.description": () =>
    `Claim your daily currency.`,
  "command.rank.pay.description": () =>
    `Send currency to another member.`,
  "command.rank.shop.description": () =>
    `List the server currency shop.`,
  "command.rank.buy.description": () =>
    `Buy a shop item.`,
  "command.rank.gamble.description": () =>
    `Gamble currency with a capped stake.`,
  "command.rank.ledger.description": () =>
    `Show your recent currency movements.`,
  "command.rank.season.description": () =>
    `Start a new XP season and archive the old one.`,
  "command.rank.option.user.description": () =>
    `Member to look at or pay`,
  "command.rank.option.limit.description": () =>
    `Rows to show`,
  "command.rank.option.value.description": () =>
    `Rewards, season key or status`,
  "command.rank.option.level.description": () =>
    `Level for admin changes`,
  "command.rank.option.amount.description": () =>
    `Coins to move or gamble`,
  "command.rank.option.item.description": () =>
    `Shop item id`,
  "command.rank.option.days.description": () =>
    `Season length in days`,
  "command.ticket.description": () =>
    `Open, claim, close and analyse private support threads.`,
  "command.ticket.panel.description": () =>
    `Post a ticket panel in a channel.`,
  "command.ticket.open.description": () =>
    `Open a private support thread.`,
  "command.ticket.claim.description": () =>
    `Claim a ticket for support.`,
  "command.ticket.close.description": () =>
    `Close a ticket and archive its thread.`,
  "command.ticket.add.description": () =>
    `Add a member to a ticket.`,
  "command.ticket.transcript.description": () =>
    `Show a ticket transcript as text.`,
  "command.ticket.summary.description": () =>
    `Summarize a ticket with the AI port.`,
  "command.ticket.stats.description": () =>
    `Show guild-wide ticket counts and close time.`,
  "command.ticket.option.channel.description": () =>
    `Panel or parent channel`,
  "command.ticket.option.title.description": () =>
    `Panel title`,
  "command.ticket.option.subject.description": () =>
    `Ticket subject`,
  "command.ticket.option.ticket.description": () =>
    `Ticket id (defaults to this thread)`,
  "command.ticket.option.user.description": () =>
    `Member to add`,
  "command.tools.description": () =>
    `Community utilities: birthdays, suggestions, content, roles, giveaways, feeds and auto-responders.`,
  "command.tools.embed.description": () =>
    `Send a simple embed to a channel.`,
  "command.tools.tag.description": () =>
    `Show a tag, or save one for this server.`,
  "command.tools.reminder.description": () =>
    `Set a reminder for yourself.`,
  "command.tools.schedule.description": () =>
    `Schedule a message for a channel.`,
  "command.tools.giveaway.description": () =>
    `Start a giveaway in a channel.`,
  "command.tools.giveaway-end.description": () =>
    `End a giveaway now and pick winners.`,
  "command.tools.giveaway-reroll.description": () =>
    `Reroll winners for a finished giveaway.`,
  "command.tools.poll.description": () =>
    `Post a poll with pipe-separated options.`,
  "command.tools.feed.description": () =>
    `Subscribe a channel to an RSS feed.`,
  "command.tools.stat.description": () =>
    `Create a member, online or booster stat channel.`,
  "command.tools.welcome.description": () =>
    `Configure the welcome message and autorole.`,
  "command.tools.goodbye.description": () =>
    `Configure the goodbye message for departing members.`,
  "command.tools.roles.description": () =>
    `Post a reaction-role or select-role panel.`,
  "command.tools.starboard.description": () =>
    `Configure the starboard channel and threshold.`,
  "command.tools.starboard-override.description": () =>
    `Set a per-channel starboard threshold or turn it off.`,
  "command.tools.voice.description": () =>
    `Configure the temporary voice hub.`,
  "command.tools.birthdays.description": () =>
    `Configure birthday announcements.`,
  "command.tools.birthday.description": () =>
    `Save or remove a member's birthday.`,
  "command.tools.suggestions.description": () =>
    `Configure the suggestions channel.`,
  "command.tools.suggestion.description": () =>
    `Submit a suggestion.`,
  "command.tools.suggestion-decide.description": () =>
    `Approve or reject a suggestion.`,
  "command.tools.sticky.description": () =>
    `Configure a sticky message in a channel.`,
  "command.tools.responder.description": () =>
    `Create or update an auto-responder trigger.`,
  "command.tools.responders.description": () =>
    `List auto-responders, or enable and disable them.`,
  "command.tools.responder-remove.description": () =>
    `Remove an auto-responder by id.`,
  "command.tools.option.channel.description": () =>
    `Target or source channel`,
  "command.tools.option.name.description": () =>
    `Name, title, question or id`,
  "command.tools.option.value.description": () =>
    `Text, options, date, URL or status`,
  "command.tools.option.duration.description": () =>
    `Minutes from now`,
  "command.tools.option.limit.description": () =>
    `Winners, threshold or delay`,
  "command.tools.option.url.description": () =>
    `Feed URL`,
  "command.tools.option.role.description": () =>
    `Role for welcome or reaction roles`,
  "command.tools.option.target.description": () =>
    `Override destination channel`,
  "command.tools.option.user.description": () =>
    `Target member`,
  "command.tools.option.match.description": () =>
    `Auto-responder match mode`,
  "command.ai.description": () =>
    `Ask server docs, deflect tickets and explain moderation. Off until enabled.`,
  "command.ai.status.description": () =>
    `Show AI features, usage and retained data.`,
  "command.ai.ask.description": () =>
    `Answer a question from this server's docs.`,
  "command.ai.chat.description": () =>
    `Ask the model directly in this channel.`,
  "command.ai.classify.description": () =>
    `Label a message as advisory automation evidence.`,
  "command.ai.docs-add.description": () =>
    `Index a server document for answers.`,
  "command.ai.docs-list.description": () =>
    `List indexed server documents.`,
  "command.ai.docs-remove.description": () =>
    `Remove an indexed server document.`,
  "command.ai.deflect.description": () =>
    `Suggest a reply to a support question.`,
  "command.ai.explain.description": () =>
    `Explain why a moderation case happened.`,
  "command.ai.summary.description": () =>
    `Summarize a ticket thread.`,
  "command.ai.budget.description": () =>
    `Set the monthly AI budget and request cap.`,
  "command.ai.option.question.description": () =>
    `Question for the server docs`,
  "command.ai.option.value.description": () =>
    `Answer, doc content, chat text or budget`,
  "command.ai.option.name.description": () =>
    `Document name`,
  "command.ai.option.case.description": () =>
    `Case number to explain`,
  "command.ai.option.ticket.description": () =>
    `Ticket id to summarize`,
  "command.ai.option.limit.description": () =>
    `Monthly request limit`,
  "command.invites.description": () =>
    `Invite leaderboard, your invite stats, and who invited a member.`,
  "command.invites.leaderboard.description": () =>
    `Show who has brought the most members in.`,
  "command.invites.stats.description": () =>
    `Show a member's join and retention totals.`,
  "command.invites.who.description": () =>
    `Show who invited a member and any advisory flags.`,
  "command.invites.option.limit.description": () =>
    `Leaderboard rows`,
  "command.invites.option.user.description": () =>
    `Member to inspect (defaults to you)`,
  "command.logging.description": () =>
    `Log message, member and moderation events in one audit channel.`,
  "command.logging.setup.description": () =>
    `Set the log channel, enable logging and send a test message.`,
  "command.logging.channel.description": () =>
    `Change the log channel, or clear it by omitting the option.`,
  "command.logging.events.description": () =>
    `List event toggles, or turn one event type on or off.`,
  "command.logging.status.description": () =>
    `Show the channel, event toggles, retention and stored count.`,
  "command.logging.retention.description": () =>
    `Set how many days to keep events, then prune older rows.`,
  "command.logging.export.description": () =>
    `Export the settings and the ten newest events as JSON.`,
  "command.logging.disable.description": () =>
    `Stop capturing and delivering events; keep the configuration.`,
  "command.logging.option.channel.description": () =>
    `Channel that receives audit events`,
  "command.logging.option.event.description": () =>
    `Event type to inspect or change`,
  "command.logging.option.enabled.description": () =>
    `Turn the selected event on or off`,
  "command.logging.option.days.description": () =>
    `Retention window in days (1-365)`,
  "command.analytics.description": () =>
    `Read-only guild analytics from the bot's own logs, cases, invites, tickets and command usage.`,
  "command.analytics.overview.description": () =>
    `One-page summary of the selected window.`,
  "command.analytics.members.description": () =>
    `Joins, leaves, invite attribution and retention.`,
  "command.analytics.messages.description": () =>
    `Logged message deletes, edits and content-filter cases.`,
  "command.analytics.commands.description": () =>
    `Command runs, outcomes and average latency.`,
  "command.analytics.tickets.description": () =>
    `Ticket counts, open state and close times.`,
  "command.analytics.export.description": () =>
    `Export the snapshot as JSON in an embed.`,
  "command.analytics.option.days.description": () =>
    `Window in days (1-90); defaults to the module setting or 7`,
  "command.music.description": () =>
    `Save tracks in a durable queue and inspect playback readiness.`,
  "command.music.play.description": () =>
    `Ask the playback backend to play; refuses when none is installed.`,
  "command.music.queue.description": () =>
    `Show the saved queue and whether audio is actually playing.`,
  "command.music.add.description": () =>
    `Save a track for later; this never plays audio.`,
  "command.music.remove.description": () =>
    `Remove one saved track by position.`,
  "command.music.clear.description": () =>
    `Clear every saved track. Nothing is left playing.`,
  "command.music.skip.description": () =>
    `Skip the current track; refuses when there is no player.`,
  "command.music.stop.description": () =>
    `Stop playback; refuses when there is no player.`,
  "command.music.status.description": () =>
    `Show module state, queue count and the exact playback blocker.`,
  "command.music.option.query.description": () =>
    `Audio URL to save; playback is unavailable in this build`,
  "command.music.option.title.description": () =>
    `Optional label for the saved track`,
  "command.music.option.position.description": () =>
    `1-based position in the saved queue`,
  "command.form.description": () =>
    `Build application forms, publish a panel and review submissions.`,
  "command.form.create.description": () =>
    `Create a draft form from a comma-separated field list.`,
  "command.form.edit.description": () =>
    `Change a form's name, description, fields or draft/open/closed state.`,
  "command.form.delete.description": () =>
    `Delete a form that has no submissions; history is never deleted.`,
  "command.form.list.description": () =>
    `List forms with state, submission counts and panel channel.`,
  "command.form.panel.description": () =>
    `Post the application panel for an open form in this channel.`,
  "command.form.submit.description": () =>
    `Submit answers to an open form; one pending submission per member.`,
  "command.form.review.description": () =>
    `List pending submissions, read one, or accept/deny it.`,
  "command.form.export.description": () =>
    `Download forms and submissions as a checksummed JSON file.`,
  "command.form.option.name.description": () =>
    `Form name shown on the panel`,
  "command.form.option.key.description": () =>
    `Stable slug; defaults from the name`,
  "command.form.option.description.description": () =>
    `Short introduction shown on the panel`,
  "command.form.option.fields.description": () =>
    `Comma-separated key:Label pairs, e.g. why:Why join, tz:Timezone`,
  "command.form.option.form.description": () =>
    `Form key or id`,
  "command.form.option.state.description": () =>
    `Draft hides the panel; open accepts; closed keeps history`,
  "command.form.option.confirm.description": () =>
    `Repeat the form key to confirm deletion`,
  "command.form.option.answers.description": () =>
    `key=value pairs separated by ; or newlines`,
  "command.form.option.submission.description": () =>
    `Submission id; omit to list the pending queue`,
  "command.form.option.decision.description": () =>
    `Accept or deny the selected submission`,
  "command.form.option.note.description": () =>
    `Decision note stored on the submission`,
  "command.event.description": () =>
    `Create guild events, take RSVPs, post reminders and export attendance.`,
  "command.event.create.description": () =>
    `Create a draft event with a start time and optional capacity.`,
  "command.event.edit.description": () =>
    `Change an event's details, capacity or draft/open/closed state.`,
  "command.event.delete.description": () =>
    `Delete an event that has no RSVPs; attendance history is never deleted.`,
  "command.event.list.description": () =>
    `List events with state, start time and RSVP counts.`,
  "command.event.rsvp.description": () =>
    `Record your own going or not-going answer; one RSVP per member.`,
  "command.event.remind.description": () =>
    `Post a reminder for an open event and record who sent it.`,
  "command.event.export.description": () =>
    `Download events and RSVPs as a checksummed JSON file.`,
  "command.event.option.name.description": () =>
    `Event name shown in the list`,
  "command.event.option.key.description": () =>
    `Stable slug; defaults from the name`,
  "command.event.option.description.description": () =>
    `Short description shown on the event`,
  "command.event.option.starts.description": () =>
    `Start, e.g. 2026-11-05T18:00:00Z`,
  "command.event.option.ends.description": () =>
    `Optional end, same format as starts`,
  "command.event.option.location.description": () =>
    `Where it happens: a channel, an address or voice stage`,
  "command.event.option.capacity.description": () =>
    `Maximum going; 0 means unlimited`,
  "command.event.option.event.description": () =>
    `Event key or id`,
  "command.event.option.state.description": () =>
    `Draft is hidden; open takes RSVPs; closed keeps history`,
  "command.event.option.confirm.description": () =>
    `Repeat the event key to confirm deletion`,
  "command.event.option.rsvp.description": () =>
    `Your answer for this event`,
  "command.modmail.description": () =>
    `Private member-to-staff mail: open a thread, reply, close and read transcripts.`,
  "command.modmail.setup.description": () =>
    `Show or change the modmail switches for this server.`,
  "command.modmail.open.description": () =>
    `Open a private thread; only you and staff can read it.`,
  "command.modmail.reply.description": () =>
    `Add a message to your thread, or answer as staff.`,
  "command.modmail.close.description": () =>
    `Close a thread and archive its transcript exactly once.`,
  "command.modmail.transcript.description": () =>
    `Read a thread you own, or any thread as staff.`,
  "command.modmail.stats.description": () =>
    `Staff queue counts read from the modmail tables.`,
  "command.modmail.option.enabled.description": () =>
    `Turn private member mail on or off in this server`,
  "command.modmail.option.max_threads.description": () =>
    `Maximum stored threads for this server`,
  "command.modmail.option.subject.description": () =>
    `What the thread is about`,
  "command.modmail.option.message.description": () =>
    `Your message`,
  "command.modmail.option.thread.description": () =>
    `Thread id shown by /modmail open`,
  "command.modmail.option.resolution.description": () =>
    `Optional closing note stored with the archived transcript`,
} as const;

/** Hand-written German for every key above. */
export const commandCopyDe: typeof commandCopyEn = {
  "command.ping.description": () =>
    `Prüft, ob Keystone erreichbar ist.`,
  "command.about.description": () =>
    `Zeigt, was Keystone ist und wie dieser Server eingerichtet ist.`,
  "command.help.description": () =>
    `Durchsucht alle Keystone-Befehle, die Befehlssuche und die Datenaufbewahrung.`,
  "command.help.browse.description": () =>
    `Listet die Befehlsgruppen nach Modul sortiert auf.`,
  "command.help.commands.description": () =>
    `Zeigt jeden Befehl und seine Unterbefehle.`,
  "command.help.search.description": () =>
    `Findet einen Befehl nach Name, Beschreibung oder Modul.`,
  "command.help.privacy.description": () =>
    `Erklärt, was Keystone speichert und was nicht.`,
  "command.help.changelog.description": () =>
    `Zeigt die aktuelle Version und den letzten Durchgang.`,
  "command.help.option.module.description": () =>
    `Nur ein Modul anzeigen`,
  "command.help.option.query.description": () =>
    `Wort, nach dem gesucht wird`,
  "command.setup.description": () =>
    `Prüft die Betriebsbereitschaft, verwaltet Module, zeigt einen Import als Vorschau oder setzt Einstellungen zurück.`,
  "command.setup.status.description": () =>
    `Prüft Datenbank, Migrationen, Cache und Module.`,
  "command.setup.module.description": () =>
    `Listet Module auf, zeigt eines an oder aktiviert/deaktiviert es.`,
  "command.setup.verify.description": () =>
    `Prüft Einstellungen, Schema-Analyse und den Befehlskatalog.`,
  "command.setup.import.description": () =>
    `Zeigt ein keystone.export-Bundle als Vorschau, bevor /export import es anwendet.`,
  "command.setup.reset.description": () =>
    `Setzt die gespeicherten Einstellungen eines Moduls auf die Schema-Standardwerte zurück.`,
  "command.setup.option.module.description": () =>
    `Modul-ID, zum Beispiel music`,
  "command.setup.option.enabled.description": () =>
    `Aktivierung setzen; weglassen, um ein Modul nur anzusehen`,
  "command.setup.option.bundle.description": () =>
    `Ein keystone.export-Bundle als .json`,
  "command.setup.option.mode.description": () =>
    `Wie eine Anwendung zusammenführen soll`,
  "command.config.description": () =>
    `Prüft und ändert die Einstellungen jedes Moduls für diesen Server über das eigene Schema des Bots.`,
  "command.config.list.description": () =>
    `Listet jedes Modul und ob es hier aktiviert ist.`,
  "command.config.get.description": () =>
    `Zeigt die wirksamen Einstellungen eines Moduls oder einen einzelnen Punkt.`,
  "command.config.set.description": () =>
    `Prüft und schreibt einen einzelnen Punkt; das Zod-Schema des Moduls ist die Prüfung.`,
  "command.config.export.description": () =>
    `Exportiert die wirksamen Einstellungen jedes Moduls als JSON.`,
  "command.config.option.module.description": () =>
    `Modul-ID, zum Beispiel ai oder moderation`,
  "command.config.option.key.description": () =>
    `Einstellungsschlüssel; Punktschreibweise wie automod.links wird unterstützt`,
  "command.config.option.value.description": () =>
    `JSON-Wert, zum Beispiel true, 7, "text" oder ["a","b"]`,
  "command.export.description": () =>
    `Exportiert, prüft oder stellt die Daten dieses Servers wieder her, ohne Discord zu verlassen.`,
  "command.export.guild.description": () =>
    `Lädt das vollständige Server-Bundle mit Einstellungen, Fällen und Verlauf herunter.`,
  "command.export.user.description": () =>
    `Lädt Fälle, Tickets, XP und Ledger-Zeilen eines Mitglieds herunter.`,
  "command.export.import.description": () =>
    `Zeigt ein keystone.export-Bundle als Anhang oder stellt es wieder her.`,
  "command.export.delete.description": () =>
    `Löscht die gespeicherten Daten dieses Servers und hinterlässt eine Quittung mit Zählern.`,
  "command.export.drift.description": () =>
    `Vergleicht gespeicherte Kanal- und Rollen-IDs mit dem laufenden Server.`,
  "command.export.rollback.description": () =>
    `Stellt die Sicherung vor einem angewendeten Import wieder her.`,
  "command.export.option.user.description": () =>
    `Mitglied, dessen Zeilen exportiert werden`,
  "command.export.option.bundle.description": () =>
    `Ein keystone.export-Bundle als .json`,
  "command.export.option.mode.description": () =>
    `replace stellt alles wieder her; merge behält Fälle und Verlauf`,
  "command.export.option.dry_run.description": () =>
    `Standardmäßig nur Vorschau; false schreibt`,
  "command.export.option.confirm.description": () =>
    `Gib die ID dieses Servers ein, um das unwiderrufliche Löschen zu bestätigen`,
  "command.export.option.import_id.description": () =>
    `Die ID, die /export import ausgibt`,
  "command.mod.description": () =>
    `Moderiert Mitglieder, prüft Fälle und bearbeitet die Warteschlange.`,
  "command.mod.ban.description": () =>
    `Bannt ein Mitglied; mit Dauer wird der Bann befristet.`,
  "command.mod.temp-role.description": () =>
    `Vergibt eine Rolle für eine Anzahl Minuten und entfernt sie danach.`,
  "command.mod.panic.description": () =>
    `Sperrt jeden Textkanal oder stellt die letzte Sicherung wieder her.`,
  "command.mod.kick.description": () =>
    `Entfernt ein Mitglied mit Fall und Begründung.`,
  "command.mod.timeout.description": () =>
    `Setzt ein Mitglied für eine Anzahl Minuten stumm.`,
  "command.mod.warn.description": () =>
    `Speichert eine Verwarnung in der Fallhistorie eines Mitglieds.`,
  "command.mod.purge.description": () =>
    `Löscht kürzlich gesendete Nachrichten in einem Kanal gesammelt.`,
  "command.mod.lock.description": () =>
    `Sperrt einen Kanal, sodass Mitglieder nicht mehr schreiben können.`,
  "command.mod.unlock.description": () =>
    `Entsperrt einen Kanal wieder.`,
  "command.mod.slowmode.description": () =>
    `Setzt den Slowmode eines Kanals in Sekunden.`,
  "command.mod.case.description": () =>
    `Zeigt einen Fall nach Nummer.`,
  "command.mod.note.description": () =>
    `Hängt eine Moderationsnotiz an einen Fall an.`,
  "command.mod.history.description": () =>
    `Listet die letzten Fälle auf, optional für ein Mitglied.`,
  "command.mod.links.description": () =>
    `Prüft die letzten Funde des Linkfilters.`,
  "command.mod.filters.description": () =>
    `Prüft Funde von Link-, Schimpfwort- und Zalgo-Filter.`,
  "command.mod.review.description": () =>
    `Zeigt die Prüf-Warteschlange oder schließt einen Fall.`,
  "command.mod.option.user.description": () =>
    `Mitglied, auf das gewirkt wird (oder Filterverlauf)`,
  "command.mod.option.reason.description": () =>
    `Begründung; bei Strafmaßnahmen erforderlich`,
  "command.mod.option.duration.description": () =>
    `Minuten für Bann/Temporolle/Timeout oder Sekunden für Slowmode`,
  "command.mod.option.dry_run.description": () =>
    `Nur Vorschau; überschreibt nie einen sicheren Standardwert`,
  "command.mod.option.role.description": () =>
    `Rolle für eine vorübergehende Rollenvergabe`,
  "command.mod.option.state.description": () =>
    `Schalter für den Panikmodus`,
  "command.mod.option.channel.description": () =>
    `Kanal für Purge, Sperre oder Slowmode`,
  "command.mod.option.limit.description": () =>
    `Anzahl für Purge, 1–100 (Standard 10)`,
  "command.mod.option.case.description": () =>
    `Fallnummer für case, note oder review`,
  "command.appeal.description": () =>
    `Legt Einspruch gegen einen Fall gegen dich ein oder prüft den Status eines Einspruchs.`,
  "command.appeal.open.description": () =>
    `Legt Einspruch gegen einen Moderationsfall gegen dich ein.`,
  "command.appeal.status.description": () =>
    `Liest deine Einspruchsereignisse und den aktuellen Fallstatus.`,
  "command.appeal.option.case.description": () =>
    `Fallnummer, gegen die Einspruch eingelegt wird`,
  "command.appeal.option.message.description": () =>
    `Warum der Fall überprüft werden sollte`,
  "command.verify.description": () =>
    `Startet die Beitrittsprüfung oder prüft deinen gespeicherten Verifizierungsstatus.`,
  "command.verify.start.description": () =>
    `Schickt dir den Verifizierungs-Button per Direktnachricht.`,
  "command.verify.status.description": () =>
    `Liest deinen gespeicherten Verifizierungs- und Quarantänestatus.`,
  "command.rank.description": () =>
    `Zeigt Level, Ranglisten, Belohnungen, Währung, Shop und Überweisungen.`,
  "command.rank.view.description": () =>
    `Zeigt dein Level und deine XP oder die eines anderen Mitglieds.`,
  "command.rank.leaderboard.description": () =>
    `Zeigt die XP-Rangliste des Servers.`,
  "command.rank.rewards.description": () =>
    `Listet Rollen-Belohnungen für Level auf oder setzt sie.`,
  "command.rank.admin.description": () =>
    `Setzt das Level eines Mitglieds direkt.`,
  "command.rank.balance.description": () =>
    `Zeigt das Währungsguthaben eines Mitglieds.`,
  "command.rank.daily.description": () =>
    `Holt deine tägliche Währung ab.`,
  "command.rank.pay.description": () =>
    `Sendet Währung an ein anderes Mitglied.`,
  "command.rank.shop.description": () =>
    `Listet den Währungsshop des Servers auf.`,
  "command.rank.buy.description": () =>
    `Kauft einen Artikel aus dem Shop.`,
  "command.rank.gamble.description": () =>
    `Setzt Währung mit begrenztem Einsatz.`,
  "command.rank.ledger.description": () =>
    `Zeigt deine letzten Währungsbewegungen.`,
  "command.rank.season.description": () =>
    `Startet eine neue XP-Saison und archiviert die alte.`,
  "command.rank.option.user.description": () =>
    `Mitglied, das angesehen oder bezahlt wird`,
  "command.rank.option.limit.description": () =>
    `Anzahl der Zeilen`,
  "command.rank.option.value.description": () =>
    `Belohnungen, Saison-Schlüssel oder Status`,
  "command.rank.option.level.description": () =>
    `Level für Admin-Änderungen`,
  "command.rank.option.amount.description": () =>
    `Münzen zum Überweisen oder Setzen`,
  "command.rank.option.item.description": () =>
    `Shop-Artikel-ID`,
  "command.rank.option.days.description": () =>
    `Saisonlänge in Tagen`,
  "command.ticket.description": () =>
    `Öffnet, übernimmt, schließt und analysiert private Support-Threads.`,
  "command.ticket.panel.description": () =>
    `Veröffentlicht ein Ticket-Panel in einem Kanal.`,
  "command.ticket.open.description": () =>
    `Öffnet einen privaten Support-Thread.`,
  "command.ticket.claim.description": () =>
    `Übernimmt ein Ticket für den Support.`,
  "command.ticket.close.description": () =>
    `Schließt ein Ticket und archiviert seinen Thread.`,
  "command.ticket.add.description": () =>
    `Fügt ein Mitglied zu einem Ticket hinzu.`,
  "command.ticket.transcript.description": () =>
    `Zeigt ein Ticket-Transkript als Text.`,
  "command.ticket.summary.description": () =>
    `Fasst ein Ticket mit der KI-Schnittstelle zusammen.`,
  "command.ticket.stats.description": () =>
    `Zeigt serverweite Ticket-Zähler und die Schließzeit.`,
  "command.ticket.option.channel.description": () =>
    `Panel- oder Ausgangskanal`,
  "command.ticket.option.title.description": () =>
    `Titel des Panels`,
  "command.ticket.option.subject.description": () =>
    `Betreff des Tickets`,
  "command.ticket.option.ticket.description": () =>
    `Ticket-ID (standardmäßig dieser Thread)`,
  "command.ticket.option.user.description": () =>
    `Mitglied, das hinzugefügt wird`,
  "command.tools.description": () =>
    `Community-Werkzeuge: Geburtstage, Vorschläge, Inhalte, Rollen, Gewinnspiele, Feeds und Auto-Antworten.`,
  "command.tools.embed.description": () =>
    `Sendet einen einfachen Embed in einen Kanal.`,
  "command.tools.tag.description": () =>
    `Zeigt einen Tag an oder speichert einen für diesen Server.`,
  "command.tools.reminder.description": () =>
    `Stellt dir selbst eine Erinnerung.`,
  "command.tools.schedule.description": () =>
    `Plant eine Nachricht für einen Kanal.`,
  "command.tools.giveaway.description": () =>
    `Startet ein Gewinnspiel in einem Kanal.`,
  "command.tools.giveaway-end.description": () =>
    `Beendet ein Gewinnspiel jetzt und zieht Gewinner.`,
  "command.tools.giveaway-reroll.description": () =>
    `Zieht die Gewinner eines beendeten Gewinnspiels neu.`,
  "command.tools.poll.description": () =>
    `Veröffentlicht eine Umfrage mit durch Striche getrennten Optionen.`,
  "command.tools.feed.description": () =>
    `Abonniert einen RSS-Feed für einen Kanal.`,
  "command.tools.stat.description": () =>
    `Erstellt einen Statistik-Kanal für Mitglieder, Online-Zahl oder Booster.`,
  "command.tools.welcome.description": () =>
    `Richtet die Willkommensnachricht und die automatische Rolle ein.`,
  "command.tools.goodbye.description": () =>
    `Richtet die Abschiedsnachricht für austretende Mitglieder ein.`,
  "command.tools.roles.description": () =>
    `Veröffentlicht ein Reaktionsrollen- oder Auswahlrollen-Panel.`,
  "command.tools.starboard.description": () =>
    `Richtet Starboard-Kanal und Schwellenwert ein.`,
  "command.tools.starboard-override.description": () =>
    `Setzt einen Starboard-Schwellenwert pro Kanal oder schaltet ihn aus.`,
  "command.tools.voice.description": () =>
    `Richtet den temporären Sprach-Hub ein.`,
  "command.tools.birthdays.description": () =>
    `Richtet Geburtstagsankündigungen ein.`,
  "command.tools.birthday.description": () =>
    `Speichert oder entfernt den Geburtstag eines Mitglieds.`,
  "command.tools.suggestions.description": () =>
    `Richtet den Vorschlagskanal ein.`,
  "command.tools.suggestion.description": () =>
    `Reicht einen Vorschlag ein.`,
  "command.tools.suggestion-decide.description": () =>
    `Nimmt einen Vorschlag an oder lehnt ihn ab.`,
  "command.tools.sticky.description": () =>
    `Richtet eine angeheftete Nachricht in einem Kanal ein.`,
  "command.tools.responder.description": () =>
    `Erstellt oder aktualisiert einen Auto-Antwort-Auslöser.`,
  "command.tools.responders.description": () =>
    `Listet Auto-Antworten auf oder aktiviert/deaktiviert sie.`,
  "command.tools.responder-remove.description": () =>
    `Entfernt eine Auto-Antwort nach ID.`,
  "command.tools.option.channel.description": () =>
    `Ziel- oder Ausgangskanal`,
  "command.tools.option.name.description": () =>
    `Name, Titel, Frage oder ID`,
  "command.tools.option.value.description": () =>
    `Text, Optionen, Datum, URL oder Status`,
  "command.tools.option.duration.description": () =>
    `Minuten ab jetzt`,
  "command.tools.option.limit.description": () =>
    `Gewinner, Schwellenwert oder Verzögerung`,
  "command.tools.option.url.description": () =>
    `Feed-URL`,
  "command.tools.option.role.description": () =>
    `Rolle für Willkommen oder Reaktionsrollen`,
  "command.tools.option.target.description": () =>
    `Zielkanal überschreiben`,
  "command.tools.option.user.description": () =>
    `Zielmitglied`,
  "command.tools.option.match.description": () =>
    `Vergleichsmodus der Auto-Antwort`,
  "command.ai.description": () =>
    `Fragt Server-Dokumente ab, fängt Tickets ab und erklärt Moderation. Aus, bis es aktiviert wird.`,
  "command.ai.status.description": () =>
    `Zeigt KI-Funktionen, Nutzung und gespeicherte Daten.`,
  "command.ai.ask.description": () =>
    `Beantwortet eine Frage aus den Dokumenten dieses Servers.`,
  "command.ai.chat.description": () =>
    `Fragt das Modell direkt in diesem Kanal.`,
  "command.ai.classify.description": () =>
    `Markiert eine Nachricht als Hinweis für die beratende Automatisierung.`,
  "command.ai.docs-add.description": () =>
    `Indiziert ein Server-Dokument für Antworten.`,
  "command.ai.docs-list.description": () =>
    `Listet indizierte Server-Dokumente auf.`,
  "command.ai.docs-remove.description": () =>
    `Entfernt ein indiziertes Server-Dokument.`,
  "command.ai.deflect.description": () =>
    `Schlägt eine Antwort auf eine Support-Frage vor.`,
  "command.ai.explain.description": () =>
    `Erklärt, warum ein Moderationsfall entstanden ist.`,
  "command.ai.summary.description": () =>
    `Fasst einen Ticket-Thread zusammen.`,
  "command.ai.budget.description": () =>
    `Setzt das monatliche KI-Budget und das Anfrage-Limit.`,
  "command.ai.option.question.description": () =>
    `Frage an die Server-Dokumente`,
  "command.ai.option.value.description": () =>
    `Antwort, Dokumentinhalt, Chat-Text oder Budget`,
  "command.ai.option.name.description": () =>
    `Dokumentname`,
  "command.ai.option.case.description": () =>
    `Fallnummer, die erklärt werden soll`,
  "command.ai.option.ticket.description": () =>
    `Ticket-ID, die zusammengefasst werden soll`,
  "command.ai.option.limit.description": () =>
    `Monatliches Anfrage-Limit`,
  "command.invites.description": () =>
    `Einladungs-Rangliste, deine Einladungsstatistik und wer ein Mitglied eingeladen hat.`,
  "command.invites.leaderboard.description": () =>
    `Zeigt, wer die meisten Mitglieder gebracht hat.`,
  "command.invites.stats.description": () =>
    `Zeigt Beitritte und Verbleib eines Mitglieds.`,
  "command.invites.who.description": () =>
    `Zeigt, wer ein Mitglied eingeladen hat, und beratende Hinweise.`,
  "command.invites.option.limit.description": () =>
    `Zeilen der Rangliste`,
  "command.invites.option.user.description": () =>
    `Mitglied, das geprüft wird (standardmäßig du)`,
  "command.logging.description": () =>
    `Protokolliert Nachrichten-, Mitglieder- und Moderationsereignisse in einem Audit-Kanal.`,
  "command.logging.setup.description": () =>
    `Setzt den Log-Kanal, aktiviert die Protokollierung und sendet eine Testnachricht.`,
  "command.logging.channel.description": () =>
    `Ändert den Log-Kanal oder leert ihn, indem die Option weggelassen wird.`,
  "command.logging.events.description": () =>
    `Listet Ereignisschalter auf oder schaltet einen Ereignistyp ein oder aus.`,
  "command.logging.status.description": () =>
    `Zeigt Kanal, Ereignisschalter, Aufbewahrung und gespeicherte Anzahl.`,
  "command.logging.retention.description": () =>
    `Setzt die Aufbewahrung in Tagen und entfernt danach ältere Zeilen.`,
  "command.logging.export.description": () =>
    `Exportiert Einstellungen und die zehn neuesten Ereignisse als JSON.`,
  "command.logging.disable.description": () =>
    `Beendet Erfassung und Zustellung von Ereignissen; die Konfiguration bleibt.`,
  "command.logging.option.channel.description": () =>
    `Kanal, der Audit-Ereignisse erhält`,
  "command.logging.option.event.description": () =>
    `Ereignistyp zum Ansehen oder Ändern`,
  "command.logging.option.enabled.description": () =>
    `Ausgewähltes Ereignis ein- oder ausschalten`,
  "command.logging.option.days.description": () =>
    `Aufbewahrungsdauer in Tagen (1–365)`,
  "command.analytics.description": () =>
    `Nur lesende Server-Analysen aus den eigenen Logs, Fällen, Einladungen, Tickets und Befehlsnutzungen des Bots.`,
  "command.analytics.overview.description": () =>
    `Zusammenfassung des gewählten Zeitraums auf einer Seite.`,
  "command.analytics.members.description": () =>
    `Beitritte, Austritte, Einladungszuordnung und Verbleib.`,
  "command.analytics.messages.description": () =>
    `Protokollierte Nachrichtenlöschungen, Bearbeitungen und Inhaltsfilter-Fälle.`,
  "command.analytics.commands.description": () =>
    `Befehlsausführungen, Ergebnisse und durchschnittliche Latenz.`,
  "command.analytics.tickets.description": () =>
    `Ticket-Zähler, offener Status und Schließzeiten.`,
  "command.analytics.export.description": () =>
    `Exportiert die Momentaufnahme als JSON in einem Embed.`,
  "command.analytics.option.days.description": () =>
    `Zeitraum in Tagen (1–90); Standard ist die Moduleinstellung oder 7`,
  "command.music.description": () =>
    `Speichert Titel in einer dauerhaften Warteschlange und prüft die Wiedergabebereitschaft.`,
  "command.music.play.description": () =>
    `Fordert die Wiedergabe an; verweigert, wenn keine installiert ist.`,
  "command.music.queue.description": () =>
    `Zeigt die gespeicherte Warteschlange und ob Audio wirklich läuft.`,
  "command.music.add.description": () =>
    `Speichert einen Titel für später; dies spielt nie Audio ab.`,
  "command.music.remove.description": () =>
    `Entfernt einen gespeicherten Titel nach Position.`,
  "command.music.clear.description": () =>
    `Leert alle gespeicherten Titel. Es bleibt nichts am Laufen.`,
  "command.music.skip.description": () =>
    `Überspringt den aktuellen Titel; verweigert, wenn kein Player läuft.`,
  "command.music.stop.description": () =>
    `Stoppt die Wiedergabe; verweigert, wenn kein Player läuft.`,
  "command.music.status.description": () =>
    `Zeigt Modulstatus, Warteschlangenlänge und den genauen Wiedergabeblocker.`,
  "command.music.option.query.description": () =>
    `Audio-URL zum Speichern; Wiedergabe ist in diesem Build nicht verfügbar`,
  "command.music.option.title.description": () =>
    `Optionale Bezeichnung für den gespeicherten Titel`,
  "command.music.option.position.description": () =>
    `1-basierte Position in der gespeicherten Warteschlange`,
  "command.form.description": () =>
    `Erstellt Bewerbungsformulare, veröffentlicht ein Panel und prüft Einsendungen.`,
  "command.form.create.description": () =>
    `Erstellt ein Formular im Entwurf aus einer kommagetrennten Feldliste.`,
  "command.form.edit.description": () =>
    `Ändert Name, Beschreibung, Felder oder Status eines Formulars.`,
  "command.form.delete.description": () =>
    `Löscht ein Formular ohne Einsendungen; der Verlauf bleibt erhalten.`,
  "command.form.list.description": () =>
    `Listet Formulare mit Status, Einsendungen und Panel-Kanal.`,
  "command.form.panel.description": () =>
    `Veröffentlicht das Bewerbungs-Panel für ein offenes Formular in diesem Kanal.`,
  "command.form.submit.description": () =>
    `Reicht Antworten für ein offenes Formular ein; eine offene Einsendung pro Mitglied.`,
  "command.form.review.description": () =>
    `Listet offene Einsendungen, liest eine oder nimmt sie an bzw. lehnt sie ab.`,
  "command.form.export.description": () =>
    `Lädt Formulare und Einsendungen als JSON-Datei mit Prüfsumme herunter.`,
  "command.form.option.name.description": () =>
    `Formularname, der im Panel angezeigt wird`,
  "command.form.option.key.description": () =>
    `Stabiler Slug; wird aus dem Namen abgeleitet`,
  "command.form.option.description.description": () =>
    `Kurze Einleitung, die im Panel angezeigt wird`,
  "command.form.option.fields.description": () =>
    `Kommagetrennte key:Label-Paare, z. B. why:Warum, tz:Zeitzone`,
  "command.form.option.form.description": () =>
    `Formularschlüssel oder ID`,
  "command.form.option.state.description": () =>
    `Entwurf verbirgt das Panel; offen nimmt an; geschlossen behält den Verlauf`,
  "command.form.option.confirm.description": () =>
    `Formularschlüssel zur Bestätigung der Löschung wiederholen`,
  "command.form.option.answers.description": () =>
    `key=value-Paare, getrennt durch ; oder Zeilenumbrüche`,
  "command.form.option.submission.description": () =>
    `Einsendungs-ID; weglassen, um die offene Warteschlange zu sehen`,
  "command.form.option.decision.description": () =>
    `Einsendung annehmen oder ablehnen`,
  "command.form.option.note.description": () =>
    `Entscheidungsnotiz zur Einsendung`,
  "command.event.description": () =>
    `Erstellt Server-Events, nimmt Zusagen an, postet Erinnerungen und exportiert die Teilnahme.`,
  "command.event.create.description": () =>
    `Erstellt einen Entwurf mit Startzeit und optionaler Kapazität.`,
  "command.event.edit.description": () =>
    `Ändert Details, Kapazität oder den Status Entwurf/offen/geschlossen eines Events.`,
  "command.event.delete.description": () =>
    `Löscht ein Event ohne Zusagen; die Teilnahmehistorie bleibt erhalten.`,
  "command.event.list.description": () =>
    `Listet Events mit Status, Startzeit und Zusagen auf.`,
  "command.event.rsvp.description": () =>
    `Speichert deine eigene Zusage oder Absage; eine Antwort pro Mitglied.`,
  "command.event.remind.description": () =>
    `Postet eine Erinnerung für ein offenes Event und notiert, wer sie gesendet hat.`,
  "command.event.export.description": () =>
    `Lädt Events und Zusagen als JSON-Datei mit Prüfsumme herunter.`,
  "command.event.option.name.description": () =>
    `Eventname, der in der Liste erscheint`,
  "command.event.option.key.description": () =>
    `Stabiler Slug; wird aus dem Namen abgeleitet`,
  "command.event.option.description.description": () =>
    `Kurze Beschreibung, die beim Event erscheint`,
  "command.event.option.starts.description": () =>
    `Start, z. B. 2026-11-05T18:00:00Z`,
  "command.event.option.ends.description": () =>
    `Optionales Ende im selben Format wie starts`,
  "command.event.option.location.description": () =>
    `Wo es stattfindet: ein Kanal, eine Adresse oder eine Sprachbühne`,
  "command.event.option.capacity.description": () =>
    `Maximale Zusagen; 0 bedeutet unbegrenzt`,
  "command.event.option.event.description": () =>
    `Event-Schlüssel oder ID`,
  "command.event.option.state.description": () =>
    `Entwurf ist verborgen; offen nimmt Zusagen an; geschlossen behält den Verlauf`,
  "command.event.option.confirm.description": () =>
    `Event-Schlüssel zur Bestätigung der Löschung wiederholen`,
  "command.event.option.rsvp.description": () =>
    `Deine Antwort für dieses Event`,
  "command.modmail.description": () =>
    `Private Nachrichten von Mitgliedern an das Team: Thread öffnen, antworten, schließen und Transkripte lesen.`,
  "command.modmail.setup.description": () =>
    `Zeigt oder ändert die Modmail-Schalter für diesen Server.`,
  "command.modmail.open.description": () =>
    `Öffnet einen privaten Thread; nur du und das Team können ihn lesen.`,
  "command.modmail.reply.description": () =>
    `Fügt deinem Thread eine Nachricht hinzu oder antwortet als Team.`,
  "command.modmail.close.description": () =>
    `Schließt einen Thread und archiviert sein Transkript genau einmal.`,
  "command.modmail.transcript.description": () =>
    `Liest einen eigenen Thread oder als Team jeden Thread.`,
  "command.modmail.stats.description": () =>
    `Zähler der Team-Warteschlange aus den Modmail-Tabellen.`,
  "command.modmail.option.enabled.description": () =>
    `Private Mitgliedernachrichten auf diesem Server ein- oder ausschalten`,
  "command.modmail.option.max_threads.description": () =>
    `Maximale Anzahl gespeicherter Threads für diesen Server`,
  "command.modmail.option.subject.description": () =>
    `Worum es im Thread geht`,
  "command.modmail.option.message.description": () =>
    `Deine Nachricht`,
  "command.modmail.option.thread.description": () =>
    `Thread-ID, die /modmail open anzeigt`,
  "command.modmail.option.resolution.description": () =>
    `Optionale Abschlussnotiz, die mit dem archivierten Transkript gespeichert wird`,
};
