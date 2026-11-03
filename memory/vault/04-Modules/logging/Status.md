# Audit logging — status

## Now

P7 audit logging is complete in-repo and live-proven for message and moderation
events. It is the seventh module and one event source `/analytics` now reads
(pass 29).

- `/logging` is registered through the shared catalog with `setup`, `channel`,
  `events`, `status`, `retention`, `export` and `disable`. The command ledger is
  **20 roots / 141 subcommands / 161 actions** after analytics, `/config`,
  `/export`, `/music`, `/setup` and `/appeal` landed.
- An event is appended before delivery. A disabled module or a disabled event
  writes nothing; a configured channel that fails still leaves the row behind.
- The five event kinds are message delete, message edit, member join, member
  leave and moderation case. A single `LOG_EVENTS` table drives settings,
  choices, embeds and tests, so adding a sixth event is one entry plus its
  adapter translation.
- Moderation cases enter through `CaseService.onOpened`, not by re-reading the
  cases table. The logger is an observer, not a second moderation path.
- `logging_events` is append-only and indexed on `(guild_id, created_at)`.
  Retention prunes at startup, after `/logging retention`, and every six hours.
- In-memory mode uses `InMemoryLoggingStore`; Postgres uses
  `DrizzleLoggingStore`. Both implement the same kernel `LoggingStore` port.
- The MCP seam is explicit: a bot-authored message is logged only in
  `DEV_GUILD_ID` when it carries the shared `keystone-test:` marker, and the
  marker is stripped before the event is stored. Production passes no
  development guild, so bot messages are never captured there.

## Verified

```text
pnpm vitest run modules/logging apps/bot/src/logging-events.test.ts packages/db/src/logging-store.test.ts
```

- Settings are off by default with all five event toggles on and a 30-day
  retention window.
- The service writes nothing when disabled or when the selected event is off.
- It appends before delivering, keeps the row when the channel is missing or the
  send fails, and maps a moderation case into the same stream.
- Pruning removes only rows older than the configured window for one guild.
- Every subcommand is exercised: setup refuses a channel it cannot post in,
  channel sets and clears, events lists and toggles, status reports the stored
  count, retention prunes immediately, export returns parseable JSON, and
  disable keeps the configuration.
- The adapter records both halves of an edit, member joins/leaves, and removes
  its listeners on dispose.
- PGlite proves guild isolation, newest-first ordering, scoped pruning and
  survival across a close/reopen.

Live evidence (2026-11-01, AI Team#5758, one bot process, memory mode):

```text
!logging setup channel=1566476509416398848
→ Logging enabled. A test message was posted to the channel.
  Logging enabled · channel <#1566476509416398848> · 0 stored · retention 30d.

log channel ← "Keystone logging configured"
  Events: Use `/logging events` to choose them.
  Retention: 30 days

MCP post: "live audit check"
MCP edit: "live audit check edited"
log channel ← "Message edited"
  Before: live audit check
  After: live audit check edited
MCP delete that message
log channel ← "Message deleted"
  Message ID: 1566479735305801759
  Content: live audit check edited

MCP post: "keystone-test: pineapple"
log channel ← "Moderation case"
  Case #1 · security.alert
  The message contains a blocked word or phrase.
  Target: <@1493685079468146808> · Actor: keystone
  Rule: automod.profanity · State: alerted

!logging status
→ Logging enabled · channel <#1566476509416398848> · 3 stored · retention 7d.
  message_delete=on · message_edit=on · member_join=on · member_leave=on · moderation_action=on

!logging events event=message_edit enabled=false
→ Message edited logging is now off. … 3 stored … message_edit=off …
!logging events event=message_edit enabled=true
→ Message edited logging is now on. … 3 stored … message_edit=on …

!logging retention days=7
→ Retention set to 7 days. Pruned 0 stored events. … retention 7d …

!logging export
→ Logging export: 3 stored event(s); JSON is in the embed.
  The fetched message contains version 1, guildId, settings, and the
  moderation_action, message_delete and message_edit rows.
```

Each reply appeared **once**; the duplicate-embed bug from pass 27 did not
return. The export embed was read back through the Discord API because the MCP's
text reader does not render embeds.

## What it proves

The event path and the read path share one contract. The Discord adapter only
translates gateway objects; `LoggingService` decides whether to store and deliver,
and the same decision is exercised without a gateway. Because the row is written
before the send, the final live state is exactly what the tests say it should be:
three stored events, one test message that was not stored, and one moderation
case that arrived through the case observer rather than the message adapter.

## Known limitations

- **Member join and leave were not exercised live.** No second Discord account
  was available. Both paths are covered by the adapter test and the formatter
  test; a real `GuildMemberAdd` / `GuildMemberRemove` remains open.
- The live messages were authored by the MCP bot under the development marker.
  A human author has not produced a log row yet.
- The live window used the `!` bridge because the MCP cannot invoke application
  commands. Slash `InteractionCreate` still needs a human client.
- Retention was changed and pruned immediately, but the six-hour timer was not
  observed across a full interval.
- Delivery failure, a deleted channel and a refused setup are unit-tested; only
  successful delivery and the moderation hook were exercised live.
- Docker Desktop is installed and running here, and pass 44 started the compose
  Postgres 16.15 and Redis containers. The SQL store is live-proven by the 14/14
  probe; the earlier pass-28 window was memory mode.
- `message_delete` records the message author as actor because Discord's gateway
  event does not name the moderator who deleted it. The audit-log API is not
  read. This is honest evidence, not a claim about who pressed delete.
- Discord's audit log itself (roles, channels, bans performed outside the bot)
  is not ingested.

## Next

- Exercise `GuildMemberAdd` / `GuildMemberRemove` with a disposable human member
  and capture the two embeds.
- Add a live delivery-failure case by deleting the configured channel, then
  confirm the ledger still contains the event.
- `/analytics` now reads this ledger (pass 29); keep the stream append-only and
  do not add a second event table for a future view.
- Dashboard reads for the ledger are intentionally out of scope for this pass;
  the JSON export is the operator surface today.
