CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  contract_address TEXT NOT NULL,
  network TEXT NOT NULL,
  public_signer TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE merchant_profiles (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  display_name TEXT NOT NULL,
  recipient TEXT NOT NULL,
  signing_key TEXT NOT NULL CHECK (signing_key ~ '^G[A-Z2-7]{55}$'),
  network TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'active')
);

CREATE INDEX merchant_profiles_user_idx ON merchant_profiles(user_id);

CREATE TABLE payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id TEXT NOT NULL UNIQUE,
  -- Merchant onboarding is a separate release slice; enforce the identifier
  -- shape in the protocol layer until profiles are provisioned here.
  merchant_profile_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status = 'created'),
  expires_at_ledger BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  CHECK (expires_at_ledger > 0),
  CHECK (payload_hash ~ '^[0-9a-fA-F]{64}$')
);

CREATE TABLE settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id TEXT NOT NULL UNIQUE REFERENCES payment_intents(intent_id),
  tx_hash TEXT UNIQUE CHECK (tx_hash IS NULL OR tx_hash ~ '^[0-9a-fA-F]{64}$'),
  ledger BIGINT CHECK (ledger IS NULL OR ledger > 0),
  status TEXT NOT NULL CHECK (status IN ('awaiting_approval', 'authorized', 'submitted', 'confirmed', 'rejected', 'expired', 'failed')),
  failure_code TEXT,
  confirmed_at TIMESTAMPTZ,
  CHECK (status <> 'confirmed' OR (tx_hash IS NOT NULL AND ledger IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK (status <> 'failed' OR failure_code IS NOT NULL)
);

CREATE INDEX settlements_status_idx ON settlements(status, intent_id);
CREATE INDEX payment_intents_created_idx ON payment_intents(intent_id);

CREATE TABLE worker_event_cursors (
  name TEXT PRIMARY KEY,
  cursor TEXT NOT NULL,
  start_ledger BIGINT NOT NULL CHECK (start_ledger > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Private keys, passkey secrets, biometric data, and raw auth payloads are forbidden here.
