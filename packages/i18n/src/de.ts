import { commandCopyDe } from "./command-copy";

import type { Catalog } from "./messages";

/**
 * German. Hand-written and limited to the surfaces this pass ships, so no
 * unreachable key is promised and no machine translation is presented as
 * reviewed prose. A key that is not here falls back to English, never to its
 * own name.
 */
export const de: Catalog = {
  "component.expired": () => "Dieses Panel ist abgelaufen. Führe den Befehl erneut aus.",
  "component.noPermission": () => "Du hast keine Berechtigung, diesen Button zu verwenden.",
  "component.guildOnly": () => "Dieses Element funktioniert nur innerhalb eines Servers.",

  "form.panel.questions": () => "**Fragen**",
  "form.panel.apply": () => "Bewerben",
  "form.panel.review": () => "Bewerbungen prüfen",
  "form.panel.hint": () =>
    "Klicke auf **Bewerben**, um in einem Formular zu antworten. Eine offene Bewerbung pro Mitglied.",
  "form.panel.tooMany": (count, key) =>
    `Dieses Formular hat ${count} Fragen; Discord-Modals fassen 5. Nutze stattdessen \`/form submit form:${key}\`.`,
  "form.apply.noModal": () =>
    "Dieser Client kann kein Formular öffnen. Nutze stattdessen `/form submit`.",
  "form.apply.tooMany": (count, key, hints) =>
    `Dieses Formular hat ${count} Fragen und ein Discord-Modal fasst fünf. Reiche es mit \`/form submit form:${key} answers:"${hints}"\` ein.`,
  "form.panel.privacy": () =>
    "Antworten werden auf diesem Server gespeichert und nur von Team-Mitgliedern gelesen.",
  "form.panel.description": (name) =>
    `Bewerbungen für **${name}** sind offen. Das Team prüft jede Einsendung.`,
  "form.errors.missing": (fields) =>
    `${fields.includes(",") ? "Pflichtfelder fehlen" : "Pflichtfeld fehlt"}: ${fields}.`,
  "form.submit.received": (id, answers) =>
    `Einsendung erhalten · \`${id}\` · ${answers} Antwort${answers === 1 ? "" : "en"}. Das Team prüft sie; reiche nicht erneut ein, solange sie offen ist.`,
  "form.review.empty": (key) =>
    `Keine offenen Bewerbungen für \`${key}\`. Prüfe abgeschlossene mit \`/form review\`.`,
  "form.review.row": (id, key, userId, answers) =>
    `\`${id}\` · ${key} · <@${userId}> · ${answers} Antwort${answers === 1 ? "" : "en"}`,
  "form.review.pending": (count, key, lines) =>
    `${count} offene Bewerbung${count === 1 ? "" : "en"} für \`${key}\`:\n${lines}\nEntscheide mit \`/form review submission:<id> decision:accept|deny\`.`,

  "rank.line": (level, xp, rank) =>
    `Level **${level}** · **${xp} XP**${rank ? ` · Rang **#${rank}**` : ""}`,
  "rank.footer": () =>
    "Rangkarte · Level sind gespeicherte XP-Zeilen, kein Bild-Rendering.",

  "ticket.panel.title": () => "Support-Tickets",
  "ticket.panel.description": () =>
    "Öffne einen privaten Thread mit dem Support-Team. Ein Ticket pro offenem Anliegen.",
  "ticket.panel.open": () => "Ticket öffnen",
  "ticket.panel.wrongGuild": () => "Dieses Panel gehört zu einem anderen Server.",
  "ticket.open.reply": (channelId) => `Ticket in <#${channelId}> geöffnet.`,
  "ticket.open.subject": () => "Support-Anfrage",
  "ticket.open.noChannel": () => "Öffne ein Ticket aus einem Server-Kanal.",
  "ticket.open.tooMany": (count, max) =>
    `Du hast bereits ${count} offene${count === 1 ? "s" : ""} Ticket${count === 1 ? "" : "s"} (Limit ${max}). Schließe eines, bevor du ein neues öffnest.`,

  "error.guildOnly": () => "Dieser Befehl funktioniert nur in einem Server.",
  "error.permission": (permission) => `Dafür brauchst du die Berechtigung ${permission}.`,

  "ping.reply": (uptime) => `Pong! Keystone ist seit ${uptime} online.`,
  "about.description": () =>
    "Ein quelloffener All-in-One-Discord-Bot, der alles erklärt. Für immer kostenlos; keine Funktion wandert hinter eine Bezahlschranke.",
  "about.field.version": () => "Version",
  "about.field.module": () => "Modul",
  "about.field.enabled": () => "Hier aktiviert",
  "about.enabled.yes": () => "ja",
  "about.enabled.no": () => "nein",
  "about.field.learn": () => "So funktioniert es",
  "about.footer": () => "Einstellungen werden vom Zod-Schema dieses Moduls geprüft.",

  "help.catalogMissing": () => "Der Befehlskatalog ist in diesem Prozess nicht verbunden.",
  "help.noModule": (moduleId) => `Kein Modul namens \`${moduleId}\` ist registriert.`,
  "help.browse.title": () => "Keystone-Befehle",
  "help.browse.description": (roots, subcommands) =>
    `${roots} Befehle · ${subcommands} Unterbefehle. Wähle einen Befehl und dann einen Unterbefehl. Nutze \`/help commands\` für die vollständige Liste.`,
  "help.browse.contextHint": () => " Kontextmenüs findest du per Rechtsklick → Apps.",
  "help.commands.title": () => "Befehlskatalog",
  "help.commands.description": (roots, subcommands) =>
    `${roots} Befehle · ${subcommands} Unterbefehle. Tippe \`/\` und wähle einen Befehl, um diese Aktionen zu sehen.`,
  "help.commands.footer.limit": (shown, total) =>
    `Zeigt ${shown} von ${total} Befehlen; filtere mit /help browse module:id.`,
  "help.commands.footer.generated": () =>
    "Aus der laufenden Registry erzeugt, nie eine handgepflegte Liste.",
  "help.root.name": (name, subcommands) => `/${name} · ${subcommands} Unterbefehle`,
  "help.search.noQuery": () => "Gib ein Wort zum Suchen an.",
  "help.search.empty": (query) =>
    `Kein Befehl passt zu \`${query}\`. Versuche \`/help browse\`.`,
  "help.search.matches": (query, lines) => `Treffer für \`${query}\`:\n${lines}`,
  "help.privacy.title": () => "Daten und Datenschutz",
  "help.privacy.body": () =>
    "Keystone speichert Server-Konfiguration, Fälle, Tickets, Level, Ledger-Zeilen, Einladungsbeitritte und KI-Nutzungszähler.\n\nPrompts und Antworten werden standardmäßig **nicht** gespeichert. Nachrichteninhalt wird nur gespeichert, wenn eine Funktion ohne ihn nicht arbeiten kann, etwa ein Ticket-Transkript.\n\nJeder gespeicherte Bereich hat ein Aufbewahrungsfenster in `memory/vault/01-Mission/Master-Plan.md`.\n\n`/export guild` und `/export delete` sind der Weg zur Datenübertragbarkeit; eine Löschquittung behält Zähler, nicht Inhalte.",
  "help.changelog.title": () => "Keystone-Changelog",
  "help.changelog.latest": (version, pass) => `**${version}** · zuletzt: ${pass}`,
  "help.changelog.entry": (pass, date, summary) => `**${pass}** (${date}) — ${summary}`,
  "help.unknown": () => "Unbekannte Hilfe-Aktion. Nutze /help browse.",

  "rank.card.noTarget": () => "Dieses Menü enthielt kein Mitglied.",
  "rank.leaderboard.title": () => "XP-Rangliste",
  "rank.leaderboard.empty": () => "Noch keine XP gespeichert.",
  "rank.leaderboard.row": (position, userId, level, xp) =>
    `${position}. <@${userId}> — Level ${level} (${xp} XP)`,
  "rank.rewards.empty": () => "Keine Rollen-Belohnungen eingerichtet.",
  "rank.rewards.row": (level, roleId) => `Level ${level}: <@&${roleId}>`,
  "rank.rewards.invalid": () => "Belohnungen sehen so aus: `5:123456789,10:987654321`.",
  "rank.rewards.updated": () => "XP-Rollen-Belohnungen aktualisiert.",
  "rank.admin.missing": () => "Admin braucht ein Mitglied und ein Level.",
  "rank.admin.updated": (target, level, xp) =>
    `<@${target}> ist jetzt Level ${level} mit ${xp} XP.`,
  "rank.balance": (target, balance, currency) =>
    `<@${target}> hat **${balance} ${currency}**.`,
  "rank.daily.ok": (amount, currency, balance) =>
    `Du hast **${amount} ${currency}** abgeholt. Guthaben: **${balance}**.`,
  "rank.daily.failed": (reason, balance) => `${reason} Guthaben: **${balance}**.`,
  "rank.daily.balance": (balance) => `Guthaben: **${balance}**.`,
  "rank.pay.missing": () => "Zahlen braucht ein Mitglied und einen Betrag.",
  "rank.pay.ok": (amount, currency, target) =>
    `**${amount} ${currency}** an <@${target}> gesendet.`,
  "rank.shop.title": (currency) => `${currency}-Shop`,
  "rank.shop.empty": () => "Der Shop ist leer.",
  "rank.shop.item": (name, price, id) => `**${name}** — ${price} (ID: \`${id}\`)`,
  "rank.shop.itemWithDescription": (name, price, id, description) =>
    `**${name}** — ${price} (ID: \`${id}\`)\n${description}`,
  "rank.buy.missingItem": () => "Nenne den Shop-Artikel, der gekauft werden soll.",
  "rank.buy.ok": (name, balance) => `**${name}** gekauft. Guthaben: **${balance}**.`,
  "rank.gamble.missingAmount": () => "Nenne den Betrag, der gesetzt werden soll.",
  "rank.gamble.won": (amount, balance) =>
    `Du hast **${amount}** gewonnen. Guthaben: **${balance}**.`,
  "rank.gamble.lost": (amount, balance) =>
    `Du hast **${amount}** verloren. Guthaben: **${balance}**.`,
  "rank.ledger.title": () => "Dein Ledger",
  "rank.ledger.empty": () => "Noch keine Bewegungen.",
  "rank.season.already": (key) =>
    `Saison **${key}** wurde bereits gestartet; es wurden keine Profile erneut archiviert.`,
  "rank.season.started": (key, archived) =>
    `Saison **${key}** gestartet. **${archived}** Profil(e) archiviert; das XP-Ledger bleibt erhalten.`,

  "ticket.panel.noChannel": () => "Wähle einen Kanal für das Panel.",
  "ticket.panel.noSigner": () =>
    "Interaktive Panels sind auf diesem Bot nicht eingerichtet.",
  "ticket.panel.posted": (messageId) => `Ticket-Panel veröffentlicht (${messageId}).`,
  "ticket.open.noChannelHere": () =>
    "Öffne ein Ticket aus einem normalen Kanal, nicht aus einer Direktnachricht.",
  "ticket.stats.title": () => "Ticket-Statistik",
  "ticket.stats.body": (open, claimed, closed, average) =>
    `Offen **${open}** · Übernommen **${claimed}** · Geschlossen **${closed}**\nDurchschnittliche Schließzeit: **${average} Minuten**`,
  "ticket.missingThread": () =>
    "Nutze dies in einem Ticket-Thread oder gib eine Ticket-ID an.",
  "ticket.claim.done": (id) => `Ticket ${id} übernommen.`,
  "ticket.close.missing": () => "Dieses Ticket existiert nicht.",
  "ticket.close.notAllowed": () =>
    "Nur die eröffnende Person oder ein Support-Mitglied kann dieses Ticket schließen.",
  "ticket.close.done": (id) => `Ticket ${id} geschlossen.`,
  "ticket.add.missing": () => "Wähle ein Mitglied zum Hinzufügen.",
  "ticket.add.done": (userId) => `<@${userId}> hinzugefügt.`,
  "ticket.summary.noAi": () => "KI-Dienste sind nicht verbunden.",
  "ticket.summary.title": () => "Ticket-Zusammenfassung",
  "ticket.summary.body": (summary) =>
    `${summary}\n\nKI kann sich irren. Über jede Aktion entscheidet ein Mensch.`,
  "ticket.summary.model": (model) => `Modell ${model}`,

  ...commandCopyDe,
};
