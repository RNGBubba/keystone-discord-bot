# Curriculum

The repository is the course. Each lesson points at real code, asks you to change
something small, and names the check that proves the change.

## Who this is for

You can read TypeScript and have used Discord. You have never built a bot with
more than one file, or you have and it became unmaintainable.

## Lessons

The curriculum has **14 lessons**, all written against code that exists now.
Every lesson is listed in `memory/machine/lessons.json`; `pnpm memory:check`
verifies its source files, proof commands, required sections and Curriculum
link. A taught count must name a machine source, so the gate recomputes it. If a
lesson and the code disagree, the gate fails rather than the prose winning.

| # | Lesson | Code | You will learn |
| --- | --- | --- | --- |
| 1 | [[01-the-module-contract]] | `modules/diagnostics`, `packages/kernel` | Why folders beat switches; how dispatch works |
| 2 | [[02-guards-and-permissions]] | `packages/kernel/src/guards.ts`, `dispatch.ts` | Middleware, 403 avoidance, cooldowns |
| 3 | [[03-settings-that-cannot-corrupt]] | `packages/kernel/src/settings.ts`, module schemas | Schema-first config, defaults, reset |
| 4 | [[04-tests-without-a-token]] | `packages/testing`, `packages/kernel/src/testing.ts` | Structural fakes, PGlite, why purity pays |
| 5 | [[05-cases-and-evidence]] | `modules/moderation/src/cases.ts`, `packages/db/src/case-store.ts` | Append-only evidence, case numbers, atomic expiry claims |
| 6 | [[06-subcommands-and-the-budget]] | `packages/kernel/src/budget.ts`, `scripts/commands-catalog.ts` | Root versus subcommand, the 100-root cap, drift checks |
| 7 | [[07-jobs-and-idempotency]] | `packages/queue`, `apps/worker` | At-least-once delivery, retries, receipts |
| 8 | [[08-the-bot-side-timer]] | `apps/bot/src/timers.ts`, `modules/moderation/src/temporary.ts` | Why the timer is bot-side, conditional SQL claims, recovery |
| 9 | [[09-memory-that-checks-itself]] | `memory/tools`, `scripts/audit-claims.ts` | Machine truth, generated pages, evidence levels |
| 10 | [[10-the-live-window]] | `scripts/live-probe.ts`, `memory/machine/live.json` | PGlite versus Postgres, the probe, what “live” means |
| 11 | [[11-panic-mode]] | `modules/moderation/src/panic.ts`, `apps/bot/src/moderation-actions.ts` | Snapshot before acting, partial restore, idempotent switches |
| 12 | [[12-goodbye]] | `modules/community/src/engagement.ts`, `apps/bot/src/community-events.ts` | Reuse settings and services; omit branches that cannot work |
| 13 | [[13-portability-and-receipts]] | `packages/importer`, `packages/db/src/portability-store.ts` | Checksums, dry runs, transactional restore, rollback receipts |
| 14 | [[14-self-host-quickstart]] | `README.md`, `compose.yaml`, `Dockerfile` | Memory mode, compose, explicit migrations, the probe boundary |

## Not written yet

Two topics from the original plan are deliberately absent because the code they
would teach does not exist: Components V2 panels (`packages/ui` is not built) and
sharding (the bot does not shard). Writing either now would be a design essay
pretending to be a lesson. They belong here when there is a runnable change and a
check to fail.

## Each lesson has the same shape

1. **The problem** — a concrete failure in a real bot.
2. **The naive version** — what most tutorials do, and why it stops working.
3. **Our version** — annotated source.
4. **The exercise** — a small change, with a failing check to guide you.
5. **What we rejected** — the alternative and the reason.

## Why "what we rejected" is not optional

Anyone can read final code and copy it. The expensive knowledge is why the other
obvious approaches were worse. That is what turns a reader into someone who can
make the next decision alone.

## Contributing a lesson

Add the lesson file, then add its `path`, `proofCommands` and source `files` to
`memory/machine/lessons.json`. Link it in the table above. Run:

```bash
pnpm memory:check
pnpm check
```

The gate checks the commands are real package scripts, the files exist, the
lesson has the required sections, and the Curriculum link is bidirectional. A
lesson that claims a repository count must name a `facts` source the gate can
recompute (`limit`, `contextMenuLimit`, `migrations`, `modules`, `roots`,
`subcommands`, `actions`, `contextMenus`, `liveChecks` or `lessons`); do not
type a number that no check owns.
