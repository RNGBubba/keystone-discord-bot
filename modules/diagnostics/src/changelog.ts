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
