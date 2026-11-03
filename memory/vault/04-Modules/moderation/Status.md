# Moderation & security — status

## Now

P2 core shipped in pass 05 (2026-11-01).

- Cases, case events and atomic per-guild numbering are wired to Postgres.
- `/mod` supports ban, kick, timeout, warn, purge, lock/unlock, slowmode, case,
  note, history and review.
- The scanner handles invites, mention spam, duplicates, links, profanity and
  zalgo; anti-raid, anti-nuke and the join gate feed the same case coordinator.
- The link filter (pass 23) checks a local host blocklist and punycode labels,
  in `alert` or `delete` mode. `/mod links` lists the newest findings and
  `/mod review` closes one; no new command root.
- The profanity/zalgo filter (pass 24) matches an operator-owned word list on
  Unicode word edges and counts combining marks against a configurable
  threshold. `/mod filters` is the content-filter review queue (link, profanity
  and zalgo).
- The context menus (pass 33) add **Report message** (message) and **Case
  history** (user) without a root. Report message opens a real case with the
  message id, channel id and a 500-character excerpt; Case history requires
  `ModerateMembers` and reads the same rows as `/mod history`.
- `/appeal open | status` is a hub (pass 35). `open` keeps the target-only guard
  and appends the existing `appealed` event; `status` reads the append-only
  `case_events` rows through `CaseStore.listEvents`, so a review that changes the
  case state cannot erase the appeal. The case-button path still calls
  `appealById`.
- `/verify start | status` is a hub with a persisted join gate (passes 36–37,
  39). An enforced `join-gate.*` hold writes a quarantined `members` row through
  `MemberStore`; a dry run and anti-raid holds do not. `start` requires that
  row, checks the gate and DM-ability, and sends the existing button through
  `ModerationActions.directMessage`; the join gate no longer depends on the
  community adapter;
  `status` reads the row and reports no record, quarantined, verified or a
  disabled gate.  The in-guild and DM buttons share `completeVerification`, which
  refuses any non-quarantined row and performs the quarantine action before
  writing `verified_at`. The button id parsing and member-facing checks now
  live in `apps/bot/src/moderation-buttons.ts` and are covered by 13 focused
  adapter tests; the reply strings did not change in that extraction.
- **Temporary moderation (pass 45):** `/mod ban` accepts an optional
  `duration` in minutes and `/mod temp-role` grants a role for a duration. Both
  write `expires_at` on the case after the action succeeds and enqueue one
  delayed `moderation.expire` job keyed by the case id. `CaseStore.claimExpiry`
  clears the timestamp atomically, so two workers cannot release the same ban or
  role twice; a failed release restores it and records a note. The expiry path
  appends an `expired` event, closes the case and notifies the mod log. At
  startup, `TemporaryActionService.recover` expires overdue cases and
  re-enqueues future ones, which is the memory-mode restart path.
- **Panic mode (pass 46):** `/mod panic state:status|on|off` is an
  `Administrator`-only switch. `on` asks `ModerationActions.lockdown` to
  snapshot each text channel's `@everyone` SendMessages overwrite, deny it and
  return what changed; `PanicService` writes that snapshot to one
  `community_records` row before replying. `off` passes the same snapshot to
  `restoreLockdown`, clears the row only when every channel restored, and
  otherwise keeps the failures so a retry touches only them. A channel that was
  already denied is left out of the snapshot, so panic cannot unlock it later.
  The snapshot is SQL and live-probed; the Discord overwrite calls are
  adapter-tested only.
- Native AutoMod rules are built and synced only when explicitly enabled.
- Dry-run is the default and produces alerts/cases without punitive calls.

## Verified

```
pnpm test                                  # 488 tests / 73 files
pnpm vitest run modules/moderation         # 60 tests (including 7 temporary-expiry and 5 panic tests)
pnpm test -- packages/db/src/cases.test.ts # 4 PGlite case-store tests, including listEvents and atomic expiry claims
pnpm test -- packages/db/src/panic.test.ts # PGlite panic snapshot scope and clear
pnpm test -- packages/db/src/member-store.test.ts # PGlite member row + verification upsert
pnpm budget                                # 20/100 roots · 141 subcommands · 161 actions · 4 context menus, status OK
pnpm build                                 # bot, worker, migrate artefacts
```

P2 exit evidence:

- `security.test.ts` scripts **10 joins, 5 invite posts and one webhook**. In
  enforcing mode it records 20 cases and makes 11 quarantine, 5 delete-message,
  1 delete-webhook and 1 timeout calls. Every case has a reason and an appeal
  button in its notification.
- The same script under defaults makes **zero punitive calls**; every resulting
  case is `alerted`, not open enforcement.
- `/mod` creates a case before a ban and asserts the reason and appeal custom id.
  Its default dry-run creates no case and calls no action. A missing reason
  throws. A caller without `ModerateMembers` is blocked by dispatch.
- `/appeal open` only accepts the target's own case and appends an `appealed`
  event. `/appeal status` keeps reporting that event after `CaseService.review`
  changes the case state, and refuses a case that is not the caller's.
  `/verify start` sends exactly one DM with the `keystone:verify:<guild>:<user>`
  button and leaves the member unverified; a closed DM is refused with the
  provider's detail. `/verify status` reads a persisted row, including a
  completed verification.
- `DrizzleCaseStore` allocates 1..8 without duplicates under `Promise.all` on
  PGlite, persists cases/events/state and isolates guilds.
- `temporary.test.ts` proves the delayed job payload/key, a not-due no-op, one
  release with an `expired` event and a closed case, concurrent workers producing
  exactly one release, temp-role removal of the recorded role, a failed release
  staying open for retry, and restart recovery expiring one case and
  rescheduling another. `mod.test.ts` adds the command paths for a temporary ban
  and a temporary role. `apps/bot/src/timers.test.ts` runs the real in-process
  queue and service, and proves a redelivery is a no-op. The live probe records a
  real Postgres case expiry in `temporary-moderation-expiry`; the Discord action
  was a recording port, not a gateway.

P7 link-filter evidence (pass 23):

- `security.test.ts` covers off mode, a blocklisted subdomain (`login.phish.test`
  against `phish.test`), punycode (`xn--pple-43d.test`) in delete mode, and an
  ordinary `example.com` link producing no finding.
- `mod.test.ts` proves `/mod links` reads an `automod.link` case and calls no
  action.
- `moderation-events.test.ts` proves a bot marker is ignored without the dev
  guild, accepted only in it, stripped before evaluation, and ordinary member
  messages still flow.
- **Live 2026-11-01:** a marked MCP-bot message in `#ai-chat` produced case #1
  (`login.phish.test`, blocklist); `https://www.phish.test/account` produced #2
  (`phish.test`, blocklist); `!mod review case=2` changed #2 to `reviewed`;
  `https://xn--pple-43d.test/login` produced #3 (punycode); and
  `https://example.com/docs` produced no #4. The process was in memory mode with
  the link filter seeded to `alert`.

P7 context-menu evidence (pass 33):

- `context.test.ts` runs `Report message` and reads the created case back from
  `CaseService.list`: one `report` case with `actorId` = reporter, `targetId` =
  author, `evidence.messageId = "message-1"`, `channelId = "channel-a"` and the
  excerpt in `reason`. A self-report is refused, and an absent MessageContent
  intent records the honest placeholder instead of inventing text.
- The same file seeds a `warn` case and reads it through `Case history`; the
  manifest marks the menu with `requirePermissions("ModerateMembers")`.
- `packages/kernel/src/context-menus.test.ts` proves the registry separates
  chat-input names from user/message names, counts the separate 15 + 15 budgets
  and rejects options or subcommands on a menu.
- **Live 2026-11-01:** one memory-mode boot found both menus missing, cleared
  once and registered 21 application commands. `pnpm commands:doctor` read
  Discord's registry and reported `user:Case history` and
  `message:Report message` with no drift. The MCP cannot right-click, so the
  handlers were **not invoked live**; this page does not claim they were.

P7 profanity/zalgo evidence (pass 24):

- `security.test.ts` covers off mode, whole-word matching (`ass` not `class`),
  case-insensitive phrases with flexible whitespace, delete mode, a zalgo
  threshold hit, and below-threshold/disabled zalgo.
- `mod.test.ts` proves `/mod filters` lists `automod.profanity` and
  `automod.zalgo` cases without calling an action.
- **Live 2026-11-01 (safe seed):** `pineapple` produced a profanity case and a
  16-mark string produced a zalgo case; both were `alerted`, `!mod filters`
  listed them, and `!mod review case=2` changed the profanity case to
  `reviewed`. An ordinary `classic assignment and apple pie` message produced no
  case. The blocklisted link in the same run stayed in the channel.
- **Live delete proof (temporary seed):** with `dryRun: false` and
  `links: "delete"`, the blocked message ID returned `10008: Unknown Message`
  after the bot handled it, while `!mod links` still showed the open case. The
  final seed is restored to `alert`.
- **Live profanity delete proof (pass 25, temporary seed):** with
  `dryRun: false` and `profanity: "delete"`, the `pineapple` fixture disappeared
  from `read_messages` while `!mod filters` still showed case #1 open. The seed
  was restored to `profanity: "alert"` before the commit.
- **Synthetic slash proof (pass 27):**
  `apps/bot/src/interaction-harness.test.ts` sends Discord's nested
  `/mod ban user:@target reason:"posting raid invites" dry_run:false` payload
  through the real `asInteractionLike` adapter and `dispatchCommand`; the case
  is created, the ban port receives the target and reason, and an unknown
  subcommand is rejected before any side effect. This is not a gateway run and
  does not replace a live ban.

P7 verify-hub evidence (passes 36–37):

- `security.test.ts` proves the join write: an enforced young-account hold
  produces `{ quarantined: true, verifiedAt: undefined }` plus a verify button;
  an account above the age threshold produces no row; a dry run produces no row;
  and anti-raid quarantines produce neither a verify row nor a verify button.
- `mod.test.ts` covers all four states: no record is refused with **No
  quarantine is recorded** and sends no DM; a disabled gate and a verified row
  are refused before a DM; a quarantined row gets one DM with the guild-scoped
  button and stays quarantined; `status` renders no record, quarantined,
  verified and disabled-gate states with their own next step.
- `verification.test.ts` proves `completeVerification` refuses no record, a
  non-quarantined record, an already-verified record and a disabled gate, and
  writes `verified_at` only after `unquarantine` succeeds on a quarantined row.
- `packages/db/src/member-store.test.ts` proves the SQL adapter upserts one
  `members` row, `markQuarantined` clears a previous verification and preserves
  `joined_at`, and completion clears `quarantined`.
- **Live 2026-11-01:** the gate was enabled and no hold existed;
  `!verify status` returned `Verification status · No verification record.` and
  `!verify start` returned `No quarantine is recorded for you in this server. If
  you are restricted, ask a moderator.` The MCP account is a bot: it cannot make
  a member join, receive the DM or click the button, so the join write and
  completion were **not** invoked live; the tests above cover them.
- `pnpm commands:doctor` read Discord after the `!form` proof and reported 18
  roots / 125 subcommands / 4 context menus with no drift; with `/event`
  registered in pass 41 it reports **20 roots / 138 subcommands / 4 context
  menus**.

P7 appeal-hub evidence (pass 35):

- `mod.test.ts` registers `/appeal` with exactly `open` and `status`, opens an
  appeal for the target only, and proves `status` still reports one appeal after
  `CaseService.review` changes the state to `reviewed`.
- The same suite refuses another member's case with `not one of your cases` and
  returns `No appeal events are on record` when the member has none.
- `packages/db/src/cases.test.ts` asserts `DrizzleCaseStore.listEvents` returns
  the appended `appealed` row on PGlite, the SQL counterpart of the live
  in-memory read.
- Live in `#ai-chat`: case #1 read `#1 · warn · appealed · 1 appeal`, then
  `#1 · warn · reviewed · 1 appeal` after `!mod review`; a case against the bot
  was refused as `Case #2 is not one of your cases.`; at pass 35
  `commands:doctor` read 17 roots / 115 subcommands with no drift.

## Proven vs still needs a live gateway

| Claim | Proven here? | How to close |
| --- | --- | --- |
| Scripted raid is contained | Yes, policy engine + coordinator | Replay in a staging guild with a real token |
| Every action has a case/reason/appeal | Yes, fake action recorder and case store; `/appeal status` survives a state change | Same |
| Dry-run makes no punitive call | Yes | Same |
| Postgres case numbering/events | Yes, PGlite | Run against a Postgres server |
| Discord ban/kick/timeout/purge/lock | No | A live guild with the bot's permissions |
| Slash `/mod ban` argument parsing | Yes, synthetic nested payload through the real adapter and dispatch | A human `/mod ban` in staging |
| Native AutoMod sync | Plan tested; adapter not run | Enable `nativeAutoMod.sync` in staging |
| Gateway joins/messages/audit events | Messages yes (link/profanity/zalgo live); joins/audit no | A live guild with privileged intents |
| Link filter on a real message | Yes, live with the dev marker in `#ai-chat` | Repeat with a human author in staging |
| Appeal status after review | Yes, live: `#1` stayed `1 appeal` after `!mod review` changed its state to `reviewed`; another member's case was refused | Repeat with a human appellant and moderator |
| Join-gate hold, start/status and DM refusal | Hold and command states tested; live no-record refusal in memory mode; the row is PGlite-tested | Repeat with a real member join and a human who has DMs open |
| Link-filter delete action | Yes: temporary `dryRun: false` + `links: "delete"`; Discord returned `10008: Unknown Message` and the case survived | Re-run on a staging guild with a disposable message |
| Profanity / zalgo findings | Yes, live with the safe alert seed; `/mod filters` and `/mod review` | Repeat with a human author in staging |
| Profanity/zalgo delete action | Profanity yes (live 2026-11-01, message gone, case kept); zalgo no | Send a disposable zalgo fixture in staging with `dryRun: false` |
| Bot authors ignored outside the marker | Yes, adapter test | Production has no marker option at all |
| Temporary ban / temp role expiry | Yes: SQL case, atomic claim, timer service and in-process queue tests; live service check | A live `/mod ban duration` and a real unban/role removal in staging |
| Panic lock / restore | Service and command state transitions tested; the snapshot is live-probed through Postgres | A live `!mod panic state:on/off` with real channel overwrites in staging |
| Join-gate timeout expiry | Not wired | Reuse the same timer with a member expiry; see known limitations |

No document claims a live Discord run for the unproven rows.

## Known limitations

- `joinGate.timeoutMinutes` is stored and shown, but no expiry job yet; a
  quarantined member stays until the verification button is clicked or a
  moderator acts. The MCP bot cannot complete the DM flow, so that click is not
  live-proven.
- Temporary bans and temporary roles now have a release job. The gateway half
  (a live unban or role removal) is not claimed; the live probe used a recording
  port. Join-gate timeout expiry is still not wired to this timer.
- Case export (JSON/CSV) is not built; the ledger is queryable and P5 owns the
  full export surface.
- Panic mode has no automatic expiry and does not touch threads, voice or
  channel-specific allow/deny rules beyond `@everyone` SendMessages. Its
  Discord calls are unobserved; a live `/mod panic` is the missing proof.
- `/appeal` is guild-only; DM and web appeals need P3/P5 surfaces.
- Native AutoMod deletes only prefixed rules; a server's own rules are untouched.
- The link blocklist is host-only: no paths, wildcards, regex, remote reputation,
  allow-list or bare-domain parsing. A legitimate internationalised domain is
  flagged as punycode until an allow-list exists.
- `/mod links` and `/mod filters` read the newest 25 cases; they are review aids,
  not exports.
- Word matching is boundary-aware by design: `pineapple` does not match
  `pineapples`, and leetspeak or homoglyph obfuscation is not normalised.
- The zalgo threshold is a heuristic; scripts with many legitimate combining
  marks can trip it. It is configurable and can be disabled separately.
- Profanity and zalgo were live-tested in `alert` mode; profanity `delete` was
  then proven live with a temporary seed. Zalgo `delete` still shares the
  coordinator path but has not itself been run live.
- There is no false-positive report or per-rule analytics yet.
- Live ban/kick/timeout/purge API calls, verification button clicks and
  join/audit gateway events remain unverified; message events now have live
  link/profanity delete and alert runs for link, profanity and zalgo.
- The two context menus are registered but were not right-clicked live; their
  handlers are covered by adapter and command tests. An `alert`-only view of a
  case is not the same as a Discord client invocation.

## Next

- Staging run with a token: replay joins/messages/webhook and record receipts.
- Consider an allow-list for legitimate punycode domains and a per-guild word
  policy; `automod.false-positive-report` is the next review gap.
- Add join-gate timeout expiry on the same `moderation.expire` timer.
- Prove a live `/mod ban duration` and `/mod temp-role` in a staging guild.
- P3: link tickets and levels to the same case/case-event service.

## Teaching

See [[Teaching]].
