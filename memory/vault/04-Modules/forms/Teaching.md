# Forms — teaching notes

## Read in this order

1. `packages/kernel/src/forms.ts` — the form, field, submission and store types.
   Notice the typed `FormCreateResult` and `FormSubmitResult`: the store returns
   a reason, not a thrown driver error.
2. `modules/forms/src/settings.ts` — the caps and the enabled switch.
3. `modules/forms/src/forms.ts` — `parseFieldSpec`, `parseAnswers` and
   `FormService`. This is the policy: what is required, when a state may change,
   and which caps need the settings.
4. `modules/forms/src/store.ts` — the same invariants in memory: unique key and
   one pending submission per member.
5. `packages/db/src/form-store.ts` — the Drizzle adapter. The partial unique
   index, not the application check, is the real guard for pending submissions.
6. `packages/db/src/migrations/0011-forms.ts` — the two tables and the partial
   index.
7. `modules/forms/src/commands/form.ts` — permission routing and rendering.
8. `modules/forms/src/forms.test.ts` — the flow the product promises.

## The idea to take away

**A review queue is a state machine, not a list of text.**

The tempting shortcut is a panel that posts an embed and a `review` command that
prints whatever a member typed into a command option. That looks like a form and
loses the two things a reviewer needs: a stable id for one submission and a rule
that prevents two reviewers from deciding it twice.

The structure that works is small:

- `forms` holds configuration. The key is unique per guild, so `form:staff` is
  never ambiguous.
- `form_submissions` holds one member's answers and a state. A partial unique
  index enforces "one pending submission per member per form".
- `FormService` owns the transition. `review` uses a conditional update
  (`WHERE state = 'submitted'`) and returns `undefined` when another reviewer
  won; the command turns that into "already decided".
- Deleting a form is refused once history exists. The database cascade is a
  backstop, not the product rule.

The second idea is **the panel is a rendering of a row**. `/form panel` reads the
form, refuses unless it is `open`, posts the fields it finds and then records the
channel. If the form changes, the next panel reflects it; there is no second copy
of the questions in a settings string.

The third idea is **parse before you persist**. `parseAnswers` rejects unknown
keys, missing required fields and oversized values before the store is called.
A form that silently stores `{ nope: "hello" }` is worse than one that refuses:
the review queue would show an application with no answers and no error.

## An exercise

Add a **draft autosave** for a member who cannot finish in one command.

1. Add a `draft` submission state and a `saveDraft` method to `FormStore`. Do not
   reuse `submitted`: the review queue must not see a draft.
2. Decide the uniqueness rule. A partial unique index on `state IN ('draft',
   'submitted')` would block a second draft, which is probably right; explain the
   choice in the migration comment.
3. Make `submit` transition an existing draft instead of inserting a second row,
   inside one transaction.
4. Extend `forms.test.ts` with "save draft → review list is empty → submit →
   review list has one" and run `pnpm vitest run modules/forms packages/db/src/form-store.test.ts`.

If your draft appears in `/form review`, the state model is wrong; stop and fix
the query before adding the command.

## The mistakes you will probably make

- **Putting the form definition in settings.** A settings write replaces a value;
  submissions reference a stable id. Two sources of truth for the questions is
  how an application ends up with an answer that no longer maps to a field.
- **Trusting a pre-check for uniqueness.** `countSubmissions` followed by an
  insert is a race. The database index is the guard; the pre-check exists only
  to choose a nicer refusal.
- **Editing the form key.** Panels, exports and members' memories use it. Create
  a new form instead; the old one can be closed.
- **Deleting a form to "clean up".** A deletion that cascades submissions
  destroys the audit trail a review queue exists to keep. The service refuses
  while history exists.
- **Letting a member call `review`.** The root guard cannot vary by subcommand,
  so the command checks `ManageGuild` (or `Administrator`) inside the management
  branches. Guard the branch, not only the root.
- **Echoing answers in the submit reply.** The reply is ephemeral for a slash
  command but a prefix bridge posts ordinary messages. Return the submission id
  and the count, not the answers.
- **Claiming a modal without a live submit.** The pass-58 layer opens a real
  modal and validates it, but the MCP bot cannot press Apply; say the probe
  drove the adapter in [[04-Modules/forms/Status|Status]] instead of implying a
  human click.
- **Forgetting the guild in the store call.** Every read and write is
  `(guildId, …)`. The PGlite test asserts guild B cannot see guild A's form or
  submissions.

## Stretch

Add a **decision note requirement** for denials: when `decision=denied`, require
`note`. Keep it in `FormService.review`, not in the command, so a future modal or
API cannot bypass it. Then add a test that `denied` without a note writes
nothing and leaves the row `submitted`. Finally, export the form, change the
note, and prove the export reflects the new row rather than a cached copy.
