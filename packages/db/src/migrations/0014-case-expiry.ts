/**
 * 0014 — release times on moderation cases.
 *
 * A temporary ban or role grant is still one case: the case explains who did
 * what and why, while `expires_at` says when the action stops being in force.
 * Keeping the timestamp on the case, rather than in a separate timer table,
 * means a lost or restarted process can recover by reading the same rows.
 *
 * The column is nullable so every existing case is unaffected. The index is
 * partial: the recovery query only ever asks for rows that actually expire.
 */
export const version = "0014_case_expiry";

export const sql = /* sql */ `
ALTER TABLE cases ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS cases_expiry_idx
  ON cases (guild_id, expires_at)
  WHERE expires_at IS NOT NULL;
`;
