# Moderation & security — spec

Moderation replaces the manual moderation of **Dyno and Carl-bot** and the
security layer of **Wick**. Tickets remain P3, but every punitive action here
creates the same case file tickets and AI will later reference.

The defining promise is not "more punishments". It is **accountability**:
a scripted raid is contained, and every action has a case number, a written
reason, evidence and an appeal path. The default is dry-run.

## Commands

| Command | Options | Guards | Behaviour |
| --- | --- | --- | --- |
| `/mod` | subcommands `ban`, `temp-role`, `panic`, `kick`, `timeout`, `warn`, `purge`, `lock`, `unlock`, `slowmode`, `case`, `note`, `history`, `links`, `filters`, `review`; each declares only the options it needs (`user`, `role`, `reason`, `case`, `duration`, `limit`, `channel`, `state`, `dry_run`) | guild-only, `ModerateMembers`; `panic on/off` also requires `Administrator` | Executes one manual action or reads the case/review queue. `ban` accepts an optional `duration` and `temp-role` requires `user`, `role` and `duration`; both write `expires_at` after the action succeeds. `panic` snapshots and restores `@everyone` SendMessages. `links` lists link findings, `filters` lists link/profanity/zalgo findings, and `review` closes the loop. Every enforced action opens a case before the external call. |
| `/appeal` | subcommands `open` (`case` required, `message`) and `status` (optional `case`) | guild-only, 5 s cooldown | `open` appends an `appealed` event to the caller's own case; never edits history or reverses automatically. `status` reads the append-only appeal events and the current case state, and refuses a case that is not the caller's. |
| `/verify` | subcommands `start` and `status` | guild-only, 5 s cooldown | `start` requires a persisted quarantine, then checks the join gate, its own state and DM-ability before sending the existing verification button through `ModerationActions.directMessage`; no community port is involved. `status` reads the persisted `members` row. Neither subcommand marks a member verified directly, and a member with no record is refused by name. |

`/mod` is a hub: those sixteen subcommands cost **one** global root. The module
spends 3 of Discord's 100 roots (`/mod`, `/appeal`, `/verify`); `/appeal`'s two
subcommands, `/verify`'s two subcommands and `/mod`'s sixteen cost no extra
slots.

### Temporary actions

A temporary ban or role grant is one case with an `expires_at` timestamp, not a
second record. After the action succeeds, the command enqueues one delayed
`moderation.expire` job whose idempotency key is the case id. The handler calls
`CaseStore.claimExpiry`, which clears the timestamp only if it is still set and
the case is not final; the winner performs `unban` or `removeRole`, appends an
`expired` event and closes the case. A failed external call restores the
timestamp and records a note, so the case remains visible and retryable. Startup
recovery reads the same rows: overdue cases expire now, future cases are
re-enqueued. This is why a lost timer is a delay, not a lost moderation action.

### Panic mode

`/mod panic` is a manual switch, not a time-bounded job. `state:on` calls one
port method that iterates the guild's text channels, records the existing
`@everyone` SendMessages overwrite for each channel it changes, and denies it.
`PanicService` saves that snapshot to one `community_records` row before the
command replies, so a restart cannot lose the way back. A channel that was
already denied is deliberately not in the snapshot: restoring panic must not
unlock a channel an administrator locked on purpose.

`state:off` restores only the recorded overwrites. When some restores fail, the
row keeps those channel ids and the next `off` retries only them; when all
succeed the row is cleared. The probe proves the row survives a Postgres
round-trip. The Discord calls are covered by the adapter test, not a gateway.

### Context menus

| Menu | Type | Guards | Behaviour |
| --- | --- | --- | --- |
| `Report message` | message | guild-only, 5 s cooldown | Opens a `report` case with `messageId`, `channelId` and a 500-character excerpt; never deletes or punishes |
| `Case history` | user | guild-only, `ModerateMembers` | Lists the selected member's 10 newest cases through the same `CaseService.list` as `/mod history` |

These are application commands of type 2/3. They cost no global root; Discord
gives the module 2 of its 15 user and 15 message menu slots. Report message is
intentionally a reviewable case rather than an auto-delete: a misclick must not
destroy a message.

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Module switch |
| `dryRun` | **`true`** | Observe and alert; no delete, timeout, quarantine, kick or ban |
| `modLogChannelId` | unset | Where case alerts and appeal/verify buttons are posted |
| `quarantineRoleId` | unset | Role applied by quarantine; falls back to a role named `Quarantined` |
| `appealsEnabled` | `true` | Whether `/appeal` and the appeal button work |
| `antiRaid.joinsPerWindow` | `10` | Joins inside `windowMs` that trigger raid mode |
| `antiRaid.windowMs` | `60000` | Join/heat window |
| `antiRaid.raidMinutes` | `5` | How long later joins stay quarantined |
| `antiRaid.minAccountAgeDays` | `7` | Age threshold used in evidence/join gate |
| `antiRaid.quarantine` | `true` | Retrospectively quarantine the burst |
| `antiNuke.actionsPerWindow` | `3` | Role/channel deletion actions before an alert/quarantine |
| `antiNuke.windowMs` | `60000` | Anti-nuke audit window |
| `antiNuke.webhookThreshold` | `1` | A created webhook is treated as hostile |
| `antiNuke.quarantineActor` | `true` | Hold the audit-log actor |
| `automod.invites` | `delete` | `off`, `alert`, `delete` or `timeout` after repeated posts |
| `automod.links` | `off` | `off`, `alert` or `delete` for a blocklisted or punycode host |
| `automod.linkBlocklist` | `[]` | Up to 200 host entries; an entry also covers its subdomains |
| `automod.profanity` | `off` | `off`, `alert` or `delete` for the operator-owned word list |
| `automod.bannedWords` | `[]` | Up to 200 words or phrases, matched case-insensitively on word edges |
| `automod.zalgo` | `off` | `off`, `alert` or `delete` for excessive combining marks |
| `automod.zalgoThreshold` | `8` | Combining marks before a zalgo finding |
| `automod.maxMentions` | `8` | Mention spam threshold |
| `automod.duplicateWindowMs` | `30000` | Duplicate hash window |
| `automod.duplicateThreshold` | `3` | Repeats before a duplicate action |
| `joinGate.enabled` | `false` | Hold new accounts until verification |
| `joinGate.minAccountAgeDays` | `7` | Join-gate age threshold |
| `joinGate.timeoutMinutes` | `10` | Intended review window (join-gate expiry still shares the temporary-action timer design but is not wired) |
| `nativeAutoMod.sync` | `false` | Manage prefixed Discord AutoMod rules |

## Events and decisions

| Event | Rule | Default decision |
| --- | --- | --- |
| `member.join` | `anti-raid.join-burst` | Alert; quarantine every join in the window |
| `member.join` | `join-gate.account-age` | Quarantine a young account when the gate is enabled |
| `message.create` | `automod.invite` / `automod.invite-burst` | Delete; optional timeout after repeated posts |
| `message.create` | `automod.link` | Alert or delete; a blocklisted host or a punycode label |
| `message.create` | `automod.profanity` | Alert or delete; a configured word or phrase on a word edge |
| `message.create` | `automod.zalgo` | Alert or delete at the combining-mark threshold |
| `message.create` | `automod.mention-spam` | Delete |
| `message.create` | `automod.duplicate` | Delete |
| `audit.action` (role/channel delete) | `anti-nuke.mass-action` | Alert; quarantine the actor at the threshold |
| `webhook.create` | `anti-nuke.webhook` | Delete webhook; alert; quarantine the creator |

The engine keeps only short-lived heat in memory. The case file is durable; the
heat is not. A restart resets raid heat, which is why the case remains the
source of truth.

## Case model

- `cases` stores one record per action: guild, monotonic case number, actor,
  target, action, reason, rule, state and JSON evidence.
- `case_events` is append-only: `created`, `note`, `reviewed`, `appealed`.
- `case_counters` allocates the next number atomically per guild. A unique index
  on `(guild_id, case_number)` is the backstop.
- Evidence contains the trigger detail, not the whole message. Invite content is
  truncated to 500 characters; a profanity finding keeps only the matched word;
  a zalgo finding keeps only the mark count. No general message archive is
  created.

## Join gate and verification

The join gate is state, not a role check. `members` stores one row per guild and
member: `joined_at`, `quarantined` and `verified_at`. `MemberStore` is the only
port over it; the SQL adapter is a real upsert on `(guild_id, user_id)` and the
in-memory adapter is the local-mode implementation.

The state machine has four real states and one writer per transition:

| State | How it is reached | `start` | `status` | `completeVerification` |
| --- | --- | --- | --- | --- |
| no record | member was never seen with the gate on | refusal: no quarantine recorded | “No record” plus the next step | refusal: nobody has asked for a hold on this member |
| quarantined | the guild member join path persists the hold after an enforced `join-gate.*` quarantine | sends the existing button by DM | shows the join time and the hold | the only allowed transition: verifies, clears the flag |
| verified | completion stamped `verified_at` | refusal: already verified | shows the verification time | refusal: already verified |
| gate disabled | operator turned the join gate off | refusal before any state check | names the disabled gate | refusal before any state check |

The join path is the only place a *new* quarantine is created for a joining
member: `SecurityCoordinator.handle` on `member.join` persists `quarantined: true`
through the same `MemberStore` that `/verify status` reads. Without that write a
member could request the button and completion would stamp `verified_at` for
someone who was never held — the state, not the role list, is the prerequisite.

There is exactly **one completion path**: `completeVerification`. The DM button
and the legacy in-guild button both call it. It checks the actor, the gate
setting, the existing `verified_at` and the persisted quarantine, performs the
existing quarantine action, and only then writes `verified_at` and clears the
flag. Completion can only move a quarantined row; any other state is refused
before Discord is touched. If Discord fails, no row is written, so
`/verify status` cannot report a verification that never happened.

`/verify start` is a prerequisite check plus delivery, not a bypass. It rejects
an already-verified member, rejects a record that is not quarantined, refuses
when the join gate is off, and turns a closed-DM error into a specific sentence
instead of a generic failure. `/verify status` reads the row and prints the join
gate state, quarantine flag, join time and next step; the footer says the
`members` table is the source. Gateway roles are deliberately not consulted.

## Link filter

`suspiciousLink` is a pure function over message content and the local blocklist.
It extracts `http(s)` URLs, normalises the host (lowercase, `www.` and a trailing
dot removed), and reports the first suspicious host with
`evidence: { host, match }`:

- **blocklist** — the host equals an entry or ends in `.` plus an entry. This is
  equality, not a substring, so `notphish.test` cannot match `phish.test`.
- **punycode** — any label starts with `xn--`. This is heuristic: it can hide a
  lookalike domain, and it is also how a legitimate internationalised domain is
  encoded. An allow-list is not built yet.

The filter is **off** by default. `alert` creates an `alerted` case and leaves
Discord's message alone; `delete` uses the same `delete-message` coordinator path
as the invite filter. The full message is not stored, only the host and the
match kind. `/mod links` reads the newest 25 cases with rule `automod.link`, so
the review queue stays the single place a moderator closes a finding.

## Profanity and zalgo

`bannedWordMatch` escapes every entry in `automod.bannedWords`, turns internal
whitespace into `\s+`, and wraps the alternatives in Unicode-aware edges:
`(?<![\p{L}\p{N}_]) … (?![\p{L}\p{N}_])`. This is **word-boundary aware**, not
a substring search: `ass` does not match `class`, and `pineapple` does not match
`pineapples`. A phrase such as `bad phrase` matches across any amount of
whitespace and is case-insensitive.

`combiningMarks` counts `\p{M}` code points. At or above
`automod.zalgoThreshold`, the message is a `automod.zalgo` finding; below it,
the message is untouched. This is a heuristic: scripts with many legitimate
diacritics can trip it, so the threshold is configurable and the rule can be
disabled independently of the word list.

Both rules are **off** by default and the word list starts empty. `alert` and
`delete` use the same case/coordinator path as the link and invite filters.
`/mod filters` lists the newest link, profanity and zalgo cases; a moderator
reviews one with `/mod review case=N`.

## Development fixture

In development, a bot-authored message in `DEV_GUILD_ID` that starts with
`keystone-test:` is evaluated as member content after the marker is stripped.
It exists so the Discord MCP can drive the real gateway → coordinator path with
one account. It is not registered in production. The in-memory dev seed turns
all three content filters to `alert` with a local `phish.test` example and the
benign word `pineapple`, so the live fixture never needs a remote list or a
real member account.

## Native AutoMod

`buildNativeAutoModPlan` produces keyword (invite) and mention-spam rules only
when `nativeAutoMod.sync` is true. The adapter deletes only rules whose names
start with `Keystone ·`, so a server's own rules survive. The plan is tested;
the live Discord sync is not, because no gateway token is available here.

## Intents and permissions

Intents: `GuildMembers`, `GuildMessages`, `MessageContent`, `GuildModeration`,
`AutoModerationExecution`. `GuildMembers` and `MessageContent` are privileged;
without them anti-raid and content scanning degrade, and `/setup` should say so
in P3.

Bot permissions: `ModerateMembers`, `BanMembers`, `KickMembers`,
`ManageMessages`, `ManageChannels`, `ManageRoles`, plus `ManageWebhooks` and
`ManageGuild` used by the action/AutoMod adapters. Every action checks the
permission **before** the Discord call.

## Non-goals

- AI classification and autonomous punishment. P4 may recommend; it never acts.
- DM appeals and a web appeal form. P2 uses the guild command and case button.
- Backups. P5 restores structure; this module records actions.
- Storing message content by default. Only the triggering evidence slice is kept.
- A remote threat-intelligence feed or a maintained phishing database. The list
  is local, operator-owned settings data; no network dependency or paid service.

## Verified by

- `modules/moderation/src/security.test.ts` — scripted raid, dry-run, link
  filter (off, blocklist subdomain, punycode, ordinary link), profanity
  (off, whole-word, phrase, delete) and zalgo (threshold, disabled), native plan.
- `modules/moderation/src/mod.test.ts` — registry, permission guard, enforced
  action, zero-write dry-run, reason requirement, appeal ownership, verification,
  `/mod links` and `/mod filters` read paths.
- `modules/moderation/src/context.test.ts` — Report message opens a real case
  with the target message id and excerpt, refuses a self-report, records the
  honest no-MessageContent placeholder, and Case history reads the same rows.
- `apps/bot/src/moderation-events.test.ts` — the dev marker is guild-scoped and
  stripped; ordinary member messages still reach the coordinator.
- `packages/db/src/cases.test.ts` — PGlite case numbering, events, state and
  concurrent allocation.
- `packages/db/src/member-store.test.ts` — PGlite proves one `members` row, the
  verification upsert, the preserved join time and the cleared quarantine flag.
- `pnpm budget` — 20/100 roots with all shipped commands (141 subcommands) and
  4 context menus on their own 15 + 15 budget.
