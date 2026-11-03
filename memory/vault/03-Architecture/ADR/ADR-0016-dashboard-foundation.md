# ADR-0016 — Dashboard foundation: framework-free HTTP over kernel ports

## Status

Accepted · 2026-11-01 · P6. Supersedes none. Related:
[[Dashboard-Security]], [[ADR-0006-ports-and-adapters]],
[[ADR-0015-portability-bundles-and-receipts]], [[Roadmap]].

## Context

P6 needs a dashboard and a versioned HTTP API, but the first risk is not the UI.
It is the authorization boundary: an OAuth login, an opaque server-side session,
a per-guild check on every read, and a browser that never receives a Discord
token. The roadmap named Next.js App Router as the v1 shell. Building that shell
first would add a framework, a build pipeline and a client bundle before a single
cross-guild request had been rejected.

The P5 work also created the read model the dashboard needs: portability
receipts, import counts and the guild spine. P6 should read that data through
existing repository seams, not invent a second query path.

## Decision

Ship the P6 foundation as a **framework-free Node HTTP service** in `apps/web`,
with the same ports-and-adapters shape as the bot:

- `AuthService` owns OAuth2 code + PKCE, sealed state, opaque session IDs and
  CSRF. The Discord access token is AES-256-GCM sealed before storage and never
  leaves the server; no refresh token is stored until a refresh path exists.
- `GuildAccessService` owns the two-check rule: the OAuth user must be owner or
  hold `ADMINISTRATOR` / `MANAGE_GUILD` (parsed with `BigInt`), **and** the bot
  token must confirm membership. A `:guildId` from the URL is never trusted.
- `DashboardService` composes the existing `SettingsService` with the kernel
  `DashboardStore` port. `DrizzleDashboardStore` is the only SQL for the read
  model; `InMemoryDashboardStore` is the token-free test path.
- The browser surface is server-rendered HTML with a strict CSP; the JSON surface
  is `/api/v1/me`, `/api/v1/guilds` and
  `/api/v1/guilds/:id/overview`. Both call the same authorization gate.
- `apps/web` is a workspace app, built as `dist/web.js` and optional in compose.
  A gateway-only self-host can omit it.

A richer client shell (including Next.js) remains an option for the fleet view
and later UI, and it would consume this authorization layer rather than replace
it. Pass 49 showed that schema-driven settings forms do not require one: the
server-rendered app generates them from the module schema.

## Alternatives

| Alternative | Why rejected for this pass |
| --- | --- |
| Next.js App Router now | Adds a framework and client bundle before the authz matrix is proven; the security tests are cheaper and clearer against a plain HTTP handler. |
| JWT-only session | A demoted guild admin would keep access until the token expired; a server-side opaque session is revocable immediately. |
| Store Discord tokens in the browser | One XSS becomes a seven-day account takeover. Sealed server-side storage is the contract in [[Dashboard-Security]]. |
| Trust the OAuth guild list alone | A guild id in a URL would be an IDOR; the bot-token membership check catches a guild the bot has left and a stale OAuth cache. |
| Put SQL in the web handlers | Duplicates the P5 data model and bypasses the ports; the dashboard read model belongs in `packages/db`. |
| Build settings writes first | The kill signal in the roadmap says ship read-only first if the authz matrix is not proven. This pass proves the matrix and defers writes. |

## Consequences

**Good**

- The auth boundary is testable with real HTTP and a fake OAuth port; no network,
  token, database or browser automation is required.
- The same gate covers HTML and JSON, so a new read route cannot accidentally be
  less protected than the page.
- Sessions survive a restart on Postgres, and a database leak exposes only hashes
  and sealed values.
- The web app shares the module catalog, so the dashboard cannot disagree with the
  bot about which modules or settings exist.

**Costs and limits**

- Plain HTML is intentionally minimal. Settings forms are generated from each
  module's schema (pass 49) and the fleet view applies built-in templates (pass
  50); modal editing, custom saved templates and bulk actions beyond templates
  are still open.
- No token refresh yet: a session that outlives the Discord access token needs a
  re-login. The unused refresh-token and rotation columns were removed in pass
  20 rather than storing a credential no code uses. Rotation/refresh is a P6
  follow-up.
- No per-token rate limit or public API tokens yet; `Idempotency-Key`, webhooks
  and OpenAPI remain P6.
- The live OAuth redirect has not been exercised against Discord; the tests use a
  fake OAuth port and a real local HTTP server.

## What this pass proves

- Missing state, wrong `iss` and a mismatched state are rejected before the code
  exchange.
- A user who is not an admin, a cross-guild id and a guild without the bot all
  return `403`.
- A successful login reads one real overview with guild-scoped counts, and the
  HTML/JSON contain no Discord token.
- The overview read model is guild-scoped on PGlite; a second guild's rows do not
  leak into the counts.
- The process boots in memory mode and serves `/healthz`, `/` and `/api/v1/...`
  with security headers and `no-store`.
- (pass 49) Every registered module's schema maps to widgets without exposing a
  credential-shaped key, a widget change persists through `SettingsService` and
  appends one audit row, and a rejected value re-renders at `400` without a
  write or an audit row — proved over real local HTTP and in the Postgres live
  check `web-schema-widgets`.
- (pass 50) The fleet view lists the manageable guilds; a two-guild template
  preview shows a schema-validated diff without writing, a wrong fingerprint is
  refused at `409`, and the previewed plan writes one moderation row and one
  dashboard audit row per guild — proved over real local HTTP and in the
  Postgres live check `web-fleet-templates`.

The live OAuth round trip is still the next proof. A Postgres-backed session is
exercised by the live probe, but its OAuth exchange is a fake port, not a Discord
login.

## Follow-up (pass 18)

The write path now reuses this gate. `PATCH /api/v1/guilds/:id/settings/:module`
and the HTML settings form call `SettingsService.update` with the module's own
Zod schema, after `GuildAccessService.authorize()` and the session CSRF check.
There is still no second schema, no browser-held permission cache and no direct
repository write from a handler. See [[Dashboard]].

## Follow-up (pass 49) — the carrier choice

The settings editor is now generated from the module's Zod schema and rendered
server-side in the existing `apps/web` app. This keeps the security boundary and
the form model in one process: booleans, bounded numbers, enums, text/textarea,
one-per-line arrays and a schema-validated JSON fallback are produced from the
same schema `SettingsService.update` parses. A client framework (including the
Next.js shell named in the original decision) stays a future option, not a
requirement for this surface; nothing in P6's settings slice needs a client
bundle or a second settings schema.

The write path also appends one `audit_events` row per accepted update/reset,
through `AuditStore`, with the actor, surface and dotted-path diff. Rejected and
no-op writes append nothing. The settings page renders the newest rows. See
[[Dashboard]].

## Follow-up (pass 50) — fleet view and built-in templates

`/dashboard/fleet` lists the manageable guilds and their enabled modules. A
selection can be previewed against a built-in template: the patch is deep-merged
over current settings, parsed by the module schema and diffed; nothing is
written. Apply is bound to a SHA-256 fingerprint of the displayed plan and
re-authorizes every selected guild through `authorizeMany` before calling
`SettingsService.update` per module. A stale or missing preview is refused, and
each accepted write is audited as a normal dashboard settings change. There is
no template table, no custom template editor and no JSON fleet API yet; those
remain later P6 work.
