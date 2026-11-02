# Lesson 14 — the self-host quickstart

## The problem

A README quickstart is a promise. If it says `docker compose up -d postgres
redis` and the volume is empty, a stranger should get a working bot. If it says
“run the tests” and the tests need a token, the reader stops trusting the page.

The repository has three run modes, and confusing them is the usual failure:

1. memory mode: no Postgres, no Redis, no token in tests;
2. local compose: Postgres and Redis with `pnpm dev`;
3. all-in-one Docker: migrations, bot, worker and the optional web process.

## The naive version

```bash
npm start
```

It assumes a global install, a populated `.env`, a running database and a
registered command tree. None of those are visible. The reader hits an error and
does not know which layer failed.

## Our version

Read `README.md` “How to run”, `compose.yaml`, `Dockerfile` and `.env.example`.

The quickstart matches the current tree:

```bash
corepack enable
pnpm install
cp .env.example .env
# put DISCORD_TOKEN in .env
pnpm check            # no token, no database, no network
```

For the full local stack:

```bash
docker compose up -d postgres redis
pnpm db:migrate       # explicit and idempotent; never on boot
pnpm dev
pnpm worker:dev       # second terminal
pnpm web:start        # optional dashboard on :3000
```

All 12 modules share the same catalog and dispatcher, so no module needs a
separate service. The Docker path has two shapes. `docker compose up --build bot worker` starts the
gateway and worker without the dashboard. `docker compose up --build` also
starts the optional web service, which refuses to boot in production without
`SESSION_SECRET`; set one in `.env` or leave `web` out. In both shapes the
`migrate` service runs once before the selected services start. The compose
services set `DATABASE_URL` and `REDIS_URL` to the container names, while a local
`pnpm dev` uses the `localhost` values in `.env.example`.

Memory mode is a supported first run: leave the two URLs empty and the bot boots
with process-local stores. The data resets on restart; that is the trade, not a
bug.

The verification boundary is deliberate:

- `pnpm check` proves typecheck, unit/PGlite tests, budget, claims, intents,
  channels and memory without services.
- `pnpm probe:live` proves the configured Postgres/Redis/queue/web path and
  writes `memory/machine/live.json`.
- A Discord token and a human slash client prove the gateway. They are not part
  of either command.

## Exercise

Run the no-secret gate first:

```bash
pnpm check
```

Then, if Docker is running:

```bash
docker compose up -d postgres redis
pnpm db:migrate
pnpm probe:live
```

For the containerized gateway, use `docker compose up --build bot worker`; add
the `web` service only after setting `SESSION_SECRET`.

Open `memory/machine/live.json` and check that the report names the Docker
server, Postgres version, applied migrations and every check. Stop Redis and run
the probe again: it should fail, not pass with a warning. Start Redis.

If you do not have Docker, run `INTENT_PROFILE=minimal pnpm audit:intents` and
read the disabled-feature list. That is the supported fallback: memory mode plus
a named capability loss, not a hidden failure.

Finally, run `git status --short`. `.env` must not appear. If it does, stop and
fix `.gitignore` before starting the bot; a token is never a lesson artifact.

## What we rejected

- **Run migrations on bot boot.** A bot restarts often; a migration should be an
  explicit operator step with a transaction and a visible result.
- **Make Docker mandatory for `pnpm check`.** The gate must run on a laptop with
  no daemon, no database and no token.
- **One “production” compose profile for every host.** The web service needs
  OAuth and a session secret; a gateway-only host should not be forced to run it.
- **Hide the memory-mode limitation.** Process-local data resets on restart.
  Saying so is better than a surprise.

## Check yourself

1. Which command proves the SQL/Redis path, and why is it not in `pnpm check`?
2. What does the `migrate` compose service depend on, and who depends on it?
3. What is still unproven after a green `pnpm check` and a green live probe?
