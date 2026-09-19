CREATE TABLE users (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  contract_address TEXT NOT NULL,
  network TEXT NOT NULL,
  public_signer TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE merchant_profiles (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  recipient TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE payment_intents (
  id UUID PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE,
  merchant_profile_id UUID NOT NULL REFERENCES merchant_profiles(id),
  payload_hash TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL,
  expires_at_ledger BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE settlements (
  id UUID PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES payment_intents(intent_id),
  tx_hash TEXT UNIQUE,
  ledger BIGINT,
  status TEXT NOT NULL,
  failure_code TEXT,
  confirmed_at TIMESTAMPTZ
);

-- Private keys, passkey secrets, biometric data, and raw auth payloads are forbidden here.
