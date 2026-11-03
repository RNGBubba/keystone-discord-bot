/**
 * 0015 — the last config bundle a guild applied or stored.
 *
 * This is an audit-adjacent ledger, not a settings copy: the live settings stay
 * in `settings`, and this row only lets the dashboard show what diverged from
 * the operator's baseline. `guild_id` is the primary key because a guild has at
 * most one current baseline; applying again replaces it and keeps `created_at`.
 *
 * There is deliberately no foreign key on the guild id. Exported guilds can be
 * restored into a different id, and the baseline follows the target guild, not
 * the source bundle.
 */
export const version = "0015_config_baselines";

export const sql = /* sql */ `
CREATE TABLE IF NOT EXISTS config_baselines (
  guild_id text PRIMARY KEY,
  source text NOT NULL,
  bundle jsonb NOT NULL,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
