# Music — status

## Now

P8 music is in repo and live-proven through the development bridge. It is the
ninth module and the last named root in the approved v1.0 plan.

- `/music` is registered with `play`, `queue`, `add`, `remove`, `clear`, `skip`,
  `stop` and `status`. The command ledger is now **20 roots / 141 subcommands /
  161 actions** (it was 18 / 125 / 143 when `/music` shipped).
- The saved queue is **real and durable in SQL mode**: one
  `community_records` row per guild under kind `music_queue`, key `default`.
  The SQL adapter locks the guild row, so the cap holds under concurrent adds.
- **Playback is not shipped.** `UnavailableMusicPlayback` returns
  `available: false` with the exact missing pieces; `play`, `skip` and `stop`
  refuse rather than pretending. `/music status` prints the same reason.
- Music is **disabled by default**. `status` still works while disabled; every
  other subcommand refuses with the enabling command. `remove` and `clear`
  require `ManageGuild`.
- The manifest requests only `Guilds`; no voice intent is asked for while no
  voice client exists.

## Verified

```text
pnpm vitest run modules/music packages/db/src/music-store.test.ts
  ✓ modules/music/src/music.test.ts (14 tests)
  ✓ packages/db/src/music-store.test.ts (3 tests)
```

- The registry test proves one root with eight subcommands and a clean budget
  audit.
- URL validation rejects a non-URL, non-http(s) schemes, embedded credentials
  and oversized input; the label falls back from `title` to the decoded file
  name to the host.
- The cap is enforced by the store; a full queue refuses with the current size
  and the way to raise it.
- Disabled music refuses `add`/`queue`/`play` but still answers `status`.
- Playback refusals carry the adapter's reason through `MusicService`; they are
  not swallowed into a success.
- PGlite: two tracks round-trip through a raw `community_records` query
  (`guild_id`, `kind = music_queue`, `key = default`, two array entries), remove
  and clear delete the row, five concurrent adds against a cap of three add
  exactly three, and guild A never sees guild B.

The SQL cross-check is the raw query in `music-store.test.ts`, not the adapter's
own `list()`: it reads `community_records` directly and asserts one row with the
expected identity and two tracks.

Live evidence (2026-11-01, AI Team#5758, **one** bot process, pass-32 memory
mode). The `.env` probe first: `DATABASE_URL` and `REDIS_URL` were set but both
ports answered `ECONNREFUSED`, so the pass-32 live window was memory mode and
the SQL adapter was PGlite-only.

```text
!music status
→ Music is disabled · saved queue 0/25 · playback UNAVAILABLE (backend none).
  Playback is unavailable in this build: it has no Discord voice client or
  Lavalink client, and no LAVALINK_URL is configured. Tracks can be saved, but
  nothing can be played.
  Queue record: 0 saved track(s) under kind `music_queue`, key `default`
  (table `community_records` in SQL mode; process memory otherwise).
  Enable it with `/config set module=music key=enabled value=true`.

!config set module=music key=enabled value=true
→ Set `music.enabled` to `true`.

!music add query=https://example.com/tone.mp3 title=Test_tone
→ Saved **Test_tone** at position 1/25. Nothing is playing: playback is
  unavailable in this build.

!music add query=https://example.com/second.ogg
→ Saved **second.ogg** at position 2/25. Nothing is playing: playback is
  unavailable in this build.

!music queue
→ Saved queue · 2/25 · nothing is playing
  1. **Test_tone** — https://example.com/tone.mp3 — <@1493685079468146808>
  2. **second.ogg** — https://example.com/second.ogg — <@1493685079468146808>
  These rows are saved only; no audio is played in this build.

!music play query=https://example.com/tone.mp3
→ Nothing was played or saved. Playback is unavailable in this build: it has no
  Discord voice client or Lavalink client, and no LAVALINK_URL is configured.

!music remove position=1
→ Removed **Test_tone**. 1 saved track(s) remain; nothing is playing.

!music queue
→ Saved queue · 1/25 · nothing is playing
  1. **second.ogg** — https://example.com/second.ogg — <@1493685079468146808>

!music skip
→ Nothing was skipped. Playback is unavailable in this build: ...

!config set module=music key=enabled value=false
→ Set `music.enabled` to `false`.

!music add query=https://example.com/blocked.mp3
→ Music is disabled in this server. Enable it with
  `/config set module=music key=enabled value=true`.
```

The counts are traceable: two adds produced **2/25**, one remove produced
**1/25**, and the disabled `add` wrote nothing. The MCP author had
`ManageGuild`, so `remove` ran; `clear` was covered by the command test, not the
live bridge. `play` and `skip` refused because no playback adapter exists; that
is the shipped behaviour, not a missing test.

## Known limitations

- **Audio is not played.** A voice/Lavalink client and a configured endpoint are
  the named next dependency; until then the queue is a planning surface. The
  journal says this plainly rather than listing music as working.
- The pass-32 live window was memory mode because local Postgres/Redis were
  closed; pass 44 has since opened them. The SQL queue is PGlite-proven, not
  live-proven through Discord.
- No buttons or select menus; only text commands.
- `queue` shows the first ten tracks. A larger queue is truncated with a count.
- The MCP reader does not render ephemeral state; replies were captured as
  text, which is what `/music` sends.
- A human slash run is still unobserved.

## Next

- Add a Lavalink adapter behind `MusicPlayback` when an operator provides
  `LAVALINK_URL`; do not change the command surface.
- Add queue buttons (remove/clear) after the UI pass has a shared component
  pattern.
- Prune or archive very large saved queues only when an operator asks; the cap
  is the current control.
- Run the same bridge transcript against SQL mode once Postgres is up, and
  confirm the same queue from a fresh `community_records` row.
