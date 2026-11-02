# Lesson 3 — settings that cannot corrupt

## The problem

A dashboard sends `{"welcome": {"enabled": "yes"}}`. A command does
`JSON.parse(stored)` and spreads it over the defaults. Now `enabled` is the
string `"yes"`, every `if (config.enabled)` passes, and the database holds a
value no code expected. The next deploy changes the shape; the old row remains.

Settings are an API. Treating them as arbitrary JSON means every writer can
break every reader.

## The naive version

```ts
const stored = await repository.get(guildId, moduleId);
const settings = { ...defaults, ...stored };
```

This has three failures:

1. A new default is not applied to an old row.
2. An unknown key survives forever.
3. A value with the right name but the wrong type is accepted.

The last one is the dangerous one: it does not fail at write time, so the bug
appears later in a command with no link to the writer.

## Our version

Read `packages/kernel/src/settings.ts` and follow one read:

```ts
const stored = await this.repository.get(guildId, moduleId);
const merged = { ...manifest.defaultSettings, ...stored };
return manifest.settingsSchema.parse(merged);
```

Four rules fall out:

- **Defaults live with the module.** `modules/community/src/settings.ts` owns
  `communitySettingsSchema` and its `.default(...)` values. The kernel does not
  know what a greeting is.
- **Every read is parsed.** `SettingsService.get` runs the owning Zod schema, so
  a hand-edited row or an old shape is repaired or rejected before a command
  sees it.
- **Every write is parsed as a whole.** `update` merges the current parsed value
  with the patch, parses the result, and only then writes. A partial patch
  cannot bypass a rule on another field.
- **Reset is deletion, not a copy of defaults.** `reset` clears the row;
  defaults return on the next read. There is no second source of truth.

The SQL adapter (`packages/db/src/settings-repository.ts`) stores JSONB through
a custom type that preserves JSON numbers and `null`. The service is the same in
memory mode; only the repository changes.

## Exercise

Run the settings tests:

```bash
pnpm test -- packages/kernel/src/settings.test.ts
```

Open the test "rejects an update that violates the module schema". It sends
`xpPerMessage: 10_000`. Change that to `50` and run the same command. The update
now succeeds, so the assertion that it rejects fails. Restore `10_000`. That
failure is the schema doing its job, not the test being brittle.

Now read `modules/community/src/settings.ts` and find the `goodbye` object added
in pass 46. It has `enabled`, an optional `channelId`, a default message and a
length cap. There is no separate goodbye store and no second parser.

## What we rejected

- **Store only explicit values and merge defaults in the command.** Every
  command re-implements merge order, and a new field is invisible until someone
  edits every caller.
- **Trust the dashboard.** The dashboard is a writer like any other; it receives
  the same schema validation through `SettingsService`.
- **Write a migration for every new field.** JSONB plus schema defaults handles
  additive fields without a migration. A breaking rename still needs a real
  migration and a backup.
- **Use a loose `z.record(z.unknown())`.** It accepts everything and protects
  nothing. The module schema is the contract.

## Check yourself

1. A guild has a stored `welcome` object with no `roleDelayMinutes`. Where does
   the value come from on the next read?
2. Why does `update` parse the whole object instead of only the patch?
3. What does `reset` delete, and what comes back on the next read?
