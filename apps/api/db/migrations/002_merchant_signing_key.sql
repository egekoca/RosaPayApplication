-- Merchant profiles now carry the key that signs RTP/1 intents, so a customer can
-- verify the request against the profile that issued it. The column is NOT NULL
-- without a default on purpose: no code path wrote this table before this change,
-- so an existing row means an unknown writer and the migration must fail closed.
ALTER TABLE merchant_profiles ADD COLUMN IF NOT EXISTS signing_key TEXT NOT NULL;

ALTER TABLE merchant_profiles
  ADD CONSTRAINT merchant_profiles_signing_key_check CHECK (signing_key ~ '^G[A-Z2-7]{55}$');

ALTER TABLE merchant_profiles
  ADD CONSTRAINT merchant_profiles_status_check CHECK (status = 'active');

CREATE INDEX IF NOT EXISTS merchant_profiles_user_idx ON merchant_profiles(user_id);
