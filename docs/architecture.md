# Rosa Pay Architecture

## Status

This document describes the implemented foundation and the boundaries that must remain stable as Rosa Pay moves from a mocked QR payment to Testnet settlement. The product name is **Rosa Pay** and the application/package slug is **RosaPay**.

## Runtime shape

```text
React Native app (iOS + Android)
  -> application/domain packages
  -> protocol package (pure RTP/1 validation and canonical hashes)
  -> Stellar adapter (RPC, address and merchant signature verification)
  -> SecureSigner port (native Swift/Kotlin implementation pending)

Fastify API -> repository port -> PostgreSQL adapter (production) / in-memory adapter (local)
Worker -> Stellar RPC health/indexing boundary
Soroban settlement contract -> approved asset -> customer authorization -> merchant payment
```

The mobile app is a bare React Native 0.85 application with the New Architecture enabled. A bare app is deliberate: secure native signing, platform key storage and Android NFC need native modules that should not be hidden behind an Expo runtime constraint.

The repository uses npm workspaces. Dependencies point inward: screens depend on application ports and packages, while protocol and domain code do not import React Native, Fastify or Stellar transport code.

## Package responsibilities

- `packages/protocol`: RTP/1 schemas, canonical JSON, QR URI encoding, policy validation and deterministic payment-intent hashing.
- `packages/domain`: payment state machine. It accepts events and returns explicit next states; it has no network or UI side effects.
- `packages/stellar`: Stellar RPC configuration, generated settlement client, RTP/1 settlement mapping, StrKey validation and merchant signature verification.
- `packages/secure-signer`: the only signing port exposed to TypeScript. The first implementation is an injected bridge; production adapters will be Swift/Kotlin backed.
- `packages/ui`: platform-neutral design tokens and small presentational components.
- `apps/mobile`: navigation, screen orchestration, runtime-validated API/query boundaries, capability switching and the mocked QR vertical slice.
- `apps/api`: Fastify transport, request validation, idempotency and repository ports.
- `apps/worker`: background RPC health boundary; durable indexing is intentionally a later phase.
- `contracts/settlement`: Soroban settlement policy and on-chain replay protection.

The API settlement record follows the domain state machine: `awaiting_approval`
can become `authorized`, then `submitted`, and only an RPC-verified receipt may
become `confirmed`. The current API exposes a read-only settlement status route;
mutation and persistence will move behind authenticated relayer/worker ports.

## Signing and passkeys

JavaScript never receives a private key. `SecureSigner` accepts an opaque authorization request and returns an opaque signature or a typed error. A production native adapter must keep the key in Secure Enclave/Keychain (iOS) or Android Keystore, require user presence for payment authorization, and expose only public-key metadata to JS.

The account decision is recorded in [ADR 0001](adr/0001-passkey-account-and-native-signer.md): use a Smart Account Kit/OpenZeppelin context-rule-compatible Soroban account, but keep React Native integration provider-neutral through a native bridge. Browser IndexedDB/WebAuthn storage is not used in React Native. Recovery and signer rotation are intentionally single-device for the Testnet demo and gated for production by [ADR 0002](adr/0002-recovery-and-signer-rotation.md). The bridge exposes Stellar SDK-compatible `signAuthEntry` and `signTransaction` operations so the generated contract client can separate customer auth-entry signing from relayer fee-payer signing. The iOS and Android `RosaPaySigner` modules are now registered fail-closed; they return `UNAVAILABLE` until platform credential storage and user-presence signing are implemented.

## RTP/1 to settlement boundary

RTP/1 signs a canonical JSON payment intent and is the QR transport artifact. Soroban verifies a different, typed XDR preimage containing the exact on-chain payment fields. The implementation keeps these artifacts separate on purpose:

1. QR scanning validates the RTP/1 payload and merchant signature.
2. The authorization layer derives a typed settlement envelope from that payload.
3. The merchant signs the contract digest and the customer authorizes the contract call.
4. The contract checks network, contract address, merchant registration, nonce, expiry, asset, amount and recipient before transferring funds.

The TypeScript settlement-envelope builder and generated contract binding now live in `packages/stellar`. The mapping is deterministic and explicit:

- The Stellar network ID is SHA-256 of the exact network passphrase.
- RTP intent IDs, merchant profile IDs and nonces are independently domain-separated and SHA-256 hashed into the contract's 32-byte fields.
- Decimal RTP amounts are converted to integer token units with `BigInt`; excess precision, zero and i128 overflow are rejected before simulation.
- Native and classic assets derive their SAC contract ID for the target network. Explicit SAC assets retain their validated contract ID.
- The generated binding comes from the optimized settlement WASM and exposes typed simulation, authorization and submission methods.
- `packages/stellar/src/settlementPipeline.ts` codifies the write path: the generated client simulates first, the customer signer authorizes every non-invoker auth entry, the relayer signs the transaction envelope, and the receipt is accepted only after RPC reports `SUCCESS` with a ledger.
- `packages/stellar/src/settlementService.ts` validates the QR/RTP payload and merchant signature before building the contract envelope. It requires a separate contract intent-digest signature, so the mobile QR signature cannot be accidentally reused as on-chain merchant authorization.
- `apps/mobile/src/features/payments/settlementAdapter.ts` is the only mobile settlement entry point. It keeps the local emulator demo behind `ROSAPAY_SETTLEMENT_MODE=mock` and exposes the real generated-client path only when `ROSAPAY_SETTLEMENT_MODE=testnet` plus native customer and relayer signing dependencies are present.

The envelope retains the RTP/1 hash for audit correlation, but does not reuse the QR signature. The merchant must sign the digest returned by the contract's `intent_digest` method, and the customer must separately authorize the exact `settle_payment` invocation.

## Network and assets

The first network is Stellar Testnet. The read path uses Stellar RPC; Horizon is not used as the application source of truth. XLM is the first supported asset. USDC is enabled only after its Testnet issuer/SAC address and decimal policy are configured from verified deployment data; no placeholder address is allowed.

The contract stores the Testnet network identifier and settlement contract address in the signed intent. A pubnet deployment must use a separate configuration and separate keys.

## Platform sequencing

QR is the required common payment path and is the current vertical slice. Android NFC is an optimization after real QR settlement. iOS uses the same QR path as a safe fallback because background NFC behavior and entitlement requirements differ by device and OS version. NFC must not introduce a second payment protocol.

## Version baseline

- Node.js `>=22.11.0`
- React Native `0.85.x`
- `@stellar/stellar-sdk` `16.2.0`
- Stellar protocol `27`
- Stellar CLI `27.1.0`
- `soroban-sdk` `27.0.6`
- Rust stable with `wasm32v1-none`

## Delivery gates

The repository has a mocked QR flow, live Testnet RPC health checks and a tested settlement contract deployed as `CBX7XUIEFWMRBZBEJGZ7SJAFJXFCAB6VFJKOAFMUFAEXML2UVOAZFAQO`. The public deployment manifest records the admin address, deterministic native XLM SAC, WASM hash and transaction hashes; CLI identity material remains ignored under `.stellar/`.

The live smoke suite registered an ephemeral merchant key, settled 0.1 XLM from a Friendbot-funded customer, checked the recipient balance delta and consumed state, then rejected replay, amount tampering, expiry, recipient substitution, unsupported asset, invalid amount, wrong network, wrong contract and fake merchant attempts. The mobile UI still uses the mock adapter until native customer authorization is available.
