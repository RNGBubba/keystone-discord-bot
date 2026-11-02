## What and why

<!-- What behaviour changes, and why this is the smallest change that does it. -->

## Evidence

<!-- Tests, a live bridge transcript, or a named limitation. Do not claim a live
proof that was not run. -->

- [ ] `pnpm check` is green.
- [ ] New behaviour is covered by a test that fails without this change.
- [ ] No module imports `discord.js`, Drizzle, BullMQ or Redis.
- [ ] A new privileged intent (if any) is justified here.
- [ ] The command budget is explained; a new root is earned, not assumed.
- [ ] `Spec.md`, `Status.md` and `Teaching.md` match the code, including what is
      not shipped.
- [ ] Counts were updated through the machine files; no sentence was hand-typed
      to satisfy the gate.

## Memory

<!-- The pass journal, module status and feature row this PR updates. A pass is
not done until the memory says the same thing as the code. -->
