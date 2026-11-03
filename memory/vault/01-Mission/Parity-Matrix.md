# Parity matrix

The definition of "everything", one feature at a time.

**Legend:** ✅ free · 💰 paid only · ❌ absent · ❔ unverified / not documented.
"Phase" is the Keystone phase that ships it; every shipped feature is free.

Verification rule: a cell is only ✅ or ❌ when a source was read. Anything from a
snippet, a marketing page or memory is ❔ and stays out of marketing until
checked. See [[Master-Plan]] for the research program.

> **Phase labels below are the original research snapshot.** The authoritative
> phase, status, evidence and live-verification flag are generated in
> [[Feature-Status]] from `memory/machine/features.json`. Roadmap v2 renumbers
> the old P5–P8; see [[ADR-0013-roadmap-v2-portability-first]].

## 1. Moderation

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ban / kick | 💰 | ✅ | ✅ | ❌ | ❔ | P2 | Permission precheck before every call |
| Timeout | 💰 | ✅ | ✅ | ❌ | ❔ | P2 | Max 28 days |
| Warn + history | 💰 | ✅ | ✅ | ❌ | ❔ | P2 | One case file for all actions |
| Bulk purge | 💰 | ✅ | ✅ | ❌ | ❔ | P2 | 100 per call, audited |
| Slowmode / lockdown | 💰 | ✅ | ✅ | ❌ | ❔ | P2 | Lockdown is a named preset |
| Temp ban / temp role | 💰 | ❔ | 💰 | ❌ | ❔ | P2 | Expiry as a scheduled job |
| Case lookup | 💰 | ✅ | ✅ | ❌ | ❔ | P2 | `/mod case view` |
| Evidence card | ❌ | ❌ | ❌ | ❌ | ❌ | P2 | **Our edge:** what triggered it |
| Dry-run default | ❌ | ❌ | ❌ | ❌ | ❌ | P2 | **Our edge:** alert-only |
| Appeal from the DM | ❌ | ❌ | ❌ | ❌ | ❌ | P2 | **Our edge:** one button, plus `/appeal open | status`; status reads the append-only appeal events, live-proven pass 35 |
| Case export | ❌ | ❔ | ❌ | ❌ | ❌ | P2 | JSON + CSV |

## 2. Automod

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Spam / caps / mentions | 💰 | ✅ | ✅ | ❌ | ✅ | P2 | Heat decay, not a binary trip |
| Invite links | 💰 | ✅ | ✅ | ❌ | ✅ | P2 | Allow-list per guild |
| Link / phishing filter | 💰 | ✅ | ✅ | ❌ | ✅ | P2 | Local host list + punycode; `/mod links`; shipped pass 23 |
| Profanity / zalgo | 💰 | ✅ | ✅ | ❌ | ❔ | P2 | Unicode word edges + mark threshold; `/mod filters`; shipped pass 24 |
| Duplicate / crosspost | 💰 | ✅ | ❔ | ❌ | ❔ | P2 | Hash window |
| Native AutoMod sync | ❌ | ❔ | ❔ | ❌ | ❔ | P2 | We manage Discord's rules too |
| AI classification | 💰 (separate) | ❌ | ❌ | ❌ | ❔ | P4 | Advisory label only; no action path |
| Per-rule punishment | 💰 | ✅ | ✅ | ❌ | ✅ | P2 | Alert / delete / timeout / quarantine |
| Rule test mode | ❌ | ❔ | ❔ | ❌ | ❔ | P2 | Fixture-driven, same as tests |
| False-positive report | ❌ | ❌ | ❌ | ❌ | ❔ | P3 | Feeds the rule's own metrics |

## 3. Security

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Anti-nuke (role/channel) | ❌ | ❌ | ❌ | ❌ | ✅ | P2 | Thresholds per permission |
| Anti-nuke (webhook/bot add) | ❌ | ❌ | ❌ | ❌ | ✅ | P2 | Bot-add block |
| Anti-raid (join burst) | ❌ | ❌ | ❌ | ❌ | ✅ | P2 | Age + avatar heuristics |
| Quarantine role | ❌ | ❌ | ❌ | ❌ | ✅ | P2 | Reversible by design |
| Join gate / verification | ❌ | ❔ | ❔ | ❌ | ✅ | P2 | Enforced hold writes a quarantined `members` row; `/verify start` requires it, `/verify status` reads it; timeout expiry still open |
| Panic mode | ❌ | ❌ | ❌ | ❌ | ✅ | P2 | `/mod panic state:on/off`: snapshot, persist, restore; Administrator |
| Heat scoring | ❌ | ❌ | ❌ | ❌ | ✅ | P2 | Decays, so no permanent trip |
| Backup / restore | ❌ | ❔ | ❔ | ❌ | 💰 | P5 | Structure + optional messages |
| Shared case file with mod | ❌ | ❌ | ❌ | ❌ | ❔ | P2 | **Our edge:** one record |

## 4. Leveling

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| XP and levels | 💰 | 💰 | 💰 | ❌ | ❌ | P3 | Free, always |
| Role rewards | 3 free, then 💰 | 💰 | 💰 | ❌ | ❌ | P3 | Per-level, stackable |
| Rank card | ✅ | 💰 | 💰 | ❌ | ❌ | P3 | Embed today; the V2 layer exists (pass 58), the card is not migrated yet |
| Leaderboard | ✅ | 💰 | 💰 | ❌ | ❌ | P3 | Paginated, cached |
| XP multipliers | 💰 | 💰 | 💰 | ❌ | ❌ | P3 | Role/channel/event |
| Import from MEE6 | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | **Our edge** |
| Seasonal reset | ❔ | ❔ | ❔ | ❌ | ❌ | P3 | Archive, don't destroy |

## 5. Economy

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Currency + daily | 💰 | ❌ | 💰 | ❌ | ❌ | P3 · P4 | Server-scoped; daily uses the kernel cooldown |
| Shop / inventory | 💰 | ❌ | ❔ | ❌ | ❌ | P3 · P4 | Role and tag items; direct grant, explicit failure |
| Transfers | 💰 | ❌ | ❔ | ❌ | ❌ | P3 · P4 | Atomic pair under a guild row lock; stable retry key |
| Gambling | 💰 | ❌ | ❔ | ❌ | ❌ | P3 · P4 | Capped, opt-in, serialized debit |
| Audit ledger | ❌ | ❌ | ❌ | ❌ | ❌ | P3 · P4 | **Our edge:** every coin traceable; balance is a `SUM` |
| Global economy | ❌ | ❌ | ❌ | ❌ | ❌ | — | Non-goal: server context matters |

## 6. Community

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Welcome / goodbye | ✅ | ✅ | ✅ | ❌ | ❔ | P3 | Text welcome and goodbye ship; a V2 panel is planned |
| Autorole | ✅ | ✅ | ✅ | ❌ | ❔ | P3 | With join delay |
| Reaction roles | 💰 (40) | ❌ | ✅ (250) | ❌ | ❔ | P3 | Buttons and selects too |
| Starboard | ✅ | ✅ | ✅ | ❌ | ❌ | P3 | Per-channel thresholds |
| Birthdays | 💰 | ❔ | ❔ | ❌ | ❌ | P3 | Timezone-aware |
| Suggestions | ❔ | ❔ | ❔ | ❌ | ❌ | P3 | Vote + status |
| Polls | ✅ | ❔ | ❔ | ❌ | ❌ | P3 | Native poll fallback |
| Giveaways | ✅ | ✅ (3) | ✅ | ❌ | ❌ | P3 | Requirements + reroll |
| Temp voice | 💰 | ❔ | ❔ | ❌ | ❌ | P3 | Hub channel pattern |
| Stat channels | 💰 | ❔ | ❔ | ❌ | ✅ | P3 | Rate-limited updates |
| Social feeds | 💰 | ❔ | ✅ (5/2) | ❌ | ❌ | P3 | YouTube, Twitch, RSS |

## 7. Tickets

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Panels | ❌ | ✅ (1) | ❔ | ✅ | ❌ | P3 | Thread/embed panels; the form panel is V2 with a modal (pass 58), the rest are not migrated |
| Thread-based tickets | ❌ | 💰 | ❔ | ✅ | ❌ | P3 | Avoids the 50-channel cap |
| Claiming | ❌ | 💰 | ❔ | ✅ | ❌ | P3 | With SLA clock |
| Transcripts | ❌ | 💰 | ❔ | ✅ (30 d free) | ❌ | P3 | Never auto-expire |
| Knowledge base | ❌ | ❌ | ❌ | ✅ | ❌ | P4 | `/ai docs-add` + exact-index RAG; pgvector ANN open |
| AI deflection | ❌ | ❌ | ❌ | 💰 | ❌ | P4 | Capped, opt-in; no match = human hand-off, no model call |
| SLA analytics | ❌ | ❌ | ❌ | 💰 | ❌ | P3 | First response, resolution |

## 8. Content

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Embed builder | 💰 | ✅ (3) | ✅ | ❌ | ❌ | P3 | Validated fields, no scripting |
| Custom commands / tags | 💰 (500) | ✅ (10) | ✅ | ❌ | ❌ | P3 | Data, never code |
| Scheduled messages | 💰 | ❔ | ❔ | ❌ | ❌ | P3 | Cron + timezone |
| Reminders | 💰 | ✅ | ❔ | ❌ | ❌ | P3 | Per-user, DM or channel |
| Sticky messages | ❌ | ❔ | 💰 | ❌ | ❌ | P3 | Repost on activity |
| RSS / feeds | 💰 | ❔ | ❔ | ❌ | ❌ | P3 | Dedup by GUID |
| Translation | ❌ | ❌ | ❌ | ❌ | ❌ | — | Non-goal: unreliable, costly |

## 9. Music

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Playback | ❌ (removed 2023) | ❌ | ❌ | ❌ | ❌ | P8 | BYO Lavalink only; not installed, so `play`/`skip`/`stop` refuse and say why (pass 32) |
| Queue / controls | ❌ | ❌ | ❌ | ❌ | ❌ | P8 | `/music` add/queue/remove/clear/status over a durable row; no buttons yet; live pass 32 |
| Bundled source | ❌ | ❌ | ❌ | ❌ | ❌ | — | Non-goal: legal risk |
| Lyrics / autoplay | ❌ | ❌ | ❌ | ❌ | ❌ | — | Non-goal |

## 10. AI

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Persona chat | 💰 (separate) | ❌ | ❌ | 💰 | ❌ | P4 | Mention-only; no conversation retention |
| Server RAG | ❌ | ❌ | ❌ | ✅ | ❌ | P4 | Portable exact index; pgvector ANN open |
| Mod explanations | ❌ | ❌ | ❌ | ❌ | ❌ | P4 | Why a rule fired |
| Thread summaries | ❌ | ❌ | ❌ | ❔ | ❌ | P4 | `/ticket summary`, on demand |
| Cost caps | ❌ | ❌ | ❌ | ❔ | ❌ | P4 | **Our edge:** hard, per guild |
| Zero retention | ❌ | ❌ | ❌ | ❔ | ❌ | P4 | Default, documented |

## 11. Operations

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Web dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | P6 | Server-rendered Node app; schema-generated widgets and settings audit shipped pass 49; fleet view and built-in templates shipped pass 50; config export/import/drift shipped pass 51; saved templates shipped pass 52; analytics aggregates shipped pass 53; session rotation, logout revocation, per-route limits and the owners[] console shipped pass 54; scoped tokens pass 55; signed webhooks and keyed replay pass 56; idle timeout and sealed refresh rotation pass 57; live Discord OAuth and live token revocation open |
| Real subcommand surface | ✅ | ✅ | ✅ | ✅ | ✅ | P7 | 20 roots / 141 subcommands; `/help` generated; shipped pass 26; synthetic nested-slash harness pass 27 (gateway still human); `/music` pass 32; `/setup` hub pass 34; `/appeal` hub pass 35; `/verify` hub pass 36; `/form` pass 40; `/event` pass 41; `/modmail` pass 42; pass 45 added `/mod temp-role`; pass 46 added `/mod panic` and `/tools goodbye`. The Master-Plan records 72 planned names across 14 built roots; all recorded names are registered, and the handoff's 18 / 160 still has 88 unrecorded names and no named 18th root |
| Context menus | ❔ | ❔ | ❔ | ❔ | ❔ | P7 | 4 menus (Report message, Case history, Rank card, Explain with AI) registered live on the separate 15 + 15 budget; invocation is human-only because the MCP cannot right-click. Competitor presence not verified for every row |
| In-bot configuration | ❔ | ❔ | ❔ | ❔ | ❔ | P7 | `/config` (list, get, set, export) over every module's own schema; shipped pass 30; live-proven. Competitor in-Discord config not verified (all surveyed bots also ship a web dashboard) |
| First-run setup hub | ❔ | ❔ | ❔ | ❔ | ❔ | P7 | `/setup status | module | verify | import | reset`; real settings/health/export seams, settings-only reset; live pass 34 |
| Audit logging | ❔ | 💰 | ✅ | ❌ | ✅ | P7 | Five event toggles, one operator channel and an append-only ledger with retention; `/logging`; message edit/delete and moderation cases proven live, member join/leave adapter-only |
| Multi-server fleet | ❔ | ❔ | ❔ | ✅ | ❔ | P6 | `/dashboard/fleet`: one view across manageable guilds; every preview/apply re-authorizes each guild with permission + bot membership; live-proven over real local HTTP on Postgres |
| Config templates | ❔ | ❔ | ❔ | ❔ | ❔ | P6 | Three built-in presets plus named saved templates; both preview a schema-validated per-guild diff and apply only the previewed plan with one audit row per module. Saved templates are schema-validated on save and apply, refused when invalid, and audited on create/update/delete. Shipped pass 52; live over real local HTTP on Postgres |
| Config export / import / drift | ❔ | ❔ | ❔ | ❔ | ❔ | P6 | A guild's settings download as a checksummed file; import validates modules, checksum and each Zod schema, previews the diff and applies only the previewed plan with one audit row per module; the applied bundle is the drift baseline. Shipped pass 51; live over real local HTTP on Postgres |
| Drift detection | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | **Our edge** |
| Importer (MEE6/Dyno/Carl) | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | **Our edge** |
| Full export | ❌ | ❔ | ❌ | ❔ | ❌ | P5 | JSON, documented schema |
| Real deletion | ❔ | ❔ | ❔ | ❔ | ❔ | P5 | Receipt included |
| Public API / webhooks | ❌ | ❔ | ❌ | 💰 | ❔ | P6 | Session or scoped-token reads and writes, audited tokens, signed webhooks with retries and receipts, `Idempotency-Key` replay and OpenAPI shipped; the live Discord OAuth round trip is open |
| i18n | ❔ | ✅ | ❔ | ✅ | ❔ | P7 | i18next, per-guild locale |
| Status page | ❌ | ❔ | ❔ | ❔ | ❔ | P9 | Public incidents |

## 12. Portability (new in Roadmap v2)

No surveyed generalist documents a full export of its own data. The import path
runs from destination to source, not the other way around. This is the wedge, and
the reason P5 comes before the dashboard.

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Full export bundle | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | Versioned JSON + manifest/checksum (NDJSON is v2) |
| Restore + config hash | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | Clean-guild restore proves counts and config |
| Dry-run diff | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | Create/update/skip before any write |
| Rollback + receipt | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | 24-hour window; deletion receipt |
| MEE6 level import | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | Saved leaderboard file only; no scraping |
| Generic JSON/CSV import | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | User-supplied file; merge modes |
| ProBot / Ticket Tool transcripts | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | JSON/HTML user-owned files |
| Drift detection | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | Report only; no auto-fix |
| Guided migration | ❌ | ❌ | ❌ | ❌ | ❌ | P5 | Dyno/Carl/Wick have no usable egress |

## 13. Invites (new in P7)

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Invite attribution | 💰 | ❌ | ❌ | ❌ | ❔ | P7 | Cached-counter diff; unique join row |
| Fake invite detection | 💰 (limited) | ❌ | ❌ | ❌ | ❔ | P7 | Advisory only; account age + avatar |
| Invite leaderboard | 💰 | ❌ | ❌ | ❌ | ❔ | P7 | Joins, leaves and retained |

MEE6's invite tracker is partly premium-gated: its public wiki says parts or
the entirety may require Premium and describes personalized invite links per
member, not a documented free attribution path. Dyno's module list and Carl-bot's
logging docs contain no invite attribution, no invite leaderboard and no
fake-invite detection (verified 2026-11-01). Keystone now ships the attribution
and leaderboard free, with advisory flags rather than MEE6's 24-hour invalidation
rule.

## 14. Parity extras (new in P7)

| Feature | MEE6 | Dyno | Carl | Ticket Tool | Wick / Security | Phase | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auto-responder | 💰 | ✅ | ✅ | ❌ | ❔ | P7 | Exact/contains/regex triggers, one reply, per-trigger cooldown; `/tools`; shipped pass 25 |
| Guild analytics | ❔ | ❔ | ❔ | ❔ | ❔ | P7 | `/analytics` with overview, members, messages, commands, tickets and export; read-only aggregates over audit, cases, invites, tickets and command usage; shipped pass 29; competitor claims unverified |
| Application forms | ❔ | ❔ | ❔ | ❔ | ❔ | P7 | `/form create \| edit \| delete \| list \| panel \| submit \| review \| export`; real forms and submissions, one pending per member, an accept/deny review queue and a checksummed JSON export; shipped and live-proven pass 40. Modal input and forms in the guild bundle are open; competitor presence unverified |
| Guild events | ❔ | ❔ | ❔ | ❔ | ❔ | P7 | `/event create \| edit \| delete \| list \| rsvp \| remind \| export`; a draft/open/closed lifecycle, one RSVP row per member, capacity counted from `going` rows in the store transaction, manual reminder bookkeeping and a checksummed JSON export; shipped and live-proven pass 41. Buttons, scheduled reminders, per-member timezones and ICS export are open; competitor presence unverified |
| Private modmail | ❔ | ❔ | ❔ | ❔ | ❔ | P7 | `/modmail setup \| open \| reply \| close \| transcript \| stats`; owner-or-staff visibility, one active thread per member, open → claimed → closed, side-aware unread, a queue with thread ids and a transcript archived once by a conditional update; shipped and live-proven pass 42. DM/thread relay, attachments and search are open; competitor presence unverified |

## Tally

| Domain | Rows | P3 | P4 adds | Ours by P8 | Note |
| --- | --- | --- | --- | --- | --- |
| Moderation | 11 | 8 | 0 | 11 | Case model is the spine; temp-ban/role expiry and case export open |
| Automod | 10 | 5 | 0 | 10 | Invite, mentions, duplicates, links, profanity/zalgo, native-plan and test mode; false-positive report open |
| Security | 9 | 7 | 0 | 9 | Anti-nuke, anti-raid, quarantine, join gate and shared cases; panic mode open |
| Leveling | 7 | 6 | 0 | 7 | XP, rewards, rank, leaderboard, multiplier and archived seasonal reset; MEE6 import is P5 |
| Economy | 6 | 5 | 0 | 6 | Daily, shop, transfers, gambling and the audit ledger; P4 added the lock/idempotency hardening, not a new row |
| Community | 11 | 10 | 0 | 11 | Welcome, delayed autorole, button/select roles, per-channel starboard, birthdays, suggestions, giveaways, temp voice, stat, feeds, polls; goodbye messages open |
| Tickets | 7 | 5 | 2 | 7 | Knowledge base and AI deflection; portable RAG, pgvector ANN open |
| Content | 7 | 6 | 0 | 6 | Embed, tags, schedules, reminders, feeds and sticky messages; translation non-goal |
| Music | 4 | 0 | 0 | 2 | BYO only |
| AI | 6 | 0 | 6 | 6 | Advisory, capped, opt-in, zero-retention |
| Invites | 3 | 0 | 0 | 3 | MEE6 is partly premium-gated; Dyno/Carl document none. Shipped in repo at pass 19; a live join is unperformed |
| Operations | 13 | 0 | 0 | 13 | Export is the wedge; command tree, in-bot configuration, audit logging and analytics are live-proven |

Two rows are non-goals (global economy, translation) and two are music features we
refuse to ship. Everything else is promised, free.

P3/P4 counts are implementation counts, not live-Discord verification. The
adapter, buttons, gateway, scheduler, provider, mention event, live role grants
and the Postgres guild lock are unrun here; audit logging is proven live for
message and moderation events, not for member joins. See
[[04-Modules/ai/Status|AI status]] and
[[04-Modules/community/Status|community status]] for the proven/unproven split.
Economy concurrency is proven in-memory and on PGlite, not across shards. The
exact vector index is not pgvector ANN; [[PGVector-Fleet]] keeps that row honest.
"Green" is not claimed for the open rows; only tested buildable rows are counted.

## How this stays honest

- A feature moves to ✅ only when its tests pass and its **Status.md** says
  verified.
- `pnpm memory:check` fails if a module's spec omits a registered command, so the
  matrix cannot drift from the code.
- Prices and competitor states are re-checked before launch (P7). Until then, 💰
  means "paid on the tier we read", not "paid on every tier".
