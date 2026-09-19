-- Median confirmation time needs two timestamps the server saw itself. The
-- settlement already records when a payment confirmed; the intent recorded only
-- the merchant device's own `createdAt`, which is a client clock and cannot be
-- trusted to measure how long Rosa Pay took.
ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS payment_intents_created_at_idx ON payment_intents(created_at DESC);
