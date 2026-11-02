# Community — spec

The P3 suite replaces the everyday community half of **MEE6, Dyno and Carl-bot**:
leveling and role rewards, a server-scoped economy, reaction roles (buttons and
selects), welcome/delayed autorole, starboard, birthdays, suggestions, giveaways,
temporary voice, embed/tag/reminder/scheduled/sticky content, polls, RSS feeds,
stat channels and keyword auto-responders. **Ticket Tool** is replaced by the
thread-based ticket root in the same module.

P4 hardens the economy half on the same `/rank` root instead of adding a second
one. It replaces **MEE6**'s paid currency/daily/shop bundle and **Carl-bot**'s
currency/gambling surface; **Dyno** has no server economy. Balances are always a
`SUM` over the append-only `economy_ledger`, every movement carries a stable
idempotency key, and concurrent spends serialize on a guild row lock.

Everything in this module is free. There is no tier, no paywalled limit and no
up-sell.

## Commands

| Command | Options | Guards | Behaviour |
| --- | --- | --- | --- |
| `/rank` | subcommands `view`, `leaderboard`, `rewards`, `admin`, `balance`, `daily`, `pay`, `shop`, `buy`, `gamble`, `ledger`, `season`; options `user`, `amount`, `level`, `value`, `item`, `limit`, `days` | guild-only; `ManageGuild` for rewards/admin/season | Reads XP/rank, configures role rewards, administers levels, runs the ledger-backed currency (balance, daily, pay, shop/buy, gamble, ledger), and starts a season (archives, then clears the projection). |
| `/ticket` | subcommands `panel`, `open`, `claim`, `close`, `add`, `transcript`, `summary`, `stats`; options `subject`, `user`, `channel`, `ticket`, `title` | guild-only; `ManageGuild` for panel/transcript/summary/stats | Posts a panel, opens a private thread, claims/closes it, adds a participant, returns a transcript, calls the AI summary port and reports SLA stats. |
| `/tools` | subcommands `embed`, `tag`, `reminder`, `schedule`, `giveaway`, `giveaway-end`, `giveaway-reroll`, `poll`, `feed`, `stat`, `welcome`, `goodbye`, `roles`, `starboard`, `starboard-override`, `voice`, `birthdays`, `birthday`, `suggestions`, `suggestion`, `suggestion-decide`, `sticky`, `responder`, `responders`, `responder-remove`; options `name`, `value`, `channel`, `target`, `role`, `user`, `duration`, `limit`, `url`, `match` | guild-only; `ManageGuild` for configuration and server-wide sends | One utility root for content, giveaways, feeds, stat channels, reaction-role buttons/selects, birthdays, suggestions, sticky messages, auto-responders and event configuration. |

The three roots are part of the current **20 roots / 141 subcommands**. The P3
exit requires fewer than 20 roots; this is well inside it.

### Context menu

| Menu | Type | Guards | Behaviour |
| --- | --- | --- | --- |
| `Rank card` | user | guild-only, 3 s cooldown | Reads the selected member's `LevelingService.rank` projection and replies with an embed: level, XP and server rank |

The menu is an application command of type 2 and costs no root. It is called a
card but is deliberately **not** a rendered PNG: this build has no image
renderer, and a client-side placeholder would be fiction. It reads the same
rows as `/rank view` and does not mutate XP or currency.

## Features and where they live

| Feature | Behaviour | Service |
| --- | --- | --- |
| XP and levels | Message XP, injected cooldown clock, one award per message id, projection updated from `xp_events` | `LevelingService` |
| Role rewards | Configured level thresholds grant roles once when crossed | `LevelingService` |
| Leaderboard | Top profiles by XP, guild-scoped | `LevelingService` |
| Seasonal reset | Admin starts a keyed season; profiles archived to `community_records`, marker written, `levels` cleared; repeated start is a no-op | `SeasonService` |
| Economy | Daily through the kernel cooldown; atomic transfers and purchases; shop role items; capped opt-in gambling; balances derived from an append-only ledger | `EconomyService` |
| Welcome / goodbye | Welcome text/DM, immediate role or durable delayed-role record applied by the tick; goodbye is text-only on member leave | `WelcomeService` |
| Reaction roles | Button panel plus multi-select/multi-role select panel; selected set reconciled against the panel | `ReactionRoleService` |
| Starboard | Global threshold plus per-source-channel threshold and destination overrides | `StarboardService` |
| Birthdays | Guild timezone, due-day announcement, optional role, once per user per year | `BirthdayService` |
| Suggestions | Validated submission, one vote per user, up/down buttons, approval/rejection with immutable decision | `SuggestionService` |
| Giveaways | Timed start, one entry per member, end, DM winners and reroll | `GiveawayService` |
| Temporary voice | Hub channel creates an owned room; empty room deletion is owner-scoped | `TempVoiceService` |
| Thread tickets | Panel, private public thread, claim, close, add, transcript, stats | `TicketService` |
| Embeds | Validated title/description/fields, 6,000-character cap | `ContentService` |
| Tags | Data-only, lowercase names, max count, owner recorded | `ContentService` |
| Reminders | User DM or channel delivery through a delayed `content.deliver` job, idempotent `sent` flag | `ContentService` |
| Scheduled messages | Channel delivery at a due time through the same delayed job | `ContentService` |
| Polls | 2–5 options, one vote per member, counts | `ContentService` |
| Feeds | RSS/Atom-style item parser, GUID dedupe, channel delivery | `ContentService` |
| Stat channels | Member/online/boosters metric record, rate-limited adapter tick | `ContentService` |
| Sticky messages | Per-channel configured message, repost after N human messages, duplicate event no-op, previous sticky deleted by its recorded id | `StickyService` |
| Auto-responders | Operator-owned exact, contains or regex triggers; one reply per message (exact > contains > regex); per-trigger cooldown; guild-scoped records | `AutoResponderService` |

## Data

- `levels` and `xp_events` — XP is a projection; the event ledger is the truth.
  A season archives the projection and keeps the event history.
- `economy_ledger` — append-only. Every movement has a unique idempotency key and
  the balance is `SUM(amount)`; there is no balance column. A transfer writes a
  paired `:out`/`:in` entry in one transaction, and a checked debit reads the sum
  and inserts the negative entry under the same guild lock.
- `tickets` — thread-backed lifecycle and SLA timestamps.
- `community_records` (migration 0004) — guild-scoped `(kind, key)` records for
  reaction-role panels, starboard entries, giveaways, tags, embeds, reminders,
  feeds, stat channels, temporary voice, ticket events, birthdays, suggestions,
  sticky messages, auto-responder triggers, delayed autoroles, season state and
  season archives.

Season reset is transactional in the Drizzle adapter: archive rows, idempotency
marker, then delete the projection. Modules never import a table; the module owns
`CommunityStore` and the composition root injects the adapter.

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Community event processing |
| `xp.minPerMessage` / `maxPerMessage` | `15` / `25` | Base award range |
| `xp.cooldownMs` | `60000` | Per-member award window |
| `xp.multiplier` | `1` | Server-wide multiplier |
| `xp.rewards` | `[]` | `{ level, roleId }` rewards |
| `economy.currency` | `coins` | Display name |
| `economy.dailyAmount` | `100` | Daily claim |
| `economy.dailyCooldownMs` | `86400000` | Kernel cooldown window; the UTC day key remains the hard guard |
| `economy.transferMax` | `10000` | Per-transfer cap |
| `economy.gambling` | `false` | Opt-in gambling |
| `economy.gambleMax` | `100` | Per-bet cap |
| `economy.shop` | `[]` | Role/tag items |
| `welcome.*` | disabled | Channel, message, role, DM, `roleDelayMinutes` |
| `goodbye.*` | disabled | Channel and message; no role or DM branch |
| `starboard.*` | disabled | Channel, threshold, emoji, per-channel `overrides` |
| `birthdays.*` | disabled | Channel, role, IANA timezone |
| `suggestions.*` | disabled | Channel, min/max length |
| `sticky.maxPerChannel` | `1` | Configuration guard |
| `tickets.*` | enabled config | Support role, SLA, open-ticket cap |
| `giveaways.*` | enabled config | Max duration/winners |
| `tempVoice.*` | disabled | Hub, category, name template, user limit |
| `content.*` | enabled config | Tag/embed caps |
| `feeds.*` | 5 feeds / 15 min | Feed cap and poll interval |
| `statChannels.*` | 3 channels | Stat-channel cap |
| `responders.enabled` | `false` | Master switch for automatic replies |
| `responders.max` | `25` | Guild trigger cap |
| `responders.cooldownSeconds` | `10` | Default per-trigger cooldown; a trigger can override it |

## Events and safety

- XP awards and currency movements use idempotency keys. Re-delivery cannot
  double-award or double-spend.
- Economy refusals are explicit: insufficient funds, self-pay, bot target,
  transfer cap, bet cap and an already-claimed daily. The store's reason reaches
  the user; nothing is silently clamped or overdrawn.
- Money mutations serialize per guild: Postgres locks the guild row with
  `SELECT … FOR UPDATE`; the in-memory store uses one queue. Two concurrent
  debits cannot both pass the balance check.
- Shop purchases debit first and grant the role second. A failed grant is
  reported as an explicit repair request; the ledger entry stays auditable.
- Birthdays mark `lastAnnouncedYear` only after a successful send, so a failed
  send retries; a second tick in the same year is inert.
- Suggestions allow one vote per user; repeating the same vote is a no-op, a
  decided suggestion refuses new votes, and repeating a decision changes nothing.
- Select-role values are checked against the stored panel role set; unmanaged
  values are rejected. Reconciliation is idempotent.
- Delayed autoroles are records with `applied`; the tick applies each once.
- Sticky deletion is limited to the message id the bot recorded; duplicate
  message events do not increment the counter.
- Season archives and markers make reset retries idempotent; no `xp_events` are
  deleted.
- Auto-responders send at most one reply per message, choose exact over
  contains over regex regardless of storage order, and skip a trigger whose
  cooldown has not elapsed. The cooldown timestamp is written only after a
  successful send. Records are guild-scoped; the operator owns every trigger and
  response, and there is no remote word list. Replies send with empty
  `allowedMentions`, so a trigger cannot ping a role or `@everyone`.
- A bot-authored message is ignored unless it carries the dev-only
  `keystone-test:` marker and the guild is the configured development guild. A
  marker message reaches the auto-responder only; it does not award XP, touch the
  starboard or append a ticket transcript.
- Ticket transcripts are the only default message-content store; documented.
- No punitive action is taken by birthdays, suggestions, sticky or seasons.

## Limits

Commands: 3 global roots (20/100 total) plus one user context menu. Components: a select holds at most 25
options and one action row; buttons are capped at five per row. Intents:
`GuildMembers`, `GuildMessages`, `MessageContent`, `GuildMessageReactions`,
`GuildVoiceStates`. `MessageContent` and `GuildMembers` are privileged and already
required by moderation; no new privileged intent is added.

## Open / non-goals

- Live Discord sends, gateway events, select interactions, threads, voice, live
  role grants and the scheduler tick are unverified without a token/staging guild.
- Reminders and scheduled messages use the bot-side durable timer (pass 45);
  giveaways, delayed autoroles, birthdays, seasons and feeds still run on the
  60-second process tick.
- Goodbye messages are text-only and have no Components V2 panel;
  YouTube/Twitch-specific feed adapters and MEE6 XP import remain open (import
  is P5).
- A failed shop role grant has no automatic refund/repair command; the user is
  told to ask an admin and the ledger entry remains. A review queue is not built.
- `statChannels.online` is approximated by member count; presence is not an intent.
- Translation is a non-goal; global economy is a non-goal.
