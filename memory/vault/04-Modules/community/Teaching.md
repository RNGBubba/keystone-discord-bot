# Community — teaching notes

## Read in this order

1. `modules/community/src/settings.ts` — every feature's opt-in and cap.
2. `modules/community/src/progress.ts` — XP as an event projection and the
   ledger-backed economy: daily, atomic spend/transfer, caps and refusals.
3. `modules/community/src/engagement.ts` — welcome, reaction roles, starboard,
   giveaways and temporary voice.
4. `modules/community/src/tickets.ts` — thread tickets and transcript events.
5. `modules/community/src/content.ts` — validated embeds, tags, reminders,
   polls, feeds and stat channels.
6. `modules/community/src/responder.ts` — auto-responder matching, precedence
   and per-trigger cooldowns.
7. `packages/kernel/src/community.ts` — the store/action contract.
8. `packages/db/src/community-store.ts` + `migrations/0004-community-records.ts`
   — the Postgres side.
9. `apps/bot/src/community-actions.ts` and `community-events.ts` — the only
   Discord/gateway seam for P3. `apps/bot/src/dev-fixture.ts` is the shared
   development-marker seam.

## The idea to take away

**XP is a projection, money is a ledger.** `levels.xp` is convenient to read,
but `xp_events` is the truth. `economy_ledger` has no balance column at all: a
balance is a sum over immutable movements with idempotency keys. That is why a
retried message or job cannot mint XP or coins, and why an export can explain
every number.

**The check and the insert must be one step.** Reading a balance in the command
and then spending is a race: two clicks both see 100 and both spend 80. The
`spend`/`transfer` methods in the store do the read and the insert under one
lock — a guild row in Postgres, one queue in memory — and the command only
reports the result.

**A button click is a request, not an authority.** The custom id carries a role
or ticket id. The service looks up its own record, checks the owner/state and
then acts. A user cannot turn `keystone:role:123` into a different role because
the adapter only passes the stored id.

**One root, many features.** `/tools` is a hub; adding a utility does not spend
another global command. `/rank` is the same idea for leveling and money. Discord
has 100; the project uses 11 in total.

**A trigger is data, not code.** Auto-responders store an operator-owned string
and a response; the service compiles a regex only when the match mode asks for
one, and it chooses exact over contains over regex so the result never depends on
the order records came back from the store. The cooldown timestamp is written
after a successful send, so a failed reply retries next time.

## The mistake you will probably make

Awarding XP by incrementing a counter before inserting the event. It works until
the job retries, the gateway reconnects or two shards see the same message. Put
the idempotency key on the event first, project the total second, and let the
read path recompute the level.

The second mistake is deleting a temp voice channel on every leave. The owner
leaving an active room must not delete it for everyone. Check the recorded owner
and the member count first.

The third mistake is trusting a random id for a retry. Discord can re-deliver an
interaction; if each attempt gets a fresh UUID the ledger records two movements.
Use the interaction id the platform already gives you, and let the unique key
turn the second attempt into a no-op.

The fourth mistake is letting an auto-responder answer every matching trigger.
One message, one reply: sort by precedence, stop at the first live match, and
write the cooldown only after the send succeeds. Otherwise a phrase with two
matches produces a wall of replies and a failed send burns the cooldown.

## Exercise

Add a per-channel XP multiplier without changing the kernel.

1. Add `channelMultipliers: Record<string, number>` to `xp` settings.
2. Pass the channel id into `awardMessageXp` and apply the multiplier before the
   award.
3. Add a test where the same message id is delivered twice and the channel
   multiplier changes between deliveries: the second must still award zero.
4. Explain why the multiplier belongs in the service, not the adapter.

## Auto-responder exercise

1. Add a `priority` number to each trigger and use it before the match-mode rank.
2. Keep one reply per message and add a test where two triggers share a priority.
3. Move the cooldown into the Redis `CooldownStore` and explain why the record
   timestamp is still useful for the admin list.

## P4 exercise: prove the double spend

1. Fund a member with 100 through `addLedger`.
2. Fire two `transfer` calls of 80 with different request ids through
   `Promise.all`.
3. Assert exactly one succeeds, the other reports “Not enough currency”, and the
   sender balance is 20.
4. Repeat both calls with one request id and assert only one movement happened.
5. Explain why the guild-row lock, not the command-level check, is what makes
   this true.

## Stretch

Move `ContentService.tick` and giveaway ending onto the durable queue. Give each
due reminder a stable `idempotencyKey` and prove a redelivery sends once. Keep
the interval as a development fallback, not the production guarantee.

Add an admin `repair` action that re-grants a shop role for a recorded `shop:`
ledger entry without creating a second debit. It must be scoped to the buyer and
the item, and it must be idempotent when the member already has the role.

## P3 completion: archive, reconcile, scope

**Archive the projection.** A season reset is not `DELETE FROM levels`. It copies
each profile into a guild-scoped archive record, writes a season marker, and only
then clears the disposable projection. `xp_events` is untouched, so the reset is
explainable and retry-safe. The same marker makes a repeated start a no-op.

**Reconcile, don't trust the select.** A select interaction sends role ids. The
service checks every value against the panel record, compares the selected set to
the user's current roles, and only then adds/removes. A forged value is rejected;
re-submitting the same set does nothing.

**Scope destructive actions.** Sticky refresh deletes only the message id it
stored. A missing id means delete nothing. The same rule applies to temp voice:
the recorded owner and an empty room are both required.

**Inject the clock.** Birthdays and seasons take `now` as a constructor function.
Tests move the clock instead of sleeping, and a duplicate tick is provably inert.

## Goodbye is welcome with the second half removed

Join and leave look symmetrical, so the first instinct is one method with an
`if (left)` branch. The branches are not equivalent: a departing member cannot
receive a DM, and granting them a role races the gateway's own member removal.
Only two things survive: the placeholder substitution and one channel send.

`handleLeave` therefore uses the same settings parser, the same `{user}` and
`{server}` replacements and the same 1,500-character cap, but it has no role or
DM code to disable. The adapter subscribes to `GuildMemberRemove` beside
`GuildMemberAdd`; the service does the work. If goodbye later grows a V2 panel,
that should be the same builder welcome uses, not a second presentation path.

## A “card” without an image

The plan called this menu **Rank card**, because that is what MEE6 ships. A real
card is a PNG: canvas layout, fonts, avatars, caching. That is a native
dependency and a separate rendering pipeline, and this pass had no install
proof for it. Shipping a picture-shaped placeholder would be worse than the
embed: users would believe the image was the feature.

So the menu is honest. It stores no new data, calls the same
`LevelingService.rank` as `/rank view`, and the footer says the numbers are
stored XP rows. When a renderer is added later, the command boundary does not
change: replace the embed builder with an `AttachmentBuilder` behind the same
port. The test should assert the same `4 / 400` row is read, not a snapshot of
pixels.
