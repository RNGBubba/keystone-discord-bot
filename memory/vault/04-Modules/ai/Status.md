# AI — status

## Now

P4 is complete in-repo as of passes 08–09 (2026-11-01). The AI module ships the
provider abstraction, exact-vector server RAG, ticket deflection, mention-only
persona chat, moderation explanations, thread summaries, hard per-guild caps and
the off-by-default kill switch. The same phase hardened the community economy;
AI behavior is unchanged. `/ai` is the only new root. At pass 09 the ledger was
10/100 and five modules were registered; it is 20/100 and 12 modules now.

Live verification on 2026-11-01: the bot logged in as **AI Team#5758**, registered
all 10 commands with Discord, and answered mentions in `#ai-chat` with
**qwen3:8b** served by Ollama. Ollama's `/api/ps` showed `qwen3:8b` loaded. The
MCP harness account is itself a bot, so the development guild allows bot authors
for one guild only; production still ignores every bot. Slash-command execution
was **not** observed: SaseQ/discord-mcp exposes channel/message tools but no
application-command invocation tool. The dev-only `!` bridge did execute real
commands through the same dispatch pipeline. The pgvector extension benchmark is
still partial.

Pass 33 added **Explain with AI**, a message context menu (type 3) that calls the
same `AiService.explain` and `replyAnswer` as `/ai explain`. It requires
`ManageMessages`, honours the `explanations` switch, the guild cap and the
zero-retention policy, and replies with the advisory banner. The menu adds no
store and no case: it is a read of the selected message plus an explanation. It
is registered in Discord (doctor reports `message:Explain with AI`); the MCP
cannot right-click, so it is covered by a command test rather than a live click.

## Verified

```text
pnpm check                            exit 0 · 636 tests / 92 files
  modules/ai/src/provider.test.ts     4 tests (incl. think:false opt-in)
  apps/bot/src/ai-events.test.ts      4 tests (bot gate + dev guild seam)
  apps/bot/src/prefix.test.ts         8 tests (parse, dispatch, guild gate)
  modules/ai/src/ai.test.ts           7 tests
  modules/ai/src/commands.test.ts     7 tests
  modules/ai/src/context.test.ts      3 tests (Explain with AI menu)
  modules/community/src/commands.test.ts 10 tests (incl. /ticket summary and stats)
  packages/db/src/ai.test.ts          2 tests
pnpm budget                           20/100 roots · 141 subcommands · 161 actions · 4 context menus, status OK
pnpm memory:check                     current (pass 33)
```

Live smoke (2026-11-01, guild 1450130465146142785, channel
1566291983377367080):

```text
AI Team#5758 ready, 2 guilds, 10 commands registered
<@AI Team> Say hello in one short sentence.
AI Team: Hello! How can I assist you today?
Ollama /api/ps: qwen3:8b loaded
```

P4 feature proofs:

| Feature | Test assertion |
| --- | --- |
| Provider abstraction | Unconfigured provider refuses; fake-fetch OpenAI-compatible provider calls `/chat/completions` and `/embeddings`, sends auth, computes rate-card cost; HTTP 429 surfaces |
| Hard dollar cap | First $0.01 call succeeds at a $0.01 cap; the next call is refused and the counting provider is not called again |
| Hard request cap | One request succeeds at `monthlyRequests: 1`; the next is refused before the provider |
| RAG | Admin doc chunks; `ask` retrieves the doc and exposes its source name; no prompt appears in usage/output keys |
| Zero retention | `ai_usage` has only `guildId`, `period`, `requests`, `inputTokens`, `outputTokens`, `costUsd`; migration has no prompt/completion columns |
| Deflection | No doc → `retrieval-only` human hand-off, zero model calls; doc → grounded answer with source |
| Mention-only chat | Service chat works; `chat: false` refuses with a feature-specific error; event ignores bots/DMs/non-mentions by construction; **live** Qwen3 reply observed through the dev MCP seam |
| Advisory classification | Service returns an advisory label/evidence with no action; `/ai classify` is guarded by `ManageMessages` and uses the same cap path |
| Mod explanations | `/ai explain` reads an existing case, returns a titled explanation and leaves the case state `open` |
| Explain with AI menu | The message menu explains the selected message, refuses when `explanations` is off, and creates no case (3 tests) |
| Thread summaries | `/ticket summary` calls the same `AiPort` and renders a summary with “A human decides any action” |
| Kill switch | `/ai status` works while disabled and reports `Retention: none`; disabling does not unregister commands |
| Isolation | Documents are guild-scoped; removing another guild's id is `false`; PGlite persists docs and usage counters |
| Postgres | Migration 0005 and `DrizzleAiStore` persist chunks and aggregate usage atomically on PGlite |
| Live mention chat | 2026-11-01: Qwen3:8b replied in `#ai-chat`; the MCP bot author is allowed only in `DEV_GUILD_ID` |
| Live status surface | `!ai status` rendered the enabled/provider/features embed in the test guild |

## P4 exit

**Green in-repo for the named P4 features.** Every provider call is preceded by
the hard budget check; prompts/completions are not stored by default; the module
can be disabled without breaking a command. The command budget is **10/100**, no
feature is paid, and no new privileged intent is required.

Not green and not claimed:

- pgvector ANN at 1M×1536 and its p95 recall/latency: the local exact-cosine
  harness ran 1M synthetic 32-dimensional vectors (p95 136.96 ms, recall 1.0).
  See [[PGVector-Fleet]]. The extension path is open.
- Hosted-vendor calls and a human-authored mention are still unobserved; the
  live chat used local Ollama and a bot author.
- Slash `InteractionCreate` handling was not exercised by the MCP. The dev `!`
  bridge did execute `!ping`, `!about`, `!ai status`, `!mod history` and
  `!rank leaderboard` through the same registry, guards and reply adapter.
- The MCP bot lacks `ManageGuild`, so the live `!ticket stats` check stopped at
  the permission guard. That exposed a real ordering bug (guild stats required a
  ticket first); the branch now runs before the ticket lookup and is unit-tested.
- The operator must set `AI_API_KEY` and `AI_BASE_URL`; no key is shipped.
- Qwen3 on Ollama needs `AI_DISABLE_THINKING=true` (or `think:false`); otherwise
  the reasoning stream can consume the whole output budget and return empty
  content.

## Proven vs still needs a live service

| Claim | Proven here? | How to close |
| --- | --- | --- |
| Provider request shape/auth/cost | Yes, fake fetch; live Qwen3:8b via Ollama | Repeat with a hosted vendor when one is authorised |
| OpenAI-compatible embedding response | Yes, fake fetch | Same |
| Cap refusal before provider | Yes, counting provider | Same against the configured provider |
| Docs and usage persistence | Yes, PGlite | Same against a Postgres server |
| Exact vector retrieval | Yes, deterministic embeddings | Measure with production embeddings and pgvector ANN |
| Mention-only event | Yes, live Qwen3 reply through the `DEV_GUILD_ID` bot allowance | Repeat with a human author in staging |
| Ticket summary seam | Command test + recorder | Live ticket thread |
| Live Discord message sends | Yes, message reply in `#ai-chat` | Slash-command replies still unobserved |
| Command registration | Yes, Discord API returned 10 commands | Run `/ping` and `/setup` through a human client |
| 1M×1536 pgvector p95/recall | No | Benchmark a Postgres+pgvector instance with production dimensions |

No document claims a live provider or Discord run for a row marked open. The
mention row is green; the ticket-summary row is not.

## Known limitations

- The reference index is exact and in-application, not pgvector ANN; it is fine
  for small server docs and is the portable test/PGlite path.
- The provider is OpenAI-compatible only; no vendor SDK or automatic fallback.
- Cost is provider-reported/rate-card based; a provider that reports zero cost
  defeats the dollar cap, though the request cap still applies. Operators should
  set both.
- The monthly period is UTC; a guild cannot reset it early.
- `temperature` is reserved and not sent by the minimal provider adapter.
- Mention chat replies once per mention; no conversation memory is retained.
- `/ai summary` and `/ticket summary` require `ManageGuild`; there is no public
  summary button yet.
- Automatic summaries on ticket close are not wired. The P4 plan does not name
  them; [[ADR-0011-economy-ledger-and-double-spend]] records the decision so the
  omission is deliberate rather than ambiguous.

## Next

- P6 dashboard/fleet: per-guild authorisation, scoped API tokens and the
  import/export/drift surfaces.
- Run `/ping`, `/setup`, `/mod history` and `/rank leaderboard` from a human
  Discord client; the MCP cannot invoke application commands. The prefix bridge
  has already exercised the same pipeline.
- Run `/ticket summary` inside a live ticket thread, and run `/ticket stats`
  from a member who holds `ManageGuild`.
- Close the pgvector ANN benchmark with a Postgres+pgvector instance.
- Keep real-provider calls out of `pnpm check`; the local Ollama smoke is manual.
