# Keystone

**Keystone** is an open-source, teach-by-default, all-in-one Discord bot. The
name is the bot and the project: one foundation that moderation, community,
tickets, economy and AI all stand on.

**Repository:** https://github.com/RNGBubba/keystone-discord-bot

> Every "all-in-one" bot today is two to four half-bots stapled together.
> Keystone ships the union — free, documented, and built so a stranger can add a
> feature in an afternoon.

**Status:** P0–P5 are complete in-repo. P6's **authorization and settings-write
foundation** is now in repo: Discord OAuth2/PKCE login, opaque Postgres-backed
sessions, per-guild BigInt authorization, schema-generated settings widgets,
audited settings writes from the dashboard and a `PATCH /api/v1` route, a fleet
view with three built-in config templates that preview a per-guild diff, named
saved templates with audited create/update/delete, and checksummed config
export/import with a stored baseline and a drift page, and read-only analytics
aggregates over the ledgers the bot already keeps. Every apply is bound to the
previewed plan. The dashboard stays the existing framework-free `apps/web` HTML
app; a Next.js shell is not built and is not required for this slice. Session
hardening, hashed guild-scoped API tokens with per-route scopes and limits,
signed webhook delivery with retries and receipts, and `Idempotency-Key` replay
are in repo; the live OAuth round trip is the remaining P6 proof. P7 now has
invite tracking as
a sixth module (attribution, a joins/retention leaderboard and advisory
suspicious-join flags), audit logging as a seventh module (five event kinds, one
operator channel and a retained ledger), link/profanity/zalgo content filters,
an auto-responder for exact, contains and regex triggers, guild analytics as an
eighth module, and `/music` as a ninth module: a durable saved queue whose
playback commands refuse with the exact missing backend instead of showing a
queue that pretends to be audio. `/verify start | status` turns the join gate into a real DM flow: an enforced join-gate hold writes a quarantined `members` row, `start` accepts only that row and sends the existing verification button after checking DM-ability, and `status` reads the row instead of guessing from gateway roles. A member with no quarantine record gets an explicit refusal. P7 also ships `/config list | get | set | export`, the in-bot
settings surface: it reads and writes any registered module's per-guild settings
through the same `SettingsService` and Zod schema as the dashboard, with no
second store. `/export guild | user | import | delete | drift | rollback` puts
the P5 portability service inside Discord: real JSON file attachments, a
dry-run-first import, a confirmation-gated delete and live drift facts from the
gateway cache. `/form create | edit | delete | list | panel | submit | review |
export` is the tenth module: a real application form with a persisted pending
submission, a review transition and a checksummed JSON export. Modal input is
explicitly not shipped; the panel prints the validated `answers` syntax instead
of a button that opens nothing. `/event create | edit | delete | list | rsvp |
remind | export` is the eleventh: a draft/open/closed lifecycle, one RSVP row per
member, capacity counted from `going` rows inside the store transaction, manual
reminder bookkeeping and a checksummed JSON export. `/modmail setup | open |
reply | close | transcript | stats` is the twelfth and last plan root: private
owner-or-staff threads, a first-staff-reply claim, side-aware unread counters and
a transcript archived once by a conditional update. The command ledger is
**20/100 roots** with **141 real subcommands**, **161 actions** and **4 context
menus** (2 user, 2 message), there are **12 modules**, and `pnpm check` covers
**623 tests across 91 files** without a Discord token, database or network.
Pass 43 audited the documented counts, paths and capability claims against the
code: `pnpm audit:claims` now fails the gate when a claim drifts. The stale
root, module, changelog and Docker notes are corrected. Live on 2026-11-01: the
bot logged in and Discord reports **20 roots / 2 user menus / 2 message
menus**, answered a Qwen3:8b mention in `#ai-chat`, and ran real
moderation, community, AI, invite, logging, analytics, configuration, music,
forms, events, modmail and content-filter commands through a development message bridge,
including
`/help`’s generated catalog. The dashboard was booted in memory mode and
exercised over real HTTP, including authenticated settings writes against a fake
OAuth port; live Discord OAuth is not claimed. Slash `InteractionCreate` from a
human client is still the next live check. Pass 44 opened the live SQL window.
Since then Docker Desktop 29.9.2 runs the repo's compose Postgres 16.15 and
Redis, all 17 migrations are applied, and `pnpm probe:live` is 19/19 — settings survive a
pool restart, cooldowns are shared through Redis, a BullMQ job runs once with a
Postgres receipt, a delayed timer fires after its delay, a real case expires
through `TemporaryActionService`, a reminder/scheduled record delivers once, a
panic snapshot round-trips on Postgres, portability imports/rolls back/deletes
real rows, and `/healthz` reports `database: postgres`. That run also found and
fixed a real migrator defect: postgres.js rejects the raw `BEGIN` the runner
used. See
[the live window](memory/vault/06-Operations/Live-Window.md) and
[pass 44](memory/journal/2026-11-02-pass-44.md).
Pass 46 completed the lifecycle block: `/mod panic state:status|on|off` snapshots
and persists every changed `@everyone` overwrite before replying, restores only
those channels, and keeps failed restores for a retry; it requires
`Administrator` and has no timer. `/tools goodbye` writes the same community
settings, and `WelcomeService.handleLeave` sends the configured text with no
role or DM branch. The live probe is 13/13, adding the panic snapshot's
Postgres round-trip; the Discord lockdown and `GuildMemberRemove` calls are
adapter-tested, not gateway-proven. See
[pass 46](memory/journal/2026-11-02-pass-46.md).
Pass 45 added the first timer slice: `/mod ban` accepts a duration,
`/mod temp-role` is a real subcommand, and both write `expires_at` on a case and
enqueue one delayed `moderation.expire` job. The case is the durable record; an
atomic `claimExpiry` makes two workers unable to release the same ban or role
twice, a failed release restores the timestamp, and startup recovery expires
overdue cases and reschedules future ones. Reminders and scheduled messages now
enqueue `content.deliver` on the same bot-side queue, where one conditional
claim decides which of the timer and the sweep sends, and only a successful
send keeps `sent:true`. The live probe proves the SQL and service paths; the
Discord action is a recording port, not a gateway, so those rows stay marked
**live unverified for Discord**. See
[pass 45](memory/journal/2026-11-02-pass-45.md).
Pass 48 made the docs answer to the machine: `memory/machine/claims.json` names
the documents that speak in the present tense, and `pnpm memory:check` recomputes
the roots, subcommands, actions, menus, modules, test count and pass count from
the generated files. A current-tense sentence that disagrees fails the gate; a
historical sentence is allowed only when it names its pass. A capability claim
with no code behind it — the Next.js shell as of pass 59 — must
be marked planned. The same pass added the root governance and issue/PR files.
See [pass 48](memory/journal/2026-11-02-pass-48.md).

This repo is both the product and the course: every module has a spec, tests, a
teaching note and a status page. The docs are the source of truth, not a
marketing site.

---

## Contents

- [What you need](#what-you-need)
- [How to run](#how-to-run)
- [Discord app setup](#discord-app-setup)
- [Configuration](#configuration)
- [Commands](#commands)
- [Dashboard and API](#dashboard-and-api)
- [Features](#features)
- [Current progress](#current-progress)
- [How to add stuff](#how-to-add-stuff)
- [How to have an agent read it easily](#how-to-have-an-agent-read-it-easily)
- [How to set up the Obsidian vault](#how-to-set-up-the-obsidian-vault)
- [Live testing and command sync](#live-testing-and-command-sync)
- [Architecture](#architecture)
- [Contributing and licence](#contributing-and-licence)

---

## What you need

**Required**

- **Node.js 22+** and **pnpm 12+** (`corepack enable` is the easiest way).
- A **Discord application** and bot token.
- A server where you can invite the bot.

**Recommended for a real deployment**

- **Postgres 16** for settings, cases, XP, economy, tickets and AI usage.
- **Redis 7** for shared cooldowns and the BullMQ worker.
- Docker is optional; `compose.yaml` starts Postgres, Redis, migrations, the bot
  and the worker together.

**Optional**

- A Discord OAuth2 client for the dashboard. Without it, `pnpm web:start` still
  boots and `/healthz` works, but `/login` returns `503`; no other feature is
  affected.
- An OpenAI-compatible AI provider. Without one, `/ai` reports `unconfigured`
  and every AI call refuses safely. Ollama + Qwen3 works locally.
- An OTLP endpoint for tracing. Tracing is off by default.

Local memory mode is a supported first run: leave `DATABASE_URL` and `REDIS_URL`
empty and settings/cooldowns/jobs live in the process. They reset on restart.

## How to run

### 1. Install

```bash
git clone https://github.com/RNGBubba/keystone-discord-bot.git
cd keystone-discord-bot
corepack enable
pnpm install
cp .env.example .env
```

Put `DISCORD_TOKEN` in `.env`. See [Discord app setup](#discord-app-setup).

### 2. Fastest local smoke (no Postgres, no Redis)

Leave `DATABASE_URL` and `REDIS_URL` empty in `.env`, then:

```bash
pnpm dev
```

You should see `runtime ready` and `ready` in the log. If `INTENT_PROFILE=full`,
the Developer Portal must have **Server Members** and **Message Content**
enabled, or Discord closes the gateway with code `4014`. Set
`INTENT_PROFILE=minimal` to boot without privileged intents and let `/setup`
name the disabled features.

### 3. Full local stack

```bash
docker compose up -d postgres redis
pnpm db:migrate          # explicit, idempotent — never on boot
pnpm dev                 # bot
pnpm worker:dev          # second terminal: BullMQ consumer
pnpm web:start           # third terminal: dashboard/API at http://localhost:3000
```

`pnpm db:migrate` is safe to rerun. Postgres data lives in the `pgdata` volume.

### 4. Docker stack

A gateway-only host can skip the optional dashboard:

```bash
docker compose up --build bot worker
```

With `SESSION_SECRET` set in `.env`, the default stack also starts the web
service:

```bash
docker compose up --build
```

Either command builds the images and runs migrations once before the selected
services start. The web process refuses to boot in production without a valid
`SESSION_SECRET`, so a gateway-only self-host should use the first command.
`docker compose up -d postgres redis` is still the lighter path when you want hot
reload with `pnpm dev`.

### 5. Dashboard and API (optional)

```bash
pnpm web:start           # http://localhost:3000
```

Memory mode works without Postgres, Redis or OAuth: `/healthz` reports
`{"database":"memory","oauth":false}` and `/login` returns `503`. To sign in,
create a Discord OAuth2 client (see [Discord app setup](#discord-app-setup)) and
set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and
`DISCORD_OAUTH_REDIRECT_URI`, plus `SESSION_SECRET` in production. The dashboard
only lists servers where you are owner or hold **Administrator** / **Manage
Server**, and the bot must be in the server.

### 6. Verify without secrets

```bash
pnpm check
```

This runs typecheck, the full test suite, the command-budget audit, the intent
and channel audits, and the memory consistency check. It must stay green in CI
without a token or network.

### 7. Register or refresh Discord commands

The bot writes commands at boot only when the registered **name or option tree**
has drifted, then reads them back and logs any mismatch. `pnpm commands:doctor`
prints what Discord actually has without writing. For a payload-only change
(description, options, subcommands) or a deliberate clean slate:

```bash
pnpm commands:doctor    # read-only: registry vs live shape
pnpm commands:sync      # atomic replace
pnpm commands:resync    # clear, register, fetch back and verify
```

Discord limits global bulk overwrites to **2 per 10 minutes**. `commands:resync`
uses both slots; if it is rate-limited it waits and retries, but do not loop it.

## Discord app setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and create an application. Name it **Keystone** (or your own instance name).
2. **Bot** → reset/copy the token. Treat it like a password; never commit `.env`.
3. **Bot** → Privileged Gateway Intents:
   - **Server Members** — welcome, delayed autoroles, join gate, role persistence.
   - **Message Content** — automod scanner, ticket transcripts, starboard snapshots.
   - If you cannot enable them, set `INTENT_PROFILE=minimal`; the core still runs.
4. **OAuth2** → **General**: copy the Client ID and Client Secret, and add the
   exact redirect `http://localhost:3000/auth/callback` (use your
   `WEB_ORIGIN` when it differs). The dashboard needs the `identify guilds`
   scope; it never asks for your bot token.
5. **OAuth2** → URL Generator:
   - Scopes: `bot`, `applications.commands`.
   - Permissions: for a first run, **Administrator** is simplest. Least privilege:
     `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`,
     `Use Application Commands`, `Manage Roles`, `Manage Channels`,
     `Manage Messages`, `Add Reactions`, `Create Public Threads`,
     `Manage Threads`, `Connect`, `Moderate Members`, `Ban Members`,
     `Kick Members`.
6. Invite the bot, then start it as above. `/setup` is the first command to run.

## Configuration

All values are validated by `packages/config`. Never put secrets in a Discord
message or the vault.

| Variable | Required | Effect when absent |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | The bot refuses to start |
| `INTENT_PROFILE` | no | `full` requests optional privileged intents; `minimal` runs the core and `/setup` names disabled features |
| `DATABASE_URL` | production | Settings are process-local and reset on restart |
| `REDIS_URL` | production | Cooldowns are local; jobs run inside the bot process |
| `QUEUE_NAME` | no | Defaults to `keystone` |
| `OTEL_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT` | no | Tracing is a no-op |
| `AI_API_KEY` | no | `/ai` says `unconfigured`; every answer call refuses safely |
| `AI_BASE_URL` | no | Defaults to `https://api.openai.com/v1` |
| `AI_MODEL` / `AI_EMBEDDING_MODEL` | no | `gpt-4o-mini` / `text-embedding-3-small` |
| `AI_INPUT_USD_PER_MILLION` / `AI_OUTPUT_USD_PER_MILLION` | no | Rate-card defaults for the hard cost cap |
| `AI_DISABLE_THINKING` | no | Sends Ollama's `think: false`; use it for Qwen3 or reasoning can consume the whole output budget |
| `DEV_GUILD_ID` | no | Development only: seeds AI chat in memory and enables `!` commands plus bot-authored mentions in that one guild |
| `WEB_PORT` | no | Dashboard/API port; defaults to `3000` |
| `WEB_ORIGIN` | production | Public origin used for the redirect/cookie mode; defaults to `http://localhost:$WEB_PORT` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | dashboard | Without them `/login` returns `503`; the bot is unaffected |
| `DISCORD_OAUTH_REDIRECT_URI` | dashboard | Must match the Developer Portal exactly; defaults to `$WEB_ORIGIN/auth/callback` |
| `DISCORD_OAUTH_ISSUER` | no | Defaults to `https://discord.com`; the callback rejects any other `iss` |
| `SESSION_SECRET` | production web | 32 bytes base64/base64url or 64 hex; the process refuses to boot in production without it |
| `WEB_SESSION_IDLE_MS` | no | End a dashboard session after this much inactivity; defaults to `1800000` (30 minutes), minimum `60000` |

`/setup` reports which mode is live. A configured-but-unreachable service is a
boot error, not a silent downgrade.

AI is **off by default**. Enabling the module never enables a feature by itself:
choose chat, deflection, explanations, summaries or classification, and set a
monthly dollar and request cap. Prompts and completions are never stored; only
aggregate counters and explicitly added admin docs are. See
[the AI spec](memory/vault/04-Modules/ai/Spec.md).

Moderation is conservative by default: `dryRun` is true, so the scanner records
and alerts but does not delete, timeout, quarantine, kick or ban. Review cases
before setting `moderation.dryRun` to `false`.

Community features are opt-in where they act on members: welcome, starboard,
temporary voice and reaction-role panels need configuration. XP and economy
writes are idempotent; every balance is a `SUM` over `economy_ledger`, and
double-spend, self-pay, bot targets, caps and insufficient funds are explicit
refusals. See [the community spec](memory/vault/04-Modules/community/Spec.md).

## Commands

Discord's global limit is 100 **roots**; Keystone uses **20** and exposes **141
real subcommands** (161 total actions), plus **4 context menus** on their own
15 + 15 budget. A subcommand does not spend another global slot, which is why the
picker now expands instead of showing one flat `action` option. Slash commands
are the product surface; context menus appear under right-click → Apps. In
development, `DEV_GUILD_ID` also enables the `!` bridge for message-only
harnesses.

`pnpm commands:catalog` regenerates the complete per-root list in
[Command-Catalog.md](memory/vault/01-Mission/Command-Catalog.md); `/help` reads
the same live registry.

| Root | Subcommands | What it does |
| --- | --- | --- |
| `/ping` | — | Confirm the gateway is alive and show uptime |
| `/about` | — | Version, module state, teaching link |
| `/help` | `browse`, `commands`, `search`, `privacy`, `changelog` | Browse the generated catalog, search it, inspect retention and the latest pass |
| `/setup` | `status`, `module`, `verify`, `import`, `reset` | Readiness report; module switchboard; read-only integrity check; bundle preview; and a settings-only module reset |
| `/config` | `list`, `get`, `set`, `export` | Read or change any module's per-guild settings through that module's own Zod schema; admin-only and guild-scoped |
| `/export` | `guild`, `user`, `import`, `delete`, `drift`, `rollback` | Download a verified JSON bundle, export one member, preview/restore a bundle, delete with an exact-id confirmation, or compare stored ids with the live server |
| `/mod` | `ban`, `kick`, `timeout`, `warn`, `purge`, `lock`, `unlock`, `slowmode`, `case`, `note`, `history`, `links`, `filters`, `review` | Moderation with cases, reasons, evidence, a content-filter review queue and a case queue |
| `/appeal` | `open`, `status` | Open an appeal on your own case, or read the append-only appeal events and the current case state |
| `/verify` | `start`, `status` | Send the verification button by DM only for a persisted quarantined row, or read the persisted verification and quarantine state |
| `/rank` | `view`, `leaderboard`, `rewards`, `admin`, `balance`, `daily`, `pay`, `shop`, `buy`, `gamble`, `ledger`, `season` | XP, levels, ledger-backed currency, shop and seasons |
| `/ticket` | `panel`, `open`, `claim`, `close`, `add`, `transcript`, `summary`, `stats` | Thread tickets, claiming, transcripts, AI summary and SLA stats |
| `/tools` | `embed`, `tag`, `reminder`, `schedule`, `giveaway`, `giveaway-end`, `giveaway-reroll`, `poll`, `feed`, `stat`, `welcome`, `roles`, `starboard`, `starboard-override`, `voice`, `birthdays`, `birthday`, `suggestions`, `suggestion`, `suggestion-decide`, `sticky`, `responder`, `responders`, `responder-remove` | Community utilities, panels and auto-responders |
| `/ai` | `status`, `ask`, `chat`, `classify`, `docs-add`, `docs-list`, `docs-remove`, `deflect`, `explain`, `summary`, `budget` | Opt-in server-doc answers, advisory classification, explanations, summaries and hard caps |
| `/invites` | `leaderboard`, `stats`, `who` | Invite attribution, joins/retention totals and who invited a member (`who` takes `user`) |
| `/logging` | `setup`, `channel`, `events`, `status`, `retention`, `export`, `disable` | One audit channel for message, member and moderation events, with per-event toggles and retention pruning |
| `/analytics` | `overview`, `members`, `messages`, `commands`, `tickets`, `export` | Read-only aggregates over the audit ledger, cases, invite joins, tickets and command usage; every view names its source rows |
| `/music` | `play`, `queue`, `add`, `remove`, `clear`, `skip`, `stop`, `status` | A durable saved queue in `community_records`; `play`, `skip` and `stop` refuse with the exact missing backend because no voice/Lavalink client is installed |
| `/modmail` | `setup`, `open`, `reply`, `close`, `transcript`, `stats` | Private member-to-staff threads over `modmail_threads` and `modmail_messages`; owner-or-staff visibility, a first-staff-reply claim, side-aware unread and a transcript archived once |

Four **context menus** (right-click → Apps) reuse the same services:

| Menu | Type | What it does |
| --- | --- | --- |
| `Report message` | message | Opens a reviewable moderation case with the message id and a bounded excerpt |
| `Case history` | user | Lists the selected member's recent cases; requires `ModerateMembers` |
| `Rank card` | user | Shows level, XP and server rank from the same projection as `/rank view` |
| `Explain with AI` | message | Advisory explanation from the same `AiService.explain` path as `/ai explain`; requires `ManageMessages` |

`/analytics`, `/config` and `/export` require `ManageGuild`.
`/music remove` and `/music clear` require `ManageGuild`; `/music status` works
while the module is disabled. `/ticket summary` and
`/ai summary` require `ManageGuild`. `/ai docs-*` and
`/ai budget` require `ManageGuild`; `/ai classify` and `/ai deflect` require
`ManageMessages`. AI is advisory: it never punishes, deletes or claims an action
happened.

## Dashboard and API

The P6 foundation is a separate, optional Node process in `apps/web`. It is
**security-first**: login, per-guild authorization and a small, schema-validated
settings write path.

```text
GET /healthz                              public, no secrets
GET /login                                OAuth2 code + PKCE; 503 without OAuth config
GET /auth/callback                        state + iss validation, then a session
GET /dashboard                            servers the user can manage
GET /dashboard/fleet                      fleet table with enabled modules per server
POST /dashboard/fleet/preview             schema-validated template diff; no writes
POST /dashboard/fleet/apply               apply the previewed plan; audited per module
GET /dashboard/guilds/:id                 guild overview
GET /dashboard/guilds/:id/analytics       bounded aggregates over the existing ledgers
GET /dashboard/guilds/:id/settings/:module  schema-generated widgets + module audit trail
POST /dashboard/guilds/:id/settings/:module  save named widgets (CSRF + module schema)
GET /dashboard/guilds/:id/config/export   checksummed settings bundle as a JSON file
GET /dashboard/guilds/:id/config/drift    baseline vs live, plus the import form
POST /dashboard/guilds/:id/config/import/preview  validate + diff a bundle; no writes
POST /dashboard/guilds/:id/config/import/apply    apply the previewed bundle; audited per module
GET /api/v1/me                            signed-in user, never a token
GET /api/v1/guilds                        manageable servers only
GET /api/v1/guilds/:id/overview           counts, module settings, latest import
GET /api/v1/guilds/:id/analytics          the same AnalyticsSnapshot as /analytics
PATCH /api/v1/guilds/:id/settings/:module  update one module (CSRF + schema)
POST /logout                              session + CSRF; deletes the server-side session
```

Every guild route performs **two checks**: the OAuth user must be owner or hold
`ADMINISTRATOR` / `MANAGE_GUILD` (parsed as `BigInt`, because bit 40 is
`MODERATE_MEMBERS`), **and** the bot token must confirm the bot is in the guild.
The `:guildId` in a URL is never trusted. Sessions are opaque random values;
only their SHA-256 hash is stored. The Discord access token is AES-256-GCM
sealed before it reaches Postgres and never appears in HTML or JSON. No refresh
token is stored: refresh is still open, so a session re-authenticates when its
Discord access token expires. Responses carry a strict
CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and
`Cache-Control: no-store`.

Settings writes are deliberately narrow: only modules already registered in the
bot can be edited, and the value is parsed by that module's own Zod schema through
`SettingsService.update` before it is stored. The HTML editor is **generated from
that same schema**: booleans are checkboxes, bounded numbers keep their real
min/max/step, enums are selects, strings become inputs or textareas, primitive
arrays are one-per-line boxes, and records or arrays of objects get a
schema-validated JSON box. There is no web-only schema and no hand-built form per
module. Unknown keys are ignored, invalid values return `400` without a write,
and the page re-renders with the rejected field and value preserved. Both the
HTML form and the API require the session's CSRF token. The API takes the session
cookie plus `x-keystone-csrf` (the value of the `keystone_csrf` cookie); the HTML
form carries the same token in a hidden field. A missing token is `403`.

Every accepted settings update or reset also appends one `audit_events` row with
the actor, surface (`command`, `dashboard` or `api`), module and dotted-path
before/after diff; a rejected or no-op write appends nothing. The settings page
shows the newest rows for that module.

**Config portability** is a settings document, not a full backup.
`GET /dashboard/guilds/:id/config/export` downloads every module's effective
settings with a SHA-256 checksum and no credential-shaped keys. Import verifies
the kind, version, module set, checksum and each module's Zod schema, then shows
the exact before/after diff without writing. Apply is bound to that preview by a
fingerprint: an edited file is refused at `400`, a stale preview at `409`, and
each accepted module write appends one dashboard audit row. The applied bundle
becomes the guild's baseline in `config_baselines` (migration 0015); the drift
page compares baseline to live, names an absent baseline, and reports a stored
row that no longer parses instead of showing every setting as drift.

The **fleet view** lists the servers the signed-in user can manage. Three
built-in templates (alert-first moderation, strict moderation and quiet optional
modules) can be previewed across a multi-server selection. The preview deep-merges
each patch over current settings, parses the result with the module's own schema
and shows the exact before/after diff; nothing is written. Apply is bound to a
SHA-256 fingerprint of that plan, re-authorizes every selected server, refuses a
missing or stale preview (`400`/`409`) and then writes through
`SettingsService.update`, with one audit row per changed module. Templates never
contain channel or role ids.

**Saved templates** let an admin name a snapshot of one server's effective
settings, list it, rename or refresh it, delete it, and apply it to selected
servers. `config_templates` (migration 0016) stores the snapshot; one kernel
`SavedTemplateStore` port has in-memory and Drizzle adapters. Save parses every
module with its own Zod schema before the insert. Apply re-validates the stored
row: a template that has drifted out of validity lists every bad path and is
refused at `400`, never applied. A valid template reuses the built-in plan,
fingerprint, re-authorization and per-module audit path; create, update and
delete append their own `template.*` audit rows. There is no marketplace and no
second settings store.

**Session hardening** rotates the opaque dashboard cookie every 15 minutes on a
safe page load, so the previous value is refused immediately. A session unused
for 30 minutes (`WEB_SESSION_IDLE_MS`) is refused and its row deleted; activity
moves only the idle clock, never the absolute 7-day lifetime. An expired Discord
access token is refreshed from a sealed, rotating refresh token, once even when
two requests arrive together, and logout revokes that grant before deleting the
session. The local session dies even when Discord is unavailable. Fixed windows
cap the auth, dashboard, write and API route classes with `429` +
`Retry-After`, and `WEB_OWNER_IDS` gates an owner console whose
sign-out-every-session action a guild admin cannot reach.

**Scoped API tokens** are the second principal. The dashboard issues a
`keystone_…` secret once and stores only its SHA-256 hash; the token is bound to
one guild and to `guild:read`, `analytics:read` and/or `settings:write`, and it
authorizes the same `/api/v1` handlers a session uses. Guild, scope and
bot-membership are checked per request, each token has its own fixed window, and
issue/revoke append one dashboard audit row each. `GET /api/v1/openapi.json` is
generated from an operation table that a test walks against the route registry
in both directions.

This is still not the P6 exit demo: a live OAuth round trip, live refresh and
live token revocation against Discord remain open. The idle timeout and the
sealed refresh path are in repo (pass 57). See
[Dashboard](memory/vault/03-Architecture/Dashboard.md) and
[ADR-0016](memory/vault/03-Architecture/ADR/ADR-0016-dashboard-foundation.md).

## Features

Everything below is free. No feature is moved behind a paywall.

### Platform and operations

- Module registry with a CI-enforced 100-root budget (currently 20 roots, 141
  subcommands) and a separate 15 + 15 context-menu budget (currently 4 menus).
- First-run `/setup` hub: readiness, a module switchboard, a read-only integrity
  check, a bundle preview and a settings-only module reset. Every write goes
  through `SettingsService` and the owning schema.
- In-bot configuration: `/config list | get | set | export` reads and writes every
  registered module's settings through `SettingsService` and the owning Zod
  schema. No second store; a rejected value never persists.
- In-Discord portability: `/export guild` posts the verified bundle as a file,
  `/export user` exports one member, `/export import` previews before writing,
  `/export delete` needs the exact guild id, `/export drift` compares stored
  channel/role ids with the live server, and `/export rollback` restores an
  applied import. The SQL adapter is the same `PortabilityService` as the CLI.
- Real Discord subcommand tree: flat `action` options are gone from every
  existing hub, `/help` is generated from the registry, boot sync compares the
  full option tree, and `pnpm commands:doctor` prints the live shape.
- Four context menus over existing services: `Report message`, `Case history`,
  `Rank card` and `Explain with AI`. They share the adapter, guards, cooldowns
  and dispatcher with slash commands; no menu has its own store.
- Postgres schema and ordered migrations; Drizzle repositories.
- Redis cooldowns and a BullMQ worker, with explicit in-memory fallbacks.
- OpenTelemetry tracing, off by default.
- Required vs optional gateway intents (`INTENT_PROFILE`) and a `/setup`
  capability report.
- One channel resolver for Discord's 2026 channel-obfuscation rollout.
- Versioned export bundle, checksum verification, transactional restore,
  24-hour rollback, deletion receipts, importers and a read-only drift report.
- P6 dashboard/API foundation: Discord OAuth2/PKCE, opaque Postgres sessions,
  per-guild BigInt authorization, a read-only overview, module settings writes
  through the bot's own schemas, `/api/v1` reads plus a settings `PATCH`, a
  fleet template preview, checksummed config export/import with drift,
  hashed guild-bound API tokens with per-route scopes, per-token limits and a
  generated OpenAPI 3.1 document, signed webhook delivery with retries and
  receipts, and `Idempotency-Key` replay on token writes.
- Token-free tests on PGlite and structural fakes.

### Moderation and security

- Cases with atomic case numbers, notes, review, appeals and evidence.
- `/mod` actions plus dry-run-first message scanning.
- Link / phishing filter: a local host blocklist plus punycode detection, with
  `alert` or `delete` mode and `/mod links` as its review queue. No remote feed.
- Profanity / zalgo filter: an operator-owned word list matched on Unicode word
  edges, a configurable combining-mark threshold, and `/mod filters` as the
  combined content-filter review queue.
- Native AutoMod plan and `Keystone ·` rule ownership.
- Anti-nuke, anti-raid, quarantine and the join gate. An enforced join-gate
  hold persists a quarantined `members` row; `/verify start` requires that row
  and sends the verifier through the moderation action port, while `/verify
  status` reads it. The community adapter is not required for the DM. Anti-raid
  holds stay moderator actions and do not get a verify button.
- Audit logging: message delete/edit, member join/leave and moderation cases in
  one operator channel, with five toggles, a 1–365 day retention window and a
  JSON export. Events are stored before delivery, so a broken channel keeps the
  ledger.
- Guild analytics: `/analytics overview | members | messages | commands |
  tickets | export` reads the bot's own ledgers. It adds no analytics table, and
  every view prints its source row counts, so a number can be checked against
  the table that produced it. Admin-only, guild-scoped and capped at 90 days.
- An appeal button on case cards.

### Community

- XP and levels, leaderboards, role rewards and seasonal resets.
- Ledger-backed currency, daily, pay, shop, buying, gambling and an audit ledger.
- Button and select reaction roles, welcome and delayed autoroles.
- Starboard with per-channel overrides and sticky messages.
- Invite tracking: attribution from cached invite counters when a baseline
  exists (a cold cache records an unknown inviter rather than guessing), a
  joins/retention leaderboard, and advisory flags for new or avatar-less
  accounts. No punishment is attached to a flag.
- Thread tickets: panel, open, claim, add, transcript, close, stats and AI summary.
- Giveaways, polls, reminders, schedules, feeds and stat channels.
- Birthdays, suggestions and temporary voice rooms.
- Auto-responders: operator-owned exact, contains or regex triggers with one
  reply per message and a per-trigger cooldown. Configuration is `/tools
  responder`, `/tools responders` and `/tools responder-remove`; records are
  guild-scoped and survive a restart through the same record seam as tags.
- Application forms: `/form create | edit | delete | list | panel | submit |
  review | export`. Fields are validated and required; one pending submission
  per member per form is a database invariant; review accepts, denies and notes
  only a pending row; export is a checksummed JSON file. Modal input is not in
  this build and the panel prints the exact `answers` syntax.
- Guild events: `/event create | edit | delete | list | rsvp | remind | export`.
  A draft/open/closed lifecycle, one RSVP row per member, capacity counted from
  `going` rows inside the store transaction, manual reminders that record who
  sent them, and a checksummed JSON export. Buttons, scheduled reminders and ICS
  are open, not faked.
- Private modmail: `/modmail setup | open | reply | close | transcript | stats`.
  A thread belongs to its opener; only the owner or staff can read or reply, and
  a foreign thread gets the same refusal as a missing one. The first staff reply
  claims the thread; close stores the canonical transcript and its SHA-256 in one
  conditional update, so a duplicate close writes nothing. `stats` lists the
  active queue with thread ids. DM/thread relay is open, not faked.

### AI (opt-in, capped, zero-retention by default)

- Provider abstraction; OpenAI-compatible adapter and a deterministic offline
  provider for tests.
- Hard per-guild monthly dollar and request caps, checked server-side before
  every call.
- Exact-vector server-doc RAG with source citations.
- Ticket deflection that returns a human hand-off without a model call when no
  doc matches.
- Mention-only persona chat, moderation explanations, thread summaries and
  advisory classification.
- Kill switch and per-feature switches. No prompt/completion columns exist.

### Planned (honest roadmap)

- **P6 remaining:** the live OAuth round trip (login, refresh and token
  revocation against real credentials). Scoped API tokens, per-token limits, the
  generated OpenAPI document, signed webhooks with retries and receipts,
  `Idempotency-Key` replay, an idle session timeout and a sealed rotating
  refresh-token path are in repo.
  Schema-driven widgets, the audit trail, the fleet view, built-in and saved
  templates, config export/import/drift, analytics aggregates, session rotation
  and logout revocation, per-route limits, and the `owners[]` instance console
  are in repo; the framework-free `apps/web` carrier is deliberate for now.
- **P7:** invite tracking, audit logging, the link/profanity/zalgo filters,
  auto-responders, guild analytics, `/config`, `/export`, the `/music` saved
  queue, `/form`, `/event`, `/modmail`, the four context menus and the typed
  rank/ticket/greeting surfaces are done; the rest is parity completion (role
  persistence), translating the remaining module copy, and the older community
  button ids that still use their own unsigned listener. The Components V2
  layer (`packages/ui`) and the form panel's modal submit landed in pass 58;
  i18n, `setup.locale` and derived command descriptions in pass 59; the rank
  card, ticket panel and welcome/goodbye greetings in pass 60.
- **P8:** `/music` queue control ships disabled by default; bring-your-own
  Lavalink playback is the open piece (no bundled streamer).
- **P9:** docs site, release workflow and self-host kit; the 14-lesson curriculum is already in `memory/vault/05-Learning/` and checked by `pnpm memory:check`.
- **P10:** sharding, load tests, SLOs, Discord.js v15 migration.

See [the parity matrix](memory/vault/01-Mission/Parity-Matrix.md) and
[the roadmap](memory/vault/01-Mission/Roadmap.md).

## Current progress

| Phase | State | Evidence |
| --- | --- | --- |
| P0 Foundation | Done | Kernel, module contract, diagnostics, memory, CI |
| P1 Substrate | Done | Postgres, Redis, BullMQ, telemetry, `/setup` |
| P2 Moderation | Done | Cases, scanner (invite/mention/duplicate/link/profanity/zalgo), appeals, verify, action logging |
| P3 Community | Done | XP, economy, tickets, tools, events |
| P4 AI + economy | Done | Provider, caps, RAG, chat, explanations, summaries |
| P4.5 Platform hardening | Done | Channel resolver, intents, capability report |
| P5 Portability | Done | Export/restore/rollback, importers, drift |
| P6 Dashboard + API | **In progress** | OAuth/PKCE sessions, per-guild authz, schema-generated settings widgets, audited settings writes, `/api/v1`, fleet view, previewed built-in templates, and checksummed config export/import/drift |
| P7 Command tree | Done | 20 roots · 141 real subcommands; `/help`; generated catalog; shape-aware sync and doctor |
| P7 Context menus | Done | 4 menus (2 user, 2 message) registered in Discord; report opens a real case, case history and rank card read existing rows, explain uses the capped AI path; invocation is human-only |
| P7 Slash harness | Harness done | Synthetic nested `/mod ban` through the real adapter + dispatch; gateway `InteractionCreate` still human-only |
| P7 Audit logging | Done | `/logging`; five event kinds, per-event toggles, append-only ledger, retention; message and moderation events live-proven |
| P7 Analytics | Done | `/analytics`; six read-only views over audit, cases, invites, tickets and command usage; live counts cross-checked against the ledger |
| P7 In-bot config | Done | `/config`; four subcommands over every module's own schema; live `alert → delete → alert` read-back and a rejected invalid value |
| P7 Forms | Done | `/form`; eight subcommands over `forms` and `form_submissions`; live create → panel → submit → review accept → 1.5 KB export parsed with the same answers and decision; modal input open |
| P7 Events | Done | `/event`; seven subcommands over `events` and `event_rsvps`; live create → open → RSVP 1/2 → reminder → decline → 1.2 KB export parsed with the same row; buttons, scheduling and ICS open |
| P7 Modmail | Done | `/modmail`; six subcommands over `modmail_threads` and `modmail_messages`; owner-or-staff privacy, one active thread, a queue with ids and a transcript archived once; live open → reply → 2-message archive → duplicate close refused; DM relay open |
| P7 Export surface | Done | `/export`; six subcommands, file attachments, dry-run import, exact-id delete, live drift; 12.8 KB live bundle parsed and checksum-verified |
| P8 Music queue | Done | `/music`; eight subcommands over a durable `community_records` queue; SQL row lock holds the cap; live add/queue/remove plus disabled refusal |
| P8 Music playback | **Open** | `play`, `skip` and `stop` refuse with the exact missing pieces (no voice/Lavalink client, no `LAVALINK_URL`); the refusal is live-proven, streaming is not shipped |
| P7 Temporary moderation | Done in repo | `/mod ban duration:<minutes>` and `/mod temp-role` write `expires_at`; one delayed `moderation.expire` job, an atomic claim, a failed-release retry and startup recovery. Live SQL/service check; Discord action not live |
| P7 Scheduled delivery | Done in repo | `/tools reminder` and `/tools schedule` enqueue `content.deliver`; an atomic claim lets exactly one of the timer and the sweep send, and a failed send releases it. Live SQL/service check; Discord delivery not live |
| P7 Parity completion | **In progress** | Invite tracking, audit logging, link/profanity/zalgo filters, auto-responders, analytics, in-bot config, `/export`, forms, events, modmail, temporary moderation, panic mode and goodbye shipped; real playback, translating the remaining copy and migrating the remaining embeds open |

Live evidence (2026-11-01): `AI Team#5758` connected and Discord reported 20
global roots (including `/analytics`, `/config`, `/event`,
`/export`, `/form`, `/help`, `/invites`, `/logging`, `/modmail`, `/music`, the
five `/setup` actions, the two `/appeal` actions and the two `/verify` actions) plus
**2 user menus and 2 message menus** with no drift, and Qwen3:8b answered a
mention in
`#ai-chat`. A development `!`
bridge ran `!ping`, `!about`, `!help commands`, `!help browse`, `!help search
query=ban`, `!ai status`, `!mod history`, `!rank leaderboard`, `!invites
leaderboard`, `!invites who` and `!logging status | events | retention | export`
through the real dispatch pipeline. `/ticket stats` reached
the `ManageGuild` guard (the MCP bot is not an admin); that check exposed a real
ordering bug, now fixed and unit-tested.

Link-filter and content-filter live evidence (2026-11-01): a marked MCP message
with `https://login.phish.test/verify` created case #1 (`alerted`, blocklist);
`https://www.phish.test/account` created #2; `!mod review case=2` changed #2 to
`reviewed`; `https://xn--pple-43d.test/login` created #3 (punycode); and
`https://example.com/docs` created no case. Later, with a temporary
`dryRun: false` / `delete` seed, the blocked message returned `10008: Unknown
Message` after the bot handled it. The safe seed then produced a profanity case
for `pineapple` and a zalgo case for a 16-mark string; `!mod filters` listed all
three content-filter cases and `!mod review` closed the profanity one. Pass 25
repeated the delete proof for profanity: with a temporary `dryRun: false` /
`profanity: "delete"` seed the `pineapple` message disappeared while case #1
stayed open in `!mod filters`. The safe seed is back in the repository. See
[pass 23](memory/journal/2026-11-01-pass-23.md) and
[pass 24](memory/journal/2026-11-01-pass-24.md).

Slash-harness evidence (2026-11-01, pass 27): a synthetic Discord payload for
`/mod ban user:@target reason:"posting raid invites" dry_run:false` crossed the
real `asInteractionLike` adapter, registry and dispatch, called the ban port and
created case #1; an unknown subcommand was rejected before side effects. This is
structural, not a gateway interaction. The pass also found two live bot process
trees double-posting replies; after stopping both and starting one, the MCP
transcript showed exactly one reply for `!mod history` and one for
`!help search query=ban`. See [pass 27](memory/journal/2026-11-01-pass-27.md).

Command-tree live evidence (2026-11-01, pass 28): the Discord REST command set
reports `AllinOne` with **14 global roots and 90 live subcommands**, including
`/analytics` and `/logging`; pass 26's `commands:doctor` run reported 12 roots /
77 subcommands at that point. The `!` bridge then returned the generated
catalog for `!help commands`, the module map for `!help browse`, one search hit
for `!help search query=ban`, a case list for `!mod history`, and the AI status
embed for `!ai status`. See [pass 26](memory/journal/2026-11-01-pass-26.md). A
human slash invocation is still the one unobserved surface: SaseQ's `discord-mcp`
has no application-command tool, and the **Use Slash Command** install permission
is a client permission, not an MCP API method.

Auto-responder live evidence (2026-11-01, pass 25): the seeded guild trigger
`hello keystone` replied to a marked MCP message with
`Hi from Keystone's auto-responder.` A second identical message inside the
60-second cooldown produced no reply; a third after the window replied again.
See [pass 25](memory/journal/2026-11-01-pass-25.md).

Audit-logging live evidence (2026-11-01, pass 28): `/logging setup` sent a real
test embed to the configured log channel. An MCP message was edited and then
deleted; the log channel received a **Message edited** embed with before/after
content and a **Message deleted** embed with the stored content. A marked
profanity fixture opened case #1 and arrived as a **Moderation case** embed. The
status bridge reported 3 stored events; the event toggle turned `message_edit`
off and back on; retention was set to 7 days; and `!logging export` returned
versioned JSON with the settings and those three events. Each reply appeared
once. Member join/leave delivery is covered by the adapter test but was not
exercised with a second account. See
[pass 28](memory/journal/2026-11-01-pass-28.md).

Analytics live evidence (2026-11-01, pass 29): after a fresh memory-mode boot,
`!logging setup channel=#ai-chat` enabled the ledger. An MCP message was edited,
then deleted; `!logging status` reported **2 stored** events, and
`!analytics overview days=7` printed **2 logged events** for the same window.
`!analytics messages days=7` printed exactly **1 deleted · 1 edited**, matching
the two MCP actions. `!analytics commands days=7` rose from 0 to 3 to 4 as bridge
commands completed, because an `/analytics` run is recorded after its reply.
At pass 29 `pnpm commands:doctor` reported `Registry 14 roots · 90
subcommands`; after pass 30's `/config` it reported 15 roots / 94 subcommands,
pass 31's `/export` reached 16 roots / 100 subcommands, and pass 32's `/music`
brought it to 17 roots / 108 subcommands; pass 34's `/setup` hub brought it to
17 roots / 113 subcommands, pass 35's `/appeal` hub brought it to 17 roots / 115
subcommands, and pass 36's `/verify` hub brought it to 17 roots / 117
subcommands. Pass 40's `/form` hub brought it to 18 roots / 125 subcommands,
pass 41's `/event` hub brought it to 19 roots / 132, and pass 42's `/modmail`
hub brought the ledger to **20 roots** at pass 42. The
MCP text reader
does not render embeds, so the embed fields, top-command list and JSON export
were covered by [the command test](modules/analytics/src/analytics.test.ts), not
read back live. See [pass 29](memory/journal/2026-11-01-pass-29.md).

Config live evidence (2026-11-01, pass 30): `!config list` reported **8 modules
· 1 disabled here**. `!config get module=moderation key=automod.links` returned
`"alert"`; `!config set ... value=delete` returned `Set moderation.automod.links to "delete"`,
and the next `get` returned `"delete"`. A `value=bogus` write returned
`automod.links: Invalid enum value. Expected 'off' | 'alert' | 'delete'` and the
next read still returned `"delete"`; the pass then reset the value to `"alert"`.
Each bridge command produced exactly one reply. Boot found `config` missing,
performed one clear + re-register cycle, and `pnpm commands:doctor` then reported
`Registry 15 roots · 94 subcommands` and `Discord 15 global chat-input commands ·
94 subcommands`; pass 31's `/export` brought that to 16 / 100. The MCP cannot
invoke slash commands or render embeds, so the
list/export embeds are covered by
[the config test](modules/setup/src/config.test.ts), not read back live. See
[pass 30](memory/journal/2026-11-01-pass-30.md).

Export live evidence (2026-11-01, pass 31): one memory-mode process served the
real bridge. A marked link message created case #1; `!rank daily` created one
100-coin ledger row; `!export guild` uploaded a **12.8 KB** bundle whose reply
reported **49 settings · 1 case · 1 case event · 1 ledger row · 1 record**; the
file was downloaded from Discord and parsed with the same verifier, which
confirmed checksum `5cde59ae…` and those counts. `!export user user=1493685079471147108`
uploaded a 2 KB member file. A stale
`logging.channelId` made `!export drift` report **1 missing**; restoring the real
channel made it **0 missing**. A wrong-id `!export delete` anda memory-mode `!export rollback` were refused with named reasons. `!export import` was not run
live because the bridge cannot carry an attachment; it is covered by the PGlite
round-trip test. See [pass 31](memory/journal/2026-11-01-pass-31.md).

Music live evidence (2026-11-01, pass 32): one memory-mode process served the
bridge. `!music status` reported **disabled · 0/25 · playback UNAVAILABLE** and
named the missing voice/Lavalink client. `!config set module=music
key=enabled value=true` enabled it; two `!music add` calls produced **1/25** and
**2/25**; `!music queue` listed both tracks; `!music play` and `!music skip`
refused with the same named reason; `!music remove position=1` left **1/25**; and
after `enabled=false`, `!music add` was refused. The in-memory counts are the
real queue length; the SQL row and its cap are covered by the PGlite test, not
this live window. See [pass 32](memory/journal/2026-11-01-pass-32.md).

Context-menu live evidence (2026-11-01, pass 33): one memory-mode process booted,
found all four menus missing, cleared the global set once and registered **21
application commands** (17 roots + 4 menus). At pass 33, `pnpm commands:doctor`
then read Discord's own registry and reported **17 chat-input commands · 108 subcommands ·
2 user menus · 2 message menus** with no missing, extra or changed entries.
The MCP bot cannot right-click, so none of the four handlers was invoked live;
`Report message` opening a real case, `Case history` reading the same rows,
`Rank card` reading a seeded `4 / 400` level row and `Explain with AI` honouring
the AI switch are covered by adapter and command tests. See
[pass 33](memory/journal/2026-11-01-pass-33.md).

Setup live evidence (2026-11-01, pass 34): the saved plan table names 12 roots /
59 subcommands, not 18 / 160; the 160 target is recorded as unverified rather
than filled with invented names. The largest named gap was `/setup` (5 planned,
0 registered), so it became a real hub. Through the MCP bridge, `!setup module`
reported **9 modules · 2 disabled here**, `music` was enabled and then reset to
its schema default, and the read-back showed `music is disabled here` — a real
settings change followed by the default. `/setup verify` read back through
Discord reported **17 roots · 113 subcommands**, and `commands:doctor` agreed
with no drift. `/setup import` is a preview only and was not sent live because
the MCP cannot attach a file; its dry-run path is covered by a test. See
[pass 34](memory/journal/2026-11-01-pass-34.md).

Appeal live evidence (2026-11-01, pass 35): one memory-mode process served the
bridge. `!config set module=moderation key=dryRun value=false` allowed a real
warning case against the MCP author; `!appeal open case=1` appended the appeal;
`!appeal status case=1` returned **#1 · warn · appealed · 1 appeal**; then
`!mod review case=1` changed the case state and `!appeal status case=1` returned
**#1 · warn · reviewed · 1 appeal** — the event survived the state change because
status reads `case_events`, not the current state. A case against the bot was
refused with **Case #2 is not one of your cases.**; the no-option status listed
the same appeal. `commands:doctor` read Discord and reported **17 roots / 115
subcommands**. The MCP cannot invoke slash, and the embed fields are covered by
the command test; the plain-text content is the live-read part. See
[pass 35](memory/journal/2026-11-01-pass-35.md).

Verify-hub evidence (2026-11-01, pass 36): one memory-mode process served the
bridge. `!config set module=moderation key=joinGate.enabled value=true` enabled
the gate; `!verify status` returned **Verification status · No verification
record.**; `!verify start` refused with **I could not DM you (Cannot send
messages to this user). Open DMs from server members and run /verify start
again.**; a second `!verify status` still returned no record, proving `start`
did not mark the member verified. The MCP account is a bot and cannot receive a
DM or click a button, so the completion path is covered by the command test and
PGlite member-store test, not claimed live. At pass 36, `commands:doctor` read
Discord and reported **17 roots / 117 subcommands** with 0 drift.

Join-gate state evidence (2026-11-01, pass 37): the security coordinator now
writes a quarantined `members` row only after an enforced join-gate hold. The
join path is covered by `security.test.ts` because the MCP account is a bot and
cannot make a member join: a young account produced a row with `quarantined:
true` and no `verifiedAt`; an old-enough account produced no row; a dry run
produced no row; and anti-raid quarantines produced no verify row or button.
`verification.test.ts` proves completion refuses no record, a non-quarantined
record, an already-verified record and a disabled gate, and transitions only a
quarantined row after the action succeeds. Live in `#ai-chat` with the gate
enabled and no hold on record:

```text
> !verify status
< Verification status · No verification record.

> !verify start
< No quarantine is recorded for you in this server. If you are restricted,
  ask a moderator.
```

The join and completion paths are not claimed live; only the refusal is.

Forms evidence (2026-11-01, pass 40): one memory-mode process served the bridge
(a stale process from an earlier session was stopped first). `!form create` wrote
`live-test` as a draft with two fields; `!form edit ... state=open` opened it;
`!form panel` posted the panel and recorded the channel; `!form submit` wrote
pending submission `31778bdb-6180-4671-afab-03d4f880a626`; `!form review` read
**1 pending submission**; a decision `accepted` with a note transitioned the row
and a second `!form review` read **0 pending**; `!form delete` was refused
because the history exists; `!form export` attached a **1.5 KB**
`keystone.forms` file with checksum `d1fd6d9105a54056…`. The file was downloaded
(HTTP 200, 1540 bytes) and parsed: **1 form / 1 submission**, the same
`why=One clean bot process on the real bridge` and `tz=UTC` answers, state
`accepted`, reviewer id and note, and a SHA-256 that recomputes to the same
value. At pass 40, `commands:doctor` read Discord and reported **18 roots / 125
subcommands / 2 user + 2 message menus** with no drift. Modal input, the panel embed's rendered
text and a human staff member without `ManageGuild` were not exercised live; the
command and PGlite tests cover them. See
[pass 40](memory/journal/2026-11-01-pass-40.md).

Events evidence (2026-11-01, pass 41): one memory-mode process served the bridge
and was stopped afterwards. `!event create` wrote `launch-night` as a draft with
capacity 2; `!event edit ... state=open` opened it; `!event rsvp ... rsvp=going`
read **1/2 going**; `!event remind` posted **Reminder 1** with **1 going**;
`!event rsvp ... rsvp=not_going` read **0/2 going**; a second `going` read
**1/2**; `!event export` attached a **1.2 KB** `keystone.events` file with checksum
`95023b522d11ed4f…`. The file was downloaded (HTTP 200, 1242 bytes) and parsed:
**1 event / 1 RSVP**, `open` with capacity 2, `reminderCount 1`, the MCP author
as `remindedBy`, one `going` row and a SHA-256 that recomputes. `!event delete`
was refused because that RSVP exists. `commands:doctor` read Discord and reported
**19 roots / 132 subcommands / 2 user + 2 message menus** with no drift. The MCP
account is a bot, so its RSVP is the bot's own membership, not a human member;
the second-member capacity refusal and a member without `ManageGuild` are
command-tested. Buttons, scheduled reminders and ICS do not exist and are not
claimed. See [pass 41](memory/journal/2026-11-01-pass-41.md).

Modmail evidence (2026-11-01, pass 42): one memory-mode process served the bridge
and was stopped afterwards. `!modmail setup` read **enabled · max 500 threads ·
0 active**; `!modmail open` wrote thread `0f7dbc9c-5054-4d60-907b-f200fbe46206`;
`!modmail reply` read back **member side · 2 messages**; `!modmail transcript`
read **2 messages · live, not archived yet**; `!modmail close` archived **2
messages** with checksum `c3c539706ed70e53…`; a duplicate `!modmail close` was
refused with **already closed**; the archived transcript still read **2 messages
· archived**; `!modmail stats` read **1 thread / 0 active / 2 messages**. A
disabled `!modmail setup enabled=false` refused a member open with the exact
reason, and `enabled=true` restored it. `commands:doctor` read Discord and
reported **20 roots / 2 user + 2 message menus** with no drift.
The MCP account is a bot and owns its own thread, so a second member, the
staff-side claim and the foreign-thread refusal are command-tested; the bridge
posts ordinary messages, so ephemerality and `InteractionCreate` are not claimed
live. DM/thread relay does not exist and is not claimed. See
[pass 42](memory/journal/2026-11-01-pass-42.md).

P6 web evidence (2026-11-03 UTC, passes 49–51): `pnpm probe:live` booted the real web
handler on an ephemeral local port against Postgres. It completed the login
redirect and state-cookie flow (with a fake OAuth exchange), created a real
Postgres session, loaded the AI settings page generated from the module's Zod
schema, saved `monthlyBudgetUsd=9` through the form, read the one `audit_events`
row naming the dashboard actor and source, and then posted `5000`: the response
was `400`, the field and value were preserved, the stored value stayed `9` and no
second audit row was written. The same check is recorded as `web-schema-widgets`.
A second check, `web-fleet-templates`, loaded `/dashboard/fleet` with the same
real session and CSRF, listed two Postgres-backed guilds, previewed strict
moderation across both without writing, got `409` for a wrong fingerprint, then
applied the previewed plan: `302` to `?applied=2&failed=0`, one moderation write
and one dashboard audit row per guild. A third check,
`web-config-export-import-drift`, exported a 12-module checksummed bundle, posted
it to the second guild as a multipart file, previewed the diff without writing,
got `400` for an edited checksum and `409` for a wrong fingerprint, applied the
real plan (`302`, one audited AI write, baseline stored), saw no drift, then
changed one setting out of band and saw exactly one reported drift. A live
Discord OAuth login is still not claimed.

Still open and not claimed as done:

- Slash `InteractionCreate` and a right-click context-menu invocation from a
  human client (the MCP can neither invoke slash commands nor right-click).
- A live member join/leave in the audit ledger, and a human author through the
  log filters.
- Live Postgres, live role grants, live selects/voice/scheduler and a human
  mention in production.
- pgvector ANN at 1M×1536 with production embeddings; the exact index is the
  portable path today.
- MEE6 import is file-based, not a live fetch.
- Forms modal input is not implemented; `/form submit` takes the validated
  `answers` option. Forms are not yet part of the `/export guild` bundle.
- Live Discord OAuth, refresh and token revocation are the remaining P6 proof.
  The Postgres session path,
  scoped tokens, analytics, webhooks and keyed replay are live-proven locally,
  but the Discord login that creates a session is not.

## How to add stuff

Read [Module-Contract](memory/vault/03-Architecture/Module-Contract.md) and copy
`modules/diagnostics` as the smallest working template. The short version:

1. Create `modules/<feature>/` with the same package shape as `diagnostics`.
2. Export a `defineModule({...})` manifest with `settingsSchema`,
   `defaultSettings`, commands, intents and `docsPath`.
3. Add commands with `defineCommand({...})`. Prefer real `subcommands` over a
   flat `action` option: Discord's picker expands them, `/help` indexes them and
   they do not spend another global root. Declare options and guards; the
   dispatcher runs guild, permission and cooldown checks for you.
4. Put side effects behind a kernel port (`ModerationActions`, `CommunityActions`,
   `AiProvider`, `JobQueue`). Modules must not import discord.js, Drizzle,
   BullMQ or Redis.
5. Add pure tests. Use `packages/testing` and PGlite; never require a token.
6. Add the manifest to `packages/module-catalog/src/index.ts` (the one list
   shared by the bot and the dashboard), then run:

```bash
pnpm typecheck
pnpm test
pnpm budget
pnpm commands:catalog   # regenerate memory/machine/commands.json + vault page
pnpm memory:check
pnpm check
```

7. Add a spec, status and teaching note under `memory/vault/04-Modules/<id>/`,
   plus the matching machine entry. Run `pnpm memory:render`; never hand-edit a
   generated page.

A new module's settings editor appears in the dashboard automatically because the
web app reads the same `settingsSchema` from the shared catalog. Do not add a
web-only schema or a second write path: use `SettingsService.update` and the
module's existing defaults.

If the feature needs a database table, add a migration in
`packages/db/src/migrations` and a repository; if it needs a Discord permission,
declare it on the manifest. If it needs a new root command, check the budget
first: seventeen roots are used, eighty-three remain, and every root is a
permanent public interface. A subcommand under an existing hub costs no new
root. A context menu costs one of the separate 15 user or 15 message slots, not
a root.

## How to have an agent read it easily

Point the agent at [`AGENTS.md`](AGENTS.md) first. It contains the read order,
the non-negotiable rules and the current state. The machine-readable memory is
the source of truth:

```text
memory/machine/project.json    phase, modules, decisions, open questions
memory/machine/features.json   every parity row and its honest status
memory/machine/research.json   external claims with source/date/expiry
memory/machine/passes.json     one row per working pass
memory/machine/decisions.json  ADR index
memory/machine/schema.json     the validator contract
```

A good agent prompt is short:

```text
Read AGENTS.md, then memory/machine/project.json and features.json.
Work only on the next open phase. Before you finish: pnpm check, update the
journal, feature status and pass ledger. Do not add a command root without
checking pnpm budget.
```

`pnpm memory:check` validates the machine files, the generated pages and every
wikilink. `pnpm memory:render` regenerates the pages from machine truth. Tests
must never need a token, a live guild or the network.

## How to set up the Obsidian vault

1. Install [Obsidian](https://obsidian.md).
2. **Open folder as vault** → select `memory/vault` (not the repo root).
3. Open `00-Index/Home.md`. Wikilinks work without plugins.
4. Start with `01-Mission/Status.md` for what is proven, `03-Architecture/` for
   how it fits together, and `04-Modules/<id>/` for one feature at a time.
5. The vault is the human half; `memory/machine/` is the machine half. Edit
   machine files, run `pnpm memory:render`, then `pnpm memory:check`. Generated
   pages say “do not edit by hand” at the top.

The `.obsidian` folder is checked in so the graph and link settings travel with
the repo. No community plugins are required.

## Live testing and command sync

The canonical slash surface needs a real interaction. A Discord MCP or bot
account can only post messages, so in development `DEV_GUILD_ID` enables a
message bridge that feeds the same registry, guards, cooldowns and reply adapter:

```text
!ping
!about
!help commands
!help browse
!help search query=ban
!ai status
!mod history
!mod links
!mod filters
!rank leaderboard
!tools responders
!logging status
!logging events event=message_edit enabled=false
!logging retention days=7
!logging export
!config list
!config get module=moderation key=automod.links
!config set module=moderation key=automod.links value=alert
```

The bridge is **never registered in production** and only answers in that one
guild. Mention chat and the shared `keystone-test:` fixture marker also allow
bot authors only there; the marker is stripped before the security engine or the
auto-responder sees the content. See
[Live-Testing](memory/vault/03-Architecture/Live-Testing.md).

Discord replaces the whole global command set with one bulk overwrite. Keystone
fetches the server set at ready and clears + re-registers only when the **name or
option tree** drifts; after any change it fetches again and logs
missing/extra/changed roots. `pnpm commands:doctor` is the read-only check, and
`pnpm commands:resync` is the explicit clear → register → verify cycle. Do not
clear on every boot: Discord allows two bulk overwrites per ten minutes, and a
clear followed by a rate-limited register leaves the app with no commands.

## Architecture

```text
apps/bot        gateway adapter, composition root, dispatch, dev prefix bridge
apps/worker     BullMQ consumer with idempotent handlers
apps/web        optional dashboard/API: OAuth sessions, guild authz, settings writes
packages/kernel registry · guards · settings · dispatch · budget · component router · ports
packages/ui     typed Components V2 layouts and modals; enforces the 40/4,000 budget
packages/module-catalog  the one module list shared by bot and web
packages/db     Drizzle schema, migrations, Postgres repositories
packages/importer  bundles, restore/rollback, importers, drift
packages/cache  Redis cooldowns + explicit in-memory fallback
packages/queue  BullMQ adapter + in-process driver for tests
packages/telemetry  OpenTelemetry wrapper, off by default
packages/config Zod-validated environment
packages/testing token-free fixtures for module authors
modules/        diagnostics, setup, moderation, community, ai, invites, logging, analytics, music
memory/         Obsidian vault + machine state + journal
```

**Dependencies point inward.** A module may depend on the kernel. The kernel
never imports discord.js, Drizzle, BullMQ or Redis. `apps/bot` is the only place
that knows what a Discord interaction looks like; `packages/db` is the only
place that knows Postgres. Gateway state gets its own owner where it has real
logic: invite events are translated by `invite-events.ts` and the cache/queue
live in `invite-tracker.ts`. See [System-Overview](memory/vault/03-Architecture/System-Overview.md).

## Contributing and licence

Start with [CONTRIBUTING.md](CONTRIBUTING.md), then
[the module contract](memory/vault/05-Learning/01-the-module-contract.md) and the
longer [Contributing](memory/vault/07-OpenSource/Contributing.md) notes.
Governance is [GOVERNANCE.md](GOVERNANCE.md), conduct is
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and vulnerabilities go through
[SECURITY.md](SECURITY.md) — never a public issue. Open an issue with a small
spec before writing a large feature; scope control is what keeps this
maintainable. The expected checks are `pnpm check` and a memory update in the
same PR.

**No paid dependencies.** Keystone must stay runnable on free/local services:
public GitHub, Discord, Postgres, Redis, Ollama, PGlite and in-memory adapters.
Never add a paid GitHub plan/feature or another paid service to make a feature
work; see [Non-Negotiables](memory/vault/01-Mission/Non-Negotiables.md#8-nothing-that-costs-money).

**Licence: AGPL-3.0-or-later.** See [`LICENSE`](LICENSE). You may run, study,
share and modify Keystone; if you run a modified version as a network service,
you must offer its source under the same licence. There is no CLA; contributions
are inbound=outbound. A DCO check is planned for the public workflow.

Keystone is a teaching project before it is a product. If an explanation and a
test disagree, the test wins; if this README and `memory/machine/` disagree, the
machine file wins and the README needs a fix.
