# Rosa Pay - Product Requirements Document

**Document status:** Implementation-ready draft  
**Product name:** Rosa Pay
**Product type:** React Native mobile payment application for iOS and Android  
**Network:** Stellar Testnet first, Mainnet-ready architecture  
**Primary audience:** Customers and small merchants accepting fast Stellar payments  
**Public website:** https://rosa-pay-app.vercel.app
**Document language:** English  
**Last updated:** 2026-08-25

Implementation status and remaining work are tracked in [`TODO.md`](TODO.md). Public Testnet deployment and smoke-test evidence are recorded under [`../config`](../config).

## 1. Executive Summary

Rosa Pay is a non-custodial mobile payment application that lets a customer approve an exact payment to a verified merchant from a single React Native app. The customer uses a passkey and biometric confirmation. The merchant creates a signed payment intent containing the recipient, asset, amount, nonce, and expiry. Rosa Pay transports that intent over QR on both platforms, with Android NFC as an optional fast path. A relayer simulates and submits the transaction on Stellar so the customer does not need to manage network fees during the demo.

Rosa Pay is not a custodial wallet, an exchange, a new token, or a generic QR payment clone. Its differentiator is an open, verifiable payment-intent flow: the user approves exactly what the merchant requested, and the contract rejects altered, expired, replayed, or recipient-swapped requests.

## 2. Problem Statement

Stellar payments are fast and inexpensive, but a typical user still has to understand wallet addresses, assets, network fees, transaction signing, and wallet extensions. This creates four practical problems:

1. Customers cannot easily verify that the amount and recipient shown by a payment surface are the same values that will be settled on-chain.
2. Small merchants need a simple way to create payment requests without operating a full wallet or writing blockchain code.
3. A relayer can improve usability, but a compromised relayer must not be able to change the payment or spend customer funds.
4. A hackathon demo can appear functional while lacking replay protection, merchant identity, negative tests, and observable on-chain proof.

Rosa Pay addresses these problems with a signed payment-intent protocol, a policy-aware customer wallet, a merchant profile, and a transparent settlement record.

## 3. Product Vision

Make a Stellar payment feel like tapping a card while preserving the strongest parts of self-custody: the customer controls authorization, the merchant is identifiable, and every settled payment is independently verifiable.

## 4. Goals

### 4.1 Product goals

- Enable a customer to complete a testnet payment in under 30 seconds after scanning or tapping.
- Make the exact merchant, recipient, asset, amount, and expiry visible before biometric approval.
- Let one user account operate as a customer by default and activate a merchant profile without a second login.
- Provide a merchant payment request that can be verified independently of Rosa Pay's backend.
- Produce a real Stellar testnet transaction and a receipt with a transaction hash.
- Support iOS and Android from one React Native codebase.
- Publish a responsive website that presents the mobile product and links every Testnet claim to reproducible evidence.
- Keep all UI text in English and use the Rosa Pay black, amber and white brand system. Green and red are reserved for semantic success and failure states.
- Express the Rosa name through the rose mark, using restrained rotation and orbit motion during loading, settlement and selected transitions without implying success before final confirmation.

### 4.2 Technical goals

- Use `@stellar/stellar-sdk` for transaction construction, simulation, authorization, and submission helpers.
- Use Stellar RPC for new contract and transaction workflows; use Horizon only for legacy or historical data needs.
- Keep private signing material out of JavaScript, the API, the database, and logs.
- Define RTP/1 (Request-to-Pay Protocol) with canonical serialization and test vectors.
- Implement Soroban settlement with replay, expiry, recipient, asset, amount, and merchant validation.
- Make the relayer untrusted: it may submit a valid authorization but may not alter authorization semantics.
- Provide unit, integration, property, negative-path, and end-to-end tests.

## 5. Non-Goals for the First Production-Quality Demo

- Custody of customer funds or pooled merchant funds.
- Operating a production fiat on-ramp, collecting KYC, or regulated money
  transmission. A Testnet-only SEP-24/SEP-45 reference-client integration may
  prove interoperability, but Rosa Pay never becomes the anchor and must not
  present sandbox activity as real money movement.
- Issuing a new Rosa Pay token.
- Cross-chain bridges, NFTs, loyalty points, AI features, or multi-chain support.
  On-Stellar liquidity is not in this exclusion: a customer holding the wrong
  Stellar asset is a payment problem, not a multi-chain one, and it is solved by
  buying the merchant's exact amount through Soroswap inside the settlement
  transaction. See [`swap-funding.md`](swap-funding.md).
- Full restaurant POS hardware integration.
- Making iOS NFC card emulation a required dependency. iOS NFC availability depends on Apple entitlements and device support; QR must always work.
- Supporting every Stellar wallet in the first release. The primary path is Rosa Pay passkey smart wallet; external wallets are a later adapter.

## 6. Target Users

### 6.1 Customer

A person who wants to pay a participating merchant quickly without copying a long address or handling XLM fees. The customer expects clear confirmation, biometric approval, and a receipt.

### 6.2 Merchant

A small business, event booth, or demo operator who needs to request a fixed amount in XLM or a supported Stellar asset. The merchant expects a recognizable identity, a payment status, and a reusable payment QR.

### 6.3 Reviewer / judge

A technical evaluator who must be able to inspect the protocol, run the app, observe a real testnet settlement, and verify that security claims are backed by tests and on-chain evidence.

## 7. Product Principles

1. **One identity, explicit capabilities.** A user does not choose a permanent role at login. Every account is a customer; a merchant profile grants merchant capabilities.
2. **Authorization is not authentication.** Passkey authentication establishes access to the wallet. Each payment still authorizes a specific intent.
3. **The relayer is not trusted.** It can pay fees and submit transactions, but it cannot change the recipient, asset, amount, nonce, or expiry.
4. **QR is the universal transport.** NFC improves speed where supported but is never the only path.
5. **Show the exact values.** The confirmation screen must show the merchant name, verified recipient, asset, amount, and expiry before signing.
6. **Prove the claim.** Every major demo claim must have a test, a metric, or an on-chain transaction.

## 8. Role and Account Model

### 8.1 Single account flow

1. A new user selects `Create a new wallet` or `I already have a wallet`; a returning user is recognized from encrypted device state.
2. Creating generates a twelve-word recovery phrase and one wallet; existing device-protected wallets remain usable.
3. `I already have a wallet` imports an existing Stellar account from its recovery phrase.
4. The account is recorded only once a wallet actually exists, so a failed setup leaves nothing behind.
5. Every launch opens `Pay`, including returning merchant users. Customer setup and payment do not ask for email; wallet authorization identifies the payer.
6. The user may select `Get paid with this account`.
7. The first `Get paid` visit requires a business name and a valid business email. The profile is saved and reused; legacy profiles complete email without replacing their profile ID or signing key. New profiles receive into the existing wallet, with no alternate receiving-address field.
8. The user can switch between `Pay` and `Get paid` below the shared balance card without changing accounts or signing keys. The card stays mounted directly below the header in both modes on iOS and Android; only the task content below it changes. Business activity stays separate from the wallet balance.

There must be no separate customer and merchant passwords, no role-specific duplicate accounts, and no hidden role switch that changes signing keys.

### 8.2 Capabilities

```text
User
|- CustomerWallet (required)
|- MerchantProfile (optional)
|- Devices (one or more)
|- PaymentHistory
|- RecoveryConfig (later milestone)
```

The API must authorize actions by capability and resource ownership, not by a client-supplied role string.

## 9. User Experience Requirements

All visible product copy is English. The following labels are the canonical starting vocabulary.

### 9.1 Entry and wallet setup

- `Welcome to Rosa Pay`
- `Create a new wallet`
- `I already have a wallet`
- `Your wallet is protected by your device`
- `Continue`
- `Use Face ID` / `Use Touch ID` / `Use device biometrics`

Requirements:

- No password is required.
- Explain that Rosa Pay is non-custodial in one concise consent screen.
- Show the network (`Stellar Testnet` in development) before any transaction.
- If wallet creation fails, show a recoverable error and do not create a partial local session.

### 9.2 Customer home

Primary actions:

- `Pay`
- `Scan QR`
- `Tap to Pay` (shown only when the device and transport support it)
- `Activity`
- `Wallet`

The home screen shows the selected network, wallet address in shortened form, balances, pending payment status, and a `Pay / Get paid` capability switcher. Both views use the same account and smart wallet; activating `Get paid` adds a merchant profile rather than creating another wallet or login.

### 9.3 Customer payment confirmation

The confirmation screen must show:

- Verified merchant name and logo/initials.
- Merchant verification state: `Verified merchant` or `Unverified merchant`.
- Full or copyable recipient address behind a details affordance.
- Asset code and issuer for non-native assets.
- Exact amount and display decimals.
- Intent expiry status.
- A clear `Approve payment` action that triggers biometrics.

The customer must never approve a payment from an opaque serialized payload or an address-only screen.

### 9.4 Merchant onboarding

Fields:

- Required business display name (1–80 characters).
- Required business email (validated format, up to 254 characters; no email verification or delivery claim).
- Existing wallet receiving address, shown for confirmation.
- Photo/logo upload, location, map and PDF invoices are deferred.
- Default asset (`XLM` initially; `USDC` after asset verification).
- Optional default payment amount for a reusable demo QR.

Actions:

- `Create merchant profile`
- `Verify receiving address`
- `Generate payment request`
- `Show QR`
- `Copy payment link`
- `View payment status`

Merchant onboarding must verify that the receiving address is valid for the selected network and must show the address before final confirmation.

### 9.5 Receipt and activity

Every payment has a state and a receipt:

```text
Created -> Awaiting approval -> Authorized -> Submitted -> Confirmed
                                      \-> Rejected / Expired / Failed
```

Receipt fields:

- Status.
- Merchant name and recipient.
- Amount and asset.
- Network.
- Intent ID.
- Stellar transaction hash when available.
- Ledger and timestamp when available.
- `View on Stellar Explorer` link.

## 10. RTP/1 Payment Intent Protocol

RTP/1 is an open JSON protocol used between the merchant surface, customer app, backend, and settlement contract. The protocol must have a canonical serialization function and published test vectors.

### 10.1 Payment intent fields

```typescript
type PaymentIntentV1 = {
  version: "RTP/1";
  intentId: string;              // globally unique UUID/ULID
  network: "testnet" | "pubnet";
  merchantProfileId: string;
  merchantName: string;
  merchantSigningKey: string;    // public key, never a secret
  recipient: string;              // G... or C... address
  asset: {
    type: "native" | "credit" | "sac";
    code: string;                 // XLM for native
    issuer?: string;
    contractId?: string;
    decimals: number;
  };
  amount: string;                 // canonical decimal string
  reference: string;
  nonce: string;
  expiresAtLedger: number;
  createdAt: string;
};
```

### 10.2 Intent signature

The merchant signs the canonical intent hash. The signature covers every settlement-relevant field, including network, recipient, asset identity, amount, nonce, and expiry. The customer app rejects malformed, unknown-version, wrong-network, expired, or unsupported intents before biometric approval.

### 10.3 Customer authorization

The customer authorization binds the customer wallet and signer to the intent hash. It must not be a generic wallet login signature. The authorization is passed as a Soroban auth entry or the equivalent SDK-supported authorization structure.

### 10.4 Replay protection

- `intentId` is unique at the API layer.
- `nonce` is unique per customer wallet and merchant profile.
- The settlement contract stores consumed intent IDs or nonce commitments with TTL.
- An expired or already consumed intent always fails.
- Retries use idempotency keys and never create a second settlement.

## 11. Stellar Settlement Design

### 11.1 Contract responsibility

The Rosa Pay settlement contract is intentionally narrow. It validates and settles a payment; it is not a general wallet, exchange, or token issuer.

The contract must enforce:

- Customer authorization for the exact payment.
- Merchant intent signature or a contract-registered merchant key.
- Recipient address equality.
- Asset identity equality, including issuer or SAC contract ID.
- Amount equality in integer base units.
- Network and expiry constraints as represented by the transaction/ledger context.
- Replay protection.
- Event emission for confirmed settlement.

### 11.2 Contract interface (proposed)

Names may change during implementation after the Soroban interface is validated.

```text
initialize(admin, supported_assets)
register_merchant(merchant_profile_id, merchant_key, recipient)
revoke_merchant(merchant_profile_id)
settle_payment(intent, merchant_signature)
is_intent_consumed(intent_id)
get_merchant(merchant_profile_id)
```

The `settle_payment` call must be atomic: either the full payment is transferred and the settlement event is emitted, or no payment is transferred.

### 11.3 Asset policy

- First demo asset: XLM.
- Second asset: a verified Stellar USDC asset on the target testnet, represented through its correct classic asset/SAC identity.
- Do not create a Rosa Pay token.
- Never identify a credit asset by code alone; always validate the issuer.
- Add trustline onboarding only when USDC support is implemented.

## 12. Wallet and Key Management

### 12.1 Customer signer

- Private signing material stays in the platform secure keystore or passkey credential system.
- JavaScript receives only public identifiers and opaque signing results.
- Every payment approval requires a biometric or platform passkey assertion.
- Secure storage is device-bound; a copied database must not be sufficient to spend.

### 12.2 Smart wallet

The preferred model is a Soroban contract account with a passkey/secp256r1 signer and a policy layer. The policy layer should support:

- Merchant allowlist or verified merchant requirement.
- Maximum single payment amount.
- Daily spending cap.
- Intent expiry bound.
- Signer rotation in a later recovery milestone.

Before committing to a specific third-party smart-account package in React Native, run a feasibility spike for iOS and Android passkey support. The app must preserve a `Signer` interface so the package can be replaced without changing payment-domain code.

### 12.3 Relayer

The relayer is a fee-payer and transaction submitter only. It must:

- Verify network and contract ID.
- Simulate the transaction before submission.
- Enforce server-side idempotency.
- Reject altered intent or authorization payloads.
- Store no customer private keys.
- Keep its signing key in a secret manager or local development secret store, never in the repository.

## 13. Transport Layer

### 13.1 QR (required)

QR is the cross-platform baseline. The QR payload contains a compact RTP/1 intent or a short-lived intent URL. It must be signed or fetch an intent whose signature is verified before display.

### 13.2 Android NFC (optional fast path)

Android NFC Host Card Emulation/APDU can carry a short intent reference or challenge. NFC must not carry an unsigned amount or recipient. The app still fetches/verifies the canonical intent and shows the same confirmation screen.

### 13.3 iOS NFC

iOS reads a tap and cannot publish one, and that split is Apple's, not a sequencing choice.

**Reading (implemented).** `RosaPayNfc.swift` opens an `NFCTagReaderSession` and speaks the same ISO 7816-4 exchange the Android reader speaks against the same AID, so an iPhone customer can pay an Android merchant by tapping. This needs the standard Near Field Communication Tag Reading capability (`com.apple.developer.nfc.readersession.formats` = `TAG`) plus the AID in `com.apple.developer.nfc.readersession.iso7816.select-identifiers`; neither requires approval from Apple. A CoreNFC session is a system sheet rather than background polling, so the reader opens on a deliberate press — the status field `needsUserAction` carries that distinction to the UI.

**Publishing (not possible).** iOS does not grant third-party apps host card emulation. The exception added in iOS 17.4 requires a commercial agreement with Apple and the NFC & SE Platform entitlement, is limited to the EEA, and is scoped to payment, transit, key and badge categories. An iPhone merchant therefore shows the QR code, and `startBroadcast` rejects instead of silently doing nothing.

The UI shows `Scan QR` whenever NFC is unavailable, and QR remains the path that works in every direction.

## 14. Backend and Data Model

### 14.1 Recommended repository structure

```text
RosaPay/
|- apps/
|  |- mobile/                  # React Native iOS + Android
|  |- api/                     # TypeScript API and relayer orchestration
|  `- worker/                  # Confirmation/indexing jobs when needed
|- packages/
|  |- domain/                  # Pure payment state machines and validation
|  |- protocol/                # RTP/1 types, canonical encoding, test vectors
|  |- stellar/                  # RPC, SDK, contract clients, network config
|  |- secure-signer/            # Signer interface and native adapters
|  `- ui/                       # Brand tokens and reusable components
|- contracts/
|  `- settlement/               # Rust Soroban contract and tests
|- docs/
|  |- PRD.md
|  |- architecture.md
|  |- rtp-1.md
|  `- security-model.md
|- tests/
|  `- fixtures/
`- package.json
```

### 14.2 Core entities

```text
User
CustomerWallet
PasskeyCredential
Device
MerchantProfile
MerchantSigningKey
PaymentIntent
PaymentAuthorization
Settlement
AuditEvent
```

### 14.3 Minimum database fields

`users`: id, created_at, status  
`wallets`: id, user_id, contract_address, network, public_signer, status  
`devices`: id, user_id, platform, device_key_id, last_seen_at  
`merchant_profiles`: id, user_id, display_name, email, recipient, network, status
`merchant_keys`: id, merchant_profile_id, public_key, status, created_at, revoked_at  
`payment_intents`: id, intent_id, merchant_profile_id, payload_hash, payload_json, status, expires_at_ledger, idempotency_key  
`authorizations`: id, intent_id, wallet_id, auth_hash, status, created_at  
`settlements`: id, intent_id, tx_hash, ledger, status, failure_code, confirmed_at  
`audit_events`: id, actor_type, actor_id, event_type, entity_id, metadata, created_at

No private key, passkey secret, or raw biometric data may be stored in these tables.

## 15. API Surface (Initial)

```text
POST   /v1/sessions/passkey/start
POST   /v1/sessions/passkey/complete
GET    /v1/me
POST   /v1/merchant-profiles
GET    /v1/merchant-profiles/:id
POST   /v1/payment-intents
GET    /v1/payment-intents/:intentId
POST   /v1/payment-intents/:intentId/authorize
POST   /v1/payment-intents/:intentId/submit
GET    /v1/payments/:intentId
GET    /v1/activity
GET    /v1/health/stellar
```

API rules:

- All mutating endpoints require authenticated user context and resource ownership.
- `POST /v1/payment-intents` returns the canonical payload, hash, signature, and QR representation.
- `POST /v1/payment-intents/:intentId/authorize` is idempotent.
- `POST /v1/payment-intents/:intentId/submit` re-simulates before relaying and returns a pending status, not a false success.
- API errors use stable machine-readable codes and human-readable English messages.

## 16. Architecture and Technology Decisions

### 16.1 Mobile

- React Native with TypeScript.
- Bare React Native or Expo prebuild only if all native modules remain controllable; do not rely on Expo Go for NFC or secure signer work.
- React Navigation.
- TanStack Query for server state.
- Zustand or an equivalent small store for session and mode state.
- Zod for runtime validation of API and RTP/1 payloads.
- Native Swift/Kotlin modules behind TypeScript interfaces.

### 16.2 Stellar

- `@stellar/stellar-sdk` as the single SDK boundary.
- Stellar RPC for Soroban simulation, submission, reads, and events.
- Horizon only for required historical/classic workflows.
- `contract.Client` and SDK authorization helpers where applicable; avoid hand-built ScVal/auth payloads unless a documented low-level exception is necessary.
- Version-pin the SDK and Soroban toolchain after a live Raven/docs verification.

### 16.3 Backend

- TypeScript API with strict validation and structured logging.
- PostgreSQL for durable state and idempotency.
- A worker process for transaction confirmation and retry handling.
- No blockchain private keys in application source or client code.

### 16.4 Contract

- Rust `soroban-sdk`, `#![no_std]`, optimized WASM.
- Constructor-based initialization.
- Explicit typed errors and contract events.
- TTL extension strategy for persistent merchant and replay state.
- Contract tests with mocked auth, negative cases, and integration tests on Testnet.

## 17. Security Requirements

### 17.1 Threats to test

- Amount changed between merchant intent and customer display.
- Recipient changed by QR tampering or a compromised API.
- Asset code kept but issuer swapped.
- Expired intent submitted.
- Same intent submitted twice.
- Customer authorization replayed against another intent.
- Relayer submits to the wrong network or contract.
- Fake merchant profile or unverified recipient.
- Device storage copied to another device.
- User rejects signing but UI reports success.
- Transaction submitted but confirmation polling fails.
- App is offline after authorization and retries later.

### 17.2 Required controls

- Canonical intent hashing and signature verification.
- Network-bound and contract-bound authorization.
- Nonce/intent replay storage with TTL.
- Merchant key rotation and revocation model.
- Biometric-gated signing.
- Secure storage for credential identifiers and session material.
- Server-side idempotency keys.
- Rate limits on intent creation and submission.
- Redacted logs; never log secrets or complete auth payloads.
- User-visible pending/failed states that cannot be confused with success.

## 18. Observability and Evidence

The demo must expose enough evidence for a judge to verify the system:

- Testnet network and contract ID in a developer settings screen.
- Intent ID and payload hash on the receipt.
- Transaction hash and explorer link.
- Contract event with intent ID, merchant profile ID, asset, amount, and payer.
- API request correlation ID.
- Relayer simulation result and submission status in server logs.
- Dashboard metrics: created intents, authorized intents, confirmed settlements, failed settlements, median confirmation time.

## 19. Success Metrics

### Demo acceptance metrics

- A new customer creates or restores a wallet without a password.
- A merchant creates a profile in under two minutes.
- Customer completes a QR payment on both Android and iOS test devices.
- Android NFC fast path completes when supported, with QR fallback available.
- At least 100 successful Stellar Testnet settlements are recorded before submission.
- At least 10 invalid/replay/tamper attempts are demonstrated as rejected.
- 100% of successful demo receipts contain a valid transaction hash.
- No private signing material appears in source, logs, database fixtures, or network traces.

### Hackathon scoring alignment

- Technical quality: real contract, native secure signing boundary, tests, and reproducible setup.
- Ecosystem integration: Stellar RPC, Soroban, SAC/USDC or XLM, passkey smart wallet, and relayer used meaningfully.
- User value: clear merchant/customer flow with no address copying.
- Originality: RTP/1 exact-intent authorization and merchant verification.
- Demo quality: fast English UI, clear states, explorer proof, and a failure-path demo.
- Continuation: open protocol, SDK/test vectors, public repository, and merchant integration path.

## 20. Delivery Roadmap

### Phase 0 - Feasibility and decisions

- Verify current Stellar protocol and SDK versions with Raven.
- Verify React Native passkey/smart-wallet options on iOS and Android.
- Verify Android NFC HCE requirements and iOS fallback behavior.
- Choose the exact testnet asset and RPC provider.
- Create the repository and CI baseline.

**Exit criteria:** a short architecture decision record with no unresolved blocker for QR + passkey + Testnet settlement.

### Phase 1 - Mobile foundation

- Initialize the React Native TypeScript application with the `RosaPay` component name.
- Add navigation, theme tokens, English copy, logo asset, and error boundary.
- Add environment-based network configuration.
- Add session, capability, and mode-switch state.
- Add API client, query cache, validation, and logging boundaries.

**Exit criteria:** app launches on iOS and Android with Welcome, Customer Home, Merchant Home placeholder, Settings, and Testnet indicator.

### Phase 2 - Protocol and contract vertical slice

- Implement RTP/1 types, canonical serialization, hash, signature verification, and fixtures.
- Implement the minimal settlement contract.
- Add contract unit and negative tests.
- Deploy to Testnet and record contract ID.
- Build a TypeScript contract client using SDK simulation and submission.

**Exit criteria:** a scripted test settles one valid payment and rejects amount, recipient, expiry, asset, and replay mutations.

### Phase 3 - Customer wallet and payment

- Implement passkey wallet creation/restoration behind `Signer` interface.
- Add secure native signer adapter.
- Implement QR scan, intent validation, payment confirmation, biometric approval, and receipt.
- Add pending/confirmed/failed polling.

**Exit criteria:** customer completes a real Testnet payment from both mobile platforms.

### Phase 4 - Merchant capability

- Implement Merchant Profile onboarding.
- Implement merchant key registration/rotation state.
- Implement payment intent creation and signed QR.
- Add merchant payment status and receipt lookup.
- Add mode switcher and capability guards.

**Exit criteria:** one device can create a merchant QR and another device can pay it without a second account system.

### Phase 5 - Transport and reliability

- Implement Android NFC adapter as an optional fast path.
- Add QR fallback and transport diagnostics.
- Add offline-safe pending state and retry/idempotency handling.
- Add worker confirmation and notification hooks.

**Exit criteria:** transport failure never creates a false success or duplicate settlement.

### Phase 6 - Security, proof, and polish

- Run tamper, replay, expiry, wrong-network, fake-merchant, and relayer-compromise tests.
- Run static analysis, dependency audit, secret scan, and contract test suite.
- Record 100+ testnet settlements and publish anonymized metrics.
- Polish English copy, accessibility, loading states, empty states, and failure states.
- Prepare architecture diagram, three-minute demo script, README, and RTP/1 documentation.

**Exit criteria:** reproducible clean install, successful CI, public Testnet proof, and no unresolved critical security finding.

## 21. Definition of Done

A feature is done only when:

- Its UI state, loading state, empty state, and failure state are implemented.
- It has runtime validation at the app/API boundary.
- It has unit tests for domain logic.
- It has an integration test for every blockchain boundary.
- It emits structured logs without secrets.
- It is covered by at least one negative-path test where applicable.
- It is documented in the architecture or protocol docs.
- It works on iOS and Android, or the platform limitation is explicitly surfaced with a fallback.

## 22. Open Decisions to Resolve Before Coding

1. Which passkey smart-wallet implementation is stable for React Native on both platforms?
2. Which exact Testnet USDC issuer/SAC address will be supported after live verification?
3. Will merchant signatures be verified directly in the Soroban contract, or will merchant registration plus contract auth provide the trust boundary?
4. Which RPC provider will be used for the demo and what rate limits apply?
5. What recovery and signer-rotation feature is required for the first post-hackathon release?

These decisions must be recorded in `docs/architecture.md` before their implementation story starts. Do not silently change them in code.

## 23. Immediate Next-Terminal Checklist

The next implementation session should execute this order:

1. Verify local toolchain: Node 22+, Xcode, Android SDK, CocoaPods, Rust, Stellar CLI, and Testnet access.
2. Scaffold the React Native TypeScript app with the `RosaPay` component name.
3. Create the monorepo directories and root scripts from Section 14.1.
4. Add the dark amber/rose design tokens and English navigation shell.
5. Add `packages/protocol` with RTP/1 types, Zod schemas, canonical hash, and test vectors.
6. Add `packages/stellar` with network config, RPC client, and explicit placeholder contract IDs.
7. Build the first vertical slice with a mocked intent: merchant QR -> customer confirmation -> local receipt.
8. In parallel, scaffold the Rust settlement contract and write the invalid-payment tests before wiring the mobile signer.
9. Replace the mocked intent with Testnet data only after the protocol and contract tests pass.
10. Do not begin NFC implementation until QR and Testnet settlement are working end to end.

## 24. Reference Documentation

- [Stellar Developer Docs](https://developers.stellar.org/docs)
- [Stellar JavaScript SDK](https://stellar.github.io/js-stellar-sdk/)
- [Stellar dApp skill](https://github.com/stellar/stellar-dev-skill/tree/main/skills/dapp)
- [Stellar smart-contract skill](https://github.com/stellar/stellar-dev-skill/tree/main/skills/smart-contracts)
- [Stellar RPC and data skill](https://github.com/stellar/stellar-dev-skill/tree/main/skills/data)
- [Stellar assets and SAC skill](https://github.com/stellar/stellar-dev-skill/tree/main/skills/assets)
- [Stellar standards skill](https://github.com/stellar/stellar-dev-skill/tree/main/skills/standards)
- [Stellar Building with AI and Raven](https://developers.stellar.org/docs/build/building-with-ai)
