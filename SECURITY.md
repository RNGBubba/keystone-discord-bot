# Security policy

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.** Use GitHub's private
vulnerability reporting on
[RNGBubba/keystone-discord-bot](https://github.com/RNGBubba/keystone-discord-bot/security/advisories/new).
If that is unavailable, contact the maintainer privately through GitHub.

We aim to acknowledge within 72 hours and to ship a fix or mitigation within 14
days for anything that can ban, leak or escalate. Please include the affected
version or commit, a reproduction, and the impact you believe it has.

## Supported versions

Keystone is pre-1.0. Security fixes land on `main`; there are no maintained
release branches yet. A self-hoster should track `main` and re-run
`pnpm db:migrate` after pulling.

## Scope

In scope: the bot, the dashboard/API, the kernel and adapters, the migration
runner, the command registration path and the dependency/build chain.

Out of scope: a self-hoster's modified fork, a compromised Discord account, and
denial of service caused only by a guild operator installing every feature at
once without the documented caps.

## Threat model

The full table is in
[memory/vault/07-OpenSource/Security.md](memory/vault/07-OpenSource/Security.md).
The assets that matter most:

| Asset | Risk | Mitigation |
| --- | --- | --- |
| Bot token | Total compromise of every guild | `.env` only, rotation runbook, never logged |
| Guild settings | Griefing, privilege escalation | Zod-validated writes, permission checks before destructive calls |
| Member data | Privacy, GDPR | Retention table, export/delete commands, no message storage by default |
| Dashboard sessions | IDOR across guilds | Per-request guild authorisation, never trust a client-supplied guild id |
| Dependencies | Supply chain | Lockfile, pnpm build-script allow-list, review before adding |

## Non-negotiables for code

1. **Permission pre-check before any destructive API call.** A 403 loop can get
   the application rate-limited or banned.
2. **No `eval`, no dynamic import of user-supplied paths.** Custom commands are
   data, not code.
3. **No secrets in logs, errors or Discord messages.** `UserError` is the only
   error text that reaches a user.
4. **Every mutation is attributable.** An audit-log reason and a case row where
   the domain requires one.
5. **Least privilege.** No `Administrator` in the invite URL. Intents are
   declared per module and reviewed.

## Build scripts and dependencies

pnpm 12 blocks postinstall scripts by default. `pnpm-workspace.yaml` records an
explicit decision for each allowed script; any addition must state what it does,
why it cannot be avoided, and who reviewed it.

A new dependency needs a justification and a replacement plan if it is
load-bearing. `discord.js` stays quarantined behind `apps/bot/src/adapt.ts`.
Run `pnpm audit` before a release; do not auto-merge dependency updates that
touch the gateway or the database.

## Dashboard

The dashboard is a larger attack surface than the bot. Every request resolves
the session user, then checks that user's permission **in the specific guild** —
never a guild id from the request body. Personalised responses are `no-store`.
