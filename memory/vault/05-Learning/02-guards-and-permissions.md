# Lesson 2 — guards and permissions

## The problem

A moderation bot checks `BanMembers` after it calls `bans.create`. Discord
returns `403 Missing Permissions`. The command replies "something went wrong",
the user retries, and the bot repeats the same invalid request. Discord can
invalidate an application that keeps making requests it is not allowed to make;
a raid is the worst possible time to spend that budget.

The same mistake has a quieter form: one author checks `ModerateMembers`, another
checks `BanMembers`, a third forgets because the command lives in a different
folder. Neither Discord nor a code review catches that reliably.

## The naive version

```ts
async execute(ctx) {
  try {
    await ctx.actions.ban(guildId, targetId, reason);
  } catch {
    await ctx.interaction.reply("Something went wrong.");
  }
}
```

It treats a permission denial as an exception. The adapter then has to guess
whether a failed request was a Discord error, a missing permission, or a real
bug. Every command repeats the guess.

## Our version

Read `packages/kernel/src/guards.ts`. It is deliberately small:

- `requireGuild` refuses a DM before a guild-only command runs.
- `requirePermissions("ModerateMembers")` reads the permissions the adapter
  already put on `InteractionLike`. It does not fetch a member or call Discord.
  `Administrator` short-circuits the list because Discord grants every
  permission to an administrator.
- `cooldown(ms)` keys the store by module, command path and user. The key
  includes the subcommand, so `/mod ban` and `/mod history` do not share a
  timer.
- `all(...guards)` composes them, first failure wins.

`packages/kernel/src/dispatch.ts` is the only place that runs guards:

```ts
for (const guard of registered.definition.guards ?? []) {
  const guardResult = await guard(ctx);
  if (!guardResult.ok) {
    await respond(ctx, { content: guardResult.message, ephemeral: true });
    return { status: "blocked", message: guardResult.message };
  }
}
await registered.definition.execute(ctx);
```

The order matters: resolve → validate path → build context → guards → execute →
respond. A module cannot accidentally run before its guard. `apps/bot/src/adapt.ts`
is where discord.js computes the permission set; the kernel never imports
discord.js.

`modules/moderation/src/commands/mod.ts` shows the shape:

```ts
guards: [requireGuild, requirePermissions("ModerateMembers")],
```

`/mod panic` adds a second check inside `execute`: `on` and `off` require
`Administrator`, while `status` is readable by a normal moderator. A single
root-level guard would be too broad for a read-only status view.

## Exercise

Run the focused dispatch test:

```bash
pnpm test -- packages/kernel/src/dispatch.test.ts
```

Then make the moderation guard deliberately stricter. In
`modules/moderation/src/commands/mod.ts`, change
`requirePermissions("ModerateMembers")` to `requirePermissions("Administrator")`,
run:

```bash
pnpm test -- modules/moderation/src/mod.test.ts
```

The test "blocks a caller without ModerateMembers" now sees the wrong refusal
message and fails. Revert the line. You have proved the guard is the thing that
blocks, not the command body.

## What we rejected

- **Check permission inside each command.** It puts a security rule in every
  command and makes a forgotten check invisible.
- **Rely on Discord's `default_member_permissions`.** Discord filters who sees a
  command, but the bot must still refuse a forged or stale interaction. The
  server-side guard is the authority.
- **Catch `403` and translate it.** By then the invalid request is spent, and
  the command has already started creating a case or writing a row.
- **One global cooldown.** A user who ran `/ping` would be locked out of
  `/mod ban`; the key includes the module and command path for a reason.

## Check yourself

1. Why does `requirePermissions` receive `ctx.interaction.permissions` instead of
   fetching the member?
2. Which commands may run in a DM, and what does `requireGuild` do to the rest?
3. If two shards run the same command for the same user, which cooldown store
   makes the second shard refuse?
