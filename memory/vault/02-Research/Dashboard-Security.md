# Dashboard security — the P6 contract

> The dashboard is a security product with a UI attached. This page records the
> OAuth2, session and authorization decisions that P6 must prove. Claims live in
> [[Claims]].

## OAuth2: the production flow

1. **Authorization code + PKCE.** Discord recommends this for production; the
   implicit grant puts the token in the URL fragment and issues no refresh token.
2. **`state` is per-attempt and bound to the pre-login session.** Discord says it
   is optional but highly recommended. A state in `localStorage` is XSS-readable.
3. **Validate `iss`.** Discord adds `iss=https://discord.com` to the redirect
   (RFC 9207); validate it before exchanging the code, especially if another IdP
   is ever added.
4. **Exact redirect URIs.** No wildcard subdomains; reject a callback whose
   `redirect_uri` differs from the authorize request.
5. **Scopes:** `identify guilds` only. Add `guilds.members.read` only if the
   dashboard needs the user's member object; add `email` only if truly needed.

## Sessions and tokens

- **Postgres-backed opaque session IDs**, not a JWT-only session. A guild admin
  can be demoted in Discord at any moment; the session must be revocable now.
- **The Discord access token stays server-side, encrypted at rest.** The browser
  never receives a Discord token. An XSS bug must not become a seven-day account
  takeover. The current foundation stores no refresh token because it has no
  refresh path; do not store one until rotation and single-flight exist.
- **Rotation is implemented (pass 54).** On a safe `GET` past 15 minutes the
  opaque cookie and CSRF token are re-keyed in one `SessionStore.rotate`; the
  old value is a `401`. `createdAt` is the issue time of the current credential
  and `expiresAt` is the absolute end, so no rotation column was added. A `POST`
  never rotates: it carries a CSRF token minted against the old hash.
- **Logout revokes, then deletes (pass 54).** `DiscordOAuth.revokeToken` posts to
  Discord's revoke endpoint; the local row is deleted even when Discord fails.
  A remote revocation is best effort and is never claimed without a real token.
- **Idle timeout and a refresh-token path remain open.** No refresh token is
  stored until refresh exists with a per-session single-flight lock; storing one
  earlier would be an unused credential.

## Per-guild authorization: two checks, not one

```
requireGuildAccess(guildId, requiredPerms):
  1. user may manage this guild?
     owner === true || (BigInt(permissions) & (ADMINISTRATOR | MANAGE_GUILD)) !== 0
  2. bot is actually in the guild?
     from the bot token, not the OAuth token
```

- Parse permission bitfields as **BigInt**. `MODERATE_MEMBERS` is bit 40 and
  `SEND_POLLS` is bit 49; `Number` is not safe.
- Never trust `:guildId` in a URL. Re-authorize on every read and every write.
- A sub-resource (`channelId`, `roleId`) must belong to the authorized guild;
  otherwise a user can pass their own guild id with a victim's channel id.
- `MANAGE_GUILD` in one guild is not instance admin. Instance-wide actions need
  the `WEB_OWNER_IDS` allow-list; `requireOwner` is separate from
  `authorizeGuild` and checks the session user id only.
- Never return `DISCORD_TOKEN`, `CLIENT_SECRET`, `JWT_SECRET` or env from any
  dashboard route, even to an admin. A `GET /api/config` is a credential leak
  waiting for a CVE.

## The failure modes that matter

| Failure | Test that catches it |
| --- | --- |
| IDOR on `PATCH /api/guilds/:id/settings` | User A cannot read/write guild B |
| Sub-resource IDOR | Channel id from guild B rejected under guild A |
| Login CSRF | Missing/mismatched `state` rejected |
| Issuer mix-up | Wrong `iss` rejected before exchange |
| Token in browser | Response/CSP test asserts no Discord token |
| Stored XSS | Discord display names rendered as text, CSP present |
| Stale permission cache | Demotion re-check on write |
| Session replay | A pre-rotation cookie is `401`; rotation is one atomic re-key |
| Abuse of an authenticated read | Per-class fixed window returns `429` with `Retry-After` |
| Guild admin reaching instance scope | `requireOwner` refuses a manage-guild user at `403` |
| Replay | `Idempotency-Key` returns the stored response, 409 in flight |

## API tokens and idempotency

- Issue **our own opaque tokens** (`keystone_` + 32 bytes), store only a SHA-256
  hash, attach guild scope, scopes, creator, last-used, expiry and revocation.
- Scopes are a ceiling, never a substitute for the guild check.
- `Idempotency-Key` on writes: first request processes; a completed duplicate
  returns the stored response; a concurrent duplicate is `409`; a reused key with
  a different payload is `422`; a missing key on a required route is `400`.
- Composite cache key includes the token/tenant id, so one client cannot read
  another's cached response.
- Version the path (`/api/v1`), send a `User-Agent`, and rate-limit per token.
  Do not let Discord's 429s propagate raw; queue the fan-out and return a clear
  `Retry-After`.

## Stack decision

One **Next.js App Router** process for the dashboard and the versioned API in
v1.0. It is the largest contributor pool, keeps self-host to one web container,
and lets server components fetch data without ever putting a Discord token in the
browser. A separate API service is deferred until a second consumer demands it.
The trade-off and rejected SvelteKit alternative belong in the P6 ADR.

## What P6 must prove before it is called done

- Authz matrix, including sub-resources.
- CSRF, `state`, `iss` and redirect-URI tests.
- Session rotation and revocation. Rotation and local deletion are proven over
  real HTTP; Discord revocation is asserted at the OAuth port, not against a
  live token.
- Per-class rate limits, including anonymous auth attempts and the health
  exemption.
- `owners[]` refusal for a guild admin and success for an owner.
- CSP and no-token-in-browser assertions.
- OpenAPI diff and idempotency replay.
- A staging OAuth smoke, marked separately from fixture tests.
