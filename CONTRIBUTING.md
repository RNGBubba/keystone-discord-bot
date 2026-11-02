# Contributing to Keystone

Keystone is a teaching project before it is a product. A contribution is judged
by whether a stranger can read it, run it and change it — not only by whether it
passes.

This file is the short path. The long version, with the project's reasoning, is
[memory/vault/07-OpenSource/Contributing.md](memory/vault/07-OpenSource/Contributing.md).

## Setup

Requires Node.js 22+ and pnpm 12+.

```bash
corepack enable
pnpm install
pnpm check        # typecheck, tests, budget, claims and memory
pnpm dev          # needs DISCORD_TOKEN; the checks above do not
```

You do **not** need a Discord token, a database or a network connection to
contribute. The suite runs on PGlite and structural fakes in `packages/testing`.
If a change makes a test need a token, the change is wrong.

## Before you write code

For anything larger than a typo, open an issue with the **spec**, not the code:
what it does, what it refuses to do, which commands it adds, which intents it
needs, and what a live proof would look like. Get a maintainer's yes. Scope
control is why the command tree stays coherent.

## Adding a module

1. Read [the module contract](memory/vault/05-Learning/01-the-module-contract.md).
2. Copy `modules/diagnostics`, rename it, and implement the `defineModule`
   manifest.
3. Add it to `packages/module-catalog/src/index.ts` — the bot and the dashboard
   both import that one list.
4. Add it to `memory/machine/project.json` and write `Spec.md`, `Status.md` and
   `Teaching.md` under `memory/vault/04-Modules/<id>/`.
5. Update the feature row and the pass journal. Memory that disagrees with code
   is a failing check, not a note.
6. Run `pnpm check`.

## Pull request checklist

- [ ] The tests cover the new behaviour and fail without the change.
- [ ] No module imports `discord.js`, Drizzle, BullMQ or Redis; those stay behind
      the adapter or a port.
- [ ] No new privileged intent without a written justification.
- [ ] The command budget is explained: which hub this attaches to, and why a new
      root (if any) is earned.
- [ ] `Spec.md`, `Status.md` and `Teaching.md` describe the real behaviour,
      including what is not shipped.
- [ ] Counts in the docs were updated through the machine files, not typed by
      hand. `pnpm check` enforces this.
- [ ] `pnpm check` is green.

## Review standard

A reviewer asks, in order:

1. Does it remove a bot, or only add polish?
2. Is it free and self-hostable?
3. Is it reversible, attributable and visible to an admin?
4. Can a learner follow it?

Formatting is tooling's job. Do not argue about it in review.

## What gets rejected

- A new root command when a subcommand would do.
- A feature that needs message content without a fallback.
- A settings write that bypasses the module's Zod schema.
- A capability claim with no code behind it.
- "I'll add tests later."
- A dependency that could be a few lines of local code.

## Commits

Conventional-ish messages (`feat(levels): add role rewards`). One logical
change per commit. Explain **why** in the body when the diff cannot.

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Security reports follow [SECURITY.md](SECURITY.md), never a public issue.
