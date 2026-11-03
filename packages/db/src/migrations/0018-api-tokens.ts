/**
 * 0018 — scoped public API tokens.
 *
 * One row per issued token. `token_hash` is the SHA-256 of the `keystone_…`
 * secret; the secret itself is never stored, so a database read cannot replay a
 * client. `guild_id` is the token's ceiling and every route re-checks it.
 *
 * `scopes` is a JSON array of the three `ApiScope` values. It is JSONB rather
 * than a Postgres array so the same shape round-trips through the in-memory
 * adapter without a second parser.
 *
 * Revocation sets `revoked_at`; rows are retained so the audit trail can still
 * name the token. There is no foreign key: a guild can be deleted or restored
 * while the operator's receipt remains.
 */
export const version = "0018_api_tokens";

export const sql = /* sql */ `
CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY,
  guild_id text NOT NULL,
  guild_name text NOT NULL,
  name text NOT NULL,
  token_hash text NOT NULL,
  scopes jsonb NOT NULL,
  created_by text,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_hash_idx
  ON api_tokens (token_hash);
CREATE INDEX IF NOT EXISTS api_tokens_guild_created_idx
  ON api_tokens (guild_id, created_at DESC);
`;
