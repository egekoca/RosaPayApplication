# Rosa Pay Delivery Backlog

This backlog is derived from `docs/PRD.md` and reflects the repository state on 2026-08-21.

Status: `[x]` implemented and locally verified, `[~]` foundation or mocked slice exists, `[ ]` not implemented, `[!]` requires an external decision, identity, or live network action.

## P0 - Real Testnet Settlement

- [x] Verify the local Node, npm, Xcode, CocoaPods, Rust and Stellar CLI toolchain.
- [x] Build and test the settlement contract with replay, expiry, recipient, asset and amount checks.
- [x] Generate the typed TypeScript contract binding and RTP/1 settlement-envelope mapping.
- [x] Resolve the merchant trust boundary with a registered key plus direct contract digest verification (PRD 22.3).
- [ ] Add a CI baseline for TypeScript, mobile, contract and dependency checks.
- [~] Use the public SDF Testnet RPC for the demo; explicit provider rate limits/SLA remain required before production (PRD 22.4).
- [x] Create a project-local Testnet deployer/admin and verify the deterministic native XLM SAC address.
- [x] Deploy the contract to Testnet and record the public contract ID, WASM hash and transaction evidence.
- [x] Register native XLM as the initial asset and ephemeral smoke-test merchant keys/recipient.
- [x] Add a scripted Testnet integration that settles XLM and rejects replay, amount, recipient, expiry, asset, network, contract and fake-merchant mutations.
- [x] Run the mobile onboarding, Testnet health, QR, confirmation and receipt demo on Android Pixel 9 and launch the iOS iPhone 17 Pro Simulator build.
- [~] Route the mobile confirmation screen through an explicit adapter; mock remains the development default while the Testnet mode uses generated-client simulation, customer authorization, submission and confirmation polling.

## P0 - Wallet and Authorization

- [x] Keep signing behind the `SecureSigner` TypeScript port with no private key exposed to JavaScript.
- [x] Complete the iOS/Android passkey smart-wallet feasibility decision and record the selected account model in ADR 0001 (PRD 22.1).
- [x] Define the generated-client settlement pipeline boundary for simulation, customer auth-entry signing, relayer submission and final confirmation.
- [x] Add a fail-closed signed-intent settlement service that keeps RTP/1 and contract-digest signatures separate.
- [x] Define first-release recovery and signer rotation requirements in ADR 0002 (PRD 22.5).
- [ ] Implement native iOS signer storage and user-presence authorization.
- [ ] Implement native Android signer storage and user-presence authorization.
- [~] Register fail-closed `RosaPaySigner` modules on iOS and Android; credential storage and signing remain pending.
- [ ] Implement wallet creation/restoration and recoverable failure states.
- [ ] Add device tests for cancellation, biometric failure and process death during authorization.
- [ ] Validate the selected native passkey bridge on physical iOS and Android devices.

## P1 - Application and API Foundation

- [x] Add the React Native shell, navigation, design system, English copy and error boundary.
- [~] Add Zustand capability/mode state, TanStack Query and structured redacted logging boundaries; session persistence remains pending.
- [x] Add a runtime-validated mobile API client with stable error handling.
- [~] Keep API intent creation/get and in-memory idempotency for local development.
- [ ] Add authenticated passkey session start/complete and `GET /v1/me`.
- [ ] Enforce capability and resource ownership on every mutating endpoint.
- [ ] Add PostgreSQL migrations and a durable repository adapter.
- [ ] Complete the PRD data model: devices, merchant keys, authorizations and audit events.
- [ ] Add merchant profile create/get endpoints and receiving-address verification.
- [ ] Add authorization, submission, payment status and activity endpoints.
- [~] Add read-only settlement status and a domain-guarded in-memory state service; authenticated mutation and durable persistence remain pending.
- [ ] Add rate limits, request correlation IDs and relayer-safe structured logs.

## P1 - Customer and Merchant Flows

- [~] QR encode/decode, signature validation, confirmation and local receipt flow exist with fixtures.
- [ ] Integrate a real camera QR scanner with size limits and malformed-payload recovery.
- [ ] Show full/copyable recipient details, non-native issuer, live expiry and verification state on confirmation.
- [ ] Track pending, confirmed and failed settlement states without false success.
- [ ] Include ledger, confirmation timestamp and a validated transaction hash in receipts.
- [ ] Implement Merchant Profile onboarding instead of the current capability toggle.
- [ ] Create and sign payment intents from merchant data rather than a fixture.
- [ ] Add merchant request status and receipt lookup.
- [ ] Persist local session and pending payment recovery across app restarts.

## P2 - Reliability and Evidence

- [ ] Implement worker confirmation/indexing, retry and notification hooks.
- [ ] Add offline-safe retry using API idempotency keys.
- [ ] Add contract-event reads and reconcile events with API settlement state.
- [ ] Add developer settings for network, contract ID and RPC status.
- [ ] Add metrics for created, authorized, confirmed and failed payments plus median confirmation time.
- [ ] Add tests for wrong contract/network, fake merchant, relayer alteration, polling failure and offline retry.
- [ ] Add static analysis, secret scanning and an independent contract review gate.

## P3 - Deferred Product Scope

- [!] Verify a Testnet USDC issuer/SAC and decimal policy before enabling USDC (PRD 22.2).
- [ ] Add USDC trustline onboarding only after the asset decision is recorded.
- [ ] Implement Android NFC HCE as an optional transport over the same RTP/1 flow.
- [ ] Keep QR visible as the iOS and unsupported-device fallback.
- [ ] Record 100+ successful Testnet settlements and publish anonymized demo metrics.
- [ ] Prepare the architecture diagram, three-minute demo script and failure-path demo.

## Emulator verification notes

- Android: Pixel 9 AVD (Android 16 / API 36), Metro on `127.0.0.1:8081`,
  `ANDROID_HOME=/Users/ege/Library/Android/sdk`, and `adb reverse tcp:8081 tcp:8081`.
- iOS: iPhone 17 Pro Simulator (iOS 26.2), launched with
  `npx react-native run-ios --simulator 'iPhone 17 Pro'` from `apps/mobile`.
- The demo flow is intentionally local/mock at the final settlement boundary;
  the receipt hash is not an on-chain transaction until the generated client
  replaces `settleMockPayment`.

## Next Execution Order

1. Implement native signer adapters and replace `settleMockPayment` with the generated Testnet client.
2. Add durable API persistence, auth/capability checks and worker confirmation.
3. Finish merchant onboarding, real QR capture and reliability states before NFC or USDC.
