# Lesson 10 — the live window and evidence levels

## The problem

The unit suite passes. PGlite applies the real migrations. Does that prove the
compose Postgres path? No: the driver is different, the connection is different,
and Redis is not in the unit process at all.

A “works on my machine” claim needs a recorded run against the configured
services, with the exact date and version. It also needs to stop short of
claiming a Discord gateway observation that nobody made.

## The naive version

Start Postgres once, run the tests, and write “live-tested” in the README. A
week later the container is gone, the evidence is a sentence, and the claim is
unfalsifiable.

## Our version

Read `scripts/live-probe.ts` and the generated
`memory/vault/06-Operations/Live-Window.md`.

`pnpm check` is the token-free gate. It must pass with no database, no Redis and
no network. `pnpm probe:live` is the operator step:

```bash
docker compose up -d postgres redis
pnpm db:migrate
pnpm probe:live
```

The probe opens the configured Postgres, checks that the 16 migrations are current,
writes a settings row, closes the pool, reopens it and reads the row again. It
uses two Redis clients to prove a cooldown is shared. It runs a BullMQ job twice
with one idempotency key and waits for one Postgres receipt. It expires a real
case, delivers a real reminder, round-trips a panic snapshot, imports/rolls
back/deletes real portability rows, and calls `/healthz` with a real database.
Every check writes `memory/machine/live.json`; `memory:render` turns that file
into the Live-Window page. The last recorded run is 17 live checks against 16
migrations. The newest four drive real local HTTP on Postgres: the schema form
path (login, session, CSRF, save, reject), the fleet template path (list,
preview diff, stale-fingerprint refusal, apply, one dashboard audit row per
guild), the config path (checksummed file export, multipart upload, preview
that writes nothing, edited-checksum and stale-fingerprint refusals, one audited
apply, a stored baseline and one reported drift), and the saved-template path
(save, list, two-guild preview, tampered/stale refusals, one audited write per
guild, invalid-row refusal, audited delete). The numbers are checked against the
report, not typed by hand.

The evidence levels are intentionally separate:

- **PGlite** proves the SQL and transaction shape without a server.
- **`probe:live`** proves the configured Postgres/Redis/queue path.
- **A gateway check** proves Discord actually received a message or overwrite.

The probe uses recording ports for Discord. It does not make the moderation
adapter send a real ban or lock a real channel. A feature row that needs the
gateway stays `liveVerified: false` even when the SQL half passed; its note must
say which half is unobserved.

## Exercise

With Docker running, run the three commands above. Open
`memory/machine/live.json` and read one check's `detail`; then open the
generated Live-Window page and find the same check. The page is not a second
report.

Now stop Redis and run `pnpm probe:live` again. It should fail before claiming a
green run; a probe that treats an unreachable dependency as a pass is worse than
no probe. Start Redis again. If you cannot run Docker, run `pnpm check` and read
the Live-Window page as the last recorded operator run; do not call your machine
live-verified.

## What we rejected

- **Put `probe:live` inside `pnpm check`.** CI has no database, and the gate must
  stay runnable on a laptop with no services. The probe is an explicit operator
  action.
- **Use PGlite for the probe.** It would prove the same driver the tests already
  use, not the compose driver the deployment uses.
- **Record “live” in prose.** A sentence cannot be re-run. `live.json` has a
  date, a Docker version, migration counts and check ids.
- **Flip every feature row to live-verified when the probe passes.** The probe
  does not touch a gateway. `liveEvidence` must name the check that proves that
  row's actual claim.

## Check yourself

1. What does the probe prove that PGlite does not?
2. Why does the probe close and reopen the Postgres pool?
3. What is still unproven after a green probe run, and where is that written?
