# Community — status

## Now

P3 is complete in-repo as of pass 07 (2026-11-01), and P4 hardened its economy in
pass 09 (2026-11-01). Balances are sums over the append-only `economy_ledger`;
transfers, purchases and gambles use the Discord interaction id as their
idempotency key; money mutations serialize per guild; and insufficient funds,
self-pay, bot targets, caps and a claimed daily are explicit refusals. `/rank`,
`/ticket` and `/tools` still own the command surface. At pass 09 the ledger was
10/100; it is 20/100 now.

Live verification on 2026-11-01 (pass 15): AI Team#5758 answered `!rank
leaderboard` with the real XP-leaderboard embed and `!mod history` with the case
list. `!ticket stats` reached the `ManageGuild` guard — the MCP harness bot does
not hold that permission — and exposed a real ordering bug: guild-wide stats
required a ticket id first. The stats branch now runs before the ticket lookup
and is covered by a test. Select interactions, thread/voice behavior, live role
grants and the scheduler tick are still unverified. The Postgres guild lock is
exercised on PGlite, not a Postgres server.

P7 added the durable timer for reminders and schedules in pass 45. `/tools
reminder` and `/tools schedule` still write the same `community_records` rows,
but now enqueue `content.deliver` with a due-time delay and an idempotency key.
`ContentService.deliver` re-reads the record, refuses a future due time, claims
it with one conditional `UPDATE … WHERE data->>'sent' <> 'true'`, then sends by
DM or channel; a failed send restores `sent:false`, and only Discord accepting
the message leaves the claim in place. `tick()` calls the same `deliver` method
and remains the reconciliation/backstop path, so the timer and the sweep can run
concurrently without sending twice. The live probe ran this against real
Postgres rows (`content-timer-delivery`, including a concurrent claim); Discord
was a recording port, not a gateway.

P7 added the auto-responder in pass 25. Exact, contains and regex triggers are
guild records; a message gets at most one reply, exact beats contains and
contains beats regex, and each trigger carries its own cooldown. `/tools` gained
`responder`, `responders` and `responder-remove` subcommands, so the command
ledger stayed at 12 roots / 77 subcommands at that pass (now 14 / 90 with audit
logging and analytics). Live 2026-11-01: the seeded `hello keystone` trigger replied to
a marked MCP message, a second identical message inside the 60-second cooldown
got no reply, and a third after the window replied again. The admin actions were
not run live because the MCP bot lacks `ManageGuild`; they are covered by the
command tests.

P7 added a user context menu in pass 33. **Rank card** is an application command
of type 2 that reads the same `LevelingService.rank` projection as `/rank view`
and replies with an embed, not an image. This build has no image renderer, and
the embed footer says `levels are stored XP rows, not an image render`. The menu
is guild-only, has a 3-second cooldown and adds no store. Discord reports it
registered; the MCP cannot right-click, so invocation is covered by the command
test rather than a live click.

## Verified

```text
pnpm check                            exit 0 · 457 tests / 68 files
  responder.test.ts                   5 tests (auto-responder service)
  community.test.ts                  14 tests (including timer delivery and a concurrent claim)
  extras.test.ts                      7 tests
  commands.test.ts                   12 tests (incl. reminder/schedule timer wiring)
  economy.test.ts                     6 tests
  apps/bot/src/community-events.test.ts 3 tests (dev marker + responder)
  apps/bot/src/prefix.test.ts         8 tests (dev bridge)
  context.test.ts                     2 tests (Rank card menu)
  packages/db/src/community.test.ts   6 tests (incl. responder reopen and delivery claim)
  packages/db/src/economy.test.ts     2 tests
pnpm budget                           20/100 roots · 139 subcommands · 159 actions · 4 context menus, status OK
pnpm memory:check                     current (pass 33)
```

Feature proofs (P3 plus the P4 economy hardening):

| Feature | Test assertion |
| --- | --- |
| XP/levels | Two awards reach 100 XP and level 1; duplicate message id awards zero; rank/leaderboard reflect the projection |
| Cooldown | A second message inside the window awards zero, the next after it awards |
| Role rewards | Level 1 crosses once and calls `addRole` once |
| Economy | Daily once, balance is a sum, transfer moves both sides, insufficient transfer fails, shop role purchase deducts once |
| Double spend | Two concurrent 80-unit transfers against a 100-unit balance: exactly one succeeds and the final balance is 20 |
| Idempotent retry | Repeating a transfer or gamble with the same request id inserts no second movement; a repeated purchase is refused because the role is already owned and leaves one ledger entry |
| Daily cooldown | A second claim is refused through `CooldownStore`; the next UTC day is allowed |
| Explicit refusals | Self-pay, bot target, above `transferMax`, above `gambleMax` and insufficient funds all return an explicit error or reason |
| Gambling | Disabled by default; cap enforced; a seeded RNG proves a win and a loss debits once |
| Welcome | Text placeholders, immediate autorole and DM are recorded |
| Delayed autorole | Join records a pending role; before due applies zero; after due applies once; second tick no-op |
| Button reaction roles | Panel carries `keystone:role:<id>`; first toggle adds, second removes |
| Select reaction roles | Panel has a select with managed options; applying a subset adds; repeat is a no-op; unmanaged value rejected; changing subset removes old roles |
| Starboard | Below threshold sends nothing; threshold sends once; the next count edits the same record |
| Starboard overrides | A source channel with threshold 1 posts to its override channel; an un-overridden source still needs the global 5 |
| Birthdays | `11-01` announces once for the year; duplicate tick sends zero; `02-30` rejected; removal stops announcements |
| Suggestions | Submit, one vote per user, duplicate vote no-op, switch vote moves counts, decision once, decided votes rejected, disabled path rejected |
| Giveaways | Duplicate entry is refused; early end is refused; due end picks a winner and DMs; second end is a no-op |
| Rank card menu | Seeds `4 / 400`; the user menu reports `Level 4 · 400 XP · rank #1`, and the row is unchanged afterwards |
| Temp voice | Hub creates the named room; owner leave with members stays; empty owner leave deletes and removes the record |
| Tickets | Panel, thread ticket, one-open cap, claim, transcript message, close, stats and average close |
| Live leaderboard | `!rank leaderboard` returned the real XP-leaderboard embed in `#ai-chat` |
| Ticket stats placement | Guild stats renders without a ticket id; only the `ManageGuild` permission guard can stop it |
| Embeds/tags | Valid embed sends; empty embed rejected; tag create/read |
| Reminders/schedules | One delayed `content.deliver` job per record with a due delay; nothing before due; one delivery each after due; redelivery and second tick inert; two concurrent claims send once |
| Polls | One vote per member, totals counted |
| Feeds | RSS parse, GUID dedupe, one post |
| Sticky | Duplicate message event does not increment; threshold posts once; next threshold deletes only the recorded previous sticky |
| Stat channels | Rename action receives `Members: 42`; bad feed URL rejected |
| Season reset | Start archives one profile and clears leaderboard; same season refuses to archive twice; rollover before due is false; after due archives the new profile; archive records remain |
| Auto-responder | Exact/contains/regex matching, exact precedence, one send, cooldown suppress and release, duplicate/invalid-regex/max refusals, list/remove |
| Postgres | XP idempotency, leaderboard isolation, ledger transfer, ticket events, record scoping/delete, season archive in one reset |
| PGlite restart | Close and reopen the same data directory: balance and ledger rows return, and a duplicate key inserts nothing |
| PGlite double spend | Two concurrent transfers on PGlite cannot spend the same balance twice |

## P3 exit

**Green for every P3 item named for this pass.** The seven follow-ups all exist,
are reachable by admins through `/tools` or `/rank season`, and are tested with
duplicate/negative/safety cases. At P3 exit the command ledger was **9/100**; P4
added `/ai` and the economy hardening added no root, so at P4 exit it was
**10/100**. It is **20/100** now. No feature is paid.

Not green and not claimed: message/gateway behaviour is now partially proven
(the leaderboard and ticket-stats guard ran live), but selects, threads, voice,
live role grants and scheduled ticks are still untested here. Goodbye messages,
YouTube/Twitch-specific adapters and MEE6 import are still open (import is P5);
durable queue delivery is in-process. The parity tally marks only verified
buildable rows and leaves competitor ❔ cells untouched.

## P4 economy exit

**Green in-repo for the buildable economy surface.** Every row the matrix assigns
to the economy — balance/currency, daily, transfers, shop/buy, gambling and the
audit ledger — is reachable from `/rank` and backed by `economy_ledger`. The
surfaces replace **MEE6**'s paid currency bundle and **Carl-bot**'s
currency/gambling; **Dyno** has no server economy. No new root was added; when
this section was written the ledger was **10/100**, and it is **20/100** now.
No feature is paid.

Not green and not claimed:

- Live Discord role grants and live gateway interaction retries.
- The guild-row lock against a real Postgres server (PGlite runs the same
  transaction path).
- Automatic refund/repair for a shop role grant that Discord rejects after the
  debit; the command reports it and the ledger stays auditable.
- Cross-shard throughput: writes serialize per guild by design.

## Proven vs still needs a live gateway

| Claim | Proven here? | How to close |
| --- | --- | --- |
| XP/currency idempotency | Yes, in-memory + PGlite | Same against a Postgres server |
| Economy double spend | Yes, in-memory queue + PGlite guild lock | Two bot shards against one Postgres server |
| Economy balance after restart | Yes, PGlite close/reopen | Same against a Postgres server |
| Ticket records/transcripts | Yes, port + PGlite | Live thread round-trip |
| Welcome/starboard/voice events | Service + recorder | Staging guild with intents |
| Select-menu role reconciliation | Service + recorder | Click a real select in staging |
| Suggestion vote/decision | Service + buttons shape | Click real buttons in staging |
| Birthday due-day tick | Service + injected clock | Run the bot tick in staging |
| Delayed autorole/sticky | Service + recorder | Live message/join flow |
| Season archive | In-memory + PGlite transaction | Same against a Postgres server |
| Shop role grant | Action recorder | Live role grant in staging |
| Scheduler reminders/giveaways/seasons | Service tick tested | Run the bot tick in staging |
| Auto-responder service | Service + command + PGlite tests; **live gateway** for trigger and cooldown | Run the admin actions with a ManageGuild member and a human author |
| RSS poll | Parser/dedupe tested | Point at a live feed |
| Stat channel rename | Action recorder | Live channel rename permission |
| Discord send/edit/thread/select/voice | Adapter typechecks only | Staging guild |
| Gateway events | Typechecks only | Live guild with intents |

No document claims a live Discord run for a row marked “staging”.

## Known limitations

- Reminders and scheduled messages now use the bot-side durable timer; in
  memory mode the queue is process-local, so the 60-second `tick` re-delivers
  overdue records after a restart. Giveaways, delayed autoroles, birthdays,
  seasons, feeds and stat channels still run on that tick and are delayed while
  the bot is offline.
- The timer consumer lives in the bot because it needs the gateway; the worker
  deliberately does not pretend to send Discord messages.
- `statChannels.online` is approximated with `guild.memberCount`; presence is not
  requested.
- Daily uses the kernel cooldown with a window to the next UTC midnight; the day
  key on the ledger is the hard idempotency guard, so a broken cooldown store
  still cannot double-pay.
- A shop role grant can fail after the debit. The user is told to ask an admin;
  there is no automatic refund command yet.
- Economy writes serialize per guild. That is a deliberate
  correctness-over-throughput trade-off for community scale.
- Temp voice cleans up when the owner leaves and the room is empty; an
  administrative orphan cleanup pass is not built.
- Birthdays use one guild timezone and support month/day only, not birth years.
- Goodbye messages and YouTube/Twitch-specific feed adapters are not built.
- Auto-responder regex is operator-owned and compiled as-is; there is no ReDoS
  sandbox or safe-pattern linter beyond the trigger length cap. The feature is
  admin-only and disabled by default.
- The auto-responder admin actions were not run live because the MCP bot lacks
  `ManageGuild`; the trigger/cooldown path was run live with a seeded record.
- Live Discord API and all gateway events are unverified here.

## Next

- P5 dashboard/fleet, importers and export/restore.
- P4 AI layer and economy hardening are in-repo; see
  [[04-Modules/ai/Status|AI status]] for its provider/live/pgvector gaps.
- Move giveaways, delayed autoroles, birthdays and season rollover onto the
  same durable timer; reminders/schedules are done.
- Prove a live Discord delivery (DM and channel) with the new timer.
- Add a repair/refund path for a failed shop role grant.
