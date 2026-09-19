-- What the customer authorized, kept for audit. Private keys, passkey secrets and
-- raw authorization payloads are forbidden: only the authorizing address, a hash
-- of the authorization entry and its expiry are stored.
CREATE TABLE IF NOT EXISTS authorizations (
  intent_id TEXT PRIMARY KEY REFERENCES payment_intents(intent_id),
  authorizer TEXT NOT NULL CHECK (authorizer ~ '^[GC][A-Z2-7]{55}$'),
  authorization_hash TEXT CHECK (authorization_hash IS NULL OR authorization_hash ~ '^[0-9a-fA-F]{64}$'),
  expires_at_ledger BIGINT CHECK (expires_at_ledger IS NULL OR expires_at_ledger > 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS authorizations_authorizer_idx ON authorizations(authorizer);
