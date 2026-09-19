-- The settlement contract verifies a merchant signature over a digest that names
-- the payer, so the merchant can only produce it once a customer has claimed the
-- request. This table is the meeting point: a customer records that it intends
-- to pay, and the merchant's device leaves the signature for it to collect.
--
-- Nothing here is secret. The signature authorizes exactly one payment by one
-- named payer, and the merchant's own signing key never leaves its device.
CREATE TABLE IF NOT EXISTS merchant_countersignatures (
  intent_id TEXT PRIMARY KEY REFERENCES payment_intents(intent_id),
  customer_address TEXT NOT NULL CHECK (customer_address ~ '^[GC][A-Z2-7]{55}$'),
  signature TEXT CHECK (signature IS NULL OR signature ~ '^[A-Za-z0-9+/]{86}==$'),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at TIMESTAMPTZ,
  CHECK (signature IS NULL OR signed_at IS NOT NULL)
);
