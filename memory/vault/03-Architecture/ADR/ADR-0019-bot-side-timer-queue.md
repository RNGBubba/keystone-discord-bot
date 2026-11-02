# ADR-0019 — A bot-side timer queue for work that needs Discord

## Status

Accepted · 2026-11-02 · P7. Related: [[ADR-0006-ports-and-adapters]],
[[Live-Window]], [[04-Modules/moderation/Status|Moderation status]],
[[04-Modules/community/Status|Community status]].

## Context

Pass 44 introduced a BullMQ worker for database jobs. P7 then needed two
timed actions: release a temporary ban/role, and deliver a reminder or
scheduled message. Both are durable facts in Postgres, but both end in a
Discord API call. The worker has no Discord client.

There were three plausible homes for the timer:

1. the existing 60-second bot interval;
2. the worker, with a new REST adapter for Discord;
3. a delayed queue consumed by the bot process.

The interval already existed, but a minute of drift is visible for a reminder
and an in-memory wake-up is lost on restart. The worker is the right process for
SQL, but giving it Discord meant a second adapter with its own permission,
channel-resolution and error semantics. That is a second source of truth for
the most failure-prone boundary in the bot.

## Decision

Delayed jobs that need the gateway run on a second BullMQ queue,
`<QUEUE_NAME>.bot`, consumed only by the bot. It uses the same `JobQueue` port,
the same `createBullWorker` retry/idempotency path, and the same module
services as a slash command. The worker keeps `<QUEUE_NAME>` for database-only
jobs. In memory mode both drivers are in-process.

The timer payload is a record id, not a command closure. The handler re-reads
the case or community record, so a redelivered job is a no-op. A temporary case
is claimed by clearing `expires_at` with one conditional update; a failed
release restores it. A reminder or schedule is claimed by one conditional
`data->>'sent'` update before sending, so the timer and the existing 60-second
sweep cannot both deliver it. Startup recovery reads the same rows: overdue
cases expire, future cases are re-enqueued.

The key has exactly three colon-separated parts because BullMQ 6 permits a
colon in a custom id only for that legacy shape. Tests assert it; the live probe
schedules through the real BullMQ queue.

## Consequences

- One Discord adapter, one permission model, one place where a guild action is
  translated.
- The bot process is now also a queue consumer; `Runtime.close` closes the timer
  worker before the producer and the database.
- A timer is durable in Redis but the timer *policy* is still in Postgres. A lost
  queue job is a delay, not a lost moderation action.
- The worker cannot send a message or lift a ban. That is intentional, and the
  health/status docs say so.
- The 60-second tick remains for giveaways, delayed autoroles, birthdays,
  seasons, feeds and stat channels; it is a reconciliation backstop for
  reminders/schedules, not their scheduler.

## Alternatives

| Option | Why it lost |
| --- | --- |
| Use the 60-second bot interval as the only scheduler | A minute of drift for reminders; a restart loses the wake-up |
| Run expiry and delivery in the worker with a Discord REST adapter | A second Discord adapter with a second permission/error model |
| A `scheduled_jobs` table polled by the bot | A second scheduler beside BullMQ, with its own leasing and retry rules |
| Close the case before the Discord call | A failure leaves a closed case while the ban or role is still in force |
| Use the case id alone as the BullMQ job id | BullMQ 6 rejects a two- or four-part colon-bearing custom id; the live probe exercises the three-part key |
