# Lesson 11 — panic mode: snapshot before you act

## The problem

A raid is happening. An administrator wants one command that stops posting in
every text channel, and one command that puts the server back exactly as it was.

“Exactly as it was” is harder than “deny everyone”. A channel may have had a
neutral overwrite, an explicit allow, or an explicit deny. A blanket restore to
allow unlocks channels that were locked before panic. A crash between the
Discord write and the command reply loses the way back.

## The naive version

```ts
for (const channel of guild.channels.cache.values()) {
  await channel.permissionOverwrites.edit(everyone, { SendMessages: false });
}
```

Then “off” edits every channel to `SendMessages: true`. Three bugs:

1. A channel that was already denied is now allowed.
2. A channel that never had an overwrite gets an empty one.
3. If the process dies after the loop, no record says what the loop changed.

## Our version

Read `modules/moderation/src/panic.ts`,
`apps/bot/src/moderation-actions.ts` and `packages/db/src/panic-store.ts`.

The adapter owns the Discord facts; the service owns the policy.

- `lockdown` fetches the guild's text-like channels, reads the `@everyone`
  SendMessages overwrite, records `{ channelId, existed, previous }`, and only
  then edits it to deny. A channel already denied is skipped and never enters the
  snapshot, so `off` cannot unlock it.
- `restoreLockdown` deletes an overwrite that did not exist, writes back
  `allow`/`deny`/`neutral` when it did, and returns separate `restored` and
  `failed` lists.
- `PanicService.start` saves the snapshot before it replies. `end` restores and
  clears the row only when every channel succeeded. If some failed, it saves only
  the remaining channels; a second `off` retries only those.
- A start where no channel could be locked writes no state. A second `on` while
  active is a no-op, not a second snapshot.
- The snapshot is one `community_records` row, not a new table. It is one small
  document per guild, read by this command and written while panic is active.
- `status` is readable by a moderator; `on/off` require `Administrator`. There
  is no timer: the promise is a manual switch and a way back. A time-bounded
  lockdown would reuse the pass-45 timer and this snapshot, not add a second
  recovery path.

The adapter test proves the skip-already-denied rule, the delete-vs-edit restore
and the permission refusal. The PGlite test proves guild scoping and clearing.
The live probe proves the row survives a real Postgres round-trip; it does not
prove the Discord overwrite calls.

## Exercise

Run both focused files:

```bash
pnpm test -- modules/moderation/src/panic.test.ts apps/bot/src/moderation-actions.test.ts
```

In `apps/bot/src/moderation-actions.ts`, change
`existed: Boolean(overwrite)` to `existed: true`. The adapter test “snapshots
only channels it changes” expects `existed: false` for the neutral channel and
fails. Restore the expression. The bug you just simulated would make `off`
write an empty overwrite where none existed.

## What we rejected

- **Restore every channel to allow.** It silently unlocks a channel an
  administrator had already denied.
- **A new `panic_snapshots` table.** One document per guild with get/save/clear
  is the typed-record seam. A table needs a migration and a second schema
  without a query benefit; add one when panic needs audit history, not before.
- **Persist after the reply.** A restart between Discord and the reply loses the
  way back. The row is durable before the user sees “enabled”.
- **Clear the row even when a restore fails.** That loses the only record of
  which channels are still locked. Keeping the failures is what makes `off` a
  retry.
- **An automatic panic timeout.** It adds a second recovery path without making
  the switch more reliable.

## Check yourself

1. Why is a channel that was already denied excluded from the snapshot?
2. What happens if the process dies after the snapshot is saved but before the
   reply reaches Discord?
3. Why does `state:off` keep a partially restored row instead of clearing it?
