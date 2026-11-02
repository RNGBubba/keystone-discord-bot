# Modmail — spec

## What it is

Private member-to-staff mail. One root, `/modmail`, with six subcommands. A
thread belongs to the member who opened it; only that member and staff can read
or write it. Closing archives the conversation exactly once.

The module is the twelfth and the last root named by the approved plan. It
follows the same contract as events and forms: one kernel port, one service that
owns the state machine, an in-memory adapter for tests and a Drizzle adapter for
Postgres.

It is an **inbox**, not a live relay: replies are read with `/modmail
transcript`, not delivered into a DM or a gateway thread. That is named as open,
not imitated with a button or a channel that does nothing.

## Commands

| Subcommand | Who | Options | Behaviour |
| --- | --- | --- | --- |
| `/modmail setup` | `ManageGuild` | `enabled`, `max_threads` | Reads effective settings and counts; writes the two switches through the shared settings service. |
| `/modmail open` | everyone | `subject`, `message` | Creates the invoking member's thread and its first message. Refuses a second active thread. |
| `/modmail reply` | owner or staff | `thread`, `message` | Appends one message on the caller's side, updates unread and claims an open thread on the first staff reply. |
| `/modmail close` | owner or staff | `thread`, `resolution` | Builds the canonical transcript, stores it with its checksum in one conditional update. A second close refuses. |
| `/modmail transcript` | owner or staff | `thread` | Reads the live messages, or the stored archive after closing; clears the caller-side unread counter. |
| `/modmail stats` | staff | — | Thread counts by state, message count, staff unread and up to ten active thread ids. |

Staff means `ManageGuild`, `ManageMessages`, `ModerateMembers` or
`Administrator`. `setup` is stricter: `ManageGuild` or `Administrator`.

## Privacy rule

1. **Owner or staff only.** Every thread read and write resolves the row and
   checks `ownerId === caller || staff`.
2. **No existence oracle.** A foreign thread and a missing thread produce the
   same refusal text: `Mail thread <id> was not found.` A member cannot use the
   command to confirm that someone else's thread exists.
3. **No user option.** `open` and `reply` take the author from the interaction.
   There is no path to write a message as another member or to open a thread on
   their behalf.
4. **Ownership wins over staff status.** If a moderator opens their own thread,
   their replies are member messages. That keeps "which side spoke" unambiguous.
5. **Replies are ephemeral.** Transcripts contain member ids and are never
   posted publicly by the command.

## State machine

```text
open ──first staff reply──▶ claimed ──close──▶ closed
  │                            │
  └────────────close───────────┘
```

| State | Member reply | Staff reply | Close | Transcript |
| --- | --- | --- | --- | --- |
| `open` | allowed | allowed, claims | allowed | allowed |
| `claimed` | allowed | allowed | allowed | allowed |
| `closed` | refused | refused | refused (`already closed`) | archived read |

A closed thread frees the member to open a new one. There is no reopen path; a
new issue is a new thread.

## Transcript rule

`close` builds one canonical JSON payload (`format: keystone.modmail`, version,
guild id, thread header, messages, counts) and computes a SHA-256 over that
payload. The store writes the transcript, checksum and message count **in the
same update that sets `state = 'closed'`**, and the update only matches a thread
whose state is not already `closed`. A duplicate close therefore returns no row
and writes nothing; the service turns that into `already closed`.

`transcript` after a close reads the stored JSON, not a fresh render of rows, so
the archive cannot drift if messages are ever pruned. `transcript` before a
close reads the live rows and says `live, not archived yet`.

## Tables

Migration 0013 adds two tables. They are justified: the product is an ownership
rule, a per-member uniqueness rule and an append-only conversation, none of
which a settings blob can enforce.

- `modmail_threads`: owner, subject, state, claim/close fields, unread counters,
  message count and the archived transcript columns. A partial unique index on
  `(guild_id, owner_id) WHERE state <> 'closed'` is the one-active-thread rule;
  a partial index keeps a closed thread from blocking the next one.
- `modmail_messages`: `thread_id` foreign key with `ON DELETE CASCADE`, author,
  side (`member` / `staff`), body and timestamp.

The thread row is locked while a message is appended, so the counters and the
first staff claim cannot race. Closing does not need a lock because the
conditional update is atomic.

## Limits

- One global command root. `pnpm budget` reports **20/100 roots · 141
  subcommands · 161 actions · 4 context menus**.
- No new dependency, no privileged intent, no paid service.
- Defaults: 500 threads per guild, 200 messages per thread, 2,000 characters per
  message, 120 per subject. All but the subject are module settings.

## Partial and open

- **No DM or gateway thread relay.** Replies are read through the command, not
  pushed to Discord. A delivery port and a message handler are deliberately not
  built.
- **No attachments.** A message is text; there is no upload path.
- **No per-staff assignment beyond the claim.** The first staff reply records
  `claimed_by`; another staff member can still answer.
- **No transcript delivery outside the command.** Staff download the JSON from
  the ephemeral reply when a conversation is too long for an embed.

## Evidence

- `modules/modmail/src/modmail.test.ts` — the positive flow, owner/staff
  visibility, foreign and missing threads, closed replies, duplicate close,
  one-active-thread, setup write, disabled drain and caps.
- `packages/db/src/modmail-store.test.ts` — PGlite: the partial unique index,
  the claimed counters read as raw rows, the single archive, closed-thread reply
  refusal, a new thread after close and guild-scoped stats.
- `memory/journal/2026-11-01-pass-42.md` — live bridge transcript and the
  close/duplicate-close/stats cross-check.
