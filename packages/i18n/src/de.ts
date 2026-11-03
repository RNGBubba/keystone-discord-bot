import type { Catalog } from "./messages";

/**
 * German, in one file: replies, refusals and every command description.
 * Hand-written and limited to the surfaces the bot ships, so no unreachable key
 * is promised and no machine translation is presented as reviewed prose. A key
 * that is not here falls back to English, never to its own name.
 */
const commandCopyDe: Record<string, () => string> = {
  "command.ping.description": () =>
    `Prüft, ob Keystone erreichbar ist.`,
  "command.about.description": () =>
    `Zeigt, was Keystone ist und wie dieser Server eingerichtet ist.`,
  "command.help.description": () =>
    `Durchsucht alle Keystone-Befehle, hilft bei der Befehlssuche und erklärt die Datenaufbewahrung.`,
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
  "command.setup.module.option.module.description": () =>
    `Modul-ID, zum Beispiel music`,
  "command.setup.reset.option.module.description": () =>
    `Modul-ID, deren Einstellungen zurückgesetzt werden`,
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
  "command.appeal.open.option.case.description": () =>
    `Fallnummer, gegen die Einspruch eingelegt wird`,
  "command.appeal.status.option.case.description": () =>
    `Eine bestimmte Fallnummer statt deiner letzten Einsprüche anzeigen`,
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
  "command.logging.setup.option.channel.description": () =>
    `Kanal, der Audit-Ereignisse erhält`,
  "command.logging.channel.option.channel.description": () =>
    `Neuer Audit-Kanal; weglassen, um den Versand zu beenden und die Einträge zu behalten`,
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
  "help.changelog.englishNote": () =>
    "Die Changelog-Einträge bleiben auf Englisch, damit die Geschichte des Bots nicht in Übersetzungen auseinanderläuft.",
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
  "rank.daily.balance": (balance) => `Guthaben: **${balance}**.`,
  "rank.pay.missing": () => "Zahlen braucht ein Mitglied und einen Betrag.",
  "rank.pay.ok": (amount, currency, target) =>
    `**${amount} ${currency}** an <@${target}> gesendet.`,
  "rank.transfer.failed": () => "Die Überweisung ist fehlgeschlagen.",
  "rank.shop.title": (currency) => `${currency}-Shop`,
  "rank.shop.empty": () => "Der Shop ist leer.",
  "rank.shop.item": (name, price, id) => `**${name}** — ${price} (ID: \`${id}\`)`,
  "rank.shop.itemWithDescription": (name, price, id, description) =>
    `**${name}** — ${price} (ID: \`${id}\`)\n${description}`,
  "rank.buy.missingItem": () => "Nenne den Shop-Artikel, der gekauft werden soll.",
  "rank.buy.ok": (name, balance) => `**${name}** gekauft. Guthaben: **${balance}**.`,
  "rank.purchase.failed": () => "Der Kauf ist fehlgeschlagen.",
  "rank.gamble.missingAmount": () => "Nenne den Betrag, der gesetzt werden soll.",
  "rank.gamble.won": (amount, balance) =>
    `Du hast **${amount}** gewonnen. Guthaben: **${balance}**.`,
  "rank.gamble.lost": (amount, balance) =>
    `Du hast **${amount}** verloren. Guthaben: **${balance}**.`,
  "rank.gamble.failed": () => "Das Glücksspiel ist fehlgeschlagen.",
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
