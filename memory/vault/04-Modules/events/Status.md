# Events — status

## Now

P7 events are in repo and live-proven through the development bridge. It is the
eleventh module and the first of the two roots the pass-40 inventory found
unbuilt.

- `/event create | edit | delete | list | rsvp | remind | export` is registered
  through the shared catalog. At pass 41 the ledger was **19 roots / 132
  subcommands / 151 actions / 4 context menus**; it is **20 roots / 141
  subcommands / 161 actions / 4 context menus** after pass 45.
- The lifecycle is draft → open → closed. `rsvp` is refused outside `open`;
  `remind` is refused on a draft or closed event; existing RSVPs stay readable.
- `EventStore` is one port. Postgres uses `DrizzleEventStore`; local mode uses
  `InMemoryEventStore`. Both enforce one row per member and count capacity from
  `going` rows.
- Migration 0012 adds `events` and `event_rsvps`. The unique
  `(event_id, user_id)` index is the ownership rule; the event foreign key
  cascades.
- The SQL capacity check locks the event row and counts inside the transaction.
  The service pre-check only chooses the message.

## Verified

```text
pnpm vitest run modules/events packages/db/src/event-store.test.ts
  ✓ modules/events/src/events.test.ts (9 tests)
  ✓ packages/db/src/event-store.test.ts (3 tests)

pnpm test                          # 633 tests / 92 files
pnpm budget                        # 20/100 roots · 141 subcommands · 161 actions · 4 context menus
pnpm commands:doctor               # Registry 20 roots · 141 subcommands · 4 context menus
```

Focused coverage:

- Parsing: ISO and `YYYY-MM-DD HH:mm` accepted and normalised; garbage refused.
- Flow: create draft → open → two going RSVPs → full refusal → decline → list
  counts → reminder bookkeeping → delete refusal → unused draft deletion.
- Ownership: one row after going → not_going → going; another member has no row
  until they answer.
- Capacity: `going` counts, `not_going` does not; a decline frees a seat.
- States: draft and closed refuse RSVPs; draft and closed refuse reminders.
- Permissions: management subcommands require `ManageGuild`; `list` and `rsvp`
  do not.
- Settings: the enabled switch blocks writes but list and export still read;
  the event cap and capacity bound come from the module schema.
- Export: the attached JSON parses, counts are `1 / 1`, and the SHA-256 matches
  a recomputation over the payload without its checksum.
- PGlite: unique `(guild_id, key)`, get by key and id, guild scoping, update,
  one RSVP row, capacity/seat release, reminder increment, cascade delete.

The SQL cross-check is the raw query in `event-store.test.ts`
(`select user_id, state from event_rsvps ...` and `select count(*) from
event_rsvps` after a cascade), not the adapter's own read methods.

## Live evidence

At pass 41 the `.env` probe found both service ports closed, so that window was
memory mode and the SQL path was PGlite-only. Pass 44 has since opened the SQL
window and applied all 14 migrations.

One bot process (`DATABASE_URL= REDIS_URL= pnpm start`), connected as
`AI Team#5758` with `"modules":11`; boot found `event` missing, cleared once and
re-registered **23** application commands (19 roots + 4 menus). It was stopped
with its process tree; a CIM query afterwards returned no remaining `node.exe`.

Through the MCP bridge in `#ai-chat`:

```text
> !event create name="Launch night" key=launch-night description="Pass 41 live proof" starts=2026-11-05T18:00:00Z ends=2026-11-05T20:00:00Z location="voice stage" capacity=2
< Event `launch-night` created in draft for <t:1793901600:F>. Open it with `/event edit event:launch-night state:open`, then members can `/event rsvp event:launch-night rsvp:going`.

> !event edit event=launch-night state=open
< Event `launch-night` updated · state open · <t:1793901600:F> · 0/2 going.

> !event rsvp event=launch-night rsvp=going
< RSVP for `launch-night` recorded · going · 1/2 going.

> !event list
< 1 event in this server.

> !event remind event=launch-night
< Reminder 1 for `launch-night` · <t:1793901600:R> · 1 going.

> !event rsvp event=launch-night rsvp=not_going
< RSVP for `launch-night` recorded · not going · 0/2 going.

> !event rsvp event=launch-night rsvp=going
< RSVP for `launch-night` recorded · going · 1/2 going.

> !event export
< Event export · 1 event · 1 RSVP · 1242 bytes · checksum `95023b522d11ed4f…`
  Attachments:
    - keystone.events.1450130465146142785.json (1.2 KB, application/json)

> !event delete event=launch-night confirm=launch-night
< Event `launch-night` has 1 RSVP. Close it with `/event edit event:launch-night state:closed` instead; attendance history is never deleted here.
```

The attached file was downloaded (HTTP 200, 1242 bytes) and parsed:

```text
counts {"events":1,"rsvps":1}
event launch-night open capacity 2 reminderCount 1 remindedBy 1493685079468146808
rsvp 1493685079468146808 going
checksum 95023b522d11ed4f9f2ea07d9e64dc5142d6be0e75d3585ed715d2e963bd2e14
match true
```

**Cross-check:** the exported event is `open` with capacity 2, `reminderCount 1`
and the MCP author as `remindedBy`; the single RSVP belongs to the same member
and is `going`; the reply's checksum prefix matches the full checksum in the
file; the SHA-256 recomputed over the payload without `checksum` matches. The
`not_going` then `going` sequence changed one row, not two: the final export
contains exactly one RSVP.

**What the MCP account could not do:** it is a bot, so the RSVP above is the
bot's own membership, not a human member. A second distinct member competing for
the last seat, and a member without `ManageGuild`, cannot be produced with one
bot account; the capacity refusal and the permission branch are covered by
`events.test.ts`. Slash `InteractionCreate` was not exercised — the bridge is a
message. The interactive RSVP buttons, scheduled reminders and ICS export do not
exist, so they were not claimed. The SQL adapters were not live because Postgres
is unreachable; PGlite covers them.

## Open

- Scheduled reminders and per-member timezones.
- RSVP buttons with a maybe answer. The component layer now exists (pass 58);
  the buttons themselves are not built.
- ICS calendar export.
- A delivery port for event-open notifications if it is ever wanted.
- Include events and RSVPs in the guild portability bundle so `/export guild`
  covers the new rows; `/event export` is the truthful dedicated export today.
