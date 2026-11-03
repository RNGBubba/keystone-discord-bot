/**
 * 0020 — dashboard session activity and refresh credentials.
 *
 * 0008 removed the unused refresh-token column on purpose: a credential nobody
 * reads is only risk. Pass 57 adds the refresh path, so the column returns with
 * the same rule as the access token — it arrives sealed and this table never
 * holds the plaintext.
 *
 * `last_seen_at` is the idle clock. It is separate from `expires_at` (the
 * absolute session lifetime) and from `created_at` (rotation), because activity
 * must not extend the absolute lifetime and rotation must not reset the idle
 * window. Existing rows get one idle window from the moment of this migration:
 * their last real activity is unknowable, and expiring every session on deploy
 * would be a worse lie than a grace period.
 *
 * `access_expires_at` is backfilled from `expires_at` for existing rows. Those
 * rows have no refresh token, so they stay usable until their absolute expiry;
 * a new login records Discord's real `expires_in`.
 */
export const version = "0020_session_refresh";

export const sql = /* sql */ `
ALTER TABLE web_sessions ADD COLUMN IF NOT EXISTS refresh_token text;
ALTER TABLE web_sessions ADD COLUMN IF NOT EXISTS access_expires_at timestamptz;
ALTER TABLE web_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

UPDATE web_sessions
   SET access_expires_at = expires_at
 WHERE access_expires_at IS NULL;

ALTER TABLE web_sessions ALTER COLUMN access_expires_at SET NOT NULL;
`;
