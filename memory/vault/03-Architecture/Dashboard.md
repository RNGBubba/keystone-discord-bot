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
| `GET /api/v1/me` | session | The signed-in user; never a token |
| `GET /api/v1/guilds` | session | Manageable guilds only |
| `GET /api/v1/guilds/:id/overview` | session + guild authz | Counts, module settings, latest import |
| `PATCH /api/v1/guilds/:id/settings/:module` | session + guild authz + CSRF | Update one module; JSON body |

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
`auth`, `dashboard`, `write` and `api` classes. `server.ts` applies it after the
session is resolved and before routing; a refusal is `429` with `Retry-After`.
`/healthz` is exempt. There is one map because `apps/web` is one process; a
multi-process deployment would need a shared counter, which is not claimed.

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
| `apps/web/src/routes/api.ts` | `/api/v1` reads, settings `PATCH` and the API 404 |
| `apps/web/src/request-context.ts` | Web dependencies, cookie parsing and the one session lookup per request |
| `apps/web/src/authorization.ts` | Session check, guild authorization and the one settings-write/CSRF gate |
| `apps/web/src/http.ts` | Response helpers, security headers, body parsing and JSON/form settings parsing |
| `apps/web/src/render.ts` | Layout, escaping, the fleet/preview pages and every HTML renderer |
| `apps/web/src/runtime.ts` | Composition root: Postgres or memory, OAuth or degraded |
| `packages/kernel/src/web.ts` | `SessionStore`, `DashboardStore`, `WebSession` |
| `packages/kernel/src/audit.ts` | `AuditStore`, in-memory adapter and the settings diff |
| `packages/kernel/src/baselines.ts` | `ConfigBaselineStore` and its in-memory adapter |
| `packages/kernel/src/saved-templates.ts` | `SavedTemplateStore`, in-memory adapter and name-taken error |
| `packages/kernel/src/settings.ts` | Schema validation, optional clear, audit append |
| `packages/db/src/web-session-store.ts` | Drizzle session adapter |
| `packages/db/src/web-dashboard-store.ts` | Guild-scoped aggregate read model |
| `packages/db/src/audit-store.ts` | Drizzle `audit_events` adapter |
| `packages/db/src/config-baseline-store.ts` | Drizzle `config_baselines` adapter |
| `packages/db/src/config-template-store.ts` | Drizzle `config_templates` adapter |
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
- Public API tokens (`keystone_…`), scopes, per-token rate limits,
  `Idempotency-Key`, webhooks and an OpenAPI document.
- Live OAuth against Discord and live Discord token revocation. The local probe
  drives a real Postgres session and asserts revocation at the port, but it fakes
  the OAuth code exchange, so neither is claimed.

The kill signal in [[Roadmap]] says read-only first if the authorization matrix
cannot pass. That step is done; settings writes now reuse the same gate. This is
still not the full P6 exit demo.
