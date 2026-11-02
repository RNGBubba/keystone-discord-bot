# Contributing

The repo-root [CONTRIBUTING.md](../../../CONTRIBUTING.md) is the short path; this
page keeps the project's reasoning.

## Setup

Requires Node 22+ and pnpm 12+.

```bash
pnpm install
pnpm check        # typecheck + tests + budget + claims + memory
pnpm dev          # needs DISCORD_TOKEN; everything else does not
```

You do **not** need a bot token to contribute. The test suite runs against
structural fakes (`packages/testing`), by design. If a change makes tests need a
token, the change is wrong.

## Your first module

1. Read [[01-the-module-contract]] and [[Module-Contract]].
2. Open an issue with the module's **spec**, not the code: what it does, what it
   refuses to do, which commands it adds, which intents it needs.
3. Get a maintainer's yes. This is the scope gate — it is why the project stays
   coherent instead of becoming 300 unreviewed commands.
4. Copy `modules/diagnostics`, rename, implement, test.
5. Register it in `packages/module-catalog/src/index.ts`; the bot and web app both import that list.
6. Add it to `memory/machine/project.json` and write Spec/Status/Teaching docs.
7. `pnpm check`.

## PR checklist

- [ ] Tests cover the new behaviour and fail without the change.
- [ ] No module imports discord.js.
- [ ] No new privileged intent without a written justification in the PR.
- [ ] Command budget explained: which hub does this attach to, and why a new
      root (if any) is earned.
- [ ] Docs: spec, status, teaching note.
- [ ] `pnpm check` green.

## Review standard

A reviewer asks, in order:

1. **Does it remove a bot?** If not, it is polish and waits.
2. **Is it free?** No feature may exist only behind hosting.
3. **Is it reversible?** Can an admin undo it and see why it happened?
4. **Can a learner follow it?** Names, structure, docs.

Style is handled by tooling; do not argue about formatting in review.

## What gets rejected

- A new root command when a subcommand would do.
- A feature that needs message content without a fallback.
- A settings write that bypasses the module's Zod schema.
- "I'll add tests later."
- A dependency that could be 40 lines of local code.

## Commits

Conventional-ish messages (`feat(levels): add role rewards`). One logical change
per commit. Explain *why* in the body when the diff cannot.
