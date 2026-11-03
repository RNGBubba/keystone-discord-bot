# Forms — spec

Application forms with a persisted submission, a review queue and a checksummed
export. `/form` is the tenth module and the first new root after the saved plan
was completed.

## Purpose

Forms are how a server asks for something it needs: staff applications, event
pitches, partnership requests. A panel that only prints instructions is not a
form; the value is that an answer becomes a row a reviewer can find, decide on
and export. This module keeps that whole chain in one owned store.

The panel uses the P7 component layer (pass 58). `/form panel` posts a
Components V2 container whose **Apply** button opens a modal built from the
form's fields, and the modal submit calls the same `FormService.submit` as the
command. A form with more than five questions keeps the validated `answers`
option because a Discord modal holds five inputs. Both input paths share the
same parser, the same one-pending rule and the same store.

## Commands

One root, eight subcommands. The root is guild-only with a three-second
per-user cooldown. `create`, `edit`, `delete`, `list`, `panel`, `review` and
`export` check `ManageGuild` (or `Administrator`) before reading or writing;
`submit` is open to any member.

| Command | Options | Behaviour | Real? |
| --- | --- | --- | --- |
| `/form create` | `name`, `key?`, `description?`, `fields` | Creates a `draft` form with validated fields | Yes — `forms` row |
| `/form edit` | `form`, `name?`, `description?`, `fields?`, `state?` | Reads one form, or updates the supplied fields | Yes — `forms` row |
| `/form delete` | `form`, `confirm` | Deletes only a form with **zero** submissions; `confirm` must equal the key | Yes — `forms` row |
| `/form list` | — | Forms with state, submission count and panel channel | Yes — query |
| `/form panel` | `form` | Requires `open`; posts the public panel in the current channel and records that channel | Yes — message + row |
| `/form submit` | `form`, `answers` | Validates every required field, enforces one pending submission per member, writes the answer set | Yes — `form_submissions` row |
| `/form review` | `submission?`, `decision?`, `note?` | Lists pending rows, reads one, or transitions `submitted → accepted/denied` | Yes — row update |
| `/form export` | `form?` | Attaches a `keystone.forms` JSON file with counts and a SHA-256 checksum | Yes — rows |

`fields` is a comma-separated list of `key:Label` pairs; a bare label derives its
key (`Why join` → `why-join`). Every field is required and capped at
`maxAnswerLength`. `answers` is `key=value` separated by `;` or newlines.

## State machine

A form starts `draft`, accepts submissions only while `open`, and a `closed`
form keeps its history. Deletion is not a state: it is allowed only before the
first submission, so a review trail cannot be erased by a typo.

```text
draft ──edit state:open──▶ open ──edit state:closed──▶ closed
  │                          │                            │
  └──────── edit state:* ────┴────────────────────────────┘
                             │
                        submission
                             ▼
              submitted ──review accept──▶ accepted
                  │
                  └──review deny──▶ denied
```

- One **pending** (`submitted`) submission per member per form is a database
  invariant: a partial unique index in migration 0011, mirrored by the
  in-memory store. A decided applicant may apply again.
- Only a `submitted` row can transition. A second reviewer gets an explicit
  "already accepted/denied" refusal and nothing is written.
- `delete` refuses when `countSubmissions > 0`, naming the count and pointing at
  `state:closed`. The SQL foreign key still cascades, but the service never
  reaches it with history present.

## Settings

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Blocks `create` and `submit`; reads and review still work |
| `maxForms` | integer 1–50 | `25` | Per-guild form cap, checked before the insert |
| `maxFields` | integer 1–15 | `10` | Field cap per form |
| `maxSubmissionsPerForm` | integer 1–10,000 | `500` | Submission cap, checked before the insert |
| `maxAnswerLength` | integer 50–1,000 | `500` | Copied onto each field at creation, so a later reduction cannot truncate accepted answers |

Settings use the same `SettingsService` and Zod schema as every module, so
`/config get module=forms` and the dashboard editor work without a forms-specific
path.

## Storage

Two tables in migration `0011_forms`:

```text
forms:
  id uuid, guild_id text, key text, name text, description text,
  fields jsonb, state text, panel_channel_id text?, created_by text,
  created_at, updated_at
  UNIQUE (guild_id, key)

form_submissions:
  id uuid, guild_id text, form_id uuid → forms(id) ON DELETE CASCADE,
  user_id text, answers jsonb, state text, reviewed_by text?,
  decision_note text?, created_at, updated_at
  UNIQUE (form_id, user_id) WHERE state = 'submitted'
```

Why two tables rather than `community_records`: a submission is mutable state
with a review transition and a per-member uniqueness rule. Keeping it in the
generic record table would make the forms module borrow the community module's
store, and could not enforce "one pending submission" in the database. Forms are
rows rather than settings because every submission references a stable id and
a settings write must not be able to rewrite history.

The `(guild_id, key)` unique index is what makes `form:staff` unambiguous. The
store returns a typed `duplicate-key` result instead of leaking a Postgres error.

## Where the code lives

- `packages/kernel/src/forms.ts` — form/submission types, `FormStore`, typed
  create/submit results and the patch shape.
- `modules/forms/src/forms.ts` — field/answer parsing and `FormService`, the one
  owner of transitions, caps and enabled policy.
- `modules/forms/src/store.ts` — in-memory store with the same invariants.
- `modules/forms/src/commands/form.ts` — guards, permissions and rendering.
- `modules/forms/src/settings.ts` — the Zod schema.
- `packages/db/src/form-store.ts` — Drizzle adapter.
- `packages/db/src/migrations/0011-forms.ts` — the two tables and the partial
  unique index.

## Non-goals

- Modal input. It needs the UI layer; the validated `answers` option is the
  shipped input path.
- Editing a form key. It is the stable reference in panels and exports; create a
  new form instead.
- Deleting review history. Close the form and export it.
- Adding form rows to the `/export` guild bundle. The bundle is generated from
  `PortabilityService`, which does not yet know these tables; `/form export` is
  the dedicated file, and the gap is stated in [[04-Modules/forms/Status|Status]].
- Per-field types other than text. A number or attachment field needs a renderer
  and a validation rule that does not exist yet.
- Cross-guild forms.

## Limits respected

- One new global root; the ledger became 18/100 at this pass (now 20/100) and eight subcommands cost no
  extra slot.
- No new dependency, paid service or gateway intent (`Guilds` only).
- One migration for the two tables, justified by the review transition and the
  pending-submission invariant.
- No second settings store and no second command tree.

## Verified by

`modules/forms/src/forms.test.ts` (12 tests: parsing, the full
create → open → panel → submit → review flow, duplicate pending, closed/draft
refusals, delete rules, permission routing, disabled policy, export checksum and
the form cap) and `packages/db/src/form-store.test.ts` (3 PGlite tests: unique
key, pending uniqueness, review transition, cascade and guild scoping). The live
transcript is in [[04-Modules/forms/Status|Status]].
