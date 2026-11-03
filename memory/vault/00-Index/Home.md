# Keystone — vault home

An open-source, teach-by-default all-in-one Discord bot.

> **The one-line thesis:** every existing "all-in-one" is a stack of two to four
> half-bots, so we ship the union — free, documented, and built so a stranger can
> extend it in an afternoon.

**Public repository:**
https://github.com/RNGBubba/keystone-discord-bot

## Start here

| If you want to… | Read |
| --- | --- |
| Understand why this exists | [[Mission]] · [[North-Star]] |
| Know what we refuse to do | [[Non-Negotiables]] |
| See the order of work | [[Roadmap]] |
| See the whole mission | [[Master-Plan]] · [[Parity-Matrix]] |
| Check what is actually proven | [[01-Mission/Status\|Project status]] |
| Understand the code | [[System-Overview]] · [[Module-Contract]] · [[Live-Testing]] |
| Understand the 100-command wall | [[Command-Budget]] · [[Command-Catalog]] |
| Add a feature | [[04-Modules/diagnostics/Spec\|Diagnostics spec]] then copy the folder |
| Know what is actually shipped | [[Feature-Status]] · [[Pass-Ledger]] |
| Know what competitors do | [[02-Research/Competitors/MEE6\|MEE6]] · [[Dyno]] · [[Carl-bot]] · [[Competitive-2026]] |
| Know the platform limits | [[Platform-Limits]] · [[Platform-2026]] |
| Know what can be imported | [[Import-Formats]] · [[Migration-Guides]] |
| Export, restore or delete a guild | [[Portability]] · [[Portability-Runbook]] |
| Know the dashboard security contract | [[Dashboard-Security]] · [[Dashboard]] |
| Know the evidence | [[Claims]] · [[02-Research/OSS-2026\|OSS-2026]] · [[User-Voice-2026]] |
| Teach or learn | [[Curriculum]] |
| Operate it | [[Release]] · [[Incident]] · [[Token-Leak]] · [[Intent-Review]] |

## Current state

- **In-bot configuration** in repo and live-proven (pass 30): `/config list |
  get | set | export` reads and writes every registered module's per-guild
  settings through `SettingsService` and the owning Zod schema. One root, four
  subcommands, no second store. Live: `moderation.automod.links` alert → delete
  → alert, read back after each write; `bogus` was rejected by the schema and
  nothing was stored. See [[04-Modules/setup/Spec|Setup spec]].
- **In-Discord portability** in repo and live-proven for export and drift (pass
  31): `/export guild | user | import | delete | drift | rollback`. Guild and
  member exports are real JSON file attachments; import defaults to a dry run
  and reads a CDN-only attachment; delete requires the exact guild id; drift
  reads the live gateway cache. The SQL adapter reuses `PortabilityService`;
  memory mode exports the live stores and refuses destructive actions by name.
  Live: a 12.8 KB guild bundle downloaded and parsed back to 49 settings / 1
  case / 1 case event / 1 ledger row / 1 record with the printed checksum; a 2
  KB member file; drift 1 missing → 0 missing; wrong-id delete and memory
  rollback refused. See [[04-Modules/setup/Status|Setup status]].
- **Guild analytics** in repo (pass 29): `/analytics overview | members |
  messages | commands | tickets | export` is a read-only aggregate over the
  audit ledger, cases, invite joins, tickets and an append-only `command_usage`
  table. There is no analytics table and no invented metric; each view prints
  its source row counts. Live: `!logging status` reported 2 stored rows and
  `/analytics overview` reported the same 2 logged events; one MCP edit and one
  delete produced exactly 1 edited / 1 deleted. See
  [[04-Modules/analytics/Spec|Analytics spec]].
- Phase **P7** has started: invite tracking is the sixth module. It records
  attribution by diffing cached invite counters when a baseline exists (a cold
  cache records no inviter), stores joins/leaves in `invite_joins`, exposes
  `/invites leaderboard | stats | who`, and flags new or avatar-less accounts as
  advisory evidence only. The gateway state (cache, per-guild join queue) is
  owned by `apps/bot/src/invite-tracker.ts`; `invite-events.ts` only translates
  discord.js events. See [[04-Modules/invites/Spec|Invites spec]].
- **Content filters** in repo: the link/phishing filter (pass 23) uses a local
  host blocklist plus punycode detection; the profanity/zalgo filter (pass 24)
  uses an operator-owned word list on Unicode word edges plus a combining-mark
  threshold. Both support `alert` or `delete`; `/mod links` and `/mod filters`
  are the review queues. A dev-only `keystone-test:` marker makes the MCP proof
  possible. Live: link, delete, profanity and zalgo cases; `!mod filters` listed
  them and `!mod review` closed one; `example.com` produced no case. Pass 25
  also removed a profanity fixture in `delete` mode while keeping its case. See
  [[04-Modules/moderation/Spec|Moderation spec]].
- **Auto-responder** in repo (pass 25): exact, contains and regex triggers in
  the community record seam, one reply per message (exact beats contains, then
  regex), and a per-trigger cooldown. `/tools responder`, `/tools responders` and
  `/tools responder-remove` configure it under the existing root. Live:  the `hello keystone` trigger replied, a second message inside 60 seconds did not,
  and a third after the window did. See
  [[04-Modules/community/Spec|Community spec]].
- **Audit logging** in repo (pass 28): `/logging setup | channel | events |
  status | retention | export | disable` captures message delete/edit, member
  join/leave and moderation cases in one operator channel and an append-only
  `logging_events` ledger with a 1–365 day retention window. Events are stored
  before delivery, so a broken channel keeps the history. Live: a real edit and
  delete produced embeds with before/after content, a moderation case arrived
  through the case observer, and `!logging status | events | retention | export`
  ran through the real bridge. Member events are adapter-tested only. See
  [[04-Modules/logging/Spec|Logging spec]].
- **Music queue** in repo (pass 32): `/music play | queue | add | remove |
  clear | skip | stop | status` stores a durable queue in `community_records`,
  with a guild row lock in SQL and a per-guild lock in memory. Playback is a
  port with one explicit unavailable adapter: `play`, `skip` and `stop` refuse
  with the exact missing pieces instead of pretending audio. The queue is
  disabled by default. See [[04-Modules/music/Spec|Music spec]].
- **Context menus** in repo and registered (pass 33): four right-click commands
  reuse the existing services — **Report message** (opens a real case with the
  message id and a capped excerpt), **Case history** (same case rows as
  `/mod history`, behind `ModerateMembers`), **Rank card** (same XP projection as
  `/rank view`) and **Explain with AI** (same capped `AiService.explain` path).
  The kernel models command type and audits the separate 15 + 15 menu budget;
  Discord reports 2 user and 2 message menus. The MCP cannot right-click, so
  invocation remains the unobserved surface and is covered by tests.
- **Setup hub** in repo (pass 34): `/setup status | module | verify | import |
  reset`. Status is the readiness report; module lists, inspects and toggles a
  module through `ConfigPort` and its schema; verify reads health, parsed
  settings and the live catalog; import previews a bundle through the existing
  export port and never applies it; reset clears one module's settings record.
  Live: 9 modules / 2 disabled, music enabled then reset to its default with a
  disabled read-back, and verify reported 17 roots / 113 subcommands. The saved
  plan table records 72 planned names across 14 built roots; the 160 figure
  still has no complete per-root list.
- **Appeal hub** in repo and live-proven (pass 35): `/appeal open | status`.
  `open` appends the existing target-only appeal event; `status` reads
  `case_events` through `CaseStore.listEvents`, so it still reports an appeal
  after a moderator changes the case state. Live: `#1 · warn · appealed · 1
  appeal` became `#1 · warn · reviewed · 1 appeal` after `!mod review`; another
  member's case was refused.
- **Verify hub** in repo and live-proven for its checks (pass 36): `/verify start
  | status`. `start` checks the join gate, persisted state and DM-ability before
  sending the existing verification button by DM; `status` reads the `members`
  row, not gateway roles. Live: no record, then the exact DM refusal, then still
  no record. The DM button click is covered by tests; the MCP bot cannot receive
  it. The saved plan table is now complete at 59 of 59 names.
- **Forms** in repo and live-proven (pass 40): `/form create | edit | delete |
  list | panel | submit | review | export` is the tenth module. `forms` and
  `form_submissions` hold the rows; `(guild_id, key)` is unique and a partial
  unique index allows one pending submission per member per form. A review only
  transitions a `submitted` row, deletion is refused while history exists, and
  export is a checksummed JSON file. Live: create → open → panel → submit → 1
  pending → accepted with a note → a 1.5 KB file that downloaded and parsed with
  the same answers. Modal input is not shipped; `submit` takes the validated
  `answers` option.
- **Events** in repo and live-proven (pass 41): `/event create | edit | delete |
  list | rsvp | remind | export` is the eleventh module. `events` and
  `event_rsvps` hold the rows; `(event_id, user_id)` is unique and capacity is
  counted from `going` rows inside the store transaction. RSVP has no user
  option, deletion is refused while attendance exists, reminders record who
  sent them, and export is a checksummed JSON file. Live: create → open → 1/2
  going → reminder 1 → decline 0/2 → going 1/2 → a 1.2 KB file that parsed with
  the same row. Buttons, scheduled reminders and ICS are open, not faked.
- **Modmail** in repo and live-proven (pass 42): `/modmail setup | open | reply |
  close | transcript | stats` is the twelfth and last plan root. A thread belongs
  to its opener; another member gets the same refusal as a missing thread. The
  first staff reply claims it, side-aware unread counters track the queue, and
  close stores the transcript and SHA-256 once in a conditional update. Live:
  2 messages archived, duplicate close refused, stats 1 thread / 0 active / 2
  messages, disabled open refused. DM/thread relay is open, not faked.
- **Timers** in repo, SQL/service live (pass 45): `/mod ban duration` and
  `/mod temp-role` write `expires_at` and schedule one delayed
  `moderation.expire` job; `/tools reminder|schedule` use the same bot-side
  queue. Cases and community records are the durable facts, an atomic claim
  decides who releases or sends, and startup recovery reschedules or expires.
  The live probe proves the SQL, queue and service paths; the Discord action was
  a recording port, so gateway delivery is still unverified. See
  [[04-Modules/moderation/Status|Moderation status]].
- **Command tree** in repo (passes 26, 30, 31, 32, 33, 34, 35, 36, 40, 41 and 42): real Discord
  subcommands replaced the flat `action` option across every existing hub — 20
  roots, 141 subcommands, 161 actions, 4 context menus. `/help` is generated
  from the live registry; `pnpm commands:catalog` writes [[Command-Catalog]] and
  `pnpm commands:doctor` checks the live shape. A human slash or right-click
  invocation remains the unobserved surface.
- Phase **P6** foundation in repo: Discord OAuth2/PKCE, opaque Postgres-backed
  sessions, BigInt per-guild authorization with a bot-membership check, a
  server-rendered dashboard, `/api/v1` reads and schema-validated module settings
  writes from the HTML form and a CSRF-protected `PATCH`. Field widgets, fleet
  actions and scoped API tokens are still open. See [[Dashboard]] and
  [[ADR-0016-dashboard-foundation]].
- Phase **P5** complete in-repo: versioned export/restore with checksum
  verification, 24-hour rollback, deletion receipts, file level importers,
  transcript archives and a read-only drift report.
- **Public release (pass 16):** AGPL-3.0-or-later, README and `AGENTS.md` for
  humans and agents, and a safe drift-only command sync with an explicit
  `pnpm commands:resync` cycle.
- **No paid dependencies:** the project uses public GitHub, Discord, local
  Postgres/Redis/Ollama and free in-process test engines only.
- **Truth pass (pass 43):** `pnpm audit:claims` checks documented counts,
  module paths, the `/help changelog` pointer and Components V2 claims against
  the code; `memory:check` checks the module layout, the Status `Now` pointer
  and the lesson map. The stale root/module/Docker notes are corrected.
- **Slash harness (pass 27):** a nested `/mod ban` payload crosses the real
  adapter and dispatch and creates a case; this is structural, not a gateway
  `InteractionCreate`. Two live bot process trees were found double-posting and
  stopped, leaving one bot and one reply per command. The `.env` points at
  localhost Postgres/Redis; pass 44 started the compose services and applied the
  13 migrations then in the ledger, pass 45 added `0014_case_expiry`, and
  `pnpm probe:live` now passes 14/14, so the SQL window is open. See
  [[06-Operations/Live-Window|Live window]].
- **Live 2026-11-01:** AI Team#5758 logged in, found four context menus missing,
  re-registered 17 roots with 108 subcommands plus 2 user and 2 message menus
  (then fetched Discord's shape to prove it); pass 34 split `/setup` into five
  subcommands, pass 35 split `/appeal` into two, and pass 36 split `/verify`
  into `start | status`, bringing the live ledger to 117; all three hubs were
  driven through the bridge. Pass 37 made the join gate persist an enforced
  quarantine hold, so `/verify start` can no longer bypass the state it was
  meant to check. Pass 38 moved the appeal/verify button parsing and member
  checks into `apps/bot/src/moderation-buttons.ts` with 13 focused tests, so
  `index.ts` no longer owns those rules. Pass 39 moved the join-gate DM onto
  the moderation action port, so moderation no longer borrows the community
  adapter. Pass 40 added `/form`, bringing the live ledger to 18 roots / 125
  subcommands; `!form create | edit | panel | submit | review | export` ran the
  whole flow, and the exported file parsed with the same pending → accepted
  rows. Pass 41 added `/event`, bringing the ledger to **19 roots / 132
  subcommands**; `!event create | edit | rsvp | list | remind | export` ran
  draft → open → 1/2 going → reminder → decline → going, and the exported file
  parsed with the same RSVP row and a matching checksum. Pass 42 added
  `/modmail`, bringing the ledger to **20 roots** at pass 42; `!modmail setup | open | reply |
  transcript | close | stats` ran an open thread through a 2-message archive, a
  refused duplicate close and a 1/0/2 queue read. Also
  qwen3:8b via Ollama answered mentions in `#ai-chat`. A dev-only `!` bridge
  proved `!ping`, `!about`, `!help commands`, `!help browse`, `!help search
  query=ban`, `!ai status`, `!mod history`, `!mod links`, `!mod filters`,
  `!rank leaderboard`, `!invites leaderboard`, `!invites who`, `!logging status`,
  `!logging events`, `!logging retention`, `!logging export`, `!analytics
  overview`, `!analytics commands`, `!analytics messages`, `!config list`,
  `!config get`, `!config set`, `!export guild`, `!export user`, `!export
  drift` and `!music status | add | queue | play | remove | skip` through the
  real dispatch pipeline; `/config export`, `!export import` and `!music clear`
  are covered by tests, not the live bridge. Audit logging also delivered live message-edit,
  message-delete and moderation-case embeds to the configured channel. The content filters produced live link, delete, profanity
  and zalgo cases; `!mod filters` listed them, `!mod review` closed one, and
  `example.com` produced none. The auto-responder trigger replied, its cooldown
  suppressed a second reply, then released. Slash execution still needs a human
  client; the MCP cannot invoke application commands or render embeds.
- Phase **P4.5** made channel obfuscation a typed outcome at every fetch site,
  separated required from optional intents with `INTENT_PROFILE`, and made `/setup`
  name disabled features.
- Phase **P4** shipped the AI layer and the ledger-backed economy hardening.
- Phase **P3** shipped the community suite: leveling, reaction roles, welcome,
  starboard, tickets, giveaways, temp voice, content and seasons.
- 20 of Discord's 100 global roots used, with 141 subcommands and 4 context
  menus (separate 15 + 15 budget); 12 modules registered.
- The full suite covers the 5,000-row portability round trip and the failure,
  rollback and deletion paths; `pnpm check` also runs the intent, channel and
  memory audits.
- Optional services: without `DATABASE_URL`/`REDIS_URL` the bot runs in a logged
  local mode; `/setup` reports which one is live.

Machine truth lives in `memory/machine/project.json` and the generated
[[Feature-Status]]; this page is the map, not the source of truth.

## The decision log

- [[ADR-0001-discordjs-v14-adapter]] — discord.js v14 behind a thin adapter
- [[ADR-0002-monorepo-dev-first]] — pnpm monorepo, no build step in the loop
- [[ADR-0003-command-budget]] — the budget is a CI gate, not a guideline
- [[ADR-0004-memory-system]] — two halves, checked against each other
- [[ADR-0005-module-contract]] — folders, not switches
- [[ADR-0006-ports-and-adapters]] — Postgres, Redis and BullMQ behind ports
- [[ADR-0007-moderation-capability-port]] — cases and Discord actions behind ports
- [[ADR-0008-community-capability-port]] — one community port over typed data and actions
- [[ADR-0009-select-rows-and-season-archives]] — select menus and non-destructive season resets
- [[ADR-0010-ai-provider-and-caps]] — provider abstraction, hard guild caps and zero retention
- [[ADR-0011-economy-ledger-and-double-spend]] — derived balances, guild lock and idempotent money
- [[ADR-0012-required-and-optional-intents]] — required/optional intents and one channel resolver
- [[ADR-0013-roadmap-v2-portability-first]] — P4.5–P10, portability before dashboard
- [[ADR-0014-memory-v2-machine-truth]] — machine files, generated Markdown, CI drift check
- [[ADR-0015-portability-bundles-and-receipts]] — checksum bundles, transactional restore, narrow merge, receipts
- [[ADR-0016-dashboard-foundation]] — framework-free HTTP, opaque sessions, per-guild authz first
- [[ADR-0017-invite-tracking]] — diff cached invite counters, store joins, advisory flags only

## Open questions

[[Open-Questions]] — the licence (AGPL-3.0 recommended), hosted-tier posture and
Activities eligibility. P4.5 and P5 are not blocked by them; the licence blocks
external contributions and P9 launch.
