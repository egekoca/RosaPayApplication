-- A wallet belongs to a device key, not to a user account, because the device
-- key is the only signer the contract will ever accept. Making the signer unique
-- keeps provisioning idempotent: the same device can never be funded twice.
ALTER TABLE wallets ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE wallets ADD CONSTRAINT wallets_public_signer_key UNIQUE (public_signer);
ALTER TABLE wallets ADD CONSTRAINT wallets_contract_address_key UNIQUE (contract_address);
ALTER TABLE wallets ADD CONSTRAINT wallets_status_check CHECK (status IN ('active', 'revoked'));
