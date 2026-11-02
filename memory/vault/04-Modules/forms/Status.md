# Forms — status

## Now

The tenth module is in repo and live-proven through the development bridge in
the pass-40 memory window. `/form` is the first root added after the saved plan
table reached 59 of 59.

- `/form create | edit | delete | list | panel | submit | review | export` is
  registered. The ledger is **20 roots / 141 subcommands / 161 actions / 4
  context menus**.
- Forms and submissions are **real rows** in `forms` and `form_submissions`
  (migration `0011_forms`). `FormStore` has one in-memory and one Drizzle
  adapter; commands never see a table.
- `create` writes a `draft`, `edit` opens/closes it, `panel` refuses a non-open
  form and records the channel after the message is posted, `submit` validates
  every field and writes a pending row, and `review` transitions only a
  `submitted` row.
- One pending submission per member per form is enforced by a partial unique
  index and by the in-memory store. A decided applicant may apply again.
- `delete` is refused once any submission exists; history is closed, not erased.
- `export` attaches `keystone.forms.<guild>.json` with a SHA-256 checksum.
- **Modal input is not shipped.** `submit` takes a validated `answers` string
  and the panel prints the exact syntax. There is no button that opens nothing.
- Forms are enabled by default; `enabled: false` blocks `create` and `submit`,
  not `list`, `review` or `export`.
- The module requests only `Guilds`; no gateway event or privileged intent is
  needed.

## Verified

```text
pnpm vitest run modules/forms packages/db/src/form-store.test.ts
  ✓ modules/forms/src/forms.test.ts (12 tests)
  ✓ packages/db/src/form-store.test.ts (3 tests)
pnpm test
  471 tests / 71 files
pnpm budget
  20/100 roots · 141 subcommands · 161 actions · 4 context menus, OK
```

- Parsing: derived and explicit keys, empty/duplicate/oversized field lists,
  unknown answers, missing required answers, values containing `=`, semicolon and
  newline separators.
- Flow: create → edit open → panel → submit → review list → accept; the store
  is read directly after every step, not through the command's own reply.
- Refusals: panel on a draft, submit on a closed form, duplicate pending
  submission, second decision, delete with history, wrong `confirm`, missing
  form, key collision, missing `ManageGuild`, disabled forms.
- Export: the attached JSON parses; counts are `1 / 1`; the checksum is a
  64-hex SHA-256 and matches a recomputation over the payload without it.
- PGlite: unique `(guild_id, key)`, get by key and id, guild scoping, update,
  one pending submission, review only `submitted`, re-apply after a decision,
  cascade delete.

The SQL cross-check is the raw query in `form-store.test.ts`
(`select key, state from forms where guild_id = 'guild-a'` and
`select * from form_submissions` after a cascade), not the adapter's own
`listForms()`.

## Live evidence

At pass 40 the `.env` probe found both service ports closed, so that window was
memory mode and the SQL path was PGlite-only. Pass 44 has since opened the SQL
window and applied all 14 migrations.

One bot process (`DATABASE_URL= REDIS_URL= pnpm start`), connected as
`AI Team#5758` with `"modules":10` and `"count":22` registered application
commands, then stopped with its process tree; a CIM query afterwards returned no
remaining `node.exe`. Through the MCP bridge in `#ai-chat`:

```text
> !form create name="Live application" key=live-test description="Pass 40 live proof" fields="why:Why join, tz:Timezone"
< Form `live-test` created in draft with 2 fields. Open it with `/form edit form:live-test state:open`, then post the panel with `/form panel form:live-test`.

> !form edit form=live-test state=open
< Form `live-test` updated · state open · 2 fields.

> !form panel form=live-test
< (panel posted as an embed-only message; the MCP text reader returns empty content for it)

> !form list
< 1 form in this server.

> !form submit form=live-test answers="why=One clean bot process on the real bridge; tz=UTC"
< Submission received · `31778bdb-6180-4671-afab-03d4f880a626` · 2 answers. Staff will review it; do not submit again while it is pending.

> !form review
< 1 pending submission.

> !form review submission=31778bdb-6180-4671-afab-03d4f880a626
< Submission `31778bdb-6180-4671-afab-03d4f880a626` · `live-test` · submitted · <@1493685079468146808>

> !form review submission=31778bdb-6180-4671-afab-03d4f880a626 decision=accepted note="Clean-window proof on the real bridge"
< Submission `31778bdb-6180-4671-afab-03d4f880a626` accepted by <@1493685079468146808>.

> !form review
< 0 pending submissions.

> !form delete form=live-test confirm=live-test
< Form `live-test` has 1 submission. Close it with `/form edit form:live-test state:closed` instead; history is never deleted here.

> !form export form=live-test
< Form export · 1 form · 1 submission · 1540 bytes · checksum `d1fd6d9105a54056…`
  Attachments:
    - keystone.forms.1450130465146142785.live-test.json (1.5 KB, application/json)
```

The attached file was downloaded (HTTP 200, 1540 bytes) and parsed with the same
JSON the module wrote. It named **one form** (`live-test`, `open`, fields
`why`/`tz`, panel channel `1566291983377367080`) and **one submission**
(`31778bdb-6180-4671-afab-03d4f880a626`, user `1493685079468146808`, answers
`why=One clean bot process on the real bridge`, `tz=UTC`, state `accepted`,
`reviewedBy=1493685079468146808`, note `Clean-window proof on the real bridge`)
with checksum
`d1fd6d9105a5405634d936a0482fa7875a00e8fc8bc81fe01f53eb6caa888813`, which
equals a SHA-256 recomputation over the parsed payload without its `checksum`
field. That is the cross-check: the submission id is the one `submit` printed,
the panel channel, answer set and decision in the file are the rows the commands
wrote, and the follow-up `0 pending` read shows the row left the queue while the
delete refusal shows it still exists.

The other refusal branches — duplicate pending, unknown field, closed form,
wrong `confirm`, key collision, missing `ManageGuild` and disabled forms — are
covered by the focused tests rather than claimed live.

At pass 40, `pnpm commands:doctor` read Discord and reported **18 global
chat-input commands · 125 subcommands · 2 user menus · 2 message menus**, with
the registered names
including `form`, and no drift.

## Known limitations

- **No modal input.** The MCP bridge and Discord slash both use the `answers`
  option. A real modal needs a kernel method, an adapter for modal submits and a
  UI layer; none exists here.
- The panel embed is not readable through the MCP text reader. The message was
  posted (it has a real message id) and the command test asserts its fields; the
  live text proves the command ran.
- The live window was memory mode at pass 40; pass 44 has since opened
  Postgres and Redis.
- `/export guild` (the portability bundle) does **not** include `forms` or
  `form_submissions`. The dedicated `/form export` is the truthful export; the
  guild bundle gap is open.
- The MCP bot holds `ManageGuild` in the test guild, so the member-without-
  permission refusal is test-only.
- No buttons, selects or modals; the panel is a plain message plus instructions.
- A human slash `InteractionCreate` was not observed; the bridge is message-based.

## Next

- Add a modal `InteractionLike` method and a modal-submit adapter, then have the
  panel button open a form whose fields come from `FormDefinition.fields`. Keep
  `FormService.submit` as the one write path.
- Add forms to `GuildSnapshot` / `PortabilityService` so `/export guild` includes
  them, with a restore test that preserves form ids and submission states.
- Decide whether a denied applicant should have a cooldown; the current rule
  allows immediate re-application after a decision.
- Add a per-form review channel and delivery through a narrow forms port, so a
  new submission can notify reviewers without borrowing the community adapter.
- Run the same transcript against SQL mode once Postgres is up.
