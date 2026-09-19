# Lumenade Pay Security Model

## Trust boundaries

```text
Merchant device --QR/RTP/1--> Customer device --secure signer--> Stellar RPC
       |                              |                         |
       +----------- API/repository ---+                         Soroban contract
```

The merchant controls the RTP/1 signing key. The customer controls the wallet key. The API stores intent metadata and idempotency records but is not trusted to authorize transfers. The contract is the final policy boundary.

## Assets

- Customer private key and passkey credentials.
- Merchant signing key.
- Customer funds and merchant recipient address.
- RTP/1 intent integrity, nonce and expiry.
- Idempotency and audit metadata.

Private keys and seed phrases must never be logged, placed in JavaScript state, committed to source, or stored in the API database. Test fixtures generate ephemeral keys at runtime; deployment identities are supplied through environment variables.

## Controls

- Canonical hash plus Ed25519 merchant signature prevents QR field tampering.
- Network, contract, asset, amount, recipient, nonce and expiry are checked on both client boundary and contract.
- Soroban requires customer authorization, verifies the registered merchant signature, persists replay state and transfers only the approved token amount.
- The API supports idempotency and typed errors; duplicate requests return the original result.
- Logs are redacted and contain intent IDs/status, never signatures, keys, seed material or full QR payloads.
- The secure signer is a native port. Production implementations must use Keychain/Secure Enclave or Android Keystore and user presence.
- QR is the common path; NFC cannot bypass the RTP/1 validation or signer confirmation flow.

## Negative-test matrix

The current tests cover:

- malformed QR/base64 and unknown protocol versions;
- unsupported network and asset policy;
- expired intent, invalid amount and excessive precision;
- invalid or tampered merchant signature;
- API duplicate idempotency and stable error responses;
- contract replay, expiry, recipient mismatch, unsupported asset, zero amount and changed amount;
- payment state-machine illegal transitions.

The Testnet smoke suite additionally proves a real native XLM transfer and live rejection of replay, amount tampering, expiry, recipient substitution, unsupported asset, invalid amount, wrong network, wrong contract and fake merchant input. Public transaction and intent evidence is stored in `config/testnet-smoke-evidence.json`; no private key is included.

Before Testnet release, add device-level tests for signer cancellation, biometric failure, process death during authorization, deep-link spoofing, API timeout/retry and stale-ledger expiry.

## Relayer and wallet provisioning

| Asset | Exposure | Control |
| --- | --- | --- |
| Relayer fee balance | Anyone who can reach the API can ask it to sign | It signs only a single `settle_payment` call on the configured contract, sourced by itself; anything else is refused before signing |
| Deployer funding balance | Creating a wallet spends a starting balance | A device key controls exactly one wallet, so provisioning is idempotent and a repeat call funds nothing; the endpoint is also rate limited |
| Customer funds | Held by a contract account | Only the device key can authorize a spend; the deployer can create the wallet but never move its funds |
| Merchant registration | Writes a signing key to the contract | Admin-signed, and merchant profiles are ownership-guarded when auth is enforced |

The rate limits are per process and are a bound on damage, not a distributed
quota. A deployment behind more than one instance needs a shared store before it
can rely on them.

## Operational rules

Testnet and pubnet configuration are separate. No private key is checked into the repository. Deployment requires explicit deployer/admin environment variables and prints only public contract identifiers. A production rollout must add rate limits, encrypted secret storage, alerting for replay failures and an independent contract review.
