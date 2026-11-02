# Lesson 7 — jobs and idempotency

## The problem

A queue promises at-least-once delivery, not exactly-once. The worker handles a
`settings.snapshot` job, writes the audit row, and crashes before it acknowledges
the job. Redis redelivers it. If the handler has no receipt, the row is written
twice and the audit log lies.

Retries make this normal, not exceptional. A network timeout is a retry; a
process restart is a retry.

## The naive version

```ts
worker.process(async (job) => {
  await doSideEffect(job.data);
});
```

The side effect runs again on every redelivery. Adding `if (job.attemptsMade > 0)
return` skips legitimate retries. There is no record of what completed, so a
second process cannot tell either.

## Our version

Read `packages/queue/src/index.ts` and `packages/kernel/src/idempotency.ts`.

- `JobQueue` is a port. `BullJobQueue` implements it with Redis; the in-process
  driver implements it for memory mode and tests. Both use the same
  `DEFAULT_RETRY_POLICY` and `backoffFor`, so a test does not describe a
  different retry policy from production.
- The job id is the idempotency key when one is supplied. BullMQ stores it as
  the job id; the worker claims the key before running and completes it after.
- `IdempotencyStore` has `claim`, `complete` and `fail`. Postgres keeps a
  `job_receipts` row so a restart, a second worker, or a redelivery sees
  `completed` and skips.
- A permanent failure writes `failed` once retries are exhausted. A future
  operator can see the key, status, attempts and last error.
- `apps/worker/src/index.ts` checks Redis before announcing readiness. BullMQ
  connects lazily, so a lazy worker would look healthy until the first job.
- `apps/worker/src/handlers.ts` is deliberately small: `settings.snapshot` reads
  settings and writes one audit row. The queue is infrastructure, not a second
  business layer.

The important distinction: the *receipt* is the source of truth for “has this
side effect happened?”. `job.attemptsMade` is not; it only describes the
transport.

## Exercise

Run the queue tests:

```bash
pnpm test -- packages/queue/src/queue.test.ts
```

Open `DEFAULT_RETRY_POLICY` in `packages/queue/src/index.ts` and change
`maxAttempts: 3` to `1`. The test “retries a transient failure and applies the
side effect exactly once” now fails because the first attempt is terminal.
Restore the value. You have changed one policy number and watched both drivers
follow it.

If you have Redis, the live probe adds a real delayed job and a real Postgres
receipt. That is the same contract with a broker, not an in-process promise.

## What we rejected

- **Exactly-once delivery.** Brokers do not provide it across a crash without a
transactional outbox or a receipt, and pretending otherwise moves the bug.
- **`attemptsMade` as the dedupe key.** It is transport state, not a durable
  side-effect record. A redelivery can arrive with the counter reset.
- **In-memory receipts in production.** A restart forgets them. Postgres is the
  durable receipt in the composed stack.
- **Swallow a failed handler.** A silently failed job looks completed to the
  queue and leaves no retry. Throw; let the policy record the failure.

## Check yourself

1. What does `claim` return when a key already completed, and what does the
   worker do?
2. Why must the receipt write happen after the handler, not before?
3. What is the difference between a `failed` receipt and an unprocessed job?
