# Moderation & security — teaching notes

## Read in this order

1. `modules/moderation/src/security.ts` — the event → finding engine and the
   coordinator that persists before it acts.
2. `modules/moderation/src/cases.ts` — `CaseService`, the append-only event
   model, and why an appeal is a new event.
3. `modules/moderation/src/commands/mod.ts` — one hub command, dry-run gate,
   case-before-action ordering, and where a temporary action writes `expires_at`.
4. `modules/moderation/src/temporary.ts` — the release service, the atomic
   `claimExpiry`, and why a failed release restores the timestamp.
5. `modules/moderation/src/commands/appeal.ts` — a two-subcommand hub; note that
   `status` reads the event log, not the case state.
6. `packages/db/src/case-store.ts` + `migrations/0003-case-counters.ts` — the
   atomic case-number allocation, `listEvents`, and `claimExpiry`'s conditional
   update.
7. `modules/moderation/src/commands/verify.ts` + `verification.ts` + `members.ts`
   — the two-subcommand hub, the one completion path, and the state port.
8. `packages/db/src/member-store.ts` — the SQL upsert over the existing
   `members` table, including why the join time is preserved.
9. `apps/bot/src/moderation-actions.ts` — permission prechecks and the only file
   that turns a case action into a Discord call.
10. `apps/bot/src/timers.ts` — the bot-side delayed consumer and the split
    between database jobs and gateway jobs.
11. `apps/bot/src/moderation-events.ts` — the gateway-to-structural-event seam.

## The idea to take away

**Alert-only is a safety property, not a missing feature.** The default settings
have `dryRun: true`; the engine still creates an `alerted` case and posts the
evidence, but the coordinator never calls a punitive action. A stranger can
install Keystone, watch a raid, and decide the rules fit before giving it the
power to remove anyone.

The second idea is **case before action**. `runAction` and the security
coordinator open the case and append `created` first. If Discord returns 403,
the case remains open with a failure note in the review queue. An external call
can fail; the accountability record cannot disappear with it.

The third is **event sourcing**. `case_events` is append-only. A reversal is a
new event and a state transition, never an edit to the original reason. That is
what makes an appeal defensible later.

## Temporary actions are a claim, not a countdown

A temporary ban has two facts that can disagree: the Discord ban and the case
row. A timer that simply fires and calls `unban` is not enough. If the bot
restarts, two consumers start, or the first release fails halfway, the same case
can be released twice or the case can be closed while the ban is still in force.

The fix is to make the case row the lock. `CaseStore.claimExpiry` is one
conditional update:

```sql
UPDATE cases SET expires_at = NULL
WHERE id = $1 AND expires_at IS NOT NULL
  AND state NOT IN ('closed', 'reversed')
RETURNING *;
```

Only the worker that gets a row back owns the Discord call. A second worker sees
no row and stops. If `unban` or `removeRole` fails, `TemporaryActionService`
puts the timestamp back and appends a note, so the next recovery can retry. If
it succeeds, the `expired` event is appended before the state becomes `closed`.
That ordering is the same lesson as case-before-action: the record explains the
state, not the other way round.

This is also why the worker does not send Discord messages. The worker owns SQL
jobs; the bot owns gateway jobs. They share the same BullMQ driver and the same
services, but a delayed `moderation.expire` or `content.deliver` is consumed by
the bot process because that is where the Discord adapter lives. Splitting by
capability keeps one Discord adapter instead of growing a second REST one.

`/appeal status` is the small exercise that proves it. It does not ask "is the
state `appealed`?" — a review changes the state to `reviewed`, and that question
would forget the appeal. It asks `CaseStore.listEvents(caseId)` and filters for
the `appealed` type. The live proof is deliberately two commands apart:
`!appeal status case=1` printed `1 appeal` while the state read `appealed`, then
`!mod review case=1` changed the state, and the same read printed `1 appeal`
beside `reviewed`. If you later add a second kind of review, keep the event read
as the source of truth and treat the state as a cache of the latest transition.

## The link filter, as a worked example

A detector should be a pure function before it is an event handler.
`suspiciousLink` takes message content and the local blocklist, and returns a
host plus a reason. It does not delete, log or write a case. That separation is
why the same function can be tested with four one-line fixtures and then driven
by a real gateway event.

Two details are worth copying into your own rules:

- **Normalise before comparing.** `new URL` lowercases the host, and the code
  removes `www.` and a trailing dot. A blocklist entry matches the host exactly
  or as a `.`-suffixed subdomain. Never use `includes`: `notphish.test` would
  otherwise match `phish.test`.
- **Keep the response a policy decision.** The detector returns the same finding
  whether the operator chose `alert` or `delete`; the mode decides the kind. The
  coordinator, case, appeal button and notification path are unchanged.

The list is local settings data, not a downloaded reputation feed. That keeps
the feature testable, private and free. The cost is that somebody has to maintain
the list, and punycode is a heuristic rather than proof.

## Profanity and zalgo, as a second worked example

The word filter is a small compiler lesson. `bannedWordMatch` first escapes each
operator-supplied word, then turns internal whitespace into `\s+`, then joins the
alternatives inside Unicode-aware edges. Escaping before compiling is what keeps
a word like `c++` from becoming a regex; the edges are what keep `ass` from
matching `class`.

The zalgo check is deliberately not a regex. It counts `\p{M}` code points and
compares the count with a threshold. That is easy to explain, easy to test, and
hard to fool with a long string of combining marks. It is still a heuristic:
some scripts use many marks legitimately, which is why the rule has its own mode
and threshold.

The default word list is empty. A bot should not ship somebody else's idea of
offensive; the operator owns the policy and can enable `alert` before `delete`.

## Exercise

Add an `appeal` rate limit and a `case export` action.

1. Add `appealCooldownMs` to `moderationSettingsSchema` with a default and a
   test that a second appeal within the window is rejected.
2. Use the injected `ctx.cooldowns` port rather than a module-local Map.
3. Add `/mod export` that returns JSON only for a moderator with
   `ModerateMembers`; include cases and events, never another guild's rows.
4. Explain in [[Status]] why export belongs to the case service, not the command.

## Link-filter exercise

1. Add `automod.linkAllowlist` and make a host that matches it win over the
   punycode check. Decide the order explicitly: allow-list, blocklist, heuristic.
2. Add a fixture with a userinfo trick (`https://phish.test@example.com`) and
   assert which host `new URL` reports. The answer is `example.com`; the part
   before `@` is not the host.
3. Keep the finding evidence to `{ host, match }`. If you are tempted to store
   the message, re-read the retention rule in [[Spec]].

## Word-filter exercise

1. Add an allow-list for the Scunthorpe problem and decide whether it wins over
   the blocklist. Write the order down before the test.
2. Add fixtures for `class`/`ass`, `pineapple`/`pineapples` and a phrase with
   three spaces. If a fixture is surprising, the rule is not documented enough.
3. Measure a 200-word list against a 2,000-character message. If compilation is
   visible in a profile, cache the compiled pattern instead of rebuilding it for
   every event; keep the cache keyed by the actual list, not the guild.

## The mistake you will probably make

Calling `actions.ban()` before `cases.open()`. It looks simpler, and in the happy
path it is. The first time Discord returns 403 or the member leaves, you have an
action with no record — exactly the failure the case model exists to prevent.

The second likely mistake is treating a JSON evidence blob as an archive. Keep
the trigger slice; do not start storing every message "just in case". The
retention table and the data-ownership promise are part of the design.

## Verification is a state machine, not a role lookup

A join gate is easy to fake. The tempting implementation is: if the member has
the quarantine role, remove it and say "verified". That reads the gateway, is
wrong after a role rename, and leaves no record of when verification happened.

Keystone treats verification as **persisted state with one completion path**.
`members` already existed in the portability schema, so the new `MemberStore` is
a narrow port over it rather than a new table: read one row, and upsert
`verified_at` while clearing `quarantined`. The in-memory and SQL versions are
the same contract, which is why the command tests and the PGlite test assert the
same fields.

The row has to be written by the thing that actually holds the member. In
`SecurityCoordinator`, an enforced `join-gate.*` quarantine calls
`members.markQuarantined` **after** `actions.quarantine` succeeds. That order
means a failed role grant cannot leave a hold that does not exist, and a dry run
writes nothing because nothing happened. Anti-raid holds are deliberately
excluded: they are moderator actions, not a verification queue, so they get no
verify button either. Without this writer the button would be a bypass — any
member could request it and completion would stamp `verified_at` for someone who
was never held.

`completeVerification` then enforces the rest of the order: check the actor,
the gate, the persisted row and `verified_at`, perform the quarantine action,
**then** write `verified_at`. It transitions only a `quarantined` row; no record
and a row that is not quarantined are refusals. If the role removal fails, the
write never happens and `/verify status` keeps telling the truth. The DM button
and the legacy in-guild button both call this function, so there is no second
path that can drift.

`/verify start` is deliberately not the completion. It exists to answer "can
this member actually complete the flow right now?" It requires the persisted
quarantine, parses the settings, and sends the button by DM. A closed DM becomes
a specific refusal that names the fix (`Open DMs from server members`), which is
far more useful than a silent failure. `/verify status` then reads the row; it
does not re-derive the answer from roles, and its footer says so. Its four states
are no record, quarantined, verified and gate disabled, and only the quarantined
state offers `/verify start` as the next step.

Delivery belongs to the same ownership boundary. `start` calls
`ModerationActions.directMessage`, not `CommunityActions.sendDM`: a module must
not borrow another module's adapter just because `CommandContext` happens to
expose it. The port carries only content and components, and a closed DM comes
back as `ok: false` with the provider detail, which the command turns into the
same fix-it sentence. That is why the moderation tests can build a context with
no community port and still prove the DM path.

If you extend this, add a `quarantined_at` timestamp rather than inferring when
the gate started; the current row has `joined_at` but no hold timestamp. Do not
let the timeout job call `markVerified`; expiry is a different outcome and needs
its own event.

## Context menus are commands with a target

A message context menu is not a new subsystem. It is an application command of
type 3 that arrives with `targetId` (the message id), `targetMessage.author.id`
and — only when the MessageContent intent is granted — the message text. The
kernel models that as `commandType: "message"` plus `targetId`,
`targetUserId` and `targetContent`; the registry keys commands by
`type:name`, so a menu can share a display name with a slash root without
colliding.

Two design choices are worth copying. First, **Report message opens a case, it
does not delete the message**. A right-click is easy to misclick, and the case
is reviewable, appealable and durable; an accidental delete is not. Second,
**Case history reuses the same permission and the same rows as `/mod history`**.
If the menu had its own query or its own permission, the two surfaces would
drift and a leak would be invisible to the slash tests.

When MessageContent is off, do not guess. The report stores
`(content unavailable; MessageContent intent is off)` and keeps the message id,
which is the one fact a moderator can still act on.

## Stretch

Replay the exact `security.test.ts` fixture through `registerModerationEvents`
with a fake discord.js client, so the adapter seam is covered without a token.
The event translator should remain dumb: no thresholds, no case creation, no
punishment decisions.
