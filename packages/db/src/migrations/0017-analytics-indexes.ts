/**
 * 0017 — indexes for the dashboard analytics window queries.
 *
 * `DrizzleAnalyticsStore` filters five guild-owned tables by a bounded
 * `since..until` window. `logging_events` and `command_usage` already have a
 * `(guild_id, created_at)` index; cases, invite joins and tickets did not.
 * These are read-path indexes only: no table, row or counter is added.
 *
 * The tickets closed index is partial because the average-close query only
 * reads rows that have a `closed_at`; an open ticket has no business there.
 */
export const version = "0017_analytics_indexes";

export const sql = /* sql */ `
CREATE INDEX IF NOT EXISTS cases_guild_created_idx
  ON cases (guild_id, created_at);
CREATE INDEX IF NOT EXISTS invite_joins_guild_joined_idx
  ON invite_joins (guild_id, joined_at);
CREATE INDEX IF NOT EXISTS tickets_guild_created_idx
  ON tickets (guild_id, created_at);
CREATE INDEX IF NOT EXISTS tickets_guild_closed_idx
  ON tickets (guild_id, closed_at)
  WHERE closed_at IS NOT NULL;
`;
