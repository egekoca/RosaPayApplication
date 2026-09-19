-- Median confirmation time needs two timestamps the server saw itself. The
-- settlement already records when a payment confirmed; the intent recorded only
-- the merchant device's own `createdAt`, which is a client clock and cannot be
-- trusted to measure how long Rosa Pay took.
ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS payment_intents_created_at_idx ON payment_intents(created_at DESC);

-- Rows that existed before this column get the migration's timestamp, which is
-- later than their confirmation. There is no honest way to recover when they
-- were really requested, so the metrics query leaves any settlement that
-- appears to have confirmed before its intent out of the median rather than
-- inventing a duration for it.
