# Analytics — status

## Now

P7 guild analytics is in repo and live-proven through the development bridge. It
is the eighth module and the first read-only module over the ledgers the other
modules own.

- `/analytics` is registered through the shared catalog with `overview`,
  `members`, `messages`, `commands`, `tickets` and `export`. The command ledger is
  **20 roots / 138 subcommands / 158 actions**; at pass 32 it was 17 / 108 / 125.
- Every view is admin-only (`ManageGuild`), guild-scoped, read-only and cooled
  down for three seconds. There is no mutation path.
- `AnalyticsStore` is one port. Postgres uses `DrizzleAnalyticsStore`; local mode
  uses `MemoryAnalyticsStore` over the same in-memory records the gateway writes.
- `command_usage` is a new append-only table. Dispatch writes it after the
  command result is known; the write is best-effort and cannot fail a command.
- The six views name their source tables and row counts. There is no analytics
  table and no second counter to reconcile.

## Verified

```text
pnpm vitest run modules/analytics packages/db/src/analytics-store.test.ts
  ✓ modules/analytics/src/analytics.test.ts (5 tests)
  ✓ packages/db/src/analytics-store.test.ts (1 test)
```

- `/analytics overview` uses the configured default window; `days=30` reaches
  the store with a 30-day `since` and the command's `until`.
- A member without `ManageGuild` is blocked before the store is called; a
  disabled module is refused without a snapshot.
- The JSON export parses back to the snapshot object.
- The in-memory adapter excludes rows outside the window, computes invite
  retention and flags, command latency and ticket close time from real records,
  and reports one source count per table.
- The PGlite test seeds all five sources through the existing stores, then
  matches `overview.loggedEvents` and `overview.commandsRun` to raw `count(*)`
  queries. A second guild's rows are excluded.
- The command usage row is appended once per dispatched guild command; a failed
  write is logged and does not turn an `ok` command into an error.

Live evidence (2026-11-01, AI Team#5758, one bot process, memory mode):

```text
!logging setup channel=1566291983377367080
→ Logging enabled. A test message was posted to the channel.
  Logging enabled · channel #ai-chat · 0 stored · retention 30d.

MCP message: keystone-test: analytics traceable row one
MCP edit:    keystone-test: analytics traceable row one edited
MCP delete

!logging status
→ Logging enabled · channel #ai-chat · 2 stored · retention 30d.

!analytics overview days=7
→ Analytics overview · 7d · 3 command runs · 2 logged events · 0 active cases · 0 open tickets

!analytics commands days=7
→ Analytics commands · 7d · 4 runs · 4 ok · 0 blocked · 0 error · avg 347ms

!analytics messages days=7
→ Analytics messages · 7d · 1 deleted · 1 edited · 0 content-filter cases
```

The cross-checks are direct: the logging status read **2 stored** rows and the
overview read **2 logged events**; one MCP edit and one MCP delete produced
exactly **1 edited** and **1 deleted**; the command count rose **0 → 3 → 4** as
the bridge commands completed, because the current command records after its
reply. At pass 29 `pnpm commands:doctor` reported `Registry 14 roots · 90
subcommands`; after pass 30's `/config` it reports 15 roots / 94 subcommands.

## Known limitations

- The live bridge proves the plain-text summary. The MCP text reader does not
  render embeds, so the embed fields, top-command list and JSON export were
  covered by the command test, not read back live. A human slash run is still
  unobserved.
- The pass-29 live window used memory mode. Pass 44 opened Postgres 16.15 and
  Redis, but no analytics rows have been produced through the SQL store yet; its
  queries are still proven on PGlite and by migration, not by a live analytics
  read.
- The live rows were produced by the MCP bot under the development marker and by
  bridge commands, not by a human author or a real member join. Member analytics
  therefore proves the aggregation, not a live `GuildMemberAdd`.
- `command_usage` has no retention or prune path yet. The table will grow with
  every guild command; a documented window is the next operational task.
- The dashboard does not expose these aggregates yet. The store is reusable, but
  no web route was added in this pass.
- Current-state fields (open tickets, active cases) intentionally do not honour
  `days`; the command and spec say so.

## Next

- Add a human slash run that renders the embed and the export JSON.
- Exercise a real member join/leave so `members` has live audit evidence rather
  than only invite rows.
- Prune `command_usage` with an operator-configured window before it reaches a
  size where the aggregate query needs a rollup.
- Reuse `AnalyticsStore` behind the existing dashboard guild gate when a screen
  is requested; do not add a second analytics query path.
