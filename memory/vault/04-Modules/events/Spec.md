# Events — spec

## What it is

Guild events with a lifecycle, a capacity-checked RSVP list, manual reminders
and a portable export. One root, `/event`, with seven subcommands. The module is
the eleventh and follows the same contract as forms: one kernel port, one
service that owns the state machine, an in-memory adapter for tests and a
Drizzle adapter for Postgres.

It does **not** schedule future reminders, send DMs, or provide interactive
RSVP buttons. Those are named as open, not imitated with a button that opens
nothing.

## Commands

| Subcommand | Who | Options | Behaviour |
| --- | --- | --- | --- |
| `/event create` | `ManageGuild` | `name`, `key`, `description`, `starts`, `ends`, `location`, `capacity` | Writes a `draft`. `capacity` 0 or absent means unlimited. |
| `/event edit` | `ManageGuild` | `event`, `name`, `description`, `starts`, `ends`, `location`, `capacity`, `state` | Changes details and moves draft/open/closed. No options prints the current row. |
| `/event delete` | `ManageGuild` | `event`, `confirm` | Deletes only an event with no RSVPs; `confirm` must equal the key. |
| `/event list` | everyone | — | Lists events with state, start, going/capacity and not-going counts. |
| `/event rsvp` | everyone | `event`, `rsvp` (`going` / `not_going`) | Writes the **invoking member's** row. One row per member; changing the answer updates it. |
| `/event remind` | `ManageGuild` | `event` | Posts a reminder for an open event and records who sent it, when, and how many times. |
| `/event export` | `ManageGuild` | `event` | Attaches `keystone.events` JSON with events, RSVPs, counts and a SHA-256 checksum. |

## State machine

```text
create ──▶ draft ──▶ open ──▶ closed
             ▲         │         │
             └─────────┴─────────┘   (edit can move between the three)
```

| Event state | New RSVP | Change RSVP | Remind | Delete |
| --- | --- | --- | --- | --- |
| `draft` | refused | refused | refused | allowed when no RSVPs |
| `open` | allowed | allowed | allowed | allowed when no RSVPs |
| `closed` | refused | refused | refused | allowed when no RSVPs |

RSVPs that already exist stay readable in every state; closing archives the
event, it does not erase attendance.

## Invariants

1. **One RSVP row per member per event.** A unique index on
   `(event_id, user_id)` is the structural rule; the command has no `user`
   option, so a member can only write their own row.
2. **Capacity counts `going` rows only.** `not_going` is a real answer, kept so
   a reminder can report it and so a decline frees a seat.
3. **Capacity is atomic.** The SQL adapter locks the event row and counts
   `going` rows inside the same transaction as the write, so two members racing
   for the last seat cannot both win. The service pre-check only produces the
   nicer refusal.
4. **History is not deleted.** `delete` refuses once any RSVP exists and points
   at `state:closed`.
5. **Reminder bookkeeping is a write, delivery is a reply.** `remind` records
   `reminded_at`, `reminded_by` and `reminder_count` through the store, then the
   command posts the message. A future scheduler can reuse the write.

## Tables

`events` owns the lifecycle; `event_rsvps` owns membership.

- `events`: `(guild_id, key)` unique, state, `starts_at`, optional `ends_at`,
  location, nullable capacity, reminder columns.
- `event_rsvps`: `(event_id, user_id)` unique, `state`, cascade delete from the
  event.

A table is required rather than a settings blob or `community_records`: the
uniqueness rule, the capacity count and the cascade all need real SQL, and a
cached counter would drift.

## Limits

- One global command root. `pnpm budget` reports **20/100 roots · 141
  subcommands · 161 actions · 4 context menus**.
- No new dependency, no privileged intent, no paid service.
- Event cap 25, RSVP cap 500 per event by default, both in module settings.

## Partial and open

- **Scheduled reminders and timezones** are not built. `remind` is manual.
- **RSVP buttons and a maybe answer** are not built. `rsvp` has two states and
  is a command.
- **ICS export** is not built. JSON is the portable format.
- **No DM or channel notification when an event opens.** It would need a
  delivery port; borrowing another module's adapter is the coupling pass 39
  removed.

## Evidence

- `modules/events/src/events.test.ts` — parsing, the full flow, ownership,
  capacity, closed/draft refusals, delete rules, permissions, settings and
  export checksum.
- `packages/db/src/event-store.test.ts` — PGlite: unique key, one RSVP row,
  capacity and seat release, reminder bookkeeping, cascade delete.
- `memory/journal/2026-11-01-pass-41.md` — live bridge transcript and the
  downloaded export cross-check.
