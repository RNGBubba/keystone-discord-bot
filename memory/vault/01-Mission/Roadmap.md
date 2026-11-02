# Roadmap

> This is the phase index for the approved **Roadmap v2** ([[ADR-0013-roadmap-v2-portability-first]]).
> For the reasoning and the specialist team read [[Master-Plan]]; for the
> feature-level truth read the generated [[Feature-Status]].

Each phase ends with **a demo, a doc, a memory update and a written critique**.
A phase is not done because the code exists.

## Done

### P0 — Foundation

Kernel, module contract, reference module, memory system, strict TypeScript,
token-free tests, command-budget ledger. Exit: `pnpm check` green without a token;
the diagnostics module is the template.

### P1 — Substrate

Postgres data spine and ordered migrations, Drizzle settings repository, Redis
cooldowns with an explicit fallback, a BullMQ worker plus an in-process driver,
OpenTelemetry, `/setup`, a bundled production build and compose. Exit evidence is
in [[01-Mission/Status|project status]] and pass 04.

### P2 — Moderation and security

Cases and atomic case numbers, `/mod`, the invite/mention/duplicate scanner,
native AutoMod plan, evidence cards, review queue, appeals, anti-nuke, anti-raid,
quarantine, join gate, `/verify` and action logging. Dry-run is the default.

### P3 — Community

Leveling, economy ledger, reaction roles, welcome/delayed autorole, starboard,
thread tickets, giveaways, temp voice, content/sticky tools, feeds, seasons,
birthdays, suggestions, polls and stat channels. `/rank`, `/ticket` and `/tools`
are the only new roots.

### P4 — AI and economy hardening

Provider abstraction, hard per-guild dollar and request caps, server-doc RAG,
ticket deflection, mention-only chat, moderation explanations, summaries and
advisory classification. Balances are sums over `economy_ledger`; movements are
idempotent and double-spend-safe.

### P4.5 — Platform hardening (done 2026-10-31)

**Why first:** Discord's channel-obfuscation change lands **2026-11-16**, and the
June 2026 privileged-intent threshold is 10,000 users.

**Done:** `resolveChannel()` and all nine fetch sites migrated; the
`CHANNEL_OBFUSCATED` fixture; required vs optional intents; `INTENT_PROFILE`;
`/setup` capability report; `audit:channels` and `audit:intents`; baseline commit;
six research pages; memory v2 and generated status pages.

**Exit evidence:** 1,616 memory checks; 26 focused tests at the hotfix point;
`pnpm check` green at close. Live obfuscated channels and a live gateway login
remain unproven here.

### P5 — Portability and migration (done 2026-10-31)

**Goal:** own the data-ownership wedge honestly.

**Done:**

- `packages/importer`: versioned `keystone.export` v1 bundle, canonical SHA-256
  checksum and counts; dry-run diff; transactional full restore; narrow settings
  + levels merge; 24-hour rollback; import and deletion receipts.
- Sources: saved MEE6 leaderboard JSON; generic JSON/CSV; Lurkr, Polaris, Arcane
  and XP Bot files; ProBot JSON and Ticket Tool HTML transcript archives; our own
  bundle for full-fidelity restore. No scraping and no vendor credentials.
- `packages/db` portability store (PGlite-tested), `pnpm portability` CLI and
  migration guides for Dyno, Carl-bot and Wick.
- Drift report over settings ids vs supplied live facts; report only.

**Exit evidence:** `packages/db/src/portability.test.ts` proves a 5,000-row
round trip, checksum equality, a failed restore that leaves the guild intact, a
24-hour rollback, deletion receipt and drift. `packages/importer/src/importer.test.ts`
covers tampering, versions, MEE6, CSV, transcripts and merge modes.

**Live Discord runs:** pass 14 (2026-11-01) logged in as AI Team#5758,
registered 10 commands, and got qwen3:8b replies in `#ai-chat`. Pass 15 added a
dev-only `!` bridge because SaseQ's MCP cannot invoke slash commands; `!ping`,
`!about`, `!ai status`, `!mod history` and `!rank leaderboard` then ran through
the real registry, guards and reply adapter. The ready path fetches the global
command set and only clears and re-registers when the names drift; otherwise it
logs that the set is current. `pnpm commands:resync` is the explicit cycle. The
slash `InteractionCreate` path still needs a human client.

**Public release (pass 16):** the repo is public at
https://github.com/RNGBubba/keystone-discord-bot under AGPL-3.0-or-later. The
README covers setup, commands, features, agent onboarding and the Obsidian vault;
`AGENTS.md` is the short read order for contributors and agents.

**Honest limits:** MEE6 live fetch is not wired (file only); the CLI's drift
facts still come from a JSON file, while `/export drift` reads the gateway cache;
messages and attachments cannot be exported; merge does not combine history.
No live Postgres, slash-command run or human mention was performed. Pass 31
added `/export guild | user | import | delete | drift | rollback`; guild and
member exports and drift were proven live in memory mode, while import, delete
and rollback are SQL-only and tested on PGlite.

## Next

### P6 — Dashboard, API and fleet

**Goal:** one dashboard with real per-guild authorization and an API at every tier.

**Foundation shipped (passes 17–18, 2026-11-01):** see
[[ADR-0016-dashboard-foundation]] and [[Dashboard]]. The first slice is a
framework-free Node HTTP service so the authorization matrix could be proven
before a UI framework was added; settings writes followed through the same gate.

- [x] OAuth2 code + PKCE, sealed `state`, `iss` and exact redirect validation.
- [x] Opaque Postgres-backed sessions; the Discord access token sealed
  server-side and never sent to the browser. No refresh token is stored until
  refresh/rotation exists.
- [x] `GuildAccessService` with BigInt permissions and a bot-token membership
  check; CSP, CSRF and `no-store` on authenticated responses.
- [x] Read-only dashboard and `/api/v1` reads through the kernel
  `SettingsService` + `DashboardStore` seams.
- [x] Schema-validated module settings writes from the dashboard and API,
  through `SettingsService`, with CSRF and no mutation on invalid input.
- [ ] Next.js shell (or keep server-rendered HTML) and schema-driven field
  widgets; the current editor is a validated JSON textarea.
- [ ] Fleet view and templates with an explicit preview; audit log;
  import/export/drift surfaces; analytics aggregates.
- [ ] Session refresh/rotation and Discord token revocation on logout; per-route
  rate limits; `owners[]` for instance-wide actions.
- [ ] Public API v1: hashed scoped tokens, OpenAPI, `Idempotency-Key`, webhooks,
  per-token rate limits.

**Exit demo:** two guilds and two users; user A cannot read/write guild B through
the UI or API. Every setting is editable. A template applies with a preview. A
guild-scoped token cannot read another guild. A repeated POST returns the same
response.

**Kill signal:** if the authz matrix cannot pass, ship read-only fleet view first
and defer writes.

### P7 — Parity completion, UI and i18n

**Goal:** close the union the paid bots cover and make every panel fit the platform.

**Shipped slices:** invite tracking as `modules/invites` (pass 19) — cached-counter
attribution serialized per guild, durable `invite_joins`,
`/invites leaderboard | stats | who`, and advisory account-age / no-avatar
flags. Live: the command was registered and the `!invites` bridge ran in
`#ai-chat`; a live member join remains unperformed. The link / phishing filter shipped in
pass 23 — a local host blocklist plus punycode detection in `alert` or `delete`
mode, `/mod links` as its review queue, and a live MCP proof of three findings
and one review in `#ai-chat`. The profanity/zalgo filter shipped in pass 24 — an
operator-owned word list matched on Unicode word edges, a configurable
combining-mark threshold, `/mod filters` as the combined review queue, and a
live safe-seed proof of both finding types. The link delete branch was also
proven live once with a temporary `dryRun: false` seed, and pass 25 repeated the
delete proof for profanity. The auto-responder shipped in pass 25 — exact,
contains and regex triggers stored as guild records, one reply per message and a
per-trigger cooldown — and was proven live through the real gateway, including
cooldown suppression and release. Pass 26 made the command tree real: every
existing hub now registers Discord subcommands, `/help` is generated from the
registry, and boot sync plus `commands:doctor` compare the full option shape.
Pass 27 added a synthetic slash harness that crosses the real adapter and
dispatch for a nested `/mod ban`; it is not a gateway interaction, so a human
slash check remains open. Pass 28 added audit logging as the seventh module:
`/logging setup | channel | events | status | retention | export | disable`,
five event kinds, an append-only `logging_events` ledger, per-event toggles and
retention pruning. Message edit/delete and moderation cases were proven live in
the operator channel; member join/leave are adapter-tested only. Pass 29 added
guild analytics as the eighth module: `/analytics overview | members | messages
| commands | tickets | export` reads `logging_events`, `cases`, `invite_joins`,
`tickets` and a new append-only `command_usage` ledger; it adds no analytics
table. The live bridge matched 2 stored audit rows to 2 logged events and one MCP
edit/delete to 1 edited / 1 deleted. Pass 30 added in-bot configuration:
`/config list | get | set | export` reads and writes any registered module's
settings through `SettingsService` and the owning Zod schema, with no second
store. The live bridge set `moderation.automod.links` alert → delete → alert,
read each value back, and rejected `bogus` with the schema's own message. Pass 31
added in-Discord portability: `/export guild | user | import | delete | drift |
rollback` in the setup module, with real JSON file attachments, a dry-run-first
attachment import, exact-id delete and live drift facts from the gateway cache.
The SQL adapter is the existing `PortabilityService`; the memory adapter reads
the live stores and refuses destructive actions by name. Live: a 12.8 KB guild
bundle was downloaded and parsed back to the printed counts and checksum; a 2 KB
member bundle; drift went 1 missing → 0 missing; wrong-id delete and memory
rollback were refused. Pass 32 added the `/music` saved queue and its honest
playback refusal: eight subcommands over a durable `community_records` row, with
`play`, `skip` and `stop` naming the missing voice/Lavalink client. Live two adds
reached 2/25, `queue` listed them, playback refused, `remove` left 1/25, and a
disabled `add` was refused. Pass 33 added the four context menus the plan named:
**Report message**, **Case history**, **Rank card** and **Explain with AI**.
The kernel now models application-command type and audits the separate 15 + 15
menu budget; the menus reuse the existing case, level and AI services and add no
store. One memory-mode boot found all four missing, cleared once and registered
21 commands; at pass 33 Discord reported **17 roots / 108 subcommands / 2 user
menus / 2 message menus** with no drift. The MCP cannot right-click, so invocation is
covered by adapter and command tests and is not claimed live. Pass 34 audited the
subcommand gap: the only saved plan table names 12 roots / 59 subcommands, not
18 / 160, so the larger figure stays unverified rather than invented. The
largest named gap was `/setup` (5 names, 0 registered), now a real hub:
`status | module | verify | import | reset`. `module` and `reset` use the existing
settings service and schema; `verify` reads health, parsed settings and the live
catalog; `import` is a preview only over the existing export port. Live: 9
modules / 2 disabled, music enabled then reset to its default, read-back
confirmed disabled, and verify reported 17 roots / 113 subcommands. Pass 35 then
split `/appeal` into `open | status`: `open` appends the existing appeal event,
and `status` reads the append-only events through `CaseStore.listEvents`, so a
review that changes the case state cannot erase the appeal. Live: case #1 read
`warn · appealed · 1 appeal`, then `warn · reviewed · 1 appeal` after `!mod
review`; another member's case was refused. Pass 36 then closed the last two
named plan gaps: `/verify start` sends the verification button by DM after
checking the join gate, persisted state and DM-ability, and `/verify status`
reads the `members` row instead of gateway roles. Pass 37 repaired the state
machine behind that hub: an enforced join-gate hold writes the quarantined row,
`start` requires it, `status` reports no record, quarantined, verified or a
disabled gate, and completion transitions only a quarantined row. Pass 38 moved
the appeal/verify button parsing and member checks into a tested adapter, and
pass 39 moved the join-gate DM onto the moderation action port, so the two
audit findings are cleared. Pass 40 added `/form create | edit | delete | list |
panel | submit | review | export`: two owned tables, a pending-submission
invariant, a real review transition and a checksummed export, with modal input
deferred and named. Pass 41 added `/event create | edit | delete | list | rsvp |
remind | export`: a draft/open/closed lifecycle, one RSVP row per member,
capacity counted from `going` rows inside the store transaction, reminder
bookkeeping and a checksummed export, with buttons, scheduling and ICS deferred
and named. Pass 42 added `/modmail setup | open | reply | close | transcript |
stats`: private owner-or-staff threads over two owned tables, a first-staff-reply
claim, side-aware unread counters and a transcript archived once by a conditional
update, with DM/thread relay deferred and named. The ledger is now **20 roots /
141 subcommands / 161 actions / 4 context menus** after pass 46; the Master-Plan records 72
planned names across 14 built roots. Every recorded plan name is registered. The
rest of this phase is open.

- `packages/ui` (planned; it does not exist yet): Components V2 budgeter (40
  components, ~4,000 text), primitives, defer-then-edit, modal
  Label/FileUpload/Radio/Checkbox.
- New domains: role persistence; plus YouTube/Twitch/RSS feeds, join-gate
  expiry, case export and `command_usage` retention. Invites, the link,
  profanity and zalgo filters, auto-responders, analytics and the four context
  menus, the `/setup` hub, the `/appeal` hub, the `/verify` hub, forms, events
  and modmail are done (above). Pass 45 added temporary ban/temp-role expiry and
  durable reminder/scheduled delivery on the bot-side timer queue; pass 46 added
  panic mode and goodbye messages. Event buttons, event scheduled reminders,
  per-timezone ICS and a real modmail relay remain open.
- `/export`, `/config`, `/help` and the `/music` saved queue shipped; BYO
  Lavalink playback is the open half of `/music`; command-budget audit remains a
  gate, now covering the separate context-menu budgets.
- Split `modules/community` into domain folders, then extract a module only if the
  "add a feature in an afternoon" test still fails.
- `packages/i18n`: typed keys, per-guild locale, command localizations; no machine
  translation.
- AI invisible features: automod triage, semantic search, summaries; pgvector
  ANN benchmark remains a gate.

**Exit demo:** every panel passes the budgeter; every parity row has a command
path and a test; a guild switches locale; expiry jobs release temp actions; search
returns a cited case/ticket/doc; no prompt or completion is stored.

**Kill signal:** if the module split churns, stop at subfolders; if pgvector misses
its gate, keep the exact index and mark the ANN row open.

### P8 — Music and activities

**Goal:** complete the union without legal risk.

- The saved queue and its controls shipped in pass 32; `/music` is disabled by
  default and every playback command refuses until a client exists.
- Lavalink v4 through a thin adapter; BYO node; DJ role; no bundled streamer.
  The queue adapter is already behind `MusicStore`; playback implements the
  existing `MusicPlayback` port.
- Activity spike behind a flag; verify Portal eligibility; drop if ineligible.

**Exit demo:** an operator enables their own Lavalink and the controls work; the
repo contains no streamer; the Activity go/no-go is written down.

### P9 — Open-source launch

**Goal:** v1.0 a stranger can run and learn from.

- Licence finalised (AGPL-3.0 recommended), DCO, no CLA.
- Astro Starlight docs generated from the vault; link checker; tested snippets.
- Curriculum 14 lessons; module generator; `pnpm lesson:verify`.
- Root CONTRIBUTING/GOVERNANCE/SECURITY/CODE_OF_CONDUCT and issue/PR templates
  are in repo (pass 48); release workflow; changelog; Docker images.
- One-command self-host; status page, privacy policy, ToS; App Directory/top.gg
  listing assets; staging-guild E2E.

**Exit demo:** clean VM, one command, bot online, dashboard up, `/setup` green; a
stranger completes "build a module" in an afternoon; docs build zero warnings.

### P10 — Hardening and scale

**Goal:** survive 2,500+ guilds and platform changes.

- Sharding, `shard` param on `/users/@me/guilds`, per-shard metrics.
- Load tests, SLOs, alerts, incident drills, cost per 1,000 guilds.
- Annual intent review; channel-obfuscation regression; discord.js v15 migration.
- Backup/restore and deletion drills; dependency policy.
- Post-v1.0: captcha provider, Google Calendar sync, advanced analytics, mobile app.

**Exit demo:** load test at target p95; v15 migration is one PR; incident drill
inside 30 minutes.

## Phase migration map

| Old label | New label | Change |
| --- | --- | --- |
| P5 Dashboard & fleet | **P6** | Portability moved ahead; API added |
| P6 Music | **P8** | After parity/UI |
| P7 Launch | **P9** | Adds docs site, staging E2E, listings |
| P8 Hardening | **P10** | Same spirit |
| — | **P4.5** | New platform hotfix |
| — | **P5** | New portability wedge |
| — | **P7** | New parity completion, UI and i18n |

## Sequencing rule

P4.5 protects the platform deadline. P5 creates the data model the dashboard
needs. P6 exposes which settings have no UI and which modules are hard to teach.
P7 closes the union and the UI budgets. P8 is optional and must not block launch.
P9 launches only after a verified demo. P10 hardens with real traffic.
