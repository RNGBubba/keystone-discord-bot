# Security policy

## Reporting

Do not open a public issue for a vulnerability. Use GitHub's private
vulnerability reporting on the repository, as [SECURITY.md](../../../SECURITY.md)
describes.

We aim to acknowledge within 72 hours and to ship a fix or mitigation within 14
days for anything that can ban, leak or escalate.

## Threat model

| Asset | Risk | Mitigation |
| --- | --- | --- |
| Bot token | Total compromise of every guild | `.env` only, rotation runbook, never logged |
| Guild config | Griefing, privilege escalation | Zod-validated writes, permission checks before every destructive call |
| Member data | Privacy, GDPR | Retention table, export/delete commands, no message storage by default |
| Dashboard sessions | IDOR across guilds | Per-request guild authorisation, never trust a client-supplied guild id |
| Webhooks | Spam, impersonation | Application-owned webhooks only, no user-supplied execute URLs |
| Dependencies | Supply chain | Lockfile, pnpm build-script allow-list, review before adding |

## Non-negotiables for code

1. **Permission pre-check before any destructive API call.** A 403 loop can get
   the IP banned within minutes (10k invalid requests / 10 min).
2. **No `eval`, no dynamic `import()` of user-supplied paths.** Custom commands
   are data, not code.
3. **No secrets in logs, errors or Discord messages.** `UserError` is the only
   error text that reaches a user.
4. **Every mutation is attributable.** `X-Audit-Log-Reason` on every moderation
   route; a case row for every action.
5. **Least privilege.** No `Administrator` in the invite URL. Intents are declared
   per module and reviewed.

## Build scripts

pnpm 12 blocks postinstall scripts by default. `pnpm-workspace.yaml` records an
explicit decision for each:

- `esbuild: true` — tsx and Vitest need the binary.
- `msgpackr-extract: false` — BullMQ's optional native accelerator. Denied on
  purpose: msgpackr has a pure-JS fallback, and refusing the build keeps a gyp
  toolchain out of every contributor machine and container.

Any addition must state: what the script does, why it cannot be avoided, and who
reviewed it.

## Dependencies

- One in, one out: a new dependency needs a justification in the PR, and a
  replacement plan if it is load-bearing.
- discord.js is quarantined behind `apps/bot/src/adapt.ts`.
- Run `pnpm audit` before each release; do not auto-merge dependency PRs that
  touch the gateway or the database.

## Dashboard (P6)

The dashboard is a bigger attack surface than the bot. Every request resolves the
session user, then checks that user's permission **in the specific guild** —
never a guild id from the request body. Personalised responses are `no-store`.
