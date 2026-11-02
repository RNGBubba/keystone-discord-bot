# Lesson 13 — portability and receipts

## The problem

A server wants to move from another bot, or restore Keystone after a bad
config. “Download the database” is not a migration: the target guild has
different ids, the bundle may be edited, and a failed restore halfway through
leaves a guild that is neither old nor new.

The operator needs three things: a preview before writing, a checksum that
proves the file arrived intact, and a way back if the import is wrong.

## The naive version

```ts
await db.insert(settings).values(bundle.settings);
```

This trusts the file, writes before it can report a diff, and has no snapshot of
the old guild. A unique constraint halfway through leaves partial state. If the
process dies, there is no record of what was attempted.

## Our version

Read `packages/importer/src/service.ts`, `packages/importer/src/types.ts` and
`packages/db/src/portability-store.ts`.

`PortabilityService` owns the policy; the store only moves rows.

- `exportGuild` builds a versioned bundle with a canonical checksum. JSON key
  order does not change the checksum.
- `importBundle` validates the bundle before writing. `dryRun: true` returns the
  diff and writes nothing. A real import first snapshots the destination, then
  writes in one transaction, then recomputes the checksum and records whether it
  verified.
- `rollback(importId)` restores the pre-import snapshot inside the rollback
  window. The record points at the backup, not at a second copy of the current
  data.
- `deleteGuild` writes a receipt with counts and keeps no content. “Gone” is
  provable without retaining the rows.
- `importLevels` and the MEE6/CSV readers are separate adapters. Their parsing
  rules do not leak into the import transaction.
- The live probe exercises dry-run, real import with checksum verification,
  rollback and a deletion receipt against Postgres.

## Exercise

Run the SQL portability tests:

```bash
pnpm test -- packages/db/src/portability.test.ts
```

Open `packages/importer/src/types.ts` and change `ROLLBACK_WINDOW_MS` from
`24 * 60 * 60 * 1000` to `0`. The test “rolls an applied import back to the
pre-import snapshot inside 24 hours” now fails with the window-closed error.
Restore the constant. The test is checking a policy boundary, not a mock.

If you have the compose services, `pnpm probe:live` runs the same three states
with real rows: `dry-run`, `applied` with a matching checksum, and a rollback.

## What we rejected

- **A raw SQL dump.** It cannot rebase guild ids, validate a bundle, or show a
  diff before writing. It also cannot roll back a partial restore.
- **Write first, validate later.** A constraint error halfway through leaves a
  guild in a state nobody can describe. Validate and snapshot first.
- **Trust the checksum in the file.** Recompute it from the parsed snapshot after
  import. A checksum that is only copied proves the file has a string, not that
  the rows match.
- **Keep deleted content “just in case”.** A deletion receipt with counts is
  enough to prove what was removed. Retaining the rows defeats the deletion.
- **A second import path for the dashboard.** One `PortabilityService`, one
  `ExportPort`, one checksum implementation.

## Check yourself

1. What does a dry run write, and what does it return?
2. Why is the backup a separate snapshot rather than a copy of the imported
   rows?
3. What does the deletion receipt retain, and what must it never retain?
