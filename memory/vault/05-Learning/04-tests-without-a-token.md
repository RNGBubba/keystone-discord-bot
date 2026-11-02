# Lesson 4 — tests without a token

## The problem

The usual Discord bot test is a staging guild with a real token. It is slow,
flaky, unsafe to run in CI, and it cannot make a member join on demand. Worse,
it hides logic inside the gateway: if the test needs Discord to reach the code,
the code cannot be tested without Discord.

A test that cannot run on a laptop with no token will not run before every
commit. That is the only time it matters.

## The naive version

Mock discord.js itself:

```ts
vi.mock("discord.js", () => ({ ... }));
```

It looks cheap until the mock has to know about `ChatInputCommandInteraction`,
`GuildMember`, permission bitfields and the reply/edit/follow-up state machine.
The mock becomes a second implementation of discord.js, and it drifts.

## Our version

The kernel defines narrow structural interfaces. `packages/kernel/src/testing.ts`
provides real fakes for them:

- `FakeInteraction` implements `InteractionLike`, records `reply`,
  `followUp` and `lastReply`, and accepts plain option objects.
- `createTestContext` wires a `SettingsService` over an in-memory repository, a
  fake logger, noop queue/health, and optional ports.
- `RecordingJobQueue` records enqueues so a command's timer payload can be
  asserted without Redis.
- The in-memory stores are real implementations of their ports, not stubs with
  `throw new Error("not implemented")`. `InMemoryCaseStore` allocates case
  numbers and appends events.

`packages/testing/src/index.ts` re-exports those fixtures so a module author has
one stable import. The test still crosses the same `dispatchCommand` as
production; only the Discord boundary is fake.

`apps/bot/src/interaction-harness.test.ts` is the closest thing to a slash test:
it builds a nested `/mod ban` payload, runs it through `asInteractionLike`, the
registry and dispatch. It is deliberately called a harness, not a gateway test,
because Discord's real `InteractionCreate` is still unobserved.

## Exercise

Run one module test file:

```bash
pnpm test -- modules/moderation/src/mod.test.ts
```

Then open the "runs an enforced ban only after creating its case and reason"
test. Remove the `reason` from the `buildContext` options:

```ts
{ action: "ban", user: "target-1" }
```

Run the same command. `mod.execute` throws the same `UserError` a real member
would see, so the test fails. Put the reason back. The point is that the refusal
was proved without a token, a guild, or a network request.

If you want a database, use PGlite. `packages/db/src/testing.ts` starts the real
Postgres engine compiled to WASM and applies the real migrations. It gives you
transactions, JSONB and unique indexes without a server.

## What we rejected

- **Mock discord.js.** It creates a second, incomplete implementation of the
  library and couples every test to its internals.
- **A live staging guild in CI.** It needs a secret, a running bot and a
  disposable server, and it still cannot prove deterministic edge cases.
- **Snapshot every reply.** A snapshot tells you the text changed; it does not
  tell you which rule produced it. Assert the fields the user relies on.
- **Make every store an in-memory fake.** The SQL adapter is where claims,
  indexes and transactions live. PGlite tests exercise the real provider SQL.

## Check yourself

1. Which line in `apps/bot/src/adapt.ts` converts a discord.js interaction into
   the structural type the kernel sees?
2. Why is `InMemoryCaseStore` a real implementation rather than a stub?
3. What does PGlite prove that an in-memory store cannot?
