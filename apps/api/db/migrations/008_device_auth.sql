CREATE TABLE IF NOT EXISTS device_auth_challenges (
  id UUID PRIMARY KEY,
  public_signer TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[A-Za-z0-9+/]{43}=$'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_auth_challenges_expiry_idx
  ON device_auth_challenges(expires_at);
