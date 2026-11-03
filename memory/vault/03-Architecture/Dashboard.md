# Dashboard and API

> Security contract: [[Dashboard-Security]]. Decision: [[ADR-0016-dashboard-foundation]].
> The dashboard is a separate process from the gateway; it reads and writes
> guild settings through the kernel ports and never imports discord.js.

## What runs today

`apps/web` is a Node HTTP service with no UI framework. It proves the part that
matters first: **who is allowed to see or change which guild**. Pass 49 kept that
carrier deliberately: the settings form is generated from each module's Zod
schema and rendered as HTML on the server, so there is no client bundle, no
second schema and no build pipeline to keep in sync. A different UI framework
remains a later option, not a requirement for the P6 settings surface.

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz` | public | Liveness, database mode, OAuth configured or not; no secrets |
| `GET /` | public | Landing/sign-in page |
| `GET /login` | public | Starts OAuth2 code + PKCE; sets the sealed state cookie; `503` without OAuth config |
| `GET /auth/callback` | state cookie | Validates `state` and `iss`, exchanges the code, creates the session |
| `POST /logout` | session + CSRF | Deletes the server-side session and clears cookies |
| `GET /dashboard` | session | Guilds the user can manage |
| `GET /dashboard/fleet` | session | Fleet table: each manageable guild and its enabled modules |
| `POST /dashboard/fleet/preview` | session + CSRF + per-guild authz | Schema-validated template diff across selected guilds; no writes |
| `POST /dashboard/fleet/apply` | session + CSRF + per-guild authz | Apply the previewed plan; one audited settings write per module |
| `GET /dashboard/instance` | session + owner | Deployment mode, session rotation, rate budgets, owner ids |
| `POST /dashboard/instance/sessions/revoke` | session + owner + CSRF | Delete every dashboard session for a user id |
| `GET /dashboard/guilds/:id` | session + guild authz | Overview page |
| `GET /dashboard/guilds/:id/settings/:module` | session + guild authz | Schema-generated settings widgets plus the module audit trail |
| `POST /dashboard/guilds/:id/settings/:module` | session + guild authz + CSRF | Parse named widgets, save through the module schema, re-render field errors on rejection |
| `GET /dashboard/guilds/:id/config/export` | session + guild authz | Download the guild's effective module settings as a checksummed JSON file |
| `GET /dashboard/guilds/:id/config/drift` | session + guild authz | Baseline vs live settings, plus the import form |
| `POST /dashboard/guilds/:id/config/import/preview` | session + guild authz + CSRF | Validate a multipart bundle, schema-check every module and show the exact diff; no writes |
| `POST /dashboard/guilds/:id/config/import/apply` | session + guild authz + CSRF | Revalidate the previewed bundle, check its fingerprint, write through `SettingsService`, store the baseline |
| `GET /dashboard/guilds/:id/analytics` | session + guild authz | Bounded aggregates over the existing ledgers, with source row counts |
| `GET /dashboard/guilds/:id/tokens` | session + guild authz | Issue a scoped token; list name, scopes, status, last use and expiry |
| `POST /dashboard/guilds/:id/tokens` | session + guild authz + CSRF | Mint a `keystone_…` secret; shown once, only its hash stored, audited |
| `POST /dashboard/guilds/:id/tokens/:id/revoke` | session + guild authz + CSRF | Revoke one active token; a second revoke is `404` and writes no row |
| `GET /api/v1/openapi.json` | public | OpenAPI 3.1, generated from the operation table the drift test checks |
| `GET /api/v1/me` | session or bearer | The signed-in user, or the token's own identity |
| `GET /api/v1/guilds` | session or bearer | Manageable guilds, or the one guild the token is bound to |
| `GET /api/v1/guilds/:id/overview` | session or bearer + guild authz | Counts, module settings, latest import |
| `GET /api/v1/guilds/:id/analytics` | session or bearer + guild authz | Aggregates over the existing ledgers; `days=1..90` |
| `PATCH /api/v1/guilds/:id/settings/:module` | session + guild authz + CSRF, or bearer + `settings:write` | Update one module; JSON body |

Every response carries `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options`, `Cross-Origin-Opener-Policy` and a restrictive CSP.
Authenticated responses are `Cache-Control: no-store`.

## Sessions and limits

`AuthService.resolve` reads the opaque cookie on every request. On a `GET` or
`HEAD` past `rotationIntervalMs` (15 minutes in `runtime.ts`) it mints a new
session token and CSRF token, keeps the sealed Discord token and the absolute
expiry, and calls `SessionStore.rotate(oldId, next)`; the old id is gone in one
step, so a replay is a `401`. `createdAt` means the issue time of the current
credential. Rotation is never attempted on a `POST`: that request carries a CSRF
token minted against the old hash.

`POST /logout` calls `DiscordOAuth.revokeToken` first and deletes the local row
second, even if Discord is down. The browser session is the thing under our
control; remote revocation is best effort and is reported, never assumed.

`RateLimiter` is a fixed window keyed by signed-in user or socket address, in
`auth`, `dashboard`, `write`, `api` and `apiToken` classes. `server.ts` applies
it after the session is resolved and before routing; a refusal is `429` with
`Retry-After`. A request carrying an `Authorization` header is bucketed by
`token:<id>` when the secret is valid, and by socket address when it is not, so
guessing secrets cannot mint a fresh budget per attempt. `/healthz` is exempt.
There is one map because `apps/web` is one process; a multi-process deployment
would need a shared counter, which is not claimed.

## Scoped API tokens

A token is a second principal, not a second API. `request-context.ts` resolves
`Authorization: Bearer keystone_…` once into `ctx.bearerPresent` and
`ctx.apiToken`; `authorization.ts` then has one guild check for both principals:
`authorizeApiGuild` verifies that the token's guild matches the URL, that the
token carries the route's scope and that the bot is still in the guild, and
returns the same `DiscordGuild` a session gets. A token write is audited as
`token:<id>` with source `api`; a session write is audited as the user with
source `dashboard` or `api` and still needs CSRF, because a cookie can be forged
by a cross-site form and a bearer header cannot.

The secret is minted in `ApiTokenService.issue`, returned once to the creation
response and never stored. `api_tokens` (migration 0018) keeps the SHA-256 hash,
the guild, the scopes, `created_at`, `last_used_at`, `expires_at` and
`revoked_at`; a revoked row is retained so the audit trail can still name it.
`scopes` is JSONB filtered through `isApiScope` on read, so an out-of-band edit
cannot smuggle a scope the code does not know. Issue and revoke go through the
same `requireSettingsWrite` gate as a settings change and append one
`api_token.issue` / `api_token.revoke` row with `source: "dashboard"`.

`apps/web/src/openapi.ts` is the operation table; `GET /api/v1/openapi.json`
renders it. `openapi.test.ts` walks the table and the registered `/api/v1`
routes in both directions with sample paths, so a new route without an operation
fails, and it checks that every scoped operation names a real `API_SCOPES` value
and both security schemes.

`WEB_OWNER_IDS` is the only instance-wide allow-list. Guild Administrator or
Manage Server never implies it. The owner console exposes deployment mode and a
sign-out-every-session action; it is not a settings write and appends no audit
row.

## The request path

```text
browser
  │  keystone_session cookie (random opaque value)
  ▼
RateLimiter.check(class, user-or-address)   → 429 + Retry-After when spent
  ▼
AuthService.resolve(sha256(cookie), method)
  │  rotate on a safe GET past the interval
  │  WebSession { sealed Discord access token, csrf hash, expiry }
  ▼
GuildAccessService.authorize(accessToken, :guildId)
  │  1. user owner/admin/manage-guild?  (BigInt bitfield)
  │  2. bot in guild?                  (bot token)
  ▼
DashboardService.view(guild)          DashboardService.editor(guild, module)
  │  SettingsService + DashboardStore    │  schema → widget model + current values
  ▼                                     ▼
DashboardService.update(guild, module, patch, { actorId, source })
  │  SettingsService.update → Zod parse → repository.set → audit.append
  ▼
HTML or JSON; no Discord token in either

fleet: GuildAccessService.authorizeMany(token, :guildIds)
  │  one OAuth guild fetch, then permission + bot membership per guild
  ▼
DashboardService.previewTemplate(guilds, template)
  │  deep merge → module schema → diff (no writes) → fingerprint
  ▼
DashboardService.applyTemplate(guilds, template, fingerprint)
  │  recompute + fingerprint check → SettingsService.update per module → audit
  ▼
redirect to /dashboard/fleet; no parallel writer

config import: parseConfigBundle → module schemas → previewConfigImport
  │  checksum → kind/version → module set → Zod → diff (no writes) → fingerprint
  ▼
applyConfigImport(guild, bundle, fingerprint)
  │  recompute + fingerprint check → SettingsService.update per module → audit
  │  → ConfigBaselineStore.save
  ▼
redirect to /dashboard/guilds/:id/config/drift
```

Both branches use the same `GuildAccessService.authorize()` result. There is no
separate "write permission" cache and no web-only settings schema. Both settings
writes go through one `requireSettingsWrite` gate: session -> guild
authorization -> token read -> CSRF check. The API reads the token from its
header; the HTML form reads it from its body, so parsing the form is part of the
token-read callback.

The HTML form is one model, not one renderer per module:

1. `buildSettingsForm(module.settingsSchema, values)` walks the Zod schema and
   produces fields (checkbox, number, select, text, textarea, lines, literal,
   JSON fallback) and nested groups. Credential-shaped keys are never rendered.
2. `renderSettingsEditor` writes those fields with a hidden `__rendered` path
   list and the CSRF token.
3. `parseSettingsForm` reads the named fields back into a nested patch. A field
   the form rendered but left unchecked is `false`; a field it did not render is
   untouched.
4. `SettingsService.update` parses the merge against the owning schema. A Zod
   issue is mapped back to its field and the same page re-renders at `400` with
   the submitted value preserved. A successful change redirects to `?saved=1`.

`SettingsService.update` and `reset` append to `audit_events` when an
`AuditStore` is wired. The row carries the actor, the surface (`command`,
`dashboard` or `api`), the module and the dotted-path before/after diff; a
no-op or rejected write writes nothing. The settings page reads the newest rows
through `DashboardService.history` and renders them as the audit trail.

## Fleet templates

`/dashboard/fleet` lists the same manageable guilds as `/dashboard`, with the
enabled modules from `SettingsService`. It is a read-only overview; selecting
guilds leads to a preview, not a write.

`apps/web/src/templates.ts` defines three built-in templates as partial patches
per module. The preview:

1. calls `GuildAccessService.authorizeMany`, which fetches the OAuth guild list
   once and checks permission **and** bot membership for every selected guild;
2. deep-merges each patch over the guild's current settings (records merge,
   arrays replace);
3. parses the result with the module's own Zod schema and diffs with
   `diffSettings`;
4. hashes the template id, each target and each before/after leaf into a
   SHA-256 fingerprint.

The apply form carries that fingerprint with the exact guild selection. Apply
recomputes the plan, returns `400` for a missing fingerprint, `400` if the plan
has schema issues and `409` if the fingerprint does not match, then calls
`SettingsService.update` for each changed module with the dashboard actor. A
stale preview is therefore refused rather than applied, and a direct bulk POST
without a preview cannot reach the writer. Each accepted module write appends
one dashboard audit row. Built-in templates are code, not rows, and there is no
second schema. Named saved templates are the next section.

The preview uses `labelFor` from the schema form, so labels match the per-guild
editor. Templates never contain channel or role ids; destinations remain
guild-specific.

## Saved templates

A saved template is a named snapshot of one guild's effective module settings,
not a second settings store. `config_templates` (migration 0016) holds the guild
id, name, description, `{ id, version, settings }[]` snapshot, creator and
timestamps; `(guild_id, lower(name))` is unique. `packages/kernel/src/saved-templates.ts`
ows the `SavedTemplateStore` port and the in-memory adapter;
`packages/db/src/config-template-store.ts` owns the SQL adapter and maps a
Postgres `23505` to the same typed name error. A saved template belongs to its
guild; there is no marketplace.

Save reads every module through `SettingsService.get`, strips
credential-shaped keys with the same filter the export uses, parses each value
with that module's own schema and only then inserts. A snapshot can therefore
never be born invalid. Create, update and delete each append one `template.*`
audit row with the dashboard actor; applying the template is audited as ordinary
`settings.update` rows, one per written module.

Edit changes the name or description and can refresh the snapshot from live
settings through the same schema gate. Every accepted edit moves `updatedAt`
forward, so a preview shown before the edit is stale. The stored row is
re-validated on read and on apply: if a schema changed, or an operator edited
the JSON outside the dashboard, the page lists every bad path, the preview
returns template-level issues and no guild targets, and apply refuses at `400`.

Apply reuses the built-in path exactly: each target guild is re-authorized, the
snapshot is diffed with `diffSettings`, the fingerprint seed includes the
template id and `updatedAt`, and a stale or tampered fingerprint is refused at
`409`. The shared `applyPlan` loop calls `SettingsService.update` per changed
module. There is no second writer.

## Config export, import and drift

This is a settings document, not the full P5 guild bundle. It deliberately
cannot create or delete cases, members, levels or transcripts.

`apps/web/src/config-bundle.ts` owns the format: `keystone.config` version 1,
source guild, export time, one `{ id, version, settings }` entry per registered
module and a SHA-256 checksum over canonical JSON. Export reads effective
settings through `SettingsService` and strips credential-shaped keys before
hashing; the file is safe to paste somewhere but cannot restore a token.

Import parses and verifies in order: object shape, kind/version, every registered
module present exactly once, no unknown modules, checksum, then each module's own
Zod schema. A structural or checksum failure is one footer issue; a schema
failure names the module-qualified path. The browser may send a real multipart
file or the URL-encoded hidden copy the apply form carries. `parseConfigUpload`
reads the CSRF field from the same body, so the normal session -> guild
authorization -> CSRF order is preserved before any setting is read.

Preview compares the parsed bundle with live settings using the same
`diffSettings` helper as the audit row and the template preview; it writes
nothing. `settings-plan.ts` owns the one plan fingerprint: source seed (template
id or bundle checksum), each module target and each sorted before/after leaf.
Apply recomputes the plan, refuses schema issues at `400`, refuses a missing or
stale fingerprint at `409`, then calls `SettingsService.update` per changed
module. Each accepted write appends one dashboard audit row; there is no second
writer.

Migration 0015 adds `config_baselines`, one row per guild, holding the applied
bundle, checksum and timestamps. The `ConfigBaselineStore` port has an in-memory
adapter and a Drizzle adapter. Applying a bundle stores it even when the diff is
empty; a refused preview stores nothing. Drift compares baseline -> live and
shows exactly the changed leaves. A guild with no baseline is named as such; a
stored row that no longer parses reports its checksum and an error rather than
pretending every setting diverged. A full portability restore or deletion clears
the baseline too.

The guild list is fetched from Discord on each request, so a demotion or removal
takes effect immediately. There is no browser-held permission cache. A
sub-resource in a later write route must be checked against the authorized guild
as well; the URL id alone is never enough.

## Webhooks and `Idempotency-Key`

A guild can subscribe an https endpoint (plain `http:` only on loopback, so a
local receiver can be tested) to `settings.updated`, `api_token.issued` and
`api_token.revoked`. The server mints a `whsec_…` signing secret, seals it with
the same `SecretBox` as the session and Discord tokens, and shows the plaintext
once. The database only ever holds the sealed value.

Delivery is an outbox, not a fire-and-forget `fetch`. `WebhookService.enqueue`
writes one `webhook_deliveries` row per matching subscription before the network
is touched. `startWebhookDrainer` picks due rows (`status = 'pending'` and
`next_attempt_at <= now`, the exact shape of
`webhook_deliveries_due_idx`), signs the body and posts it with
`t=<unix>,v1=HMAC-SHA256(<t>.<body>)` in `x-keystone-signature`, plus
`x-keystone-event` and `x-keystone-delivery`. A receiver recomputes the HMAC in
constant time and refuses a timestamp outside its tolerance, so a captured body
cannot be replayed later. A failed attempt is scheduled at
`250ms * 2^(attempt-1)`; the third failure is terminal and keeps the last status
and error, which is what the receipt table on the page shows. Deleting a
subscription cascades its receipts.

The drainer lives in `apps/web` because that process already owns the sealing
key; the Discord worker has no web dependencies and no reason to hold it. The
rows are durable, so moving the drainer into the worker later would not change
the `WebhookStore` contract.

`Idempotency-Key` is the second use of `job_receipts`. A token write namespaces
the key by principal (`http:<actor>:<key>`) and fingerprints `METHOD path\nbody`,
so two clients cannot collide. A completed receipt with the same fingerprint
replays the stored status and body with `Idempotent-Replayed: true`; the same key
with a different body is `409 idempotency_conflict`; a failed write releases the
claim so a corrected retry can run. The response body is stored as text, not
jsonb, because jsonb normalises key order and a replay must be byte-identical.

## Where the code lives

| File | Owns |
| --- | --- |
| `apps/web/src/crypto.ts` | AES-256-GCM sealing, session/CSRF hashing, state expiry |
| `apps/web/src/oauth.ts` | The only Discord URL/HTTP adapter; a port for tests |
| `apps/web/src/auth.ts` | OAuth completion, opaque sessions, CSRF |
| `apps/web/src/access.ts` | BigInt permissions and the bot-membership check |
| `apps/web/src/settings-form.ts` | Zod-to-widget model, named-field parser, field-level validation error |
| `apps/web/src/settings-plan.ts` | Shared plan types and the canonical SHA-256 fingerprint |
| `apps/web/src/config-bundle.ts` | Config file format, checksum, strict parse and schema validation |
| `apps/web/src/templates.ts` | Built-in template patches and deep merge |
| `apps/web/src/overview.ts` | View composition, saved-template lifecycle, editor/history, settings update and schema-error mapping; filters credential-shaped settings |
| `apps/web/src/server.ts` | Error boundary, request context, route dispatch and the final method/404 fallback |
| `apps/web/src/routes/index.ts` | Ordered route table, the shared guild/module patterns and matching |
| `apps/web/src/routes/auth.ts` | Health, login, callback, logout and landing handlers |
| `apps/web/src/routes/dashboard.ts` | Guild list, fleet preview/apply, saved-template CRUD/preview/apply, config export/import/drift, overview and settings editor/form handlers |
| `apps/web/src/routes/api.ts` | `/api/v1` reads, settings `PATCH`, OpenAPI and the API 404 |
| `apps/web/src/routes/tokens.ts` | Token page, issue and revoke through the guild write gate |
| `apps/web/src/api-tokens.ts` | Secret minting, hashing, scope rules, bearer resolution and revocation |
| `apps/web/src/openapi.ts` | The operation table and the OpenAPI 3.1 renderer |
| `apps/web/src/request-context.ts` | Web dependencies, cookie parsing, one session and one bearer lookup per request |
| `apps/web/src/authorization.ts` | Session/bearer principal, guild authorization and the one settings-write/CSRF gate |
| `apps/web/src/http.ts` | Response helpers, security headers, body parsing and JSON/form settings parsing |
| `apps/web/src/render.ts` | Layout, escaping, the fleet/preview pages and every HTML renderer |
| `apps/web/src/runtime.ts` | Composition root: Postgres or memory, OAuth or degraded |
| `packages/kernel/src/web.ts` | `SessionStore`, `DashboardStore`, `WebSession` |
| `packages/kernel/src/audit.ts` | `AuditStore`, in-memory adapter and the settings diff |
| `packages/kernel/src/baselines.ts` | `ConfigBaselineStore` and its in-memory adapter |
| `packages/kernel/src/saved-templates.ts` | `SavedTemplateStore`, in-memory adapter and name-taken error |
| `packages/kernel/src/api-tokens.ts` | `ApiTokenStore`, scopes, active rules and in-memory adapter |
| `packages/kernel/src/settings.ts` | Schema validation, optional clear, audit append |
| `packages/db/src/web-session-store.ts` | Drizzle session adapter |
| `packages/db/src/web-dashboard-store.ts` | Guild-scoped aggregate read model |
| `packages/db/src/audit-store.ts` | Drizzle `audit_events` adapter |
| `packages/db/src/config-baseline-store.ts` | Drizzle `config_baselines` adapter |
| `packages/db/src/config-template-store.ts` | Drizzle `config_templates` adapter |
| `packages/db/src/api-token-store.ts` | Drizzle `api_tokens` adapter |
| `packages/module-catalog` | The one module list shared with the bot |

The kernel owns the contracts; `packages/db` owns SQL; `apps/web` owns HTTP and
rendering. That is why the tests can run without a Discord token, a Postgres
server or a browser.

## How to add a read route

1. Decide which port it needs. Prefer an existing store; add a method to
   `DashboardStore` rather than SQL in a route handler.
2. Add the handler under `apps/web/src/routes/` and register its pattern in
   `routes/index.ts`. Use `requireSession()` for a personal read and
   `authorizeGuild()` for anything guild-scoped before reading data.
3. Compose the response in `DashboardService` or a sibling service; keep
   `routes/` to request decisions and `render.ts` to escaping and HTML.
4. Escape every Discord-supplied string in HTML. Never interpolate raw JSON into
   a `<script>` tag.
5. Add a test in `apps/web/src/web.test.ts` that proves a cross-guild request is
   `403` and that the body contains no sealed token.
6. Add the route to this table and to the README feature list; update the pass
   journal and feature status.

## How to add a write route

1. Authorize first: call `requireSettingsWrite()` from
   `apps/web/src/authorization.ts`. It performs session -> guild authorization ->
   token read -> CSRF in that order, before any mutation. A non-admin must not
   be able to probe validation behaviour.
2. Let the gate read the token from the surface: `csrfHeader(ctx.req)` for JSON,
   or parse the form in the callback and return its hidden `csrf` field. Do not
   duplicate the session/access/CSRF sequence in a handler.
3. Validate through the module's existing schema via `SettingsService.update`.
   Do not add a second schema, a web-only whitelist or a direct repository write.
4. Keep the write guild-scoped: call `SettingsService.update(guild.id, ...)` with
   the guild returned by `authorize()`, never a guild id read from the body.
5. Return a safe view: `DashboardService` filters credential-shaped setting keys
   before returning HTML or JSON.
6. Test all four refusals in `apps/web/src/web.test.ts`: cross-guild, non-admin,
   bot absent and bad/missing CSRF, plus validation failure with no mutation.

## Deliberately not done yet

- Bulk actions beyond the built-in and saved templates.
- Idle timeout and a Discord refresh-token path. Rotation re-keys the opaque
  session cookie; it does not extend the Discord grant. No refresh token is
  stored until refresh and single-flight exist, so the session re-authenticates
  when its access token expires.
- Live OAuth against Discord and live Discord token revocation. The local probe
  drives a real Postgres session and asserts revocation at the port, but it fakes
  the OAuth code exchange, so neither is claimed.
- Webhook SSRF hardening. A subscription URL must be https (loopback http is
  allowed so a local receiver can be tested), but private and link-local address
  ranges are not blocked. Creating one requires Manage Guild, so the gate is the
  current control; an allowlist or DNS resolution check is the next step, not a
  claim that this is done.

The kill signal in [[Roadmap]] says read-only first if the authorization matrix
cannot pass. That step is done; settings writes now reuse the same gate. This is
still not the full P6 exit demo.
