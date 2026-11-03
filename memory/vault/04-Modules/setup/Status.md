# Setup — status

## Now

P1 complete; `/config` added in pass 30 and `/export` in pass 31 (2026-11-01).

- `/setup` registered through the shared module catalog (`packages/module-catalog`), behind `ManageGuild`.
- Reports database reachability, migration state, cache mode, module state and
  the intents each manifest requests (P4.5, ADR-0012).
- Three readiness branches are covered by tests; `/setup` never writes.
- `/config list | get | set | export` reads and writes any registered module's
  per-guild settings through `SettingsService` and the owning Zod schema. It has
  its own 8-test suite and no second settings store.
- `/export guild | user | import | delete | drift | rollback` puts the P5
  portability service above Discord. `guild` and `user` post the same verified
  `keystone.export` files the CLI writes; `import` previews by default;
  `delete` requires the exact guild id; `drift` reads live gateway facts and
  never writes; `rollback` restores a 24-hour pre-import backup. The memory
  adapter exports the live in-memory rows and refuses import/delete/rollback
  with the missing `DATABASE_URL` rather than faking a transaction.

## Verified

```text
pnpm typecheck
pnpm vitest run modules/setup/src   # 27 tests / 3 files
pnpm test                           # 515 tests / 76 files
pnpm budget                         # 20/100 roots · 141 subcommands · 161 actions · 4 context menus
pnpm commands:doctor                # Registry 20 roots · 141 subcommands · 4 context menus
```

P1 exit evidence for `/setup`:

- `/setup` registers through the shared module catalog and the normal registry.
- Dispatch blocks a member without `ManageGuild` and allows one with it.
- Ready, missing-database, pending-migration and disabled-module states are
  asserted; the module enabled state comes from its own settings.
- A repository spy that throws on `set`/`clear` proves the command never writes.
- Proven at P1 exit with fixtures and a fake health probe; a live Postgres/Redis
  run was then outstanding. Pass 44 opened that window; since pass 46 it has
  Postgres 16.15, Redis, 14 migrations and `pnpm probe:live` 14/14, including a
  settings row that survived a pool close/reopen. See
  [[06-Operations/Live-Window|Live window]].

Pass 30 evidence for `/config`:

- A synthetic fixture module with a nested schema proves the schema is the gate,
  not the command: `nested.flag=false` writes, `mode=bogus` is rejected and the
  repository stays empty.
- A snowflake string survives unchanged, which a plain `JSON.parse` would round.
- The real dispatch pipeline blocks a member without `ManageGuild` before any
  read or write.
- Live in `#ai-chat`: `alert -> delete -> alert` on
  `moderation.automod.links`, read back after each write; `bogus` returned
  `automod.links: Invalid enum value` and the next read still returned `"alert"`.
- One bot process performed one drift-triggered clear + re-register; at pass 30
  `commands:doctor` reported 15 roots / 94 subcommands including `config`.

Pass 31 evidence for `/export`:

- The command suite covers all six subcommands: one root, permission refusal
  before the port is called, file attachment and checksum in the guild reply,
  member filtering in the user reply, import preview by default and write only
  on `dry_run:false`, exact-id delete confirmation, read-only drift, and
  rollback by import id.
- The PGlite suite exports real rows, proves USER_B never appears in USER_A's
  file, previews without writing, applies with `verified:true`, rolls back to
  the pre-import value, and returns a deletion receipt while refusing a
  post-deletion rollback.
- Live in `#ai-chat`: `!export guild` posted a 12.8 KB bundle whose parsed
  counts and checksum matched the reply (49 settings, 1 case, 1 case event,
  1 ledger row, 1 community record); `!export user` posted the 2.0 KB member
  file; drift went `1 missing` -> `0 missing` after restoring the channel; a
  wrong-id delete and a memory-mode rollback were refused with named reasons.
- One bot process booted, saw only `export` missing, cleared once and
  re-registered 16 roots with no duplicate replies.

## What it proves

`/setup`'s health port is wired to the real adapters in
`apps/bot/src/runtime.ts`, so its values come from the same handles the bot uses
— not from a parallel configuration check that could disagree with reality.

`/config` demonstrates that the bot and the dashboard share one write path. A
value that the dashboard accepts and a value that `/config` accepts are parsed
by the same schema and persisted through the same service. That is the property
that stops a guild's settings from depending on which surface edited it last.

`/export` demonstrates that a Discord surface can reuse a service without
copying its policy. The SQL adapter constructs the same `PortabilityService` the
CLI uses, so bundle format, checksum verification, restore transaction and
rollback window have one implementation and two doors. The memory adapter is
the honest exception: it exports the rows that exist and names the prerequisite
it lacks for the rest.

## Known limitations

- `/setup` cannot verify Discord permissions or channel layout; that is P2's
  verification work, not a readiness check.
- When `DATABASE_URL` is unset, `/setup` reports "settings are in memory" rather
  than failing. That is the supported local mode, and the warning is loud.
- No Redis means the worker cannot run; `/setup` says "not configured" instead
  of pretending cooldowns are shared.
- `/config` validates shape, not referents: a syntactically valid channel id can
  be stored even if the channel no longer exists. That check belongs to the
  owning module.
- `/config set` and `/setup reset` now append an `audit_events` row with the
  command actor, module and dotted-path diff; a no-op or rejected write writes
  nothing. The row is appended immediately after the settings write, not in the
  same transaction, so a process crash in that gap could store a change without
  its audit row. A single-transaction settings/audit port would close it.
- The dashboard renders the newest settings audit rows. `/logging` does not yet
  stream them into its channel ledger.
- The pass-30 live run used memory mode because the configured local
  Postgres/Redis endpoints were closed; pass 44 has since opened them.
- The MCP cannot invoke slash commands or render embeds, so the live proof is
  the message bridge with plain-text replies; the list and export embeds are
  covered by the command test.
- `/export import` cannot run through the `!` bridge because the bridge cannot
  carry an attachment option. The command path is tested; no live import is
  claimed.
- `/export import`, `delete` and `rollback` need `DATABASE_URL`. Memory mode
  refuses them by name instead of pretending a transaction exists.
- A memory-mode guild export omits member profiles and audit events because the
  in-memory stores never retained them. Settings are effective values, not raw
  override rows.

## Next

- P6: link the dashboard's setup page to the same health probe.
- P7: `/help` can render the same manifest data as documentation.
- Portability: store the current bundle as an import candidate so a large file
  can be restored without a fresh upload. The SQL service path is live-proven;
  the remaining live check is `/export import` and `/export delete` through a
  human Discord client.
