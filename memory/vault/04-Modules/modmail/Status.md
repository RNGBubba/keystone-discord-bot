# Modmail — status

## Now

P7 modmail is in repo and live-proven for its command surface. It is the twelfth
module and the last root named by the approved plan.

- `/modmail setup | open | reply | close | transcript | stats` is registered
  through the shared catalog. The ledger is **20 roots / 141 subcommands / 161
  actions / 4 context menus**.
- A thread belongs to the member who opened it. Only the owner or staff may read
  it, reply to it or close it; a foreign thread and a missing thread return the
  same `was not found` refusal.
- The lifecycle is open → claimed (first staff reply) → closed. A closed thread
  refuses replies and further closes, and frees the member to open a new one.
- `ModmailStore` is one port. Postgres uses `DrizzleModmailStore`; local mode
  uses `InMemoryModmailStore`. Both enforce one active thread per member, the
  append-only message log, the side-aware unread counters and the single archive.
- Migration 0013 adds `modmail_threads` and `modmail_messages`. The partial
  unique index on `(guild_id, owner_id) WHERE state <> 'closed'` is the
  one-active-thread rule; the message foreign key cascades.
- Closing stores the canonical transcript, its SHA-256 and its message count in
  the same conditional update. A second close returns no row, so it cannot
  write a second archive.

## Verified

```text
pnpm vitest run modules/modmail packages/db/src/modmail-store.test.ts
  ✓ modules/modmail/src/modmail.test.ts (6 tests)
  ✓ packages/db/src/modmail-store.test.ts (4 tests)

pnpm test                          # 604 tests / 89 files
pnpm budget                        # 20/100 roots · 141 subcommands · 161 actions · 4 context menus
pnpm commands:doctor               # Registry 20 roots · 141 subcommands · 4 context menus
```

Focused coverage:

- **Privacy:** another member cannot read, reply to or close a thread; the
  refusal is byte-identical to a missing thread.
- **Flow:** open → staff reply claims → member read clears member unread →
  staff read clears staff unread → close archives 2 messages → archived read.
- **Close once:** the first close stores the transcript and checksum; a second
  close refuses; the stored checksum and message count are unchanged and the
  message table still holds exactly the two messages.
- **One active thread:** a second open is refused and names the active thread;
  after a close a new thread opens with a different id.
- **Setup:** requires `ManageGuild`, writes `enabled` and `max_threads`, and the
  disabled switch refuses a member open and a member reply while a staff reply
  can still drain an existing thread.
- **Caps:** the thread cap, the message-length bound and the per-thread message
  cap all refuse with the configured number.
- **PGlite:** raw selects confirm the active-owner index, the claim and unread
  counters, the single archive after two closes, a closed reply refusal, the
  partial index freeing a new thread and guild-scoped stats.

The SQL cross-check is in `modmail-store.test.ts`: after the duplicate close it
selects `state, transcript_checksum, transcript_message_count, closed_by`
directly from `modmail_threads` and asserts the first transcript is still the
only one. The live cross-check is the close reply's **2 messages archived**
against `!modmail stats` reading **2 messages** and **1 thread / 0 active**.

## Live evidence

At pass 42 the `.env` probe found both service ports closed, so that window was
memory mode and the SQL path was PGlite-only. Pass 44 has since opened the SQL
window and applied all 14 migrations:

```text
DATABASE_URL 127.0.0.1:5432  ECONNREFUSED  connect ECONNREFUSED 127.0.0.1:5432
REDIS_URL    127.0.0.1:6379  ECONNREFUSED  connect ECONNREFUSED 127.0.0.1:6379
```

One bot process (`DATABASE_URL= REDIS_URL= pnpm start`) connected as
`AI Team#5758` with `"modules":12`; boot found `modmail` missing, cleared once
and re-registered **24** application commands (20 roots + 4 menus). It was
stopped with its process tree; a CIM query afterwards returned **0** `node.exe`.

Through the MCP bridge in `#ai-chat`:

```text
> !modmail setup
< Modmail setup · enabled · max 500 threads · 0 active

> !modmail open subject="Pass 42 privacy proof" message="My saved role vanished after the last update."
< Mail thread `0f7dbc9c-5054-4d60-907b-f200fbe46206` opened · open · only you and staff can read it.

> !modmail reply thread=0f7dbc9c-5054-4d60-907b-f200fbe46206 message="Thanks, I am checking the audit log."
< Reply recorded on `0f7dbc9c-5054-4d60-907b-f200fbe46206` · member side · open · 2 messages.

> !modmail transcript thread=0f7dbc9c-5054-4d60-907b-f200fbe46206
< Transcript `0f7dbc9c-5054-4d60-907b-f200fbe46206` · 2 messages · live, not archived yet

> !modmail close thread=0f7dbc9c-5054-4d60-907b-f200fbe46206 resolution="Restored the saved role"
< Thread `0f7dbc9c-5054-4d60-907b-f200fbe46206` closed · 2 messages archived · checksum `c3c539706ed70e53…`

> !modmail close thread=0f7dbc9c-5054-4d60-907b-f200fbe46206
< Thread `0f7dbc9c-5054-4d60-907b-f200fbe46206` is already closed.

> !modmail transcript thread=0f7dbc9c-5054-4d60-907b-f200fbe46206
< Transcript `0f7dbc9c-5054-4d60-907b-f200fbe46206` · 2 messages · archived

> !modmail stats
< Modmail stats · 1 threads · 0 active · 2 messages

> !modmail setup enabled=false
< Modmail setup · disabled · max 500 threads · 0 active

> !modmail open subject="Should be refused" message="modmail is disabled"
< Modmail is disabled here. Enable it with `/modmail setup enabled:true` to open a mail thread.

> !modmail setup enabled=true
< Modmail setup · enabled · max 500 threads · 0 active
```

**Cross-check:** the close reply reports **2 messages archived**; the archived
transcript read reports the same **2 messages** and `archived`; `!modmail stats`
reads **1 thread / 0 active / 2 messages**. The duplicate close was refused and
the archived read still reports one transcript, not two. The checksum prefix
`c3c539706ed70e53…` is the one printed at close, and the module test recomputes
the full SHA-256 over the archived payload. Because the pass-42 window was
memory mode, the durable-row half of that cross-check runs in PGlite
(`packages/db/src/modmail-store.test.ts`), not against a server.

**What the MCP account could not do:** it is a bot, so the thread it opened
belongs to the bot and every reply was the **member** side. A second member
attempting to read the thread, a staff reply that claims an open thread, and the
private refusal for a foreign member cannot be produced with one bot account;
those paths are covered by `modmail.test.ts`. The bridge posts normal messages,
so the command's `ephemeral: true` reply was not observed as ephemeral; a human
client is still required to prove that. Slash `InteractionCreate` was not
exercised — the bridge is a message. No DM or gateway relay exists, so none was
claimed.

## Open

- A delivery port and gateway message handler for DM-to-thread relay.
- Attachments and file uploads in a message.
- Conversation search and per-staff assignment.
- Include modmail threads in the guild portability bundle so `/export guild`
  covers them; `/modmail transcript` is the dedicated read today.
