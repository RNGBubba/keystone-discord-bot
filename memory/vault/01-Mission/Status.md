# Project status

## Now

**Pass 55 added the P6 scoped API tokens** (2026-11-03): a `keystone_…` secret
is shown once by the dashboard and stored only as a SHA-256 hash in
`api_tokens` (migration 0018), bound to one guild and a subset of `guild:read`,
`analytics:read` and `settings:write`. Bearer authentication feeds the existing
`/api/v1` handlers instead of a second copy: the guild, the route scope and bot
membership are checked per request, a session write still needs CSRF and a token
write does not. Each token has its own fixed window (60 / min) and an unknown
secret is bucketed by address. Issue and revoke pass the guild write gate and
append one `api_token.issue` / `api_token.revoke` dashboard audit row. The
`/api/v1/openapi.json` document is generated from an operation table that a test
walks against the route registry in both directions, so it cannot silently
drift. Tests are **553 / 82 files**; `pnpm probe:live` is **20/20**, adding
`web-api-tokens`: the plaintext secret never reached a column, the token used the
overview and guild-list handlers and returned its own identity, foreign-guild and
wrong-scope calls were `403`, anonymous and bogus bearers `401`, the tight
per-token window returned `429` + `Retry-After` then recovered, revoke returned
`401` and audited exactly once. The OAuth exchange used a fake port; live
Discord OAuth remains open. See [pass 55](../../journal/2026-11-03-pass-55.md).

**Pass 54 hardened the P6 session path** (2026-11-03): an opaque session cookie
is re-keyed every 15 minutes on a safe `GET`, so the previous value is refused
immediately; logout asks the OAuth port to revoke the Discord access token
before deleting the row and still deletes it when Discord is unavailable; fixed
windows cap the auth (20 / 5 min), dashboard (120 / min), write (30 / min) and
API (60 / min) route classes with `429` + `Retry-After`; and `WEB_OWNER_IDS`
gates `/dashboard/instance` and its sign-out-every-session action, which a guild
admin cannot reach. Tests are **540 / 80 files**; `pnpm probe:live` is
**19/19**, adding `web-session-hardening`: 401 anonymous / 403 guild admin / 200
owner, the owner's revocation killed the admin session, every limited class
returned `429` then recovered while `/healthz` stayed exempt, the rotated cookie
replaced the old one, and logout revoked through the fake OAuth port. Live
Discord token revocation and live Discord OAuth are not claimed. See
[pass 54](../../journal/2026-11-03-pass-54.md).

**Pass 53 added the P6 dashboard analytics aggregates** (2026-11-03):
`GET /dashboard/guilds/:id/analytics` and
`GET /api/v1/guilds/:id/analytics` reuse the existing `AnalyticsStore` over
`logging_events`, `cases`, `invite_joins`, `tickets` and `command_usage`. There
is no analytics table, new writer or second aggregation path. The window is
bounded to 1–90 days; the page prints each source table's row count, marks open
tickets and active cases as current state, and says plainly when a window has no
retained rows. A web process without a shared database adapter says analytics is
unavailable instead of rendering an unexplained zero. Migration 0017 adds only
the four missing guild/time indexes those window queries need. Tests are **540 /
80 files**; `pnpm probe:live` is **19/19**, adding `web-analytics-aggregates`:
seeded rows in the real Postgres tables matched every API and page aggregate, an
empty guild was named, `days=91`/`abc` were refused at `400` and signed-out
reads at `401`. The OAuth exchange used a fake port; live Discord OAuth remains
open. See [pass 53](../../journal/2026-11-03-pass-53.md).

**Pass 52 finished the P6 template capability** (2026-11-03): an admin can save
a guild's effective module settings as a named template, list it, rename or
refresh it, delete it, and apply it to selected guilds. A saved template is a
guild-owned snapshot in `config_templates` (migration 0016) behind one
`SavedTemplateStore` port with in-memory and Drizzle adapters. Save parses every
module with its own Zod schema before the insert; apply re-validates the stored
row, so a template that has drifted out of validity is reported with each bad
path and refused at `400` instead of being applied. Valid templates reuse the
built-in path exactly: per-guild diff, SHA-256 preview fingerprint, re-authorize
every selected guild, one `SettingsService.update` per changed module and one
dashboard audit row. Create, update and delete append `template.*` audit rows.
There is no marketplace, second settings store or second write path. The carrier
is still the framework-free `apps/web` HTML app; no Next.js shell is needed for
this surface. Tests are **526 / 79 files**; `pnpm probe:live` is **17/17**,
adding `web-saved-templates`: real local HTTP on Postgres saved, listed,
previewed across two guilds without writing, refused a tampered and a stale
preview at `409`, applied one audited write per guild, refused an invalidated
stored row at `400`, and audited delete. The OAuth exchange used a fake port;
live Discord OAuth remains open. See [pass 52](../../journal/2026-11-03-pass-52.md).

**Pass 51 built the P6 config export, import and drift slice** (2026-11-03):
`GET /dashboard/guilds/:id/config/export` downloads a guild's effective module
settings as a checksummed `keystone.config` JSON file; credential-shaped keys
are omitted. Import accepts a multipart file, verifies kind/version, every
registered module, the SHA-256 checksum and each module's own Zod schema, then
shows the exact per-setting diff without writing. Apply is bound to a SHA-256
fingerprint of that plan; an edited checksum is refused at `400`, a stale
preview at `409`, and each changed module goes through `SettingsService.update`
with one dashboard audit row. Migration 0015 adds `config_baselines`, so the
applied bundle becomes the guild's baseline and the drift page compares baseline
to live, names an absent baseline, and reports a stored row that no longer
parses. The carrier remains the framework-free `apps/web` HTML app; no Next.js
shell, template table or second settings schema was added. Tests are **515 / 76
files**; `pnpm probe:live` is **16/16**, adding
`web-config-export-import-drift`: real local HTTP on Postgres, a 12-module file
export, multipart upload, preview with no write, `400`/`409` refusals, one
audited apply, a stored baseline, no drift, then one changed value after an
out-of-band update. The OAuth exchange used a fake port; live Discord OAuth
remains open. See [pass 51](../../journal/2026-11-03-pass-51.md).

**Pass 50 built the P6 fleet slice** (2026-11-03): `/dashboard/fleet` lists the
guilds the signed-in user can manage with their enabled modules. Three built-in
templates — alert-first moderation, strict moderation and quiet optional modules
— preview a schema-validated diff across a multi-guild selection: each patch is
deep-merged over current settings, parsed by the module's own Zod schema and
diffed with the audit helper, and nothing is written. Apply is bound to a
SHA-256 fingerprint of the displayed plan; a missing or stale preview is refused
at `400`/`409`, every selected guild is re-authorized (permission and bot
membership), and each changed module goes through `SettingsService.update` and
appends one dashboard audit row. The carrier remains the framework-free
`apps/web` HTML app; there is no template table, second schema or Next.js shell.
Tests are **502 / 74 files**; `pnpm probe:live` is **15/15**, adding
`web-fleet-templates`: two guilds on Postgres, preview diff, wrong-fingerprint
refusal, and one moderation write plus one dashboard audit row per guild. The
OAuth exchange used a fake port; live Discord OAuth remains open. See
[pass 50](../../journal/2026-11-03-pass-50.md).

**Pass 49 built the P6 schema-widget slice** (2026-11-02): the dashboard settings
editor is generated from each module's own Zod schema — booleans, bounded
numbers, enums, text/textarea, one-per-line arrays and a validated JSON fallback
— and named fields parse back into the patch `SettingsService.update` validates.
Every accepted settings update and reset now appends an `audit_events` row with
the actor, surface, module and dotted-path diff; the page shows the newest rows,
and `/config` and `/setup` pass the command actor. The carrier remains the
framework-free `apps/web` HTML app; no Next.js shell, `packages/ui` or second
settings schema was added. Two defects were fixed: `maxOutputTokens` was hidden
by an over-broad secret filter, and an explicit `undefined` optional value could
become SQL NULL. Tests are **488 / 73 files**; `pnpm probe:live` is **14/14**,
with new check `web-schema-widgets` driving real local HTTP login/session/CSRF
and the schema form on Postgres (save 9, one audit row, 5000 rejected at 400 with
no second row). The OAuth exchange used a fake port; live Discord OAuth remains
open. See [pass 49](../../journal/2026-11-02-pass-49.md).

**Pass 48 made the memory gate read prose** (2026-11-02):
`memory/machine/claims.json` names the documents that speak in the present tense,
and `pnpm memory:check` now recomputes roots, subcommands, actions, context
menus, modules, tests and passes from `commands.json`, `project.json`, the vitest
report and `passes.json`. A current-tense contradiction fails unless the sentence
names the pass it describes. A capability with no code evidence — Components V2,
i18n, the Next.js shell — must be marked planned. The drift named by the
completion plan is corrected: README counts, the Gate block, every module ledger
block, the stale Docker and expiry notes, and the V2/Next claims. The root
CONTRIBUTING, GOVERNANCE, SECURITY and CODE_OF_CONDUCT files and the issue/PR
templates now exist. No product behaviour changed. At pass 48 the suite was
**471 / 71 files** and the live probe was **13/13**. See
[pass 48](../../journal/2026-11-02-pass-48.md).

**Pass 47 completed the teaching phase** (2026-11-02): all 14 lessons are
written against the current code, and `memory/machine/lessons.json` makes them
checkable. `pnpm memory:check` now verifies every lesson's source paths, proof
commands, required sections and Curriculum link, and every count a lesson
asserts against `commands.json`, `live.json` or `project.json`. The README
Docker quickstart was corrected to match `apps/web/src/runtime.ts`: a
gateway-only host runs `docker compose up --build bot worker`, while the default
stack needs `SESSION_SECRET` before the optional web service can boot. No
product behaviour changed; tests remain **471 / 71 files** and the live probe is
still **13/13**. See [pass 47](../../journal/2026-11-02-pass-47.md).

**Pass 46 finished the P7 lifecycle block** (2026-11-02): panic mode and
goodbye messages. `/mod panic state:status|on|off` is one Administrator-only
switch. `on` snapshots every text channel's `@everyone` SendMessages overwrite
before denying it, persists the snapshot before replying, and `off` restores
exactly those channels; a failed restore keeps only the failures, so a second
`off` retries them instead of guessing. `/tools goodbye` writes the existing
community settings and `WelcomeService.handleLeave` sends the same placeholder
text as welcome to one channel, with no role or DM branch because the member is
already gone. There is no second scheduler: neither feature is time-bounded.
`pnpm probe:live` is **13/13**, adding a panic snapshot that is written, read
back and cleared on Postgres. The Discord lockdown calls and the member-leave
event are covered by adapter and command tests, not a gateway, so both rows
stay **live unverified for Discord**. Tests are **471 / 71 files**. See [pass
46](../../journal/2026-11-02-pass-46.md).

**Pass 45 added the first P7 timer slice** (2026-11-02): temporary moderation
and scheduled delivery now share one delayed queue. `/mod ban` accepts a
`duration`, `/mod temp-role` is a real subcommand, and both write `expires_at`
on the case and enqueue one `moderation.expire` job keyed by the case id. The
expiry atomically claims the case by clearing the timestamp, releases the
ban/role through `ModerationActions`, appends an `expired` event and closes the
case; a failed release restores the timestamp and records a note, and startup
recovery expires overdue cases and reschedules future ones. `/tools reminder`
and `/tools schedule` enqueue `content.deliver` on the same bot-side queue,
where one conditional claim decides which of the timer and the sweep sends; a
failed send releases the claim, so `sent` survives only a successful send.
Migration `0014_case_expiry` is applied. `pnpm probe:live` is **12/12**, adding
a delayed BullMQ timer, a real Postgres case expiry and real reminder/scheduled
delivery. The Discord port was recorded, not sent to a guild, so the three timer
rows remain marked **live unverified for Discord**. Tests are **457 / 68
files**. See [pass 45](../../journal/2026-11-02-pass-45.md).

**Pass 44 opened the live SQL window** (2026-11-02): `docker compose up -d
--wait postgres redis` started Postgres 16.15 and Redis, `pnpm db:migrate`
applied all 13 migrations, and `pnpm probe:live` passed **9/9** checks (pool
restart settings, shared Redis cooldown, BullMQ idempotency with a Postgres
receipt, portability dry-run/import/rollback/deletion, `/healthz` with
`database: postgres`). The first live run exposed a real migrator defect: postgres.js
rejects the raw `BEGIN` the runner sent across a pooled connection. `SqlRunner`
now exposes a driver transaction primitive with a PGlite rollback regression
test. The last machine report is [[06-Operations/Live-Window|Live window]] and
the full story is [pass 44](../../journal/2026-11-02-pass-44.md). This is bring-up and
proof, not a feature pass; no parity row was flipped without a check in
`live.json`.

**Pass 43 was a truth pass** (2026-11-02): no product behaviour changed except
`/help changelog`, which now reads the pass ledger instead of hard-coding pass
26. The pass audited the vault and machine files against the code. `AGENTS.md`
now names 20 roots and all 12 modules; the stale Components V2 notes are marked
planned because no `packages/ui` or V2 code exists; old ledgers in this page are
qualified as historical instead of presented as current; and the Docker notes
matched this machine at pass 43 (Docker Desktop 29.9.2 running, services down);
pass 44 then started them and passed the live probe.
`pnpm audit:claims` is now part of `pnpm check`: it checks documented root,
subcommand, action, module and test counts, module paths, the `/help changelog`
pointer and Components V2 claims. `memory:check` now also checks the module
layout, the Status `Now` pass pointer and the Curriculum lesson map.

The pass-42 modmail record below is retained as history.

**P7 modmail is in repo and live-proven for its command surface** (pass 42,
2026-11-01): `/modmail setup | open | reply | close | transcript | stats` is the
twelfth module and the last root named by the approved plan. `modmail_threads`
and `modmail_messages` are real tables (migration 0013); a partial unique index
on `(guild_id, owner_id) WHERE state <> 'closed'` allows one active thread per
member. A thread belongs to its opener: only the owner or staff can read, reply
or close it, and a foreign thread returns the same `was not found` refusal as a
missing one. The first staff reply claims an open thread; closing stores the
canonical transcript, its SHA-256 and its message count in one conditional
update, so a duplicate close writes nothing. `stats` lists the active queue with
thread ids so staff can answer. Live in `#ai-chat` with one memory-mode process:
setup read enabled, open wrote `0f7dbc9c-…`, the owner reply read `member side ·
2 messages`, the live transcript read 2 messages, close archived 2 messages with
checksum `c3c539706ed70e53…`, a duplicate close was refused, the archived read
reported 2 messages, `stats` read **1 thread / 0 active / 2 messages**, a
disabled open was refused and setup restored enabled. The MCP account is a bot
and owns its own thread, so a second member and a staff-side claim are covered
by tests, not claimed live. See [[04-Modules/modmail/Status|Modmail status]].

**P7 events are in repo and live-proven** (pass 41, 2026-11-01): `/event create |
edit | delete | list | rsvp | remind | export` is the eleventh module. `events`
and `event_rsvps` are real tables (migration 0012): a unique `(guild_id, key)`
makes `event:launch-night` unambiguous, and a unique `(event_id, user_id)` makes
one RSVP row per member structural. `EventService` owns the draft/open/closed
lifecycle, date parsing, the event cap and the capacity bound; `rsvp` reads the
member id from the interaction and has no user option, so no command can write
another member's row. The SQL adapter locks the event row and counts `going`
rows inside the write transaction, so the last seat cannot be sold twice; a
decline frees a seat because `not_going` is a row, not a delete. `remind` records
who sent it and when before the command posts the message; `delete` refuses
while any RSVP exists. Live in `#ai-chat` with one memory-mode process: create
wrote a draft, edit opened it, rsvp read **1/2 going**, remind posted **Reminder
1** with 1 going, a decline read **0/2**, a second going read **1/2**, and export
produced a **1.2 KB** file that downloaded (HTTP 200, 1242 bytes) and parsed as
**1 event / 1 RSVP** with the same capacity, reminder count, reviewer id and a
checksum that recomputes; delete was refused while the RSVP exists. Buttons,
scheduled reminders and ICS are not shipped and are not claimed. See
[[04-Modules/events/Status|Events status]].

**P7 forms are in repo and live-proven** (pass 40, 2026-11-01): `/form create |
edit | delete | list | panel | submit | review | export` is the tenth module.
`forms` and `form_submissions` are real tables (migration 0011): a unique
`(guild_id, key)` makes `form:staff` unambiguous, and a partial unique index on
`(form_id, user_id) WHERE state = 'submitted'` enforces one pending application
per member. `FormService` validates fields and answers, gates draft/open/closed,
refuses deletion while any submission exists, and transitions only a `submitted`
row with a conditional update; a second reviewer gets "already accepted/denied"
and nothing is written. `/form panel` refuses a non-open form, posts in the
invoking channel and records it; `/form export` attaches a `keystone.forms` JSON
file with a SHA-256 checksum. **Modal input is not shipped**: `submit` takes the
validated `answers` option and the panel prints the syntax, so there is no button
that opens nothing. Live in `#ai-chat` with one memory-mode process: `create`
wrote a draft, `edit` opened it, `panel` posted, `submit` wrote
`31778bdb-6180-4671-afab-03d4f880a626`, `review` read **1 pending**, a decision
`accepted` with a note transitioned it, a second `review` read **0 pending**,
`delete` was refused while the history exists, and `export` produced a **1.5 KB**
file that downloaded (HTTP 200, 1540 bytes) and parsed as **1 form / 1
submission** with the same answers, reviewer and note and a checksum that
recomputes. `commands:doctor` now reports **20 roots / 141 subcommands / 4
context menus** with no drift. See [[04-Modules/forms/Status|Forms status]].

**P7 `/verify` is a real two-subcommand hub with a complete persisted join gate**
(pass 37, 2026-11-01): the saved plan's last two names, `/verify start | status`,
are registered, so the plan table is complete at **59 of 59**. The join path now
writes a quarantined `members` row when an enforced `join-gate.*` hold lands,
and only then; dry runs and anti-raid holds create no verify row. `start`
requires that row, refuses a disabled gate and an already-verified member, then
sends the existing button by DM; a closed DM is a specific refusal. `status`
reads the persisted row through `MemberStore` and reports one of the four real
states. The in-guild and DM buttons share one `completeVerification` path, which
refuses no record and any non-quarantined row, and performs the quarantine
action before writing `verified_at`. No new table or migration; the row already
existed. Live in `#ai-chat` with the gate enabled: `!verify status` read **No
verification record**, `!verify start` returned **No quarantine is recorded for
you in this server**, and no row was written. The MCP account is a bot and
cannot make a member join, receive the DM or click the button, so the join and
completion paths are covered by security, command and PGlite tests, not claimed
live. Pass 39 moved the DM itself onto `ModerationActions.directMessage`, so the
join gate no longer borrows the community adapter; the body, button and refusal
text are unchanged. `commands:doctor` now reports **20 roots / 141 subcommands /
4 context menus** with no drift. See [[04-Modules/moderation/Status|Moderation
status]].

**P7 `/appeal` remains live-proven** (pass 35): `open` keeps the target-only
guard and appends the existing `appealed` event; `status` reads those events
through `CaseStore.listEvents`, so a review that changes the case state cannot
erase the appeal. Live: case #1 read `#1 · warn · appealed · 1 appeal`, then
`#1 · warn · reviewed · 1 appeal` after `!mod review`; a case against the bot was
refused with `Case #2 is not one of your cases.`

**P7 `/setup` is a real onboarding hub; the 160-subcommand target is corrected**
(pass 34, 2026-11-01): `/setup status | module | verify | import | reset` replaces
the previous root-only command. Status is the same readiness report; `module`
lists, inspects and toggles one module through `ConfigPort` and its Zod schema;
`verify` is a read-only check of database, settings parsing and the command
catalog; `import` previews an attached bundle through the existing `ExportPort`
with `dryRun: true` and never applies it; `reset` exposes the existing repository
`clear` through `ConfigPort.reset` and leaves cases, XP and ledger rows alone.
No new root, store, migration or paid service. Live in `#ai-chat`: `!setup
module` reported **9 modules · 2 disabled here**, `music` was enabled, then
`!setup reset module=music` returned it to its schema default and a fresh read
confirmed **disabled**; at pass 34 `/setup verify` read back from Discord
**17 roots · 113 subcommands** and **9 modules parsed**. `commands:doctor`
agreed with no drift. The MCP cannot attach a file or invoke slash, so `import` is
preview-tested only. The saved plan table's historical **12 roots / 59
subcommands** are not 18 / 160; the 160 figure has no per-root list in the repository and remains
unverified. See [[04-Modules/setup/Spec|Setup spec]] and
[[04-Modules/setup/Status|Setup status]].

**P7 context menus are registered in Discord and unit-proven; invocation is
human-only** (pass 33, 2026-11-01): the four right-click commands from the
approved v1.0 plan now exist — **Report message** (message), **Case history**
(user), **Rank card** (user) and **Explain with AI** (message). They cross the
same `asInteractionLike` adapter, type-keyed registry, guards, cooldowns and
`dispatchCommand` as slash commands. The kernel now models `CommandType`,
validates menu names separately (`"Explain with AI"` is legal), rejects
options/subcommands on a menu and audits Discord's separate 15 + 15 menu budget
without spending a root. Report message opens a real case with the message id and
a 500-character excerpt; Case history requires `ModerateMembers` and reads the
same rows as `/mod history`; Rank card reads the same `LevelingService.rank`
projection as `/rank view`; Explain with AI calls the same capped
`AiService.explain` path and honours the `explanations` switch. One memory-mode
boot found all four missing, cleared once and registered **21 application
commands**. At pass 33 Discord's own registry reported **17 chat-input commands ·
108 subcommands · 2 user menus · 2 message menus** with no drift; pass 34's
`/setup` hub brought the live ledger to 113. The MCP cannot
right-click, so the handlers were not invoked live; adapter and command tests
cover each path. See [[04-Modules/moderation/Status|Moderation status]],
[[04-Modules/community/Status|Community status]] and
[[04-Modules/ai/Status|AI status]].

**P8 music is in repo and live-proven for the saved queue; playback is explicitly
not shipped** (pass 32, 2026-11-01): `/music play | queue | add | remove | clear |
skip | stop | status` is the ninth module and the last named v1.0 root. The saved
queue is a real `community_records` row per guild (kind `music_queue`, key
`default`); the SQL adapter locks the guild row so concurrent adds hold the cap,
and the in-memory adapter serializes per guild. Playback is a separate port with
one adapter that refuses: this build has no Discord voice client, no Lavalink
client and no `LAVALINK_URL`, so `play`, `skip` and `stop` return that exact
reason and `/music status` prints `playback UNAVAILABLE`. The queue is disabled by
default; `status` still works while disabled. Live in `#ai-chat`: status showed
disabled 0/25, `/config set music.enabled=true` enabled it, two adds reached
2/25, `queue` listed both tracks, `play` and `skip` refused, `remove position=1`
left 1/25, and after disabling, `add` was refused. The root adds one slot and
eight subcommands; no migration, no new intent, no paid service. See
[[04-Modules/music/Spec|Music spec]] and [[04-Modules/music/Status|Music status]].

**P7 in-Discord portability is in repo and live-proven for export and drift**
(pass 31, 2026-11-01): `/export guild | user | import | delete | drift |
rollback` puts the P5 service inside Discord. Guild and member exports are real
JSON file attachments; import reads a Discord CDN attachment, verifies checksum
and counts, and defaults to a dry run; delete requires the exact guild id;
drift reads live channels, categories, roles and AutoMod names from the gateway
cache. One `ExportPort`; the SQL adapter is the existing `PortabilityService`
and the memory adapter reads the live stores and refuses destructive actions by
name. Live in `#ai-chat`: `!export guild` uploaded a **12.8 KB** bundle that was
downloaded and parsed with the same verifier (**49 settings · 1 case · 1 case
event · 1 ledger row · 1 record**, checksum `5cde59ae…`); `!export user`
uploaed a **2 KB** member file; a stale `logging.channelId` made drift report
**1 missing**, restoring the real channel made it **0 missing**; a wrong-id
delete and a memory-mode rollback were refused with named reasons. `!export
import` was not run live because the message bridge cannot carry an attachment;
the PGlite round-trip test covers preview → apply → verify → rollback. The root
adds one global slot and six subcommands; no module, table or migration. See
[[04-Modules/setup/Spec|Setup spec]] and [[04-Modules/setup/Status|Setup status]].

**P7 in-bot configuration is in repo and live-proven** (pass 30, 2026-11-01):
`/config list | get | set | export` is the settings surface for guild admins
inside Discord. It calls the same `SettingsService` the dashboard uses, so every
write is merged with the current record and validated by the target module's own
Zod schema before it is stored. The command is guild-only, requires
`ManageGuild` and has one root-level cooldown. It adds one root and four
subcommands, no module, no table and no second settings store. Live in
`#ai-chat`: `moderation.automod.links` went `alert → delete → alert`, with a
read-back after each write; `bogus` returned `automod.links: Invalid enum value`
and the next read still returned `"alert"`. Pass 31 added `/export` and pass 32 added
`/music`, pass 35 split `/appeal` into two, pass 36 split `/verify` into two and
pass 42 added `/modmail` with six, so Discord now reports **20 roots / 141
subcommands / 161 actions** including `config`, `export`, `form`, `modmail`,
`music`, the five `/setup` actions, the two `/appeal` actions and the two
`/verify` actions. The MCP cannot invoke slash
commands or render embeds, so the live proof is the message bridge with
plain-text replies; list/export embeds are covered by a command test. See
[[04-Modules/setup/Spec|Setup spec]] and [[04-Modules/setup/Status|Setup status]].

**P7 guild analytics is in repo and live-proven** (pass 29, 2026-11-01): the
eighth module adds `/analytics overview | members | messages | commands |
tickets | export` as a read-only aggregate over rows other modules already own.
There is no analytics table: `logging_events`, `cases`, `invite_joins`, `tickets`
and the new append-only `command_usage` ledger are queried directly, and every
view prints a source-row line. `AnalyticsStore` is one port with a SQL adapter
and an in-memory adapter over the same stores. The command is guild-scoped,
admin-only and capped at a 90-day window. Live: `/logging status` reported **2
stored** rows, `/analytics overview` reported the same **2 logged events**, and
one MCP edit plus one delete appeared as **1 edited / 1 deleted**. Command runs
rose 0 → 3 → 4 as bridge commands completed; an invocation is recorded after
its reply. At pass 29 Discord reported **14 roots / 90 subcommands / 104
actions**; pass 30 added `/config`, pass 31 added `/export` and pass 32 added
`/music`, pass 35 split `/appeal` into two, pass 36 split `/verify` into two and
pass 40 added `/form` with eight, so at pass 40 the ledger was
**18 / 125 / 143**; passes 41 and 42 brought the current ledger to
**20 / 138 / 158**.
The MCP text reader does not render embeds, so the live transcript proves the
summary text while the embed fields and JSON export are covered by a command
test. See [[04-Modules/analytics/Spec|Analytics spec]] and
[[04-Modules/analytics/Status|Analytics status]].

**P7 audit logging is in repo and live-proven for message and moderation events**
(pass 28, 2026-11-01): the seventh module adds `/logging setup | channel | events
| status | retention | export | disable`. Five event kinds (message delete, message
edit, member join, member leave, moderation case) are written to an append-only
`logging_events` ledger **before** best-effort delivery to one operator channel.
A disabled module or disabled event writes nothing; a missing or broken channel
keeps the row. Moderation cases enter through `CaseService.onOpened`, not by
re-reading the cases table. Retention prunes at startup, after `/logging
retention`, and every six hours. Live: the configured channel received a
test embed, a real edited/deleted MCP message produced before/after embeds, and a
blocked profanity message arrived as case #1 through the case observer;
`!logging status | events | retention | export` ran through the real dispatch
pipeline and reported 3 stored events. Member join/leave remain adapter-tested
only. See [[04-Modules/logging/Spec|Logging spec]] and
[[04-Modules/logging/Status|Logging status]].

**P7 invite tracking is in repo** (pass 19; cold-cache fix in pass 20;
gateway boundary in pass 21, 2026-11-01): the sixth module adds `/invites leaderboard | stats | who`,
durable `invite_joins` attribution with a unique
`(guild, user, joined_at)` key, SQL join/leave/retention totals, and advisory
account-age / no-avatar flags that never punish. A cold cache now records no
inviter and seeds the cache instead of diffing historical totals; the adapter
regression test covers that path. The bot receives `GuildInvites` and requests
`GuildMembers` optionally; a live join could not be performed because no second
Discord account was available. The gateway half is split: `invite-tracker.ts`
owns the cache and per-guild queue, and `invite-events.ts` only translates
discord.js events. MEE6's invite tracker is partly premium-gated (its wiki says
parts or the entirety may require Premium); neither Dyno nor Carl-bot documents
it. Distinguish this from P6, which remains open below.

**P7 content filters are in repo** (link pass 23; profanity/zalgo pass 24,
2026-11-01): the security engine checks a local host blocklist and punycode
labels, and matches an operator-owned word list on Unicode word edges plus a
configurable combining-mark threshold. Both support `alert` or `delete`;
`/mod links` and `/mod filters` list the findings, and `/mod review case=N`
closes one. There is no new command root. Live: marked MCP messages in
`#ai-chat` created link cases #1–#3 (subdomain, apex, punycode); `!mod review`
marked one reviewed; `example.com` created no case. With a temporary
`dryRun: false` / `delete` seed the blocked message returned
`10008: Unknown Message` while its case survived. The safe seed then produced a
profanity case for `pineapple` and a zalgo case for a 16-mark string; `!mod
filters` listed all three and `!mod review` closed the profanity case. A
`keystone-test:` marker is accepted from a bot author only in `DEV_GUILD_ID` and
stripped before the engine sees it; production has no marker path. See
[[04-Modules/moderation/Spec|Moderation spec]] and
[[04-Modules/moderation/Status|Moderation status]].

**P7 auto-responder is in repo** (pass 25, 2026-11-01): the community module
owns exact, contains and regex triggers in the existing
`community_records` seam. One trigger replies per message (exact beats
contains, contains beats regex), every trigger has its own cooldown, and
`/tools responder | responders | responder-remove` is the admin surface under
the existing `/tools` root. Live: the seeded `hello keystone` trigger replied to
a marked MCP message; a second identical message inside the 60-second cooldown
got no reply; a third after the window replied again. See
[[04-Modules/community/Spec|Community spec]] and
[[04-Modules/community/Status|Community status]].

**P7 command tree is in repo** (pass 26, 2026-11-01): the kernel gained
real Discord subcommands and subcommand groups. Every hub that existed at that
point exposes its working actions as subcommands — `/mod` 14, `/rank` 12,
`/ticket` 8, `/tools` 24, `/ai` 11 and `/invites` 3 — for 12 roots, 77
subcommands and 89 actions at pass 26. `/help` (`browse`, `commands`, `search`, `privacy`,
`changelog`) reads the live registry, so its catalog cannot drift.
`pnpm commands:catalog` generates `memory/machine/commands.json` and
[[Command-Catalog]], and `pnpm commands:doctor` prints the live registration
shape without writing. Two defects found during proof are fixed: the structural
adapter now flattens nested subcommand options, and boot sync compares the whole
option tree instead of names alone. Pass 28 added `/logging` with seven
subcommands, bringing the ledger to **13 roots · 84 subcommands · 97 actions** at
that point. Pass 29 added `/analytics` with six subcommands, pass 30 added
`/config` with four, pass 31 added `/export` with six and pass 32 added `/music`
with eight, pass 34 split `/setup` into five, pass 35 split `/appeal` into two,
pass 36 split `/verify` into two, pass 40 added `/form` with eight, pass 41
added `/event` with seven and pass 42 added `/modmail` with six; the current
ledger, after pass 45's `temp-role`, is **20 roots · 141 subcommands · 161
actions**. After pass 30 the boot found
`config` missing, cleared the global set once and re-registered it; pass 31's
boot found only `export` missing and did the same. Pass 33 now models context
menus as application commands with their own type and budget, and its boot found
all four menus missing and re-registered 21 commands. `commands:doctor` now
reports 20 roots / 141 subcommands plus 2 user and 2 message menus, including
`analytics`, `logging`, `config`, `event`, `export`, `form`, `modmail`, `music`,
the five `/setup` actions, the two `/appeal` actions and the two `/verify`
actions. See
[[03-Architecture/Command-Budget|Command budget]] and
[[03-Architecture/ADR/ADR-0003-command-budget]].

**P7 synthetic slash harness is in repo** (pass 27, 2026-11-01):
`apps/bot/src/interaction-harness.test.ts` builds the nested payload Discord
sends for `/mod ban user:@target reason:"posting raid invites" dry_run:false`
and runs it through the real `asInteractionLike` adapter, the real module
registry and `dispatchCommand`. It proves the adapter now flattens the nested
`user`/`reason`/`dry_run` options, the ban port receives the target and reason,
case #1 is created, and the reply reports the action; an unknown subcommand is
rejected before any side effect. This is a structural harness, not a gateway
connection — a human `InteractionCreate` remains unobserved. The pass also found
and stopped two live bot process trees that were double-posting replies; one
instance now answers each command once.

**Live SQL window (pass 44, 2026-11-02):** Docker Desktop **29.9.2 is installed
and running**; `docker compose up -d --wait postgres redis` started Postgres
**16.15** and Redis, and `pnpm db:migrate` applied all **13 migrations** through
the project's own runner. A real defect surfaced only here: the runner issued a
raw `BEGIN` through postgres.js, which refuses pooled transaction control, so
`pnpm db:migrate` failed with `UNSAFE_TRANSACTION`. `SqlRunner` now exposes a
driver transaction primitive; the Postgres and PGlite runners implement it, and
a regression test proves a failed migration rolls back completely. `pnpm
probe:live` then passed **9/9** checks: migrations, a settings row surviving a
pool close/reopen, a cooldown shared across two Redis clients, two enqueues
producing one BullMQ execution and a completed Postgres receipt, dry-run /
import / rollback / deletion through the SQL portability store, and `/healthz`
returning `database: postgres`. The last machine report is
[[06-Operations/Live-Window|Live window]]; the fallback memory mode still exists
but is no longer the configured path. Local Ollama is up (`qwen3:8b`,
`qwen3-embedding:0.6b`); the first `!ai chat` after boot hit the provider's
30-second cold-start timeout, and a warm retry returned `keystone`.

**P6 authorization and settings-write foundation is in repo** (passes 17–18;
server boundaries in pass 22, 2026-11-01): Discord OAuth2 code + PKCE, sealed
state, opaque Postgres-backed sessions, BigInt guild authorization with a
bot-token membership check, a server-rendered dashboard, `/api/v1` reads and
schema-validated module settings writes from both the HTML form and
`PATCH /api/v1`. The web process is split into an ordered route table, per-area
handlers, one request context, shared render/HTTP modules and one settings-write
CSRF gate. The browser never receives a Discord token; the session stores one
sealed access token and no refresh token.
Pass 49 generated the settings editor from each module's own schema and made
every accepted settings change append an `audit_events` row, so an edit is one
generic, schema-declared path rather than a hand-built form per module. Pass 50
added the fleet view and three built-in templates that preview a per-guild diff
and apply through that same path. Pass 51 added checksummed config export, a
previewed and audited import, and a baseline drift page through the same
schemas and write path. Pass 52 added named saved templates and audited their
create/update/delete through the same plan and writer. Pass 53 added read-only
analytics aggregates over the existing ledgers. Pass 54 added session rotation,
logout revocation behind the OAuth port, per-route rate limits and the
`owners[]` instance console. The remaining P6 exit items are idle timeout, a
Discord refresh-token path, scoped API tokens and the live Discord OAuth round
trip. See
[[Dashboard]] and [[ADR-0016-dashboard-foundation]].

**P5 is complete in-repo** (pass 13, 2026-10-31): a versioned export bundle with
checksum and counts, transactional restore with post-import verification, a
24-hour rollback, deletion receipts, file level importers, transcript archives,
a read-only drift report and migration guides. P4.5 platform hardening and the
P4 AI/economy layers remain as shipped.

**Web verification (passes 17–18):** `pnpm web:start` booted in memory mode;
real HTTP requests returned `/healthz` `200`, `/` `200`, `/api/v1/nope` `404` and
`/login` `503`. A real local HTTP server with a fake OAuth port proved login,
logout/CSRF, cross-guild `403`s, escaped HTML and no token in the response. The
same harness proved a `PATCH` and the HTML form persist real module settings via
`SettingsService`, invalid values are rejected without mutation, and a missing
CSRF token or unauthorized guild is refused. Live Discord OAuth is not claimed.

**Live verification (pass 15, 2026-11-01):** AI Team#5758 logged into the test
guild and answered a qwen3:8b mention in `#ai-chat`. SaseQ's `discord-mcp` cannot
invoke slash commands, so a **dev-only `!` bridge** now feeds the real dispatch
pipeline in `DEV_GUILD_ID`: `!ping`, `!about`, `!ai status`, `!mod history` and
`!rank leaderboard` all returned live Discord messages/embeds. Pass 19 added
`!invites leaderboard` and `!invites who`. Pass 26 re-registered 12 roots /
77 subcommands at the time; pass 28 added `/logging`, pass 29 added
`/analytics`, pass 30 added `/config`, pass 31 added `/export` and pass 32 added
`/music`, pass 34's `/setup` hub, pass 35's `/appeal` hub, pass 36's `/verify`
hub, pass 40's `/form`, pass 41's `/event` and pass 42's `/modmail`, so Discord's
fetched shape at pass 42 reported **20 roots / 138 subcommands** with no missing,
extra or changed roots.

The registry now has 141 subcommands.
The bridge
added `!help commands`, `!help browse`, `!help search query=ban`, `!mod history`,
`!ai status`, `!logging status`, `!logging events`, `!logging retention`,
`!logging export`, `!analytics overview`, `!analytics commands`, `!analytics
messages`, `!config list`, `!config get`, `!config set`, `!export guild`, `!export user`,
`!export drift`, `!music status | add | queue | play | remove | skip`,
`!appeal open | status`, `!verify start | status`, `!event create | edit |
rsvp | list | remind | export` and `!modmail setup | open | reply | transcript |
close | stats` to the live list. Pass 23
added `!mod links` and a live link-filter proof: three marked MCP messages
produced a blocklisted
subdomain case, an apex case and a punycode case; `!mod review case=2` marked one
reviewed, and an ordinary `example.com` link produced no case. Pass 24 added
`!mod filters` and profanity/zalgo, and closed the pending delete-mode gap: a
temporary `dryRun: false` / `links: "delete"` seed made the blocked message
return `10008: Unknown Message` while its case remained. The safe seed then
produced a profanity case for `pineapple` and a zalgo case for a 16-mark string,
listed by `!mod filters`; an ordinary sentence produced no case. Pass 25 then
repeated the delete proof for profanity: a temporary `dryRun: false` /
`profanity: "delete"` seed removed the `pineapple` message while case #1 stayed
open in `!mod filters`; the safe seed is committed. Pass 25 also added the
auto-responder: a marked MCP message matched the seeded `hello keystone` trigger
and got `Hi from Keystone's auto-responder.`, a second identical message inside
the 60-second cooldown got no reply, and a third after the window replied again.
`!ticket stats`
exposed a real ordering bug (guild stats required a ticket first), now fixed and
tested. On ready the bot fetches Discord's command set and only clears and
re-registers when the **name or option tree** drifts; otherwise it logs that the
set is current. `pnpm commands:doctor` is the read-only shape check and
`pnpm commands:resync` is the explicit clear → register → verify cycle. Slash
interaction handling from a human client is still unproven; at that pass,
obscured channels, live role grants, live Postgres and a MEE6 pull were
unverified. Pass 44 has since opened the live Postgres/Redis window (below). The
P6 auth
foundation is documented above. The baseline, P4.5, P5 and P6 foundation are
published at
https://github.com/RNGBubba/keystone-discord-bot under AGPL-3.0-or-later; the
public packaging pass also added the README and `AGENTS.md` read paths.

## Gate

```
pnpm check        exit 0 · typecheck 0 · 553 tests / 82 files · budget 20/100 roots (141 subcommands · 161 actions · 4 context menus) · claims current · live 20/20 · memory current
pnpm build        exit 0 · bot, worker, web, migrate and portability artefacts
live              2026-11-01 · AI Team#5758 · 2 guilds · 20 roots / 138 subcommands / 2 user menus / 2 message menus · one bot process · qwen3:8b reply in #ai-chat · /modmail open → reply → 2-message archive → duplicate close refused → stats 1/0/2 · /event create → open → rsvp 1/2 → reminder → decline → 1.2 KB export parsed with the same row · /form create → open → panel → submit → 1 pending → accepted → 1.5 KB export parsed with the same answers and decision · logging edit/delete/case embeds delivered · /config alert→delete→alert read back · /export 12.8 KB bundle parsed · /music 2/25 saved → 1/25 after remove, playback refused · /setup 9 modules, music enable → reset → disabled read-back · /appeal case #1 appealed → reviewed with the event retained, other member's case refused · /verify status no record → start refused with no quarantine → no row written
live menus        2026-11-01 · boot found Report message / Case history / Rank card / Explain with AI missing · one clear + re-register · 21 application commands · doctor reports 2 user + 2 message menus, no drift · right-click invocation not performed (MCP cannot)
live commands     2026-11-01 · !ping · !about · !help commands · !help browse · !help search query=ban · !ai status · !mod history · !mod links · !mod filters · !rank leaderboard · !invites leaderboard · !invites who · !logging status · !logging events · !logging retention · !logging export · !config list · !config get · !config set · !export guild · !export user · !export drift · !music status · !music add · !music queue · !music play · !music remove · !music skip · !appeal open · !appeal status · !verify start · !verify status · !event create · !event edit · !event rsvp · !event list · !event remind · !event export · !modmail setup · !modmail open · !modmail reply · !modmail close · !modmail transcript · !modmail stats
live slash harness 2026-11-01 · nested /mod ban through asInteractionLike + dispatch · case #1 + ban port · unknown subcommand rejected
live substrate  2026-11-03 UTC · Docker 29.9.2 · Postgres 16.15 with 17/17 migrations · Redis reachable · pnpm probe:live 20/20 · /healthz database=postgres · migration runner transaction defect fixed
live web widgets 2026-11-03 UTC · real local HTTP login/session/CSRF · AI form generated from schema · saved 9 · one audit row actor live-probe-web-user source dashboard · 5000 rejected at 400 with field preserved · OAuth exchange fake, live Discord OAuth open
live fleet     2026-11-03 UTC · real local HTTP fleet page listed two Postgres-backed guilds · strict-moderation preview diff · wrong fingerprint 409 · apply 302 · one moderation write + one dashboard audit row per guild · OAuth exchange fake
live config portability 2026-11-03 UTC · real local HTTP on Postgres · 12-module checksummed file export · multipart import preview with no write · edited checksum 400 · wrong fingerprint 409 · apply 302, one audited AI write, baseline stored · no drift, then one changed value after an out-of-band update · OAuth exchange fake
live saved templates 2026-11-03 UTC · real local HTTP on Postgres · saved from one guild and listed · two-guild preview with no write · tampered and stale 409 · apply 302, one audited write per guild · invalid stored row reported and refused 400 · create/update/delete audited · OAuth exchange fake
live dashboard analytics 2026-11-03 UTC · real local HTTP on Postgres · 7 audit rows, 3 cases, 2 invite joins, 3 tickets, 3 command runs seeded · API and page matched every aggregate and source count · empty guild named · days=91/abc 400 · signed-out 401 · OAuth exchange fake
live analytics    2026-11-01 · 2 stored audit rows = 2 logged events · 1 MCP edit + 1 delete = 1 edited / 1 deleted · command runs 0 → 3 → 4
live config       2026-11-01 · moderation.automod.links alert → delete → alert read back · bogus rejected by the enum schema with no write · one reply per bridge command
live export       2026-11-01 · 12.8 KB guild bundle downloaded and parsed = 49 settings / 1 case / 1 case event / 1 ledger row / 1 record; checksum matched; 2 KB member file; drift 1 missing → 0 missing; wrong-id delete and memory rollback refused
live content filters 2026-11-01 · link delete returned 10008 Unknown Message; profanity delete removed the pineapple message and kept its case; safe seed produced link/profanity/zalgo cases; one reviewed; example.com not flagged
live auto-responder 2026-11-01 · hello keystone replied, 60s cooldown suppressed the next reply, then released
live failure      !ticket stats → ManageGuild guard (MCP bot is not admin); branch fixed and unit-tested
public            2026-11-01 · https://github.com/RNGBubba/keystone-discord-bot · AGPL-3.0-or-later
```

A local `.env` exists in the working tree. Smoke commands pin
`DOTENV_CONFIG_PATH=.env.absent` so the result is deterministic and does not
read that file.

## P7 context-menu acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | The four menus exist with the right types | `context-menus.test.ts` asserts `contextMenuNames()` and type-keyed lookup; `commands:doctor` reads Discord and prints `2 user menus · 2 message menus` | Unit + **live Discord API** |
| 2 | A menu cannot declare options or subcommands | `context-menus.test.ts` registration throws on both | Unit |
| 3 | Menus have their own budget, not the 100 roots | `context-menus.test.ts` audits 1 root + 2 menus and 16 user menus; `pnpm budget` prints the current ledger (20 roots, 4 menus at pass 43) | Unit + budget |
| 4 | The adapter exposes a user target and a message target | `adapt.test.ts` maps `targetId` for a user menu and `targetId`/`targetUserId`/`targetContent` for a message menu | Unit |
| 5 | Report message opens a real case with the message id | `context.test.ts` reads the case row back (`messageId: "message-1"`, `channelId: "channel-a"`, excerpt) | In-memory store |
| 6 | Case history reads the same rows behind `ModerateMembers` | `context.test.ts` seeds a `warn` case and reads it through the menu; the manifest declares `requirePermissions("ModerateMembers")`, and the shared dispatch tests prove permission guards run before `execute` | Unit + dispatch |
| 7 | Rank card reports a real XP row | `context.test.ts` seeds `4 / 400`, asserts `Level 4 · 400 XP · rank #1`, and reads the unchanged row afterwards | In-memory store |
| 8 | Explain with AI uses the capped AI path and the switch | `context.test.ts` asserts the advisory text, a disabled `explanations` refusal and no case creation | Unit |
| 9 | Nickname-style menu names are accepted; slash names stay strict | `manifest.ts` uses `CONTEXT_MENU_NAME_PATTERN` only for menus; existing command-name tests still pass | Unit |
| 10 | The real bot registers them once | Live 2026-11-01: boot drift listed all four, one clear + re-register logged `count: 21`; doctor then reported no missing/extra/changed | **Live gateway + Discord API** |
| 11 | The menus were invoked live | **Not performed and not claimed** — the MCP account cannot right-click; adapter and command tests cover the handlers | Not claimed |
| 12 | The SQL side was exercised for menus | **Not performed** — the menus add no store; they read the existing case and XP services, whose SQL adapters are covered by their own PGlite tests | Not claimed |

## P7 setup acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | The five saved `/setup` names exist | `commands.json` and `commands:doctor`: `/setup status`, `module`, `verify`, `import`, `reset` | **Live Discord API** |
| 2 | Module changes go through the owning schema | `setup.test.ts` toggles `setup.enabled` through `SettingsService`; an unknown module is refused with the valid ids | In-memory repository + dispatch |
| 3 | Reset removes only the module's stored record | `setup.test.ts` resets `setup.enabled`; `settings.test.ts` proves the same `SettingsService.reset` clears a PGlite row and the schema default returns | In-memory + **PGlite** |
| 4 | Reset does not touch cases, XP or ledger rows | `resetAction` calls only `ConfigPort.reset`; the repository port has no case/XP method and the footer says so | Code inspection |
| 5 | Import is a preview and cannot apply | `setup.test.ts` records `dryRun: true` and `mode: "merge"`, and the reply says no rows were written | Unit with a recording port |
| 6 | Verify reports a real catalog and real settings | `setup.test.ts` checks parsed modules and catalog roots; live `/setup verify` read `9 modules` and `17 roots · 113 subcommands` | Unit + **live REST read** |
| 7 | Verify does not claim readiness in memory mode | Live `/setup verify` printed `Not ready: database` and named `DATABASE_URL` | **Live REST read** |
| 8 | The live toggle is a real settings change | `!setup module module=music enabled=true` then `!setup module module=music` returned enabled; after `!setup reset` it returned disabled | **Live bridge** |
| 9 | The saved plan's 160 claim is not invented | The gap table in `memory/journal/2026-11-01-pass-34.md` shows the saved table is 12 roots / 59 names; 4 names remain missing and 47 are unnamed | Repository audit |
| 10 | Import was exercised live | **Not performed** — the MCP cannot attach a file; the unit test covers the preview path | Not claimed |

## P7 appeal hub acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | `open` appends an event, never edits history | `mod.test.ts`: target opens an appeal; the case state becomes `appealed` and a `case_events` row exists | In-memory case store + **live bridge** |
| 2 | `status` still reports an appeal after the state changes | `mod.test.ts`: open → `review` → `status` reports 1 appeal and `reviewed`; live printed `#1 · warn · appealed · 1 appeal` then `#1 · warn · reviewed · 1 appeal` | Unit + **live bridge** |
| 3 | Status is member-scoped | `mod.test.ts`: another member's case throws `not one of your cases`; live `case=2` against the bot returned exactly that refusal | Unit + **live bridge** |
| 4 | No appeal event means no invented appeal | `mod.test.ts`: a member with no appeals gets `No appeal events are on record`; the embed path renders `Appeals on record: 0` for a case that was never appealed | Unit |
| 5 | The SQL history is append-only and ordered | `packages/db/src/cases.test.ts`: `DrizzleCaseStore.listEvents` returns the appended `appealed` event | **PGlite** |
| 6 | One root, two subcommands, budget intact | `mod.test.ts` registry shape; `pnpm budget` at pass 35: 17/100 roots, 117 subcommands | Registry + budget |
| 7 | The live counts match Discord | `commands:doctor` read **17 roots / 117 subcommands / 4 context menus** with no drift | **Live Discord REST read** |
| 8 | The embed fields were read live | **Not performed** — the MCP text reader cannot render embeds; the plain-text summary was read back and the fields are covered by `mod.test.ts` | Not claimed |

## P7 verify hub acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | The join path persists a quarantined row only after an enforced hold | `security.test.ts`: a young account in enforcing mode produces `{ quarantined: true, verifiedAt: undefined }` and a verify button; an old-enough account, a dry run and an anti-raid hold produce no row and, for anti-raid, no verify button | In-memory member + case stores |
| 2 | `start` requires a persisted quarantine | `mod.test.ts`: no record is refused with **No quarantine is recorded** and sends no DM; a disabled gate and an already-verified row are refused | In-memory member store |
| 3 | `start` sends the button without completing | `mod.test.ts`: a quarantined row gets one DM with `keystone:verify:guild-1:new-member` and the row stays `quarantined: true` | In-memory member store |
| 4 | A closed DM is an explicit refusal | `mod.test.ts`: a failed `directMessage` on the moderation port throws `could not DM you` with the provider detail; pass 36's live run printed **Cannot send messages to this user** and the fix | Unit + **pass-36 live bridge** |
| 5 | `status` reads persisted state, not roles | `mod.test.ts`: quarantined, verified, no-record and disabled-gate rows each render their own state and next step, with the `members table` footer | In-memory rows |
| 6 | The SQL adapter is a real upsert | `member-store.test.ts`: one `members` row, `markQuarantined` clears a previous verification, verification clears `quarantined`, `joined_at` is preserved | **PGlite** |
| 7 | Completion transitions only a quarantined row | `verification.test.ts`: no record, non-quarantined, verified and disabled gate are refused; a quarantined row is written only after `unquarantine` succeeds | In-memory member store + recorder |
| 8 | One root, two subcommands, budget intact | `mod.test.ts` registry shape; `pnpm budget` at pass 36: 17/100 roots, 117 subcommands | Registry + budget |
| 9 | The live counts match Discord | `commands:doctor` read **17 roots / 117 subcommands / 4 context menus** with no drift | **Live Discord REST read** |
| 10 | A member joined and completed verification live | **Not performed** — the MCP account is a bot; it cannot make a member join, receive the DM or click the button. The join write, completion and SQL row are test-covered. | Not claimed |

## P8 music acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | The saved queue is a real row, not a view | `music-store.test.ts` reads `community_records` directly and finds `(guild-a, music_queue, default)` with two tracks; remove and clear delete it | **PGlite** |
| 2 | The cap holds under concurrent adds | `music-store.test.ts`: five concurrent adds against a cap of three add exactly three; `store.ts` serializes in memory per guild | **PGlite** + unit |
| 3 | Playback refusals are explicit and propagated | `music.test.ts`: `play`, `skip` and `stop` throw the adapter's reason; live `!music play` and `!music skip` returned that exact text | Unit + **live bridge** |
| 4 | Status is available while disabled | `music.test.ts`: disabled `status` names the enabling command; live 0/25 `playback UNAVAILABLE` reply before enabling | Unit + **live bridge** |
| 5 | A disabled module refuses mutations without writing | `music.test.ts`: disabled `add` throws; live `add` after disabling returned the refusal | Unit + **live bridge** |
| 6 | Queue mutations are permission-gated | `music.test.ts`: `remove`/`clear` without `ManageGuild` are blocked; live `remove` ran under the MCP member who holds `ManageGuild` | Dispatch + **live bridge** |
| 7 | One root, eight subcommands, budget intact | `music.test.ts` registry shape; `pnpm budget` at pass 32: 17/100 roots, 113 subcommands | Registry + budget |
| 8 | The live counts match the queue | Live two adds → **2/25**, one remove → **1/25**, and the disabled add wrote nothing | **Live gateway** |
| 9 | Audio was played | **Not performed and not claimed** — the playback adapter is unavailable by design; `play`, `skip` and `stop` refused | Not claimed |
| 10 | The SQL queue was exercised live | **Not performed at pass 32** — Postgres was unreachable then; PGlite covers the SQL adapter. Pass 44 later ran BullMQ and Postgres receipts live. | Not claimed at pass 32 |

## P7 export acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | The bundle is the same verified format the CLI writes | `createSqlExportPort` calls `PortabilityService.exportGuild` and `serializeBundle`; `export-port.test.ts` parses it with `parseBundle` and compares checksum/counts | **PGlite + live downloaded file** |
| 2 | Printed counts equal the file | Live 2026-11-01: summary `49 settings · 1 cases · 1 case events · 1 ledger rows · 1 records`; downloaded bundle parsed to exactly those counts and checksum `5cde59ae…` | **Live gateway + Discord CDN** |
| 3 | A user export contains only that member's rows | `export-port.test.ts` seeds USER_A and USER_B; USER_A's file has 1 case/1 level and does not contain USER_B | **PGlite** |
| 4 | Import previews by default and verifies after writing | `export.test.ts` proves `dry_run` defaults true; `export-port.test.ts` applies the same bundle, gets `verified:true`, and the re-exported checksum matches | Command + **PGlite** |
| 5 | Rollback restores the pre-import snapshot | `export-port.test.ts`: change setting → import → change again → rollback; value returns to the pre-import `999` | **PGlite** |
| 6 | Deletion is exact-id-gated and keeps a count-only receipt | `export.test.ts` wrong id throws before the port; `export-port.test.ts` deletes, checks counts/hash and a refused post-deletion rollback | Command + **PGlite** |
| 7 | Drift is read-only and uses live facts | `export.test.ts` passes gateway facts; `export-port.test.ts` finds stored `404` without changing it; live 1 missing → 0 missing | Unit + **live gateway** |
| 8 | Attachment input cannot SSRF | `export-discord.test.ts`: a non-Discord URL throws before `fetch`; only HTTPS Discord CDN hosts pass; content-length over 25 MB throws | Unit |
| 9 | Memory mode does not pretend | Memory adapter exports live rows but throws `needs DATABASE_URL` for import/delete/rollback; live memory rollback returned that exact message | Unit + **live bridge** |
| 10 | One root, six subcommands, budget intact | `export.test.ts` registry shape; `pnpm budget` at pass 31: 16/100 roots, 100 subcommands | Registry + budget |
| 11 | The real surface runs once | Live 2026-11-01: `!export guild`, `!export user`, three `!export drift`, a refused delete and a refused rollback each produced one message; boot re-registered 16 roots | **Live gateway + Discord API** |
| 12 | Slash `InteractionCreate` and a live SQL import/delete | **Not performed** — the bridge is message-based and Postgres is unreachable; command/PGlite tests cover them | Not claimed |

## P7 in-bot configuration acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | One settings path, not a second store | `config.ts` calls only `ConfigPort`; `SettingsService` is implemented once and shared with the dashboard; no repository is exposed | Code inspection |
| 2 | Every write is validated by the owning module's schema | `config.test.ts`: fixture `mode=bogus` returns an error and the repository stays empty; live `automod.links=bogus` returned the enum issue | Unit + **live bridge** |
| 3 | A valid write is readable from the same service | `config.test.ts` nested write; live `alert → delete` then `get` returned `"delete"`, reset to `alert` and `get` returned `"alert"` | Unit + **live bridge** |
| 4 | Dotted writes preserve siblings | `patchFor` clones each path and `config.test.ts` asserts `nested.flag=false` leaves `label="keep"` | Unit |
| 5 | Snowflake ids are not rounded | `config.test.ts` asserts the exact 19-digit string survives | Unit |
| 6 | Non-admin is rejected before any write | `config.test.ts`: `blocked`, repository empty | Dispatch |
| 7 | Unknown modules fail with the valid ids | `config.test.ts`: `Unknown module` plus `fixture`/`setup` list | Unit |
| 8 | One root, four subcommands, budget intact | `config.test.ts` and `pnpm budget` at pass 30: 15/100 roots, 94 subcommands | Registry + budget |
| 9 | The real surface runs once | Live 2026-11-01: seven `!config` bridge messages each produced exactly one reply (one was a deliberate bad-syntax check); `commands:doctor` reports 15 roots / 94 subcommands | **Live gateway + Discord API** |
| 10 | List/export embeds were read live | **Not performed** — the MCP text reader does not render embeds; the command test covers their structure | Not claimed |

## P7 analytics acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | Every view is a query over existing rows, not a second stream | `analytics-store.ts` has no insert/update; `command-usage-store.ts` is the only new write and is append-only | Code inspection + PGlite |
| 2 | One printed figure equals the raw ledger | `analytics-store.test.ts`: `overview.loggedEvents` and `commandsRun` match `count(*)`; live logging status **2 stored** = overview **2 logged events** | **PGlite + live gateway** |
| 3 | Message and member analytics count the right events | `analytics.test.ts` window filtering; live one MCP edit and one delete produced **1 edited / 1 deleted** | In-memory + **live gateway** |
| 4 | Command usage is append-only and cannot fail a command | `dispatch.ts` records after the result; a failure logs a warning; three bridge commands produced 0 → 3 runs | Unit + **live bridge** |
| 5 | Guild scoping is enforced in the aggregate | PGlite test seeds a second guild and asserts zero contribution; live guild 1450130465146142785 only | **PGlite** |
| 6 | Current state is not disguised as a window count | `AnalyticsTicketStats` and the captions; test asserts open/closed current, opened/closed window | Unit |
| 7 | Admin-only and guild-only | `analytics.test.ts`: non-admin `blocked`, store not called; live bridge ran under the MCP member with `ManageGuild` | Dispatch + **live bridge** |
| 8 | A disabled module refuses instead of returning zeros | `analytics.test.ts`: disabled returns `error` and no snapshot | Unit |
| 9 | One root, no extra slot | `/analytics` with six subcommands; the budget was **15/100** after `/config` at pass 30 | Static registry |
| 10 | The real surface runs | Live 2026-11-01: three `/analytics` views replied once each in `#ai-chat`; at pass 30 `commands:doctor` reported 15 roots / 94 subcommands | **Live gateway + Discord API** |
| 11 | Embed fields and JSON export were read live | **Not performed** — the MCP text reader does not render embeds; command test covers the parseable export | Not claimed |

## P7 audit-logging acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | The ledger is written before delivery | `modules/logging/src/logging.test.ts`: a missing channel stores one row; a failed send keeps the row and returns `delivery-failed` | In-memory service |
| 2 | Disabled module and disabled event write nothing | Same suite: `disabled` and `event-off` return zero rows and zero sends | In-memory service |
| 3 | Moderation cases share the stream through an observer | `logging.test.ts` maps a `ModerationCase`; live case #1 arrived as a **Moderation case** embed | Service + **live gateway** |
| 4 | Event toggles are real settings, not decoration | `logging.test.ts`: `events` lists and toggles `message_delete`; live `message_edit` was turned off and back on | Command + **live bridge** |
| 5 | Retention is bounded and actually prunes | `logging.test.ts`: only rows older than 7 days are removed; PGlite scoped prune test; live `retention days=7` pruned immediately | Service + **PGlite** + **live bridge** |
| 6 | Storage is append-only and guild-scoped | `packages/db/src/logging-store.test.ts`: newest-first, guild isolation, prune, close/reopen | **PGlite** |
| 7 | The bot marker cannot widen production | `apps/bot/src/logging-events.test.ts`: no marker and another guild are ignored; marker stripped in `DEV_GUILD_ID` | Adapter test; production passes no option |
| 8 | Message edit and delete carry content when available | `logging-events.test.ts` asserts both halves; live log channel showed **Before/After** and stored **Content** | Adapter + **live gateway** |
| 9 | The real surface runs without a new duplicate reply | Live 2026-11-01: `/logging setup` posted the test embed; 3 events stored; each bridge reply appeared once | **Live gateway + Discord API** |
| 10 | A live member join/leave was **not** performed | `Status.md` limitation; no second account was available | Not claimed |

## P7 invite acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | Attribution is a deterministic diff, not a guess | `invites.test.ts`: increment, new code, unchanged, missing inviter, code tie-break; `invite-events.test.ts`: a cold cache records no inviter | Pure functions + adapter |
| 2 | A repeated gateway delivery cannot double-count | `invites.test.ts` and `invite-store.test.ts`: second identical join returns false; the unique key is `(guild, user, joined_at)` | In-memory + **PGlite** |
| 3 | Concurrent joins are serialized per guild | `apps/bot/src/invite-tracker.ts`: one promise chain per guild, no queue shared across guilds; `invite-tracker.test.ts` holds the first fetch open and proves the second join waits | Tracker with a gated fetch; not a live gateway race |
| 4 | Joins, leaves and retention are computed in SQL | `invite-store.test.ts`: two joins and one leave produce `{joins: 2, leaves: 1, retained: 1}` | **PGlite** |
| 5 | Flags are advisory | `invites.test.ts`: one log embed, footer "Advisory only"; the port has no ban/kick/timeout method | In-memory + recorder |
| 6 | Settings are the module's own schema | `inviteSettingsSchema`; the dashboard uses the same catalog, no web-only schema | Shared catalog |
| 7 | The command fits the budget and declares its intents | `commands.test.ts`: one root, budget 1, `GuildInvites` required, `GuildMembers` fallback named by `/setup` | Registry |
| 8 | The real surface runs | Live 2026-11-01: `/invites` was registered with the then-current 12 roots / 77 subcommands (13 / 84 at pass 28); `!invites leaderboard` and `!invites who` dispatched and replied in `#ai-chat` | Live gateway |
| 9 | A live member join was **not** performed | `Status.md` limitation; no second account was available | Not claimed |

## P7 auto-responder acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | Exact, contains and regex triggers are distinct | `modules/community/src/responder.test.ts`: exact does not fire on a longer sentence; contains and regex do | In-memory service |
| 2 | One reply per message, with deterministic precedence | Same suite: exact beats contains regardless of save order; one send | In-memory service |
| 3 | A trigger cooldown suppresses and then releases | Same suite moves the clock; live 2026-11-01: second message inside 60s got no reply, third after the window replied | Service + **live gateway** |
| 4 | Configuration is admin-only and input is validated | `modules/community/src/commands.test.ts`: `ManageGuild` guard, enable/list/remove, duplicate and invalid regex rejected | Command + service |
| 5 | Records are guild-scoped and survive a restart | `packages/db/src/community.test.ts`: one record after close/reopen, zero in another guild | **PGlite** |
| 6 | The dev marker cannot widen production | `apps/bot/src/community-events.test.ts`: bot message without marker and marker in another guild do nothing; fixture message never awards XP | Adapter test |
| 7 | The feature costs no new root | `/tools` subcommands `responder`, `responders`, `responder-remove`; budget remained 12 roots / 77 subcommands at that pass | Static registry |
| 8 | The real surface runs | Live 2026-11-01: marked MCP message `hello keystone` produced `Hi from Keystone's auto-responder.` | **Live gateway** |

## P7 content-filter acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | A blocklisted host and its subdomains alert or delete | `security.test.ts`: `login.phish.test` matches `phish.test`; live #1 and #2 | Pure engine + **live gateway** |
| 2 | Punycode is suspicious without a list | `security.test.ts`: `xn--pple-43d.test`; live #3 | Pure engine + **live gateway** |
| 3 | An ordinary link is not flagged | `security.test.ts`: `example.com` returns no finding; live `!mod links` stayed at #3 | Pure engine + **live gateway** |
| 4 | A finding is reviewable through the existing case queue | `mod.test.ts`: `/mod links` reads an `automod.link` case; live `!mod review case=2` changed #2 to `reviewed` | Command + **live gateway** |
| 5 | Bot authors stay ignored outside the dev marker | `moderation-events.test.ts`: no marker → ignored; marker in another guild → ignored; marker stripped in `DEV_GUILD_ID` | Adapter test; production passes no option |
| 6 | Evidence is the host and match, not the message | `security.test.ts` asserts `{ host, match }`; the case stores no content | Unit |
| 7 | The feature costs no new root | `/mod links` and `/mod filters` are existing `/mod` subcommands; `pnpm budget` remained 12 roots / 77 subcommands at that pass | Static registry |
| 8 | A live `delete`-mode deletion | Temporary `dryRun: false` seed; blocked message ID returned `10008: Unknown Message`; case #1 stayed open | **Live gateway + Discord API** |
| 9 | A configured word is caught on word edges | `security.test.ts`: `ass` not `class`; phrase whitespace; live `pineapple` case #2 | Pure engine + **live gateway** |
| 10 | Excessive combining marks are caught at the threshold | `security.test.ts`: threshold hit and below-threshold; live 16-mark case #3 | Pure engine + **live gateway** |
| 11 | Both filter findings are reviewable through one queue | `mod.test.ts`: `/mod filters` lists profanity and zalgo; live `!mod review case=2` changed the profanity case to `reviewed` | Command + **live gateway** |

## P6 foundation acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | OAuth2 code + PKCE, sealed state and `iss` validation | `apps/web/src/web.test.ts`: missing state cookie, wrong issuer and wrong state all `400` before exchange | Real local HTTP + fake OAuth |
| 2 | Opaque server-side session, not a browser token | `packages/db/src/web-store.test.ts`: round trip; `web.test.ts`: raw session id is not a key | **PGlite** + in-memory store |
| 3 | No Discord credential reaches the browser | `web.test.ts`: HTML/JSON bodies do not contain the access token; the session stores only a sealed access token, with no refresh token | Real HTTP response assertions |
| 4 | Per-guild authorization, two checks | `web.test.ts`: non-admin `403`, cross-guild id `403`, guild without the bot `403`; `access.ts` BigInt tests | Real HTTP + fake OAuth/bot membership |
| 5 | BigInt permission parsing | `web.test.ts`: bit 40 `MODERATE_MEMBERS` is not Manage Guild; invalid bitfield is false | Unit |
| 6 | One real read path through repository seams | `web.test.ts`: `/api/v1/guilds/:id/overview` and the HTML page show guild-scoped counts; `packages/db/src/web-store.test.ts` proves a second guild does not leak | Real HTTP + **PGlite** |
| 7 | CSRF and revocation | `web.test.ts`: logout without CSRF `403`; valid logout `302` then `/api/v1/me` `401` | Real local HTTP |
| 8 | No token or secret in a route | `web.test.ts`: `/healthz` has only ok/database/oauth; CSP and `no-store` asserted | Real HTTP |
| 9 | A write is schema-validated by the bot's own contract | `web.test.ts`: `PATCH` and the form update AI settings through `SettingsService`; `monthlyBudgetUsd: 5000` is `400` and leaves the stored value unchanged | Real HTTP + in-memory repository |
| 10 | Every write is CSRF-protected | `web.test.ts`: missing header/form token is `403`; a valid token writes | Real HTTP |
| 11 | A write is guild-scoped and two-checked | `web.test.ts`: cross-guild, non-admin and bot-absent writes are `403`; no session is `401` | Real HTTP + fake OAuth |
| 12 | The settings editor is generated from the bot's own schema | `settings-form.test.ts`: every registered module maps to widgets with no duplicate paths and no credential-shaped key; booleans, bounded numbers, enums, text/textarea, lines and records choose real widgets | Unit + the real module catalog |
| 13 | A widget change persists and is audited, and a bad one changes nothing | `web.test.ts`: the AI form page renders named widgets and the audit trail; a submitted form saves 7, appends one `settings.update` row with the dashboard actor and dotted diff; `5000` and `not-a-number` are `400` with the submitted value preserved, the stored value unchanged and no audit row | Real local HTTP + in-memory repository, plus the Postgres `web-schema-widgets` live check |
| 14 | The fleet view lists only guilds the user can manage | `web.test.ts`: `/dashboard/fleet` shows Alpha, Gamma and Delta and not the non-admin Beta; `manageableGuilds` is the same list as `/dashboard` | Real local HTTP + fake OAuth |
| 15 | A template previews a diff and applies only after the preview, with one audit row per module | `templates.test.ts`: deep merge, schema rejection, no-write preview, fingerprint invalidation, audited apply and no-op; `web.test.ts`: two-guild preview, wrong fingerprint `409`, apply `302`, one row per guild, non-admin/bot-absent `403`, stale preview after an external change, missing CSRF `403` | Real local HTTP + in-memory repository, plus the Postgres `web-fleet-templates` live check |
| 16 | A saved template is schema-validated on save and on apply, and its lifecycle is audited | `saved-templates.test.ts`: snapshot read through `SettingsService`, create/update/delete rows, stale preview after edit, invalid stored row reported and refused with no write; `config-template-store.test.ts`: PGlite round trip and case-insensitive unique name; `web.test.ts`: save, list, edit, two-guild apply with one audited row per guild, tampered/stale `409`, invalid row `400`, audited delete | Real local HTTP + in-memory repository and **PGlite**, plus the Postgres `web-saved-templates` live check |
| 17 | Analytics is the existing read model, bounded and honest about sparse data | `analytics.test.ts`: the service passes a 30-day window to `AnalyticsStore`, refuses 0/91/7.5 before calling it, returns null in memory mode, and the renderer shows source rows, current-state labels and a no-rows notice; `web.test.ts`: page and API numbers, empty guild, `400` windows and authorization; `analytics-store.test.ts`: PGlite checks the four migration-0017 indexes | Real local HTTP + in-memory repository and **PGlite**, plus the Postgres `web-analytics-aggregates` live check |
| 18 | The opaque session cookie rotates and the old value is dead | `web.test.ts`: past the interval a `GET` returns new session and CSRF cookies, the old cookie is `401` and the new one works; `web-store.test.ts`: `rotate` is one atomic re-key and a missing id returns false | Real local HTTP + **PGlite**, plus the Postgres `web-session-hardening` live check |
| 19 | Logout revokes the Discord token before deleting the session, and deletes it even when revocation fails | `web.test.ts`: the fake port records the access token, the session is gone and `/api/v1/me` is `401`; with `revokeFails` the same happens and the failure is only logged | Real local HTTP + fake OAuth port; no live Discord revocation |
| 20 | Each route class is limited and recovers; health is exempt | `web.test.ts`: API class `429` with `Retry-After`, next window `200`; anonymous sign-in `429`; `/healthz` stays `200`; `rate-limit.ts` has no per-URL bypass | Real local HTTP + a movable clock, plus the Postgres `web-session-hardening` live check |
| 21 | A token secret is shown once and only its hash is stored | `api-tokens.test.ts`: the record hash equals `sha256(secret)`, the record does not contain it, `list` never returns it and the first use stamps `lastUsedAt`; `web-store.test.ts` (PGlite): the hash and scopes round-trip, guild-scoped reads do not leak, a row is retained after revoke | Unit + **PGlite**, plus the Postgres `web-api-tokens` live check |
| 22 | A bearer token authorizes the same handler, not a second copy | `web.test.ts`: a `guild:read` token reads `/api/v1/me`, `/api/v1/guilds` and `/overview`; `authorization.ts` returns the same `DiscordGuild` for either principal; live `web-api-tokens` called the existing overview and guild-list handlers | Real local HTTP + fake OAuth, plus the Postgres live check |
| 23 | Guild and scope are enforced per route, and a token write is audited | `web.test.ts`: a foreign guild and a wrong scope are `403` with named codes; a `settings:write` token PATCHes without CSRF and the row names `token:<id>` with source `api`; invalid values stay `400`; live: a foreign-guild and a wrong-scope call were `403` | Real local HTTP + in-memory repository, plus the Postgres live check |
| 24 | Each token has its own limited window; revocation is immediate and audited once | `web.test.ts`: two requests pass, the third is `429` with `Retry-After`, the next window passes and a second token is unaffected; revoke `302` then `401`, a second revoke `404` with no second audit row; live: same, with one `api_token.issue` and one `api_token.revoke` dashboard row | Real local HTTP + a movable clock, plus the Postgres live check |
| 25 | The OpenAPI document describes the routes that exist | `openapi.test.ts`: every operation's sample path matches a registered `/api/v1` route and its method, every such route has an operation, scopes come from `API_SCOPES`, and both principals are declared; live `GET /api/v1/openapi.json` named both and the analytics scope | Unit + real route table, plus the Postgres live check |
| 26 | Owners-only instance actions refuse a guild admin | `web.test.ts`: instance page and revoke action are `401` anonymous, `403` for a manage-guild user and `200`/`302` for `WEB_OWNER_IDS`; deleting every row for a user signs that session out | Real local HTTP + **PGlite**, plus the Postgres `web-session-hardening` live check |

This table proves the foundation, the narrow write path, the schema-widget
editor, the fleet/built-in/saved template paths, the analytics read, session
hardening and the scoped-token API, not the exit demo. Live Discord OAuth, live
Discord token revocation, webhooks and per-token `Idempotency-Key` remain open.
A live Postgres-backed
session is real — pass 44 applied the session table and `/healthz` runs with
`database: postgres` — but an authenticated OAuth session has still not crossed
a real Discord login, and revocation is asserted at the port only.

## P5 acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | A versioned bundle is verifiable before a write | `packages/importer/src/importer.test.ts`: round trip, canonical key order, edited checksum, unsupported version, count mismatch | Pure functions |
| 2 | A 5,000-member guild exports, wipes and restores | `packages/db/src/portability.test.ts`: 5,002 levels, checksum equality after restore, `verified: true` | **PGlite**, not a Postgres server |
| 3 | A failed restore leaves the old guild intact | Same suite: duplicate case number forced inside the transaction; rejection; pre/post checksum equal | **PGlite** transaction |
| 4 | A 24-hour rollback restores the pre-import snapshot | Same suite: changed setting before import, rollback returns it, state `rolled-back` | **PGlite** |
| 5 | Deletion leaves a receipt without content | Same suite: counts, deleted guild id, content hash, backups removed, guild rows gone | **PGlite** |
| 6 | File importers are honest about source limits | `importer.test.ts`: MEE6 `players[]`, bad ids, duplicates, quoted CSV, level-derived XP, transcript HTML/JSON | Pure fixtures |
| 7 | Merge is narrow and named | `importer.test.ts`: settings upsert, keep-higher and add-on-top; service adds the limitation warning | Pure functions |
| 8 | Drift is report-only | `portability.test.ts`: missing channel, refused permission, missing AutoMod rule, `readOnly: true` | Snapshot + supplied live facts |
| 9 | Operators have a safe surface | `scripts/portability.ts`: dry-run, `--yes`, `0600` export, receipts; [[Portability-Runbook]] | CLI smoke (usage) + pass-44 Postgres service round trip |
| 10 | The decision is recorded | [[ADR-0015-portability-bundles-and-receipts]], [[Portability]], [[Migration-Guides]] | Vault check |

**P5 live window (pass 44, 2026-11-02):** `pnpm probe:live` ran the same
`PortabilityService` and SQL store against Postgres 16.15. A source guild with
one setting exported a checksummed bundle; a dry run to a destination guild
reported `1 added / 0 changed / 0 removed` and wrote nothing; the applied
import returned `verified: true`; rollback restored the pre-import backup and
left zero settings; deletion kept a receipt with one setting and removed the
guild row. The PGlite rows above remain the 5,000-level and failure-transaction
evidence; the live rows prove the same service against a real server. `/export
import` and `/export delete` through a human Discord client are still open.

## P4.5 acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | Hidden channels are a typed outcome, not a crash | `apps/bot/src/channels.test.ts`: flag, `___hidden___`, null, 10003/50001/50013 and a generic error | Fixtures; live rollout not observed |
| 2 | Every bot fetch site uses the resolver | `pnpm audit:channels`: 9 call sites; no `.channels.cache` identity use | Static scan of `apps/bot/src` |
| 3 | Core works without privileged intents | `INTENT_PROFILE=minimal` returns only non-privileged intents; `pnpm audit:intents` prints the disabled features | Registry + manifest tests |
| 4 | `/setup` names disabled features | `modules/setup/src/setup.test.ts`: minimal profile shows `GuildMembers` consequence and the `INTENT_PROFILE=full` next step | Fake health probe, zero writes |
| 5 | Optional intent contract is validated | `packages/kernel/src/registry.test.ts`: required/optional split, fallback join, duplicate rejection | Registry |
| 6 | Memory cannot silently drift | `pnpm memory:check` at that pass: 123 features, 20 claims, 36 passes, 18 decisions, 4 generated pages, 388 wikilinks | Machine files + generated pages |
| 7 | The plan is recorded | [[ADR-0012-required-and-optional-intents]], [[ADR-0013-roadmap-v2-portability-first]], [[ADR-0014-memory-v2-machine-truth]] | Vault check |

## P3 acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | Every named P3 feature exists | `community.test.ts`, `extras.test.ts`: XP, economy, welcome/delayed autorole, button/select roles, starboard overrides, birthdays, suggestions, giveaways, temp voice, tickets, content, sticky and seasons | In-memory port + recording actions |
| 2 | XP as a projection, money as a ledger | 30 P3 tests; duplicate message ids award zero; duplicate ledger keys insert once; balance is a sum; shop/daily/transfer/gamble paths | In-memory + **PGlite** |
| 3 | Thread ticket lifecycle | `community.test.ts`: panel button, thread open, one-open cap, claim, transcript, close, stats | Recorder; adapter typechecks only |
| 4 | Safety paths | Giveaway duplicate entry/early end refused; duplicate votes/sticky/birthday/season are no-ops; unmanaged select role rejected; temp voice non-owner does not delete | Service tests |
| 5 | Command budget | `pnpm budget`: `/rank`, `/ticket`, `/tools` make 10/100, under P3's 20-root ceiling | Static registry |
| 6 | Persistence | `packages/db/src/community.test.ts`: XP idempotency, ledger transfer, ticket events, record scoping/delete and transactional season archive on PGlite | PGlite, not a Postgres server |
| 7 | Records | this page, [[Roadmap]], [[Parity-Matrix]], [[04-Modules/community/Status|community status]], [[ADR-0008-community-capability-port]], [[ADR-0009-select-rows-and-season-archives]], pass 07 | Vault check |

P3 follow-ups are now green in-repo: birthdays, suggestions, select-menu and
multi-role reaction roles, per-channel starboard overrides, delayed autorole,
sticky messages and seasonal XP reset all have admin paths and regression tests.
The full matrix is still not fully green because goodbye messages,
YouTube/Twitch-specific feeds, MEE6 import (P5) and live Discord verification
remain open.

## P4 acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | Provider abstraction with no vendor SDK in a module | `modules/ai/src/provider.test.ts`: unconfigured, OpenAI-compatible request/auth/cost, HTTP 429 | Fake fetch + deterministic provider; no network |
| 2 | Hard per-guild dollar and request cap | `modules/ai/src/ai.test.ts`: `$0.01` cap allows one `$0.01` call, refuses the next before the provider; request cap same | In-memory usage + counting provider |
| 3 | Zero prompt/completion retention | Same suite: usage has only six counter fields; migration 0005 has no prompt/completion columns | In-memory + **PGlite** |
| 4 | Server RAG over admin docs | `ai.test.ts`: docs chunked, embedded, retrieved, source cited; guild scoping/removal; `/ai docs-add` command path | Deterministic embeddings; exact index |
| 5 | Ticket deflection | `ai.test.ts`: no match returns human hand-off with zero provider calls; match answers with source | Service; no live ticket |
| 6 | Mention-only chat + moderation explanations | `ai.test.ts` chat/feature refusal; `commands.test.ts` explain leaves case state `open`; event ignores bots/DMs/non-mentions by construction | Service + command; **live** mention reply via the dev guild seam |
| 7 | Thread summaries | `modules/community/src/commands.test.ts` `/ticket summary` calls the AI port and labels the result advisory | Command recorder; no live thread |
| 8 | Disable/kill switch breaks no command | `commands.test.ts`: `/ai status` works with `enabled: false`; one root remains registered | Registry + command |
| 9 | Cap and budget records | migration 0005, `DrizzleAiStore`, `packages/db/src/ai.test.ts`: scoped docs and atomic monthly increments | PGlite, not a Postgres server |
| 10 | Economy balances derive from the append-only ledger | `modules/community/src/economy.test.ts`, `community.test.ts`: balance equals the sum; no balance column; daily/transfer/buy/gamble all read the sum | In-memory + **PGlite** |
| 11 | Every money movement is idempotent | `economy.test.ts`: a repeated request id inserts no second entry; daily uses the UTC day key; `/rank` passes `ctx.interaction.id` | In-memory + **PGlite** |
| 12 | Concurrent double spend is impossible | `economy.test.ts`: two concurrent 80-unit transfers against 100 leave 20; `packages/db/src/economy.test.ts` repeats the race on PGlite | In-memory + **PGlite**, not a Postgres server |
| 13 | Refusals are explicit and server-side | `economy.test.ts` + `commands.test.ts`: insufficient funds, self-pay, bot target, transfer/bet caps and daily cooldown | Service + command |
| 14 | Economy proof survives restart | `packages/db/src/economy.test.ts`: close/reopen PGlite, balance and ledger rows return; a duplicate key inserts once | PGlite |

P4 is green for the named buildable rows. The full matrix is still not fully
green: live gateway/provider behavior, live role grants, pgvector ANN at
1M×1536, goodbye messages, YouTube/Twitch-specific feeds and MEE6 import (P5)
remain open.

## P2 acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | One case spine with atomic numbering | `packages/db/src/migrations/0003-case-counters.ts`, `case-store.ts`, `modules/moderation/src/cases.ts`; `CaseService` opens the case before an action | **PGlite**, not a Postgres server |
| 2 | Scripted raid contained | `modules/moderation/src/security.test.ts`: 10 joins + 5 invite posts + 1 webhook → 20 cases; 11 quarantine, 5 delete-message, 1 delete-webhook, 1 timeout | Policy engine + action recorder, not a live gateway |
| 3 | Every action has reason and appeal | The same test asserts every case has a reason and every notification has a `keystone:appeal:` button; `/mod` test asserts the custom id | Recorder, not a live Discord button |
| 4 | Dry-run is default and takes no punitive action | Default-settings test: zero action calls, every case `alerted`; `/mod` dry-run test: zero cases and zero action calls | Recorder |
| 5 | `/mod` guarded and case-first | `modules/moderation/src/mod.test.ts`: dispatch blocks without `ModerateMembers`; enforced ban creates case/reason before the action; missing reason throws | Dispatch + fake action port |
| 6 | Appeals and verification | `mod.test.ts`: target opens an appeal, event appended, other user rejected; `status` survives a state change and refuses another member's case; `/verify start` requires a persisted quarantine and sends the button without completing it, `status` reads that row | In-memory case/member stores + recorder + **live bridge** |
| 7 | Native AutoMod plan | `security.test.ts`: two prefixed rules, alert action, disabled by default | Pure plan; Discord sync adapter unrun |
| 8 | Records | this page, [[Roadmap]], [[ADR-0007-moderation-capability-port]], journal pass 05, `project.json` | Vault check |

## P1 acceptance evidence

| # | Criterion | Where it is asserted | Proven against |
| --- | --- | --- | --- |
| 1 | Data spine and port isolation | `packages/db/src/schema.ts`, `migrations/0001-init.ts` (PK on guild+module+key), `apps/bot/src/runtime.ts`; no module imports Drizzle | Schema and migration applied in PGlite; grep confirms no module/table import |
| 2 | Settings survive restart with JSON fidelity | `packages/db/src/settings.test.ts`: writes through `SettingsService`, closes, reopens the same data directory, `toEqual`/`toStrictEqual` on nested objects, arrays, null, numbers, Unicode and `"123"`; module isolation through two modules | **PGlite** (the Postgres engine as WASM), not a server |
| 3 | Atomic cooldowns and explicit fallback | `packages/cache/src/cooldowns.test.ts`: 50 concurrent `hit`s → exactly 1 allowed; TTL admits the next; fallback warns and is process-local | Atomic in-process stand-in for Redis, not a Redis server |
| 4 | Retry once, dead-letter at the limit, shared policy | `packages/queue/src/queue.test.ts`: attempts 2 / effects 1 on a transient failure; attempts 3 and receipt `failed` on a permanent one; duplicate delivery skipped; dispatch by job name; unknown job failed. `RetryPolicy` is one object used by `retryOptions` and the in-process driver | **In-process driver**; BullMQ's configuration is unit-tested, live BullMQ is not |
| 5 | One trace across command → DB → queue | `apps/bot/src/p1.test.ts`: one trace id across `command`, `db.settings.get`, `db.settings.set`, `queue.enqueue`, `job demo.job`, with parent ids checked; `createTelemetry()` returns a no-op with no exporter | In-memory span exporter, not a collector |
| 6 | `/setup` guarded and read-only | `modules/setup/src/setup.test.ts`: dispatch blocks without `ManageGuild`, runs with it, reports ready/missing/pending/disabled, and a repository spy proves zero writes | Fixtures and a fake health probe |
| 7 | Build, packaging and explicit migrate | `pnpm build` from a clean `dist`; artefacts exit 1 with their missing-prerequisite messages; a worker pointed at a closed Redis port exits 1 with a redacted URL **before** it logs ready; `compose.yaml` has a one-shot `migrate` service that bot/worker wait on | Node 24 locally; Docker image not built |
| 8 | Records | this page, [[Roadmap]], [[ADR-0006-ports-and-adapters]], journal pass 04, `project.json` | Vault check |

## Proven vs still needs a live service

| Claim | Proven here? | How to close |
| --- | --- | --- |
| Settings survive restart | Yes, on PGlite | Same test against a Postgres server |
| JSONB fidelity (null, arrays, numeric string) | Yes, on PGlite | Same |
| Cooldown single-winner | Yes, on an atomic stand-in | Run the 50-caller test against Redis |
| Job retries and dead-letters | Yes, on the in-process driver with shared policy | Run a failing job through `apps/worker` + Redis |
| Worker refuses an unreachable Redis | Yes, bundled worker against a closed port | Re-run with a live Redis; the same ping passes |
| Trace propagation | Yes, in-memory exporter | Point `OTEL_EXPORTER_OTLP_ENDPOINT` at a collector |
| Scripted raid containment | Yes, policy engine + recorder | Replay in a staging guild |
| Case numbering/events | Yes, PGlite | Same against Postgres |
| Real ban/kick/timeout/purge/lock | No | Staging guild with the bot's permissions |
| Gateway joins/messages/audit events | Messages yes; joins/audit no | Message event observed live; replay joins/audit in staging |
| Link / phishing filter | Yes: live alert + review, and live delete (`10008: Unknown Message`) | Re-run on staging with a human author |
| Profanity / zalgo filter | Yes: live alert cases + `/mod filters` + review, and live profanity delete (message gone, case #1 open) | Repeat zalgo delete with a disposable fixture on staging |
| Auto-responder | Yes: live trigger, cooldown suppression and release through the real gateway | Repeat with a human author and a re-opened process |
| Native AutoMod sync | Plan tested, adapter not run | Enable sync in staging |
| XP/currency idempotency | Yes, in-memory + PGlite | Same against a Postgres server |
| Economy double-spend | Yes, in-memory queue + PGlite guild lock | Two bot shards against one Postgres server |
| Economy balance after restart | Yes, PGlite close/reopen | Same against a Postgres server |
| P3 ticket records/transcripts | Yes, port + PGlite | Live thread round-trip |
| P3 service events/buttons | Yes, recorder | Staging guild with intents |
| P3 Discord sends/threads/voice | No | Staging guild with permissions |
| Channel obfuscation classification | Yes, fixtures | A staging guild after 2026-11-16 |
| Intent profile and `/setup` report | Yes, registry + fake health | A live login with the matching Portal intents |
| Export/restore/rollback/deletion | Yes, PGlite with 5,002 levels | Same against a Postgres server |
| MEE6 and generic file import | Yes, fixtures | A real MEE6 export and a real Postgres server |
| Transcript archive | Yes, HTML/JSON fixtures | A real Ticket Tool/ProBot file |
| Drift report | Yes, supplied live facts | A live guild via the P6 collector |
| CLI against a real database | No | `pnpm portability export` with compose Postgres |
| AI provider request/cost | Yes, fake fetch | Real configured provider |
| AI hard cap and zero retention | Yes, service + PGlite | Same against Postgres |
| Exact server-doc retrieval | Yes, deterministic embeddings | Production embeddings + pgvector ANN |
| AI mention event / live sends | Yes, Qwen3:8b reply in `#ai-chat` | Repeat with a human author; slash-command replies still unobserved |
| 1M×1536 pgvector p95/recall | No | Postgres+pgvector research benchmark |
| Container build | No | `docker compose up` on a machine with a daemon |
| Live gateway login | Yes, 2026-11-01 as AI Team#5758 | Repeat on the production shard after P10 |
| Slash-command execution | No | A human client, or a harness with interaction support |
| Dashboard HTTP surface | Yes, real process in memory mode | Re-run with Postgres and a real OAuth client |
| Dashboard login/session/CSRF/authz | Yes, real HTTP + fake OAuth | A live Discord OAuth round trip |
| Dashboard settings writes | Yes, real HTTP + in-memory repository | A Postgres server and a browser form run |
| Dashboard Postgres session | Yes, PGlite | A Postgres server |

No document claims a live-server or live-gateway run for a row marked "not
proven". The join-gate expiry job, temporary-ban/temp-role expiry, case export
and panic mode are named as open in the moderation status; they are not claimed
here.

## Next

P7 parity work continues alongside the P6 exit items. Auto-responders, audit
logging, the content filters, guild analytics, in-bot configuration,
`/export`, the `/music` saved queue, forms, events, modmail, temporary
moderation, panic mode and goodbye are done; the next open rows are real music
playback (a voice/Lavalink client), forms modal input, scheduled event
reminders/ICS, modmail DM relay and the planned Components V2 UI/i18n work.
`automod.false-positive-report` is still the smallest useful moderation
follow-up. P6 remains the active phase
for the dashboard. The auth gate, settings writes, schema-generated widgets and
the settings audit trail are built in the existing `apps/web` HTML app; pass 50
added the fleet view and built-in templates, pass 52 added saved templates, pass
53 added analytics aggregates, pass 54 added session rotation, logout
revocation, per-route limits and the `owners[]` instance console, and pass 55
added hashed scoped tokens, per-token limits, audited issue/revoke and the
generated OpenAPI document. The carrier decision is recorded in
[[ADR-0016-dashboard-foundation]]. Next are webhooks, `Idempotency-Key` replay,
an idle timeout and a refresh-token path, plus the live Discord OAuth round
trip. Before
launch, close the pgvector ANN gate and run the live
provider/Discord/Postgres/OAuth smoke in staging.
