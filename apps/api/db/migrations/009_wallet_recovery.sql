-- A wallet whose only signer is a Secure Enclave key dies with the handset: the
-- key cannot be copied anywhere, by design. The recovery signer is a passkey the
-- platform replicates to the owner's other devices, and it is the only thing a
-- replacement phone can present.
--
-- Recording it here is what lets that phone find the wallet at all. It arrives
-- knowing nothing: not the contract address, and not the device key it has to
-- rotate out. Both are looked up from the credential the passkey presents.
ALTER TABLE wallets ADD COLUMN recovery_public_key text;
ALTER TABLE wallets ADD COLUMN recovery_credential_id text;
ALTER TABLE wallets ADD COLUMN recovery_signer_kind text
  CHECK (recovery_signer_kind IN ('Device', 'Passkey'));

-- One credential recovers one wallet. Without this a second wallet claiming the
-- same credential would make the lookup ambiguous, and the wrong answer here
-- means rotating a stranger's wallet.
CREATE UNIQUE INDEX wallets_recovery_credential_id_key
  ON wallets (recovery_credential_id)
  WHERE recovery_credential_id IS NOT NULL;
