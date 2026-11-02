# Master plan

> The mission in one line: **ship the union of the big all-in-one bots, free,
> with a codebase a stranger can learn from — and prove it feature by feature.**

This page is the durable version of the approved plan. [[Roadmap]] is the phase
index; [[Parity-Matrix]] is the competitor research table; the generated
[[Feature-Status]] is the implementation truth.

## Roadmap v2 amendment (2026-10-31)

Six research passes changed the order. The current sequence is:

| Phase | Goal | Exit demo |
| --- | --- | --- |
| **P4.5** | Platform hardening: channel obfuscation, intent profiles, memory v2 | Hidden channels are typed; core runs without privileged intents; memory checks generated pages |
| **P5** | Portability: export bundle, restore, file/MEE6 importers, drift, migration guides | 5k fixture export → wipe → restore; failed import rolls back; deletion receipt |
| **P6** | Dashboard, API and fleet: per-guild authz, schema forms, scoped tokens | User A cannot reach guild B; repeated POST replays; every setting has a UI |
| **P7** | Parity completion, UI and i18n: invites, forms, events, modmail, auto-responder, V2 budgeter, locales | Every panel fits 40/4,000; expiry jobs release; search cites a source |
| **P8** | Music and activities: BYO Lavalink; Activity spike | Operator node works; no bundled streamer; go/no-go written |
| **P9** | Open-source launch: docs, curriculum, one-command self-host, listings | Stranger self-hosts and ships a module in an afternoon |
| **P10** | Hardening and scale: sharding, load, SLOs, v15 | Load test at target p95; v15 migration is one PR |

**Why portability before the dashboard:** no surveyed generalist exports its own
data; the dashboard needs the bundle, receipts and drift model to display
anything real. **Why the promise is narrower:** Dyno, Carl-bot and Wick expose no
usable egress, so they get a guided manual migration, not a fake one-click.
**Why the dashboard is a security product:** per-guild authorization and a
server-side token boundary are the feature, not polish.

See [[ADR-0013-roadmap-v2-portability-first]], [[Import-Formats]],
[[Dashboard-Security]] and [[Competitive-2026]].

> The P5–P8 sections later on this page are the **original** plan, retained as
> history. Their old labels migrate as P5→P6, P6→P8, P7→P9, P8→P10. Do not use
> those sections for new work.

## Definition of done

The mission is complete when all five are true:

1. A 5,000-member server can uninstall MEE6, Dyno, Carl-bot, Ticket Tool and Wick
   and lose nothing it used daily.
2. A stranger self-hosts in one command, with no paid dependency.
3. A learner clones the repo, gets `pnpm check` green without a token, and ships a
   module in an afternoon.
4. Every claim in the README is reproducible from the repository.
5. Every module has a spec, tests and a teaching note, and every ADR says what
   lost.

## The specialist team

We work as eight specialists. Each owns one veto question; a proposal that fails
any of them is redesigned or dropped.

| Role | Veto question | Owns |
| --- | --- | --- |
| Parity lead | Which bot does this let an admin uninstall? | Feature priority, parity matrix |
| Platform engineer | Which limit does it spend — 100 commands, 40 components, an intent, 50 req/s? | Kernel, adapter, budget ledger |
| Trust & safety | Can this punish someone wrongly, and can they appeal? | Cases, dry-run, review queue, appeals |
| Data engineer | Can it be exported, and truly deleted? | Schema, retention, export/import |
| UX / components | Does it fit 40 slots and a 3-second ack? | Panels, modals, defer-then-edit |
| Teaching lead | Can a beginner follow it in one sitting? | Spec/Status/Teaching, curriculum |
| Ops | What does it cost per 1,000 guilds, and how does it fail? | Queue, metrics, runbooks, cost caps |
| Legal / open source | Can we ship this free, legally, forever? | Licence, intents, music, data policy |

### Protocol

1. **RFC.** One page answering all eight questions, plus the named bot it replaces.
2. **Round one — divergent.** At least three approaches, including "do nothing"
   and "buy it".
3. **Round two — adversarial.** The team attacks the leading option: failure
   modes, cost, platform risk, teaching cost.
4. **Decision.** ADR for contract-level choices; a row in [[Decision-Log]]
   otherwise. **Alternatives must be recorded.**
5. **Build, verify, critique, memory.** Same order every pass.

The critique is written down, not implied. A review that says "looks good" is not
a review.

## Research program

Already in the vault: teardowns of 14 bots, 8 open-source repositories, platform
limits, stack evidence, legal/ops constraints and user pain points.

Every claim carries **source, date and confidence**. Unverified cells are marked
❔ in [[Parity-Matrix]] and are never used in marketing copy.

### Gaps and how they close

| Gap | Method | Needed by | Status |
| --- | --- | --- | --- |
| App verification threshold | Portal test with a real app | P9 listing | Open |
| Per-webhook rate limits | Probe response headers, record values | P6 | Open |
| Components V2 text budgets | Live client experiment, one panel per shape | P7 | Open |
| Competitor import APIs and ToS | Read each vendor's terms and API docs | P9 refresh | Open; P5 shipped the file importers |
| discord.js v15 GA date | Watch the release milestone monthly | P10 | Open; no v15 exists as of 2026-11-02 |
| MEE6 / Ticket Tool pricing | Read official pricing pages directly | P9 refresh | Open |
| pgvector at fleet scale | Benchmark 1M vectors, measure p95 recall latency | P7/P8 gate | Partial — local exact 1M×32; pgvector ANN 1M×1536 open |
| Channel obfuscation behaviour | Test `CHANNEL_OBFUSCATED` before 2026-11-16 | now | Open |

Monthly research refresh: re-check the two or three claims the current phase
depends on, and update the date. A claim older than two quarters is a rumour.

## Architecture

### Pipeline

```
interaction → adapter → registry → guards → execute → respond
```

The kernel owns the pipeline; modules only declare. discord.js appears in exactly
one file (`apps/bot/src/adapt.ts`), so v15 is a contained PR.

### Data spine (P1)

One schema, not four bots' worth of partial records:

| Table | Purpose | Retention (default) |
| --- | --- | --- |
| `guilds` | Installed guilds, locale, plan, joined_at | While installed |
| `settings` | `(guild_id, module, key, jsonb)` — the only config store | While installed |
| `members` | Join state, quarantine, verification, notes | While in guild |
| `cases` | One moderation action: actor, target, rule, reason, state | 365 days |
| `case_events` | Append-only transitions: created, reviewed, appealed, reversed | 365 days |
| `tickets` | Thread-backed tickets, claim, SLA, state | Until closed + 90 days |
| `levels` / `xp_events` | Current XP projection and the events that produced it | Until reset |
| `economy_ledger` | Append-only currency movements with idempotency keys | 365 days |
| `audit_events` | Every destructive action and config change | 365 days |
| `imports` / `backups` | Import runs, snapshots, restore receipts | 30 days |

Rules: modules never read another module's tables; cross-module access goes
through exported service functions or events. Every mutation writes an audit row.
Message content is not stored unless a feature cannot work without it, and then
it is off by default and listed in the retention table.

### Ports

`SettingsRepository`, `CooldownStore`, `Queue`, `AiProvider`, `ObjectStore`. P0
ships in-memory implementations; P1 swaps Postgres, Redis and BullMQ behind the
same interfaces. No module changes when a port changes.

### Command allocation

**Plan record (pass 42, 2026-11-01):** this is the durable per-root source for
the approved plan. It records **14 built roots**, for **72 planned subcommand
names** where the plan has a record (59 from the original table, 7 for `/event`,
6 for `/modmail`). The live registry is **20 roots / 139 subcommands** after
pass 45's `/mod temp-role`. Six
registered roots (`/ping`, `/about`, `/ai`, `/invites`, `/analytics`, `/form`)
are not in the plan table. 67 of the 139 registered names are beyond the 72
planned names (39 extra names inside plan roots, 28 in those six roots). The
handoff's **"18 roots / 160 subcommands"** still cannot be recomputed: the plan
records only 72 names, leaving **88 names unrecorded**, and it never identifies
its 18 roots. Separately, the 139 registered names are 21 short of the raw 160
count. Do not invent the missing names, and do not treat 160 as a target — the
plan's own non-goals reject feature-count marketing.

| Root | Planned subcommands (as recorded) | Planned | Registered | Replaces / notes |
| --- | --- | ---: | ---: | --- |
| `/ping` | — (not in the plan table) | — | 0 | P0 diagnostic root |
| `/about` | — (not in the plan table) | — | 0 | P0 diagnostic root |
| `/help` | browse, search, privacy | 3 | 5 | every bot's help; adds `commands`, `changelog` |
| `/setup` | status, module, import, verify, reset | 5 | 5 | onboarding wizards — **shipped pass 34** |
| `/config` | get, set, list, export | 4 | 4 | per-feature config commands |
| `/export` | guild, user, import, delete, drift, rollback | 6 | 6 | nobody (our edge) |
| `/mod` | ban, kick, timeout, warn, purge, lock, slowmode, case, note, history | 10 | 14 | Dyno/Carl moderation; adds `unlock`, `links`, `filters`, `review` |
| `/appeal` | open, status | 2 | 2 | nobody (our edge) — **shipped pass 35** |
| `/verify` | start, status | 2 | 2 | Security Bot — **shipped pass 36** |
| `/rank` | view, leaderboard, rewards, admin | 4 | 12 | MEE6 leveling; adds the economy names |
| `/ticket` | panel, claim, close, add, transcript, stats | 6 | 8 | Ticket Tool; adds `open`, `summary` |
| `/tools` | embed, tag, reminder, giveaway, poll, feed, stat | 7 | 24 | Carl/MEE6 utilities; adds 17 names |
| `/ai` | — (not in the plan table) | — | 11 | P4 AI layer |
| `/invites` | — (not in the plan table) | — | 3 | P7 invite tracking |
| `/logging` | setup, channel, events, status, retention, export, disable | 7 | 7 | Dyno/Carl audit logging |
| `/analytics` | — (not in the plan table) | — | 6 | P7 read-only analytics |
| `/music` | play, queue, stop | 3 | 8 | BYO Lavalink; adds `add`, `remove`, `clear`, `skip`, `status` |
| `/form` | — (not in the plan table) | — | 8 | P7 forms — **shipped pass 40** |
| `/event` | create, edit, delete, list, rsvp, remind, export | 7 | 7 | P7 events — **shipped pass 41** |
| `/modmail` | setup, open, reply, close, transcript, stats | 6 | 6 | P7 modmail — **shipped pass 42** |
| **Totals** | 14 rows with a planned count | **72** | **138** | 20 registered roots; 88 names of the raw 160 are not recorded |

## Phases

Each phase ends with **a demo, a doc and a memory update**. A phase is not done
because the code exists.

> Current sequence: P4.5 → P5 → P6 → P7 → P8 → P9 → P10 (see the amendment above).
> P1–P4 below are history and still accurate. P5–P8 below are superseded.

### P1 — Substrate (2 weeks)

Drizzle + Postgres settings, migrations, Redis cooldowns, BullMQ worker,
OpenTelemetry, `/setup`, production build, Docker Compose.

**Exit demo:** change a setting, restart the bot, setting survives; a failing job
retries with backoff exactly once per idempotency key; one trace spans command →
database → queue.

**Teaching:** why interfaces beat a global `db` import; at-least-once delivery.

### P2 — Moderation and security (4 weeks)

Cases and case events, `/mod`, native AutoMod sync, our scanner, evidence cards,
review queue, appeals, anti-nuke, anti-raid, quarantine, join gate, action
logging.

**Exit demo:** a scripted raid (10 joins, 5 invite posts, one webhook creation) is
contained; every action has a case, a reason and an appeal button; dry-run is the
default and takes no action.

**Teaching:** event-sourced cases; why alert-only is the default; the invalid
request budget.

### P3 — Community (4 weeks)

Leveling, economy ledger, reaction roles, welcome/onboarding, starboard,
thread-based tickets, giveaways, temp voice, embed builder, tags, scheduled
messages, feeds, stat channels.

**Exit demo:** the [[Parity-Matrix]] is green for these domains, all free, and the
command ledger is still under 20 roots.

**Teaching:** append-only ledgers; XP as a projection, not a counter; Components
V2 layout budgets.

### P4 — AI layer (3 weeks)

Provider abstraction, per-guild cost caps, pgvector RAG over server docs, ticket
deflection, mention-only persona chat, moderation explanations, thread summaries.
Off by default, with a kill switch.

**Exit demo:** every call is refused past its cap; no prompt or completion is
stored by default; disabling the module breaks no command.

**Teaching:** cost as a first-class constraint; why AI may recommend but never
punish.

### P5 — Dashboard and fleet (5 weeks)

Next.js dashboard, per-guild authorisation, fleet view, templates, drift
detection, importers (MEE6 XP, Dyno cases, Carl reaction roles, Ticket Tool
panels), backup/restore, export API.

**Exit demo:** import a real 5k-member server in under 10 minutes; restore it into
a clean test server and diff the config.

**Teaching:** authorisation per request, not per session; import as a reversible
migration with a receipt.

### P6 — Music (1 week)

Bring-your-own Lavalink, disabled by default, legal page explaining why.

**Exit demo:** an operator enables music with their own node; the repo contains no
streamer and says why.

### P7 — Launch (3 weeks)

Starlight docs, one-command self-host, status page, listings, security review,
licence decision (Q-1), v1.0.

**Exit demo:** a stranger self-hosts in one command on a clean VM and ships a
module in an afternoon.

### P8 — Hardening (ongoing)

Sharding, load tests, SLOs, annual privileged-intent renewal, incident drills, the
discord.js v15 migration.

**Exit demo:** a 2,500-guild load test at target p95; the v15 migration is one PR.

### Why this order

P2 before P3: the case file is the accountability spine that leveling, tickets
and AI all reference. P4 after tickets because RAG needs real content. P5 after
importers exist, because the dashboard is the least useful place to start. P1
first because every later module writes to the same settings table.

## Quality gates

- `pnpm check` in CI: typecheck, tests, command budget, claim audit, memory links.
- A dry-run test for every automod rule: given the fixture, no action is taken.
- Export → wipe → import round-trip must produce an identical config hash.
- Permission precheck before every destructive API call.
- 403 circuit breaker: stop on a spike long before 10,000 invalid requests/10 min.
- Idempotency key on every job that sends a message or moves currency.
- A Components V2 budgeter (planned; no `packages/ui` yet) throws above 40 slots in development.
- p95 interaction ack < 1 s; handler < 250 ms excluding IO.
- Per-guild AI cap, enforced server-side, never in the prompt.
- No test may require a token, a live guild or the network.

## Teaching

Every module ships three docs:

- **Spec** — written before the code; the contract.
- **Status** — verified vs stubbed, with the commands to prove it.
- **Teaching** — reading order, exercise, the mistake you will make.

The [[Curriculum]] maps one lesson per phase. Exercises break a real check on
purpose. "What we rejected" is mandatory in every ADR and every journal entry,
because that is the part a reader cannot infer from finished code.

## Memory protocol

**Every pass:** journal (`What changed`, `What we tried and rejected`,
`Verification`, `Next`), `Status.md` for touched modules, `project.json` metrics,
`pnpm memory:check`, `pnpm check`.

**Every phase:** update [[Roadmap]], [[Parity-Matrix]] and the README status.

**Monthly:** refresh the research claims the current phase depends on.

**Every contract change:** an ADR with alternatives, before the code merges.

## Risks and kill criteria

| Risk | Mitigation | Kill signal |
| --- | --- | --- |
| Scope creep | A feature must remove a named bot | Two phases slip with no demo |
| Platform change | Adapter + budgeter + intent fallbacks | A limit invalidates a core module |
| Intent denial | Every intent has a documented fallback | A feature only works with content intent |
| Legal | No bundled streamer, no scraping, no mass DM | A vendor sends a letter |
| AI cost | Hard caps, opt-in, kill switch | Cost per guild exceeds hosting revenue |
| Maintainer load | Scope gate, no marketplace, few roots | Reviews take longer than builds |
| Data breach | Retention table, minimal storage, export/delete | Any message content stored by default |

**Kill rule:** if a phase's ten-minute demo cannot be shown, cut scope. Never
extend the date. A smaller bot that works beats a bigger one that does not.

## Explicit non-goals

No plugin marketplace of unreviewed code. No feature-count marketing. No
per-server lifetime licences. No bundled YouTube ripper. No AI that punishes
autonomously. No dashboard-only features. No mass DM, scraping, self-bots or
NSFW. No "custom bot identity" upsell that requires re-inviting.

## Scoreboard

| Milestone | Proof |
| --- | --- |
| M1 Substrate | Settings survive restart; one trace end to end |
| M2 Accountability | Scripted raid contained; every action appealable |
| M3 Parity | Matrix green for moderation, leveling, tickets, community |
| M4 Migration | 5k-server import under 10 minutes, restore verified |
| M5 Self-host | One command on a clean VM, no paid dependency |
| M6 Hardening | 2,500-guild load test; v15 migration in one PR |

## This pass

Write this page and [[Parity-Matrix]], wire the index and roadmap, journal pass
02 with the rejected plan shapes, update machine memory, and run the full check.
P1 starts next.
