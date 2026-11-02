# Lesson 9 — memory that checks itself

## The problem

A README says “18 roots / 160 subcommands”. The code has a different shape. A
status page says a feature is live when only a unit test ran. A journal says a
pass is green because it was green two edits ago.

This is not a documentation problem. It is a trust problem: a reader cannot tell
a checked fact from a confident sentence, so every page becomes suspect.

## The naive version

Write the docs by hand, update them when you remember, and ask reviewers to
notice stale numbers. That works for one afternoon and fails on the second.

## Our version

The repository separates **machine truth** from **human prose**:

- `memory/machine/*.json` records the registry counts, feature statuses, test
  results, live checks, passes, decisions and now the lesson metadata.
- `memory/vault/` is the readable half. Pages with the generated marker are
  written by `pnpm memory:render`; edit the machine file, not the page.
- `pnpm memory:check` validates both directions: every module folder has docs,
  every written lesson is listed, every local link resolves, generated pages are
  current, and every feature's `liveVerified` claim has a passing live check.
- `pnpm audit:claims` reads the actual registry and the vitest JSON report. It
  compares the current-tense counts in `AGENTS.md` and `README.md`, the
  `/help changelog` pointer, module paths and Components V2 claims. A stale count
  fails the gate; prose cannot override it.
- `pnpm memory:check` also reads `memory/machine/claims.json`, which names the
  documents that speak in the present tense. It recomputes roots, subcommands,
  actions, context menus, modules, tests and passes from `commands.json`,
  `project.json`, the vitest JSON report and `passes.json`. A current-tense
  sentence must match. A historical sentence is allowed to describe an older
  shape only when it names its pass (`at pass 41`, `then-current`, a dated live
  run) — "now" or "current" is never excused.
- The same file lists capabilities that have no code yet (Components V2, i18n,
  the Next.js dashboard shell). Any mention must carry a planned/future marker
  while the evidence probe is absent. A capability claim with no code behind it
  is a failing check, not a roadmap note.
- `memory/machine/lessons.json` records each lesson's proof commands, source
  files and any count it teaches. The memory gate checks that the commands exist
  in `package.json`, the paths exist, the lesson has the required sections, every
  linked lesson is in the machine file, and every taught count still matches
  `commands.json`, `live.json` or `project.json`.

The evidence ladder is explicit:

1. A test proves the in-process contract.
2. PGlite proves the real SQL engine without a server.
3. `pnpm probe:live` proves the configured Postgres/Redis/queue path.
4. A gateway check proves Discord actually did the thing.

A row may say `liveVerified: true` only when it names a passing `liveEvidence`
check in `live.json`. A passing local suite is not step 3.

## Exercise

Run both checks:

```bash
pnpm memory:check
pnpm audit:claims
```

Then open `memory/machine/features.json`, find `security.panic-mode`, and delete
its `evidence` array. Run `pnpm memory:check`. It fails because a shipped row
must name at least one real file. Put the evidence back.

Then open `README.md`, change a current `20/100 roots` line to `18/100 roots`,
and run `pnpm memory:check`. It fails against `commands.json`; restore it. Do the
same with the word "current": a sentence that says "the current ledger is" cannot
hide behind an earlier pass reference.

Now open `memory/machine/lessons.json`, change a `proofCommands` entry to
`pnpm lesson:does-not-exist`, and run `pnpm memory:check`. The gate rejects a
command that is not a package script. Restore it. This is the same pattern as
the feature evidence: a claim is a pointer the gate can follow.

Then find a `facts` entry — lesson 10 says `13 live checks` — change the text to
`99 live checks` and run `pnpm memory:check` again. The gate compares it with
`live.json` and fails. Restore the text. A number in a lesson is now a checked
claim, not a remembered one.

## What we rejected

- **One generated docs site with no prose.** It removes stale pages by removing
  the explanation. The journals and teaching notes are the point.
- **A spell-checker for prose.** It would catch typos, not “18 roots” in a repo
  that has 20. The gate checks the claims, not the style; it has no opinion about
  an adjective or a comma.
- **Trust a `liveVerified` boolean.** A boolean is a claim. The `liveEvidence`
  pointer and the passing check are the proof.
- **Freeze volatile counts in every lesson.** Teach the command that prints the
  count; use machine facts only for counts the lesson genuinely needs.

## Check yourself

1. Which page do you edit directly, and which do you regenerate?
2. What turns a feature row from a claim into live evidence?
3. Why can `pnpm check` run on a machine with no Postgres while `probe:live`
   cannot?
4. What makes a historical count acceptable while a current count is not?
