# Invites — status

## Now

P7 invite tracking is complete in-repo. It is the sixth module and the first P7
parity slice.

- `/invites` is registered through the shared catalog with `leaderboard`, `stats`
  and `who`; the command ledger is **20 roots / 141 subcommands** after
  `/logging`, `/analytics`, `/config`, `/export`, `/music`, `/setup` and
  `/appeal` landed.
- Attribution diffs cached invite counters after every join **when a baseline
  exists**, serialized per guild. A cold cache records the join without an
  inviter and seeds the cache; historical `uses` totals are never treated as new
  increments. A join row is unique on `(guild, user, joined_at)`.
- The gateway side is split: `apps/bot/src/invite-tracker.ts` owns the cache,
  the per-guild queue and the join/leave decisions; `invite-events.ts` only maps
  discord.js events to that tracker.
- Suspicious joins are advisory only: account-age and no-avatar flags, an
  optional log-channel embed, never an automatic action.
- Postgres storage is a first-class adapter (`invite_joins`) with a PGlite test;
  in-memory mode uses `InMemoryInviteStore`.

## Verified

```text
pnpm vitest run apps/bot/src/invite-tracker.test.ts
pnpm vitest run apps/bot/src/invite-events.test.ts
pnpm vitest run modules/invites/src/invites.test.ts modules/invites/src/commands.test.ts
pnpm vitest run packages/db/src/invite-store.test.ts
```

- Pure diff: increment, new code, unchanged, missing inviter, deterministic tie.
- Adapter: a join before the first successful cache refresh records no inviter,
  even when an existing invite has a much larger historical `uses` total.
- Tracker: two joins for one guild queue behind the first fetch; the second
  join sees the first cache update and records the incremented invite.
- Flags: new account + no avatar, established account, each check disabled.
- Service: duplicate gateway delivery records once; leave reduces retained
  count; flagged join notifies exactly once; disabled module records nothing.
- Command: one root, budget 1, `GuildInvites` declared, the minimal intent
  profile names the `GuildMembers` consequence, all three actions render, and a
  missing port is a clear refusal.
- PGlite: SQL totals and ordering, idempotency, newest-join lookup, scoped
  reads, and survival across close/reopen.
- Live 2026-11-01: AI Team#5758 started with `GuildInvites` + `GuildMembers`,
  re-registered the then-current 12 roots / 77 subcommands after drift (Discord
  returned `invites`), and
  `!invites leaderboard` / `!invites who` ran through the real dispatch pipeline
  in `#ai-chat`. The `who` reply is visible; the leaderboard is an embed that the
  MCP text reader does not render.

## What it proves

The join path and the read path share one contract. The bot adapter only
translates Discord objects; `attributeInvite` and `InviteService` decide what was
counted, and the same functions run in the tests. That is why a duplicate
delivery, a tie between two changed invites, or a disabled module can be reasoned
about without a gateway.

## Known limitations

- **A live member join was not performed.** No second Discord account was
  available, so real attribution is proven by unit tests and the live invite
  cache fetch, not by a real join event.
- The MCP bot cannot invoke slash commands and does not render message embeds;
  the live check used the dev `!` bridge. Slash `InteractionCreate` still needs a
  human client.
- The invite cache is process-local. A join before the first successful refresh,
  or after a refresh failure, is recorded **without an inviter** so it cannot be
  misattributed; the next successful fetch seeds the cache. Durable per-invite
  counter snapshots are a later optimization.
- The cold-cache path is covered by
  `apps/bot/src/invite-events.test.ts`; per-guild serialization is covered by
  `apps/bot/src/invite-tracker.test.ts`. Neither test is a live gateway race.
- If the bot lacks `ManageGuild`, joins are recorded without an inviter and one
  warning is logged per guild.
- No backfill: joins before the first successful cache refresh stay
  unattributed; they are not guessed from historical totals.

## Next

- Persist invite counter snapshots if restart gaps show up in practice.
- Surface invite totals on the dashboard guild overview.
- Reuse the join rows in the anti-raid review queue as evidence.
- Add a per-inviter retention history command after the first real guild data.
