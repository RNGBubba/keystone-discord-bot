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

  "command.ping.description": () => "Prüft, ob Keystone erreichbar ist.",
  "command.about.description": () =>
    "Zeigt, was Keystone ist und wie dieser Server eingerichtet ist.",
  "command.form.description": () =>
    "Erstellt Bewerbungsformulare, veröffentlicht ein Panel und prüft Einsendungen.",
  "command.form.create.description": () =>
    "Erstellt ein Formular im Entwurf aus einer kommagetrennten Feldliste.",
  "command.form.edit.description": () =>
    "Ändert Name, Beschreibung, Felder oder Status eines Formulars.",
  "command.form.delete.description": () =>
    "Löscht ein Formular ohne Einsendungen; der Verlauf bleibt erhalten.",
  "command.form.list.description": () =>
    "Listet Formulare mit Status, Einsendungen und Panel-Kanal.",
  "command.form.panel.description": () =>
    "Veröffentlicht das Bewerbungs-Panel für ein offenes Formular in diesem Kanal.",
  "command.form.submit.description": () =>
    "Reicht Antworten für ein offenes Formular ein; eine offene Einsendung pro Mitglied.",
  "command.form.review.description": () =>
    "Listet offene Einsendungen, liest eine oder nimmt sie an bzw. lehnt sie ab.",
  "command.form.export.description": () =>
    "Lädt Formulare und Einsendungen als JSON-Datei mit Prüfsumme herunter.",
  "command.form.option.name.description": () => "Formularname, der im Panel angezeigt wird",
  "command.form.option.key.description": () => "Stabiler Slug; wird aus dem Namen abgeleitet",
  "command.form.option.description.description": () =>
    "Kurze Einleitung, die im Panel angezeigt wird",
  "command.form.option.fields.description": () =>
    "Kommagetrennte key:Label-Paare, z. B. why:Warum, tz:Zeitzone",
  "command.form.option.form.description": () => "Formularschlüssel oder ID",
  "command.form.option.confirm.description": () =>
    "Formularschlüssel zur Bestätigung der Löschung wiederholen",
  "command.form.option.answers.description": () =>
    "key=value-Paare, getrennt durch ; oder Zeilenumbrüche",
  "command.form.option.submission.description": () =>
    "Einsendungs-ID; weglassen, um die offene Warteschlange zu sehen",
  "command.form.option.decision.description": () => "Einsendung annehmen oder ablehnen",
  "command.form.option.note.description": () => "Entscheidungsnotiz zur Einsendung",
  "command.form.option.state.description": () =>
    "Entwurf verbirgt das Panel; offen nimmt an; geschlossen behält den Verlauf",
};
