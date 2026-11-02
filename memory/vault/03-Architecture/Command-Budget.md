# The command budget

Discord allows **100 global chat-input commands per application**. That is not a
lot for a bot that wants to replace four others, and it is the constraint most
likely to be discovered too late.

This is why `pnpm budget` exists, why `pnpm check` runs it, and why the bot
refuses to boot when it fails.

## Current ledger

```text
20/100 global roots used (80 left)
138 subcommands · 158 total actions
4 context menus (2 user · 2 message; 15 each)
status: OK

  /command    module       subs  opts  chars
  /ai         ai             11     2   1954
  /analytics  analytics       6     1   1539
  /rank       community      12     2   2108
  /ticket     community       8     2   1450
  /tools      community      24     5   7224
  /about      diagnostics     0     0    131
  /help       diagnostics     5     1    816
  /ping       diagnostics     0     0    103
  /event      events          7     8   2899
  /form       forms           8     5   2709
  /invites    invites         3     1    672
  /logging    logging         7     2   1606
  /appeal     moderation      2     2    575
  /mod        moderation     14     4   3991
  /verify     moderation      2     0    306
  /modmail    modmail         6     2   1614
  /music      music           8     2   1322
  /config     setup           4     3   1106
  /export     setup           6     3   1445
  /setup      setup           5     2   1151

  Context menus (separate 15 + 15 budget)
  Explain with AI  ai           message
  Rank card        community    user
  Case history     moderation   user
  Report message   moderation   message
```

`pnpm budget` prints the live table. It is the source of truth; this page only
explains the shape of the number, not the number itself.

A **root** is one of Discord's 100 global chat-input commands. A **subcommand**
is free: it lives inside its root and does not consume another slot. Pass 26
replaced the flat `action` option in every existing hub with real subcommands, so
`/mod ban` and `/rank daily` are now visible in Discord's picker. The generated
[[Command-Catalog]] is the complete per-root list.

A **context menu** is an application command of type 2 (user) or 3 (message).
Discord gives each type its own 15 slots, so a menu costs no chat-input root.
Pass 33 added four: **Report message** and **Explain with AI** (message),
**Case history** and **Rank card** (user). `pnpm budget` reports them separately
and fails if either type exceeds 15; the kernel registry keys commands by
`type:name`, so a menu may share a display name with another type.

P4's economy work reused `/rank`; `/ai` was its only new root. A second economy
root was rejected in [[ADR-0011-economy-ledger-and-double-spend]] because it
would duplicate the hub and spend a command for no user benefit.

## How to spend a command

**Prefer, in order:**

1. **A subcommand group on an existing hub** — `/config levels xp 15`.
   Costs zero new global commands.
2. **A context-menu command** — right-click a message → Apps → *Report*.
   Separate budget: 15 user + 15 message.
3. **A component** — button/select on a panel. Costs component slots, not commands.
4. **A new root command** — last resort, and it needs a line in this ledger.

**Never:**

- One root command per feature (`/ban`, `/kick`, `/warn`, `/mute`, `/unmute`…).
  That is five of a hundred spent on one module.
- Deep nesting. Discord allows exactly one level: group → subcommand. A group
  inside a group is invalid and fails registration.
- Long descriptions "for clarity". The whole payload, localisations included,
  caps at 8,000 characters.

## The hub layout we are building toward

| Root | Owns | Example |
| --- | --- | --- |
| `/setup` | onboarding, module toggles, import | `/setup import mee6` |
| `/config` | every module's settings | `/config levels xp 15` |
| `/mod` | cases, warnings, timeouts, bans | `/mod case view 42` |
| `/ticket` | panels, claiming, transcripts | `/ticket panel create` |
| `/rank` | leveling and economy | `/rank view @user` |
| `/tools` | embeds, giveaways, reminders, feeds | `/tools embed edit` |
| `/help` | discovery, generated from the registry | `/help moderation` |

Seventeen roots today for a bot with dozens of implemented actions. The remaining
83 slots are held for Activities and features that genuinely need their own name;
context menus do not consume them. `/help`, `/setup`, `/logging`, `/analytics`,
`/config`, `/export` and `/music` are roots. `/config` landed in pass 30 with four
subcommands and no new settings store; `/export` landed in pass 31 with six
subcommands and reuses the P5 portability service; `/music` landed in pass 32
with eight subcommands over the existing `community_records` table, and its
playback seam refuses because no voice/Lavalink client is installed. Pass 33
added four context menus over existing services; none needed a root or a table.
Pass 34 split `/setup` into five subcommands (`status`, `module`, `verify`,
`import`, `reset`), so the root now spends five more free slots and no new root.
The saved plan table names 12 roots / 59 subcommands, not the handoff's 18 / 160;
the generated catalog is the current truth.

## Component budget (the other 100-limit)

Components V2 allows **40 components per message, total**, and the flag is
irreversible once set. A panel with a container, three text displays, two
separators and four action rows has already spent ten slots.

A `packages/ui` package (planned for P7; it does not exist yet) will expose
`layout()` that counts slots as it builds and throws in development when a panel
exceeds 40. Until then, the rule is: a panel is one container, at most four
action rows, and no nested sections for decoration.

## Anti-patterns with receipts

- **MEE6** ships a `/` namespace per plugin and a separate AI subscription. It is
  the cautionary tale for command sprawl and for pricing the core.
- **"500+ commands"** repos use command count as marketing. Users cannot find
  anything, and the maintainers cannot deprecate anything.
- **Prefix + slash duplication** doubles the name surface for no user benefit and
  requires the message-content intent. Slash-first; prefix is opt-in, later, and
  clearly labelled.

## When we hit 80

`pnpm budget` warns at 80. At that point the policy is:

1. Convert any single-purpose roots into subcommands of their hub.
2. Move configuration into `/config` rather than `/feature-config`.
3. Only then consider whether a new root is genuinely earned.

The number in `memory/machine/project.json` must match `commands` in the report.
`pnpm memory:check` enforces that it stays under the limit.
