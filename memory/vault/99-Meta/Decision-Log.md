# Decision log

Chronological index. ADRs hold the reasoning; this page holds the audit trail,
including the small calls that did not deserve an ADR.

## 2026-10-31 — P0

| # | Decision | Where |
| --- | --- | --- |
| 1 | discord.js v14 behind a thin adapter | [[ADR-0001-discordjs-v14-adapter]] |
| 2 | pnpm monorepo, source exports, no build step yet | [[ADR-0002-monorepo-dev-first]] |
| 3 | Command budget enforced in CI and at boot | [[ADR-0003-command-budget]] |
| 4 | Dual memory: vault + `machine/project.json` | [[ADR-0004-memory-system]] |
| 5 | Module contract instead of a central switch | [[ADR-0005-module-contract]] |
| 6 | Turborepo deferred to P1 | [[Stack-Decisions]] |
| 7 | In-memory settings and cooldowns for P0, behind interfaces | `packages/kernel/src/settings.ts` |
| 8 | One root `tsconfig.json` instead of per-package configs | [[ADR-0002-monorepo-dev-first]] |
| 9 | No `LICENSE` file until Q-1 is answered | [[Open-Questions]] |
| 10 | `packages/testing` is a thin re-export of `@keystone/kernel/testing` | `packages/testing/src/index.ts` |
| 11 | pnpm build-script allow-list uses pnpm 12's `allowBuilds` map in `pnpm-workspace.yaml` (the `package.json` "pnpm" field is no longer read) | [[Security]] |
| 12 | Explicit module array, not glob loading | [[01-the-module-contract]] |
| 13 | `diagnostics` is the reference module and ships with the bot | [[04-Modules/diagnostics/Spec\|Spec]] |

## 2026-11-01 — P2

| # | Decision | Where |
| --- | --- | --- |
| 14 | Cases own one accountability spine for mod, security and later tickets/AI | [[ADR-0007-moderation-capability-port]] |
| 15 | Discord actions sit behind `ModerationActions`; modules never import discord.js | [[ADR-0007-moderation-capability-port]] |
| 16 | Dry-run is the default and still records `alerted` cases | [[04-Modules/moderation/Spec\|Moderation spec]] |
| 17 | Case numbers are allocated by an atomic per-guild counter | `packages/db/src/case-store.ts` |
| 18 | Appeals are append-only events, never edits to the original reason | [[04-Modules/moderation/Teaching\|Moderation teaching]] |
| 19 | Native AutoMod only manages `Keystone ·`-prefixed rules | [[04-Modules/moderation/Spec\|Moderation spec]] |
| 20 | Pglite/recorder proofs are labelled separately from live Discord proofs | [[01-Mission/Status\|Project status]] |

## 2026-11-01 — P3

| # | Decision | Where |
| --- | --- | --- |
| 21 | One `CommunityPort` with a typed store and a Discord action half | [[ADR-0008-community-capability-port]] |
| 22 | XP is a projection over `xp_events`; money is a ledger, never a counter | [[04-Modules/community/Teaching\|Community teaching]] |
| 23 | P3 feature state uses guild-scoped `community_records`; the level/ledger/ticket spine stays typed | `packages/db/src/migrations/0004-community-records.ts` |
| 24 | `/rank`, `/ticket` and `/tools` are the only new roots | [[03-Architecture/Command-Budget\|Command budget]] |
| 25 | Reaction roles ship as buttons first; select menus are an explicit open item | [[04-Modules/community/Status\|Community status]] |
| 26 | Live Discord/gateway claims stay separated from service/PGlite proofs | [[01-Mission/Status\|Project status]] |
| 27 | Select components are structural kernel rows; the adapter alone builds Discord selects | [[ADR-0009-select-rows-and-season-archives]] |
| 28 | Season resets archive profiles and write an idempotency marker before clearing `levels` | [[ADR-0009-select-rows-and-season-archives]] |
| 29 | Sticky deletion is scoped to the message id the bot recorded | [[04-Modules/community/Status\|Community status]] |
| 30 | P3 stays on the three existing roots; new paths are `/tools` and `/rank season` | [[03-Architecture/Command-Budget\|Command budget]] |

## 2026-11-01 — P4

| # | Decision | Where |
| --- | --- | --- |
| 31 | `AiProvider` is a kernel contract; the composition root selects the adapter | [[ADR-0010-ai-provider-and-caps]] |
| 32 | Caps are server-side dollar + request counters, checked before every call | [[ADR-0010-ai-provider-and-caps]] |
| 33 | Prompts/completions have no schema; only aggregate usage is retained | [[ADR-0010-ai-provider-and-caps]] |
| 34 | Server RAG uses a portable exact index; pgvector ANN remains an open gate | [[PGVector-Fleet]] |
| 35 | AI is advisory only; no moderation/action path from the module | [[04-Modules/ai/Spec\|AI spec]] |
| 36 | `/ai` is the only new root; `/ticket summary` reuses the AI port | [[03-Architecture/Command-Budget\|Command budget]] |
| 37 | AI is off by default with a master switch and per-feature switches | [[04-Modules/ai/Status\|AI status]] |
| 38 | Economy balances stay derived from `economy_ledger`; no cached balance column | [[ADR-0011-economy-ledger-and-double-spend]] |
| 39 | `CommunityStore.spend` owns the checked debit; Postgres locks the guild row, in-memory uses one queue | [[ADR-0011-economy-ledger-and-double-spend]] |
| 40 | The Discord interaction id is the idempotency key; daily keeps the UTC day key plus the kernel cooldown | [[ADR-0011-economy-ledger-and-double-spend]] |
| 41 | Insufficient funds, self-pay, bot targets, caps and cooldown refuse explicitly; nothing is silently clamped | [[04-Modules/community/Spec\|Community spec]] |
| 42 | Shop/role purchases grant directly; a failed grant is reported, not queued for review | [[ADR-0011-economy-ledger-and-double-spend]] |
| 43 | The economy reuses `/rank`; the command ledger stays 10/100 | [[03-Architecture/Command-Budget\|Command budget]] |
| 44 | Automatic AI summaries on ticket close are not wired; P4 does not name them, so summaries stay on demand | [[ADR-0011-economy-ledger-and-double-spend]] |

## 2026-11-01 — live verification (P5)

| # | Decision | Where |
| --- | --- | --- |
| 45 | A dev-only `!` bridge feeds the real dispatch pipeline because a Discord MCP cannot invoke slash commands; it is never registered in production | [[Live-Testing]] |
| 46 | The MCP bot may author messages only in `DEV_GUILD_ID`; production still ignores every bot author | `apps/bot/src/ai-events.ts` |
| 47 | `/ticket stats` is guild-wide, so its branch runs before the ticket-id lookup instead of requiring a ticket thread | `modules/community/src/commands/ticket.ts` |
| 48 | A failed live command is fixed at the source and covered by a test; the MCP's missing `ManageGuild` is recorded as a harness limitation, not patched around | [[04-Modules/community/Status\|Community status]] |

## 2026-11-01 — public release (P5)

| # | Decision | Where |
| --- | --- | --- |
| 49 | Licence is AGPL-3.0-or-later; a public repo without a licence is not open source | `LICENSE`, [[Open-Questions]] |
| 50 | Commands clear only on first run/drift, not every boot; `pnpm commands:resync` is the explicit clean cycle | `apps/bot/src/index.ts`, `scripts/commands.ts` |
| 51 | README is the user and agent entry point; `AGENTS.md` holds the short read order and non-negotiables | `README.md`, `AGENTS.md` |
| 52 | The public repository is `RNGBubba/keystone-discord-bot`, named after the bot and the project | https://github.com/RNGBubba/keystone-discord-bot |

## 2026-11-01 — P6 dashboard foundation

| # | Decision | Where |
| --- | --- | --- |
| 53 | The P6 foundation is framework-free Node HTTP over kernel ports; the Next.js shell is a later UI decision | [[ADR-0016-dashboard-foundation]] |
| 54 | Sessions are opaque random values; only a SHA-256 hash is stored, and the Discord access token is sealed before Postgres. Unused refresh-token storage was removed in pass 20 | [[Dashboard-Security]] |
| 55 | Every guild route checks both the user's BigInt permissions and bot membership; a URL guild id is never trusted | [[Dashboard-Security]] |
| 56 | Web reads go through `SettingsService` and the `DashboardStore` port, not ad-hoc SQL in a handler | [[Dashboard]] |
| 57 | Read-only first: settings writes, fleet actions and scoped tokens are deferred until the authz matrix is proven | [[Roadmap]] |
| 58 | No paid services, including paid GitHub plans/features; free/local only | [[01-Mission/Non-Negotiables\|Non-Negotiables]] |
| 59 | Settings writes reuse the viewer's `GuildAccessService` gate, session CSRF and `SettingsService` schema; no second write path | [[Dashboard]] |
| 60 | The first settings editor is a validated JSON textarea; richer field widgets remain P6 work. **Superseded by #85** | [[Dashboard]] |

## 2026-11-01 — P7 invite tracking

| # | Decision | Where |
| --- | --- | --- |
| 61 | Attribution is a pure diff of cached invite `uses`, with the code as tie-breaker; there is no invented join event | [[ADR-0017-invite-tracking]] |
| 62 | Join handling is serialized per guild, so two arrivals cannot both claim one increment | [[ADR-0017-invite-tracking]] |
| 63 | `invite_joins` is unique on `(guild, user, joined_at)`; leaves mark the newest open row and totals are SQL aggregates | [[ADR-0017-invite-tracking]] |
| 64 | Suspicious-join flags are advisory only; the invite port has no punishment method | [[04-Modules/invites/Spec\|Invites spec]] |
| 65 | Invite settings use the existing dashboard write path; `/invites` is read-only and one new root | [[04-Modules/invites/Spec\|Invites spec]] |

## 2026-11-01 — P7 link / phishing filter

| # | Decision | Where |
| --- | --- | --- |
| 66 | The link filter is a local host blocklist plus a punycode heuristic; no remote threat feed, network call or paid reputation service | [[04-Modules/moderation/Spec\|Moderation spec]] |
| 67 | `/mod links` is a subcommand under the existing root, not a new command; review uses the existing `/mod review case=N` path | [[04-Modules/moderation/Spec\|Moderation spec]] |
| 68 | The only bot-author exception in the security adapter is a `keystone-test:` marker in `DEV_GUILD_ID`, stripped before evaluation; production has no marker path | [[Live-Testing]] |
| 69 | The first live proof used `alert` mode; `delete` shares the coordinator path but was not claimed as live-run in pass 23 | [[04-Modules/moderation/Status\|Moderation status]] |

## 2026-11-01 — P7 content filters

| # | Decision | Where |
| --- | --- | --- |
| 70 | Banned words match on Unicode word edges, never as substrings; escaping happens before the regex is compiled | [[04-Modules/moderation/Spec\|Moderation spec]] |
| 71 | Profanity and zalgo are separate modes with separate settings; combining marks are legitimate in many scripts | [[04-Modules/moderation/Spec\|Moderation spec]] |
| 72 | `/mod filters` is a subcommand under the existing root; `/mod links` remains the link-only view | [[04-Modules/moderation/Spec\|Moderation spec]] |
| 73 | The default word list is empty and both rules are off; the operator owns the policy | [[04-Modules/moderation/Spec\|Moderation spec]] |
| 74 | The link filter's delete branch was proven live with a temporary `dryRun: false` seed; the committed dev seed and production default stay `alert`/dry-run | [[04-Modules/moderation/Status\|Moderation status]] |

## 2026-11-01 — P7 auto-responder

| # | Decision | Where |
| --- | --- | --- |
| 75 | Auto-responder triggers are guild-scoped `community_records`, not a new table: the record seam already gives in-memory and Postgres the same behaviour | [[04-Modules/community/Spec\|Community spec]] |
| 76 | One reply per message, with exact > contains > regex precedence, so the result never depends on storage order | [[04-Modules/community/Spec\|Community spec]] |
| 77 | The 60-second cooldown is per trigger and written only after a successful send; a failed send retries next time | [[04-Modules/community/Spec\|Community spec]] |
| 78 | The `keystone-test:` marker now has one shared matcher; a fixture message reaches the auto-responder only, never XP/starboard/tickets | [[Live-Testing]] |
| 79 | The profanity `delete` branch was proven live with a temporary `dryRun: false` seed; this closes the pass-24 claim gap, and the committed seed stays `alert` | [[04-Modules/moderation/Status\|Moderation status]] |

## 2026-11-01 — P7 command tree

| # | Decision | Where |
| --- | --- | --- |
| 80 | Hubs register real Discord subcommands instead of one flat `action` option; a subcommand spends no global slot | [[ADR-0018-real-subcommands]] |
| 81 | One module owns a root; cross-module registration into another module's root is rejected | [[ADR-0018-real-subcommands]] |
| 82 | `/help` reads the registry catalog injected by dispatch; `pnpm commands:catalog` renders the same data to machine JSON and vault Markdown | [[Command-Catalog]] |
| 83 | Boot sync compares name, description and the full option tree; a name-only comparison would miss subcommand changes | [[ADR-0018-real-subcommands]] |
| 84 | The adapter flattens Discord's nested subcommand options; a top-level-only map silently drops every argument | `apps/bot/src/adapt.ts` |

## 2026-11-02 — P6 schema-driven settings widgets

| # | Decision | Where |
| --- | --- | --- |
| 85 | The dashboard carrier stays the framework-free `apps/web` HTML app; settings forms are generated server-side from the module schema, and a client/Next.js shell is deferred to the fleet-view UI rather than required for settings | [[ADR-0016-dashboard-foundation]], [[Dashboard]] |
| 86 | The widget model is a projection of the module's Zod schema, never a second schema or web-only whitelist; unsupported shapes fall back to a JSON box the same schema validates | [[Dashboard]] |
| 87 | Every accepted settings update/reset appends one `audit_events` row through the kernel `AuditStore` with actor, surface and dotted-path diff; a no-op or rejected write appends nothing | [[Dashboard]], `packages/kernel/src/audit.ts` |
| 88 | Credential-shaped setting keys are matched by suffix (`token`, `secret`, `password`, `apiKey`), not any key containing `token`; the over-broad filter hid `maxOutputTokens` | [[Dashboard]] |

## 2026-11-03 — P6 fleet view and config templates

| # | Decision | Where |
| --- | --- | --- |
| 89 | A fleet preview/apply authorizes every selected guild through one `authorizeMany` call (OAuth manage permission + bot membership); body guild ids are never trusted | [[ADR-0016-dashboard-foundation]], [[Dashboard]] |
| 90 | Templates are built-in partial patches, deep-merged over current settings and parsed by each module's own schema; there is no template table and no second settings schema | [[Dashboard]], `apps/web/src/templates.ts` |
| 91 | Apply is bound to a SHA-256 fingerprint of the template id, targets and before/after leaves; a missing preview is `400` and a stale one is `409` before any write | [[Dashboard]] |
| 92 | Custom saved templates, a template editor and JSON fleet endpoints are later P6 work, not part of this slice | [[Dashboard]] |

## 2026-11-03 — P6 config export, import and drift

| # | Decision | Where |
| --- | --- | --- |
| 93 | A config bundle is settings-only (`keystone.config` v1), not the P5 full guild bundle; an import must never create or delete cases, members or transcripts | [[Dashboard]], `apps/web/src/config-bundle.ts` |
| 94 | Import verifies shape, kind/version, the complete module set, a canonical SHA-256 checksum and every module's own Zod schema before any setting is read; credential-shaped keys are omitted on export | [[Dashboard]] |
| 95 | Apply is bound to a plan fingerprint and reuses `SettingsService.update`; each accepted module write appends one dashboard audit row, and the applied bundle becomes the baseline | [[Dashboard]] |
| 96 | Drift compares baseline -> live and never treats a missing or unreadable baseline as empty settings; a full portability restore/delete clears the baseline | [[Dashboard]], `packages/db/src/config-baseline-store.ts` |

## 2026-11-03 — P6 saved templates

| # | Decision | Where |
| --- | --- | --- |
| 97 | A saved template is a guild-owned snapshot of effective settings in `config_templates`, not a second settings store or a marketplace; one `SavedTemplateStore` port has in-memory and Drizzle adapters | [[Dashboard]], `packages/kernel/src/saved-templates.ts`, migration 0016 |
| 98 | Save and apply both parse the snapshot with each module's own Zod schema; an invalid stored row is reported and refused at `400`, never applied best-effort | [[Dashboard]], `apps/web/src/overview.ts` |
| 99 | Saved templates share the built-in plan, fingerprint, re-authorization and `SettingsService.update` loop; create/update/delete append `template.*` audit rows, and an edit moves `updatedAt` so an earlier preview is stale | [[Dashboard]], `apps/web/src/overview.ts` |

## How to add a decision

1. If it changes the contract, write an ADR with **Alternatives**.
2. If it is small, add a row here with a link to the file it affects.
3. Never delete a row. Superseded decisions stay, marked as such, because the
   history is the teaching material.
