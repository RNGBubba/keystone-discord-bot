# Lesson 6 — real subcommands and the budget

## The problem

Discord gives an application **100 global roots**. The roots are scarce; the
subcommands inside a root are not. A bot that spends one root per feature runs
out, then invents a hidden `action:` string option so it can keep adding
features. The command picker becomes a wall of near-duplicates and nobody can
discover the subcommand that would have helped.

This project reached the choice early, with a plan that named more features than
fit as separate roots.

## The naive version

```ts
{ name: "mod", options: [{ name: "action", choices: ["ban", "kick", ...] }] }
```

It fits under the cap, but Discord cannot show the subcommand list, autocomplete
the action, or give each action its own required options. A user has to memorize
the strings. The bot's own `/help` has to parse them back.

The other extreme — one root per action — is honest but does not scale.

## Our version

A root can declare `subcommands` (and groups of subcommands). The registry
measures every node, while Discord counts only the root.

- `packages/kernel/src/registry.ts` rejects duplicate names per command type and
  validates the manifest before boot.
- `packages/kernel/src/budget.ts` holds `DISCORD_LIMITS`: **100 global roots**,
  plus separate **15 user** and **15 message** menu budgets. It measures
  options, payload characters and subcommands.
- `scripts/commands-catalog.ts` reads the same registry and writes
  `memory/machine/commands.json` and the vault catalog. It is not a second list.
- `scripts/commands-doctor.ts` fetches the live Discord shape and compares names
  and option trees. The boot path only clears and re-registers when the shape
  drifted, because Discord allows two global bulk overwrites in ten minutes.

`modules/moderation/src/commands/mod.ts` is a good example: one `/mod` root owns
`ban`, `temp-role`, `panic`, `kick`, `timeout`, `warn`, `purge`, `lock`,
`unlock`, `slowmode`, `case`, `note`, `history`, `links`, `filters` and `review`.
The module spends one root for all of them. `/tools` does the same for community
configuration. A new subcommand is a code change and a catalog regeneration, not
a new global slot.

## Exercise

Run the live budget:

```bash
pnpm budget
```

Then rename the `history` subcommand in `modules/moderation/src/commands/mod.ts`
to `log` and regenerate the catalog:

```bash
pnpm commands:catalog
pnpm budget
```

`pnpm budget` still passes — a rename costs no root. Look at the diff in
`memory/machine/commands.json` and the vault catalog, then restore the name and
regenerate. You have seen the catalog is derived, not typed by hand.

## What we rejected

- **One root per command.** It is simple until the plan names more than the cap;
  then the only options are silence or a second bot.
- **A flat `action` option.** It saves roots and loses discoverability,
  per-action validation and a real command tree.
- **Register commands per guild.** Guild commands have their own limits and
  caches; the global surface is the product, and `commands:doctor` checks it.
- **Clear and re-register on every boot.** A rate-limited register after a clear
  leaves the application with no commands. Boot sync only writes on drift.

## Check yourself

1. Why does a subcommand not spend one of the 100 global slots?
2. Which file would you edit to add a `/mod` subcommand, and which command
   regenerates the catalog?
3. What is different about the context-menu budget, and why is it separate?
