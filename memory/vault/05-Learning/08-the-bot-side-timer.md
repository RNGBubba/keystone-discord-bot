# Lesson 8 — the bot-side timer and conditional claims

## The problem

A temporary ban must end even if the bot restarts. A reminder must be sent at
the right minute, not the next time someone happens to run a sweep.

Both facts are durable in Postgres, but both end in a Discord API call. The
worker process has no Discord client. Giving the worker one would mean a second
adapter with its own permission checks, channel resolution and error handling —
the most failure-prone boundary in the bot, implemented twice.

## The naive version, twice over

The first attempt is a 60-second `setInterval` in the bot. It works until the
process restarts; the wake-up is gone. It also drifts by up to a minute, which
is visible for a reminder.

The second attempt is “put it in the worker and add a REST client”. Now the
worker needs a token, a guild cache or fetches, a permission model and the same
channel resolver. The bot and worker disagree on what a channel is.

## Our version

Read `memory/vault/03-Architecture/ADR/ADR-0019-bot-side-timer-queue.md`, then
`apps/bot/src/timers.ts`.

- The bot creates a second BullMQ queue, `<QUEUE_NAME>.bot`, and is its only
  consumer. The worker keeps the database-only queue.
- The timer payload is a record id, not a closure. The handler re-reads the case
  or community record after delivery, so a redelivered job is a no-op.
- `modules/moderation/src/temporary.ts` claims an expiry by clearing
  `expires_at` with one conditional update. The winner calls `unban` or
  `removeRole`; a failure restores the timestamp and appends a note.
- `modules/community/src/content.ts` claims a reminder with `claimSent`, one
  conditional update on `data->>'sent'`. Only the writer of `sent:true` sends.
  A failed send releases the claim so a retry can try again.
- Startup recovery calls the same services: overdue cases expire now, future
  cases are re-enqueued. In memory mode this is the only recovery path; BullMQ
  keeps the delayed job in Redis when Redis is configured.

The three-part idempotency key (`moderation:expire:<caseId>`) is not cosmetic.
BullMQ 6 accepts a colon in a custom id only for that legacy shape. A test
asserts the shape; the live probe schedules through the real queue.

## Exercise

Run the focused timer test:

```bash
pnpm test -- modules/moderation/src/temporary.test.ts
```

Then open `temporary.ts` and comment out the `restore()` call in the failed
release branch. The test “failed release restores expiry and stays open, then
retries” fails: the case has lost its way to retry. Uncomment it.

If the compose services are running, follow with:

```bash
pnpm probe:live
```

Read the `temporary-moderation-expiry` and `content-timer-delivery` checks in
`memory/machine/live.json`. They prove the SQL and queue paths with a recording
Discord port, not a gateway send.

## What we rejected

| Option | Why it lost |
| --- | --- |
| Use the 60-second interval as the only scheduler | A minute of drift and a lost wake-up on restart |
| Run expiry and delivery in the worker with a Discord REST adapter | A second Discord adapter and a second permission model |
| A `scheduled_jobs` table polled by the bot | A second scheduler beside BullMQ, with its own leases and retries |
| Close the case before calling Discord | A failure leaves a closed case while the ban is still in force |
| Use `job.attemptsMade` as the expiry claim | Transport state, not the durable case fact |

## Check yourself

1. Why can the worker not simply run `moderation.expire` itself?
2. What does the loser of `claimExpiry` see, and what does it do next?
3. Why does a failed reminder send put `sent:false` back instead of leaving the
   claim?
