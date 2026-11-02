# Curriculum

The repository is the course. Each lesson points at real code, asks you to change
it, and fails a real check if the change is wrong.

## Who this is for

You can read TypeScript and have used Discord. You have never built a bot with
more than one file, or you have and it became unmaintainable.

## Lessons

This is the original 8-lesson map from P3; P9 expands it to 14. A linked lesson
is written; an unlinked row is planned. `pnpm memory:check` keeps the links and
the lesson files in step, so a row cannot claim a lesson that does not exist.

| # | Lesson | Code | You will learn |
| --- | --- | --- | --- |
| 1 | [[01-the-module-contract]] | `modules/diagnostics`, `packages/kernel` | Why folders beat switches; how dispatch works |
| 2 | Guards and permissions | `packages/kernel/src/guards.ts` | Middleware, 403 avoidance, cooldowns |
| 3 | Settings that cannot corrupt | `settings.ts`, Zod schemas | Schema-first config, defaults, migration thinking |
| 4 | Tests without a token | `packages/testing` | Structural typing, fakes, why purity pays |
| 5 | Cases and evidence (P2) | `modules/moderation` | Event sourcing a moderation trail |
| 6 | Components V2 panels (planned, P7) | `packages/ui` (planned) | The 40-slot budget, defer-then-edit |
| 7 | Jobs and idempotency (P4) | `apps/worker` | At-least-once delivery, retry, backoff |
| 8 | Sharding and the 2,500 wall (P10) | `apps/bot` | Sessions, buckets, shard 0 hot spots |

## Each lesson has the same shape

1. **The problem** — a concrete failure in a real bot.
2. **The naive version** — what most tutorials do, and why it stops working.
3. **Our version** — annotated source.
4. **The exercise** — a small change, with a failing check to guide you.
5. **What we rejected** — the alternative and the reason.

## Why "what we rejected" is not optional

Anyone can read final code and copy it. The expensive knowledge is why the other
five obvious approaches were worse. That is what turns a reader into someone who
can make the next decision alone.

## Contributing a lesson

A lesson is a vault doc plus, ideally, a tagged commit or test that demonstrates
the failure mode. If you cannot reproduce the naive version's failure, the lesson
is an opinion, not a lesson.
