/**
 * The single source for the version and the latest pass.
 *
 * `/help changelog` used to hard-code "pass 26" long after pass 42, which made a
 * command whose description promised "the latest pass" the most obviously stale
 * surface in the bot. The memory gate now compares `CHANGELOG[0]` with the
 * highest pass in `memory/machine/passes.json`, so the next pass that forgets
 * to add an entry fails `pnpm check` instead of shipping a confident lie.
 *
 * Keep this file small: one entry per pass that changes what a user can see.
 * Internal refactors belong in the journal, not here.
 */
export const VERSION = "0.1.0";

export interface ChangelogEntry {
  /** The pass id exactly as it appears in `memory/machine/passes.json`. */
  pass: string;
  date: string;
  summary: string;
  /** The journal this entry points at, relative to the repository root. */
  journal: string;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    pass: "pass-59",
    date: "2026-11-03",
    summary:
      "P7 i18n: panels, modal receipts and shared refusals render in the guild's setup.locale from one typed catalog, /config and the dashboard validate the same locale list, and Discord command descriptions are generated from the catalog instead of a hand-maintained table. A missing translation falls back to English, then to a plain sentence rather than a raw key.",
    journal: "memory/journal/2026-11-03-pass-59.md",
  },
  {
    pass: "pass-58",
    date: "2026-11-03",
    summary:
      "P7 Components V2: panels are now built through a typed layout that refuses to exceed Discord's 40-component or 4,000-character budget, buttons and modals carry signed expiring ids, and `/form panel` posts a real Apply button that opens a modal and files the same validated submission as the command path.",
    journal: "memory/journal/2026-11-03-pass-58.md",
  },
  {
    pass: "pass-57",
    date: "2026-11-03",
    summary:
      "P6 session lifecycle: a dashboard session unused for 30 minutes (configurable with WEB_SESSION_IDLE_MS) is ended and deleted, activity keeps it alive without extending the 7-day maximum, and an expired Discord access token is refreshed from a sealed, rotating refresh token — once even when two requests arrive together. Logout now revokes the refresh grant.",
    journal: "memory/journal/2026-11-03-pass-57.md",
  },
  {
    pass: "pass-56",
    date: "2026-11-03",
    summary:
      "P6 webhooks and Idempotency-Key: subscribe an https endpoint from the dashboard, receive HMAC-signed settings and token events, watch retries back off and stop on the delivery receipt page, and safely retry a keyed token write knowing the stored response will be replayed instead of applied twice.",
    journal: "memory/journal/2026-11-03-pass-56.md",
  },
  {
    pass: "pass-55",
    date: "2026-11-03",
    summary:
      "P6 scoped API tokens: issue a guild-bound keystone_… token with guild:read, analytics:read or settings:write, use it on the existing /api/v1 routes, and revoke it; the secret is shown once, only its hash is stored, every call is scope-checked and rate-limited, and the OpenAPI document is generated from the routes.",
    journal: "memory/journal/2026-11-03-pass-55.md",
  },
  {
    pass: "pass-54",
    date: "2026-11-03",
    summary:
      "P6 session hardening: dashboard sessions rotate their opaque cookie, logout revokes the Discord grant through the OAuth port, per-route limits return 429 with Retry-After, and WEB_OWNER_IDS gates an instance console that can end a user's sessions.",
    journal: "memory/journal/2026-11-03-pass-54.md",
  },
  {
    pass: "pass-53",
    date: "2026-11-03",
    summary:
      "P6 dashboard analytics: the dashboard and API show bounded aggregates over the audit, case, invite, ticket and command ledgers that already exist, with source row counts and an honest empty state.",
    journal: "memory/journal/2026-11-03-pass-53.md",
  },
  {
    pass: "pass-52",
    date: "2026-11-03",
    summary:
      "P6 saved templates: save a server's settings as a named template, then preview and apply it to the servers you manage through the same audited, schema-validated path; invalid or stale templates are refused.",
    journal: "memory/journal/2026-11-03-pass-52.md",
  },
  {
    pass: "pass-51",
    date: "2026-11-03",
    summary:
      "P6 config portability: download a checksummed settings bundle, import one behind a schema-validated preview and a stale-proof apply, and compare a stored baseline with live settings to see drift.",
    journal: "memory/journal/2026-11-03-pass-51.md",
  },
  {
    pass: "pass-50",
    date: "2026-11-03",
    summary:
      "P6 fleet view: three built-in templates preview a schema-validated diff across the servers you manage, and apply only the previewed plan through the audited settings path.",
    journal: "memory/journal/2026-11-03-pass-50.md",
  },
  {
    pass: "pass-49",
    date: "2026-11-02",
    summary:
      "P6 settings widgets: the dashboard form is generated from each module's Zod schema, and every accepted settings change is written to the audit trail with its actor and diff.",
    journal: "memory/journal/2026-11-02-pass-49.md",
  },
  {
    pass: "pass-48",
    date: "2026-11-02",
    summary:
      "Truth gate: current-tense counts and capability claims now fail the build when they disagree with the machine files; root governance and issue/PR templates added.",
    journal: "memory/journal/2026-11-02-pass-48.md",
  },
  {
    pass: "pass-47",
    date: "2026-11-02",
    summary:
      "Teaching pass: 14 lessons taught against the real code, a memory gate that checks their commands and counts, and a Docker quickstart that matches the web guard.",
    journal: "memory/journal/2026-11-02-pass-47.md",
  },
  {
    pass: "pass-46",
    date: "2026-11-02",
    summary:
      "Panic mode snapshots and restores every changed @everyone overwrite, and goodbye messages reuse the welcome settings without a role or DM branch.",
    journal: "memory/journal/2026-11-02-pass-46.md",
  },
  {
    pass: "pass-45",
    date: "2026-11-02",
    summary:
      "Temporary moderation and scheduled delivery: one delayed timer queue, one atomic expiry claim, and startup recovery on real case/community rows.",
    journal: "memory/journal/2026-11-02-pass-45.md",
  },
  {
    pass: "pass-44",
    date: "2026-11-02",
    summary:
      "Live substrate: compose Postgres/Redis, 13 migrations, a transaction-safe migrator and 9/9 SQL, Redis, queue and web checks.",
    journal: "memory/journal/2026-11-02-pass-44.md",
  },
  {
    pass: "pass-43",
    date: "2026-11-02",
    summary:
      "Truth pass: documented counts, paths and capability claims are checked against the code, and `/help changelog` follows the pass ledger.",
    journal: "memory/journal/2026-11-02-pass-43.md",
  },
  {
    pass: "pass-42",
    date: "2026-11-01",
    summary:
      "Modmail: private owner-or-staff threads, a first-staff-reply claim and a transcript archived once.",
    journal: "memory/journal/2026-11-01-pass-42.md",
  },
  {
    pass: "pass-41",
    date: "2026-11-01",
    summary:
      "Events: a draft/open/closed lifecycle, one RSVP row per member, capacity inside the transaction and a checksummed export.",
    journal: "memory/journal/2026-11-01-pass-41.md",
  },
] as const;

/** The newest entry. `audit:claims` proves it matches the pass ledger. */
export const LATEST_PASS = CHANGELOG[0]?.pass ?? "";
