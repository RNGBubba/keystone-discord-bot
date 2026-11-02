# Lesson 5 — cases and evidence

## The problem

A member appeals a warning. A moderator reviews it and changes the case state
from `warned` to `reviewed`. If the appeal is stored only as a state field, the
appeal disappears when the state changes. A second moderator cannot tell whether
the first one reviewed the warning or the appeal.

Moderation records have the same problem as money: the current balance is useful,
but the ledger is what explains it.

## The naive version

```ts
await db.update(cases).set({ state: "reviewed" }).where(eq(cases.id, id));
```

One row, one state. The history is implicit and overwritten. `reason` is edited
in place if someone fixes a typo, so the original reason is gone too.

## Our version

Read `modules/moderation/src/cases.ts` and `packages/db/src/case-store.ts`.

- **Case numbers are per guild and allocated atomically.** The Postgres path is
  one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`; two concurrent commands
  cannot receive the same number.
- **A case is opened before the Discord action.** A failed ban still leaves a
  reviewable record, and the command can append the failure.
- **Events are append-only.** `appendEvent` only inserts. `updateState` changes
  the current state, but never deletes or rewrites an event.
- **An appeal is an event, not a state.** `/appeal status` calls
  `CaseStore.listEvents` and filters for `appealed`. That is why the status still
  reads `1 appeal` after `/mod review` changes the case to `reviewed`.
- **An expiry is a claim.** `claimExpiry` is one conditional update:

```sql
UPDATE cases
SET expires_at = NULL
WHERE id = $1 AND expires_at IS NOT NULL
  AND state NOT IN ('closed', 'reversed')
RETURNING *;
```

Only the caller that gets a row back performs `unban` or `removeRole`. A second
worker sees no row. A failed Discord call restores the timestamp and appends a
note, so the next recovery can retry instead of silently closing the case.

The in-memory store implements the same port, including the counters and event
log. Tests can therefore prove the command path without a database, while the
PGlite test proves the actual SQL condition.

## Exercise

Run the case-store tests:

```bash
pnpm test -- packages/db/src/cases.test.ts
```

In "allocates per-guild numbers, stores cases and appends events", change
`store.updateState(record.id, "appealed")` to `"closed"`. The next assertion
expects `appealed` and fails, but the `listEvents` assertion still finds the
appealed event. Restore the state. That is the lesson: state and history are
different facts.

## What we rejected

- **A mutable `history` JSON array on the case row.** It is one writer away from
  a lost update, and it cannot be indexed or queried by event type.
- **A separate appeals table.** An appeal is one kind of case event; a table
  would duplicate the case, the actor and the timestamp rules.
- **Delete a case when it is reversed.** The original action and its review are
  both evidence. A reversal is a new event and a state transition.
- **Use a read-then-write expiry check.** Two workers can both read `due`, both
  call Discord, and both close. The claim must be one conditional write.

## Check yourself

1. Why does `/appeal status` survive a later change to the case state?
2. What does `claimExpiry` return to the loser of a race, and what does the loser
   do next?
3. Which operation must happen before the case is marked `closed`, and why?
