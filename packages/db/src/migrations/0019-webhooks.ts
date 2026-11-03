/**
 * 0019 — outbound webhooks and request idempotency.
 *
 * `webhook_subscriptions` is a guild-owned endpoint with its signing secret
 * sealed by the web app; the plaintext secret never reaches this table.
 * `webhook_deliveries` is the outbox: a row is written before the network call,
 * every attempt updates it, and the admin's receipt is that row. The due index
 * is the drainer's only query shape.
 *
 * `job_receipts` gains the columns an `Idempotency-Key` needs to replay a
 * response: the request fingerprint and the stored status/body. The queue's
 * columns are untouched, so job receipts and request receipts share one table
 * and one claim rule instead of two replay mechanisms. `response_body` is
 * text, not jsonb: jsonb normalises key order, and a replay that reorders the
 * first response is not the same response.
 */
export const version = "0019_webhooks";

export const sql = /* sql */ `
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id uuid PRIMARY KEY,
  guild_id text NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  events jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_subscriptions_guild_created_idx
  ON webhook_subscriptions (guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  subscription_id uuid NOT NULL REFERENCES webhook_subscriptions (id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_status integer,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_deliveries_guild_created_idx
  ON webhook_deliveries (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_subscription_idx
  ON webhook_deliveries (subscription_id);

ALTER TABLE job_receipts ADD COLUMN IF NOT EXISTS fingerprint text;
ALTER TABLE job_receipts ADD COLUMN IF NOT EXISTS response_status integer;
ALTER TABLE job_receipts ADD COLUMN IF NOT EXISTS response_body text;
`;
