# Rosa Pay Delivery Backlog

This backlog is derived from `docs/PRD.md` and reflects the repository state on 2026-08-23.

Status: `[x]` implemented and locally verified, `[~]` foundation or mocked slice exists, `[ ]` not implemented, `[!]` requires an external decision, identity, or live network action.

## P0 - Real Testnet Settlement

- [x] Verify the local Node, npm, Xcode, CocoaPods, Rust and Stellar CLI toolchain.
- [x] Build and test the settlement contract with replay, expiry, recipient, asset and amount checks.
- [x] Generate the typed TypeScript contract binding and RTP/1 settlement-envelope mapping.
- [x] Resolve the merchant trust boundary with a registered key plus direct contract digest verification (PRD 22.3).
- [~] Add a CI baseline for TypeScript, mobile, contract and dependency checks; GitHub Actions now runs workspace checks, production dependency audit, PostgreSQL migrations against a service container, Rust formatting, contract tests and WASM build.
- [~] Use the public SDF Testnet RPC for the demo; explicit provider rate limits/SLA remain required before production (PRD 22.4).
- [x] Create a project-local Testnet deployer/admin and verify the deterministic native XLM SAC address.
- [x] Deploy the contract to Testnet and record the public contract ID, WASM hash and transaction evidence.
- [x] Register native XLM as the initial asset and ephemeral smoke-test merchant keys/recipient.
- [x] Add a scripted Testnet integration that settles XLM and rejects replay, amount, recipient, expiry, asset, network, contract and fake-merchant mutations.
- [x] Run the mobile onboarding, Testnet health, QR, confirmation and receipt demo on Android Pixel 9 and launch the iOS iPhone 17 Pro Simulator build; the relayed Testnet settlement itself is verified on Android (tx `e8a4ecfe…`, `4284246`) and the iOS build installs and runs the same bundle.
- [x] Route the mobile confirmation screen through an explicit adapter; the Testnet mode now settles for real through the relayer (evidence: tx `e8a4ecfeb4d5a1439c54e9589122e37f91df9d12c0d9da4753b140716d82dcd5`, ledger 4283738), while demo mode stays the default.

## P0 - Wallet and Authorization

- [x] Keep signing behind the `SecureSigner` TypeScript port with no private key exposed to JavaScript; a Testnet payment is now authorized by the Keystore key and paid from the smart wallet (tx `9417138c…`, ledger 4295728).
- [x] Complete the iOS/Android passkey smart-wallet feasibility decision and record the selected account model in ADR 0001 (PRD 22.1); the account is now implemented as `contracts/wallet` and deployed to Testnet.
- [x] Define the generated-client settlement pipeline boundary for simulation, customer auth-entry signing, relayer submission and final confirmation; the relayer is now the transaction source and fee payer, verified on-chain by `npm run testnet:relayed`.
- [x] Add a fail-closed signed-intent settlement service that keeps RTP/1 and contract-digest signatures separate.
- [x] Define first-release recovery and signer rotation requirements in ADR 0002 (PRD 22.5); the wallet enforces them, with the recovery key scoped to rotation only.
- [~] Implement native iOS signer storage and user-presence authorization; the Secure Enclave module is implemented as a local pod and builds, while on-device verification remains.
- [x] Implement native Android signer storage and user-presence authorization; a Keystore secp256r1 key signs only behind a device-credential prompt, verified on the Pixel 9 emulator against the exported public key.
- [x] Register fail-closed `RosaPaySigner` modules on iOS and Android; both now generate a hardware secp256r1 key and sign a digest behind a user-presence prompt.
- [x] Implement wallet creation/restoration and recoverable failure states; the app provisions a device-controlled smart wallet, restores it with the session, and every failure maps to a specific message.
- [~] Add device tests for cancellation, biometric failure and process death during authorization; developer settings run a real signature self-test and every failure maps to a typed signer error, while scripted cancellation and process-death cases remain.
- [ ] Validate the selected native passkey bridge on physical iOS and Android devices.

## P1 - Application and API Foundation

- [x] Add the React Native shell, navigation, design system, English copy and error boundary; motion primitives are React Native ports of React Bits components, screen transitions run on the native stack, and the home balance is the wallet's real on-chain balance rather than a fixture.
- [x] Add Zustand capability/mode state, TanStack Query and structured redacted logging boundaries, with the session persisted in encrypted device storage.
- [x] Add a runtime-validated mobile API client with stable error handling.
- [~] Keep API intent creation/get and in-memory idempotency for local development.
- [~] Add authenticated passkey session start/complete and `GET /v1/me`; the API now has a fail-closed auth resolver boundary and request IDs, while passkey session issuance remains.
- [~] Enforce capability and resource ownership on every mutating endpoint; merchant intent creation now checks the authenticated merchant capability and owned profile when auth is required.
- [x] Add PostgreSQL migrations and a durable repository adapter; `packages/postgres` wraps a transaction-capable `pg` pool, `createApiRuntime` selects it from `DATABASE_URL` (and refuses memory when `API_REQUIRE_DATABASE=true`), and `npm run db:migrate` applies checksum-guarded migrations.
- [~] Complete the PRD data model: devices, merchant keys, authorizations and audit events; merchant signing keys (migration `002`) and authorization records (migration `003`) persist, while devices and audit events remain.
- [x] Add merchant profile create/get endpoints and receiving-address verification; creation is idempotent, checks the Stellar receiving address and signing key, and reads are ownership-guarded.
- [~] Add authorization, submission, payment status and activity endpoints; `POST /v1/payment-intents/:id/authorize` records who authorized a payment, `/submit` records the relayed transaction, and both settlement and authorization are readable. An account-wide activity endpoint remains.
- [~] Add read-only settlement status and a domain-guarded in-memory state service; authenticated mutation and durable persistence remain pending.
- [~] Add rate limits, request correlation IDs and relayer-safe structured logs; every response now carries a validated `x-request-id` and the logger redacts authorization/signature fields, while rate limiting remains.

## P1 - Customer and Merchant Flows

- [x] QR encode/decode, signature validation, confirmation and local receipt flow now run on merchant-created, merchant-signed requests instead of fixtures.
- [ ] Integrate a real camera QR scanner with size limits and malformed-payload recovery.
- [x] Show full/copyable recipient details, non-native issuer, live expiry and verification state on confirmation; approval is blocked when the signature fails or the request has expired against the live ledger.
- [~] Track pending, confirmed and failed settlement states without false success; the settlement stepper reports Prepare/Authorize/Submit/Confirm, the submitted hash is shown before confirmation, demo settlements are labelled `DEMO ONLY`, and every failure maps to a specific message. Cross-device status still needs the API endpoints.
- [~] Include ledger, confirmation timestamp and a validated transaction hash in receipts; the Testnet path now records ledger and confirmation time, while hash re-validation against RPC remains.
- [x] Implement Merchant Profile onboarding instead of the current capability toggle; the business name and receiving address are verified before a profile exists.
- [x] Create and sign payment intents from merchant data rather than a fixture; amounts are canonicalized, expiry comes from the live ledger and the customer verifies the merchant signature.
- [~] Add merchant request status and receipt lookup; the merchant request screen polls the API settlement for its live request, while receipt lookup by merchant remains.
- [x] Persist local session and pending payment recovery across app restarts; the merchant profile, demo wallet, open request and receipts survive a restart in the platform's encrypted store, and a returning user skips onboarding.

## P2 - Reliability and Evidence

- [~] Implement the worker confirmation port and safe interval lifecycle: the runtime now reconciles submitted settlements from PostgreSQL through the RPC receipt guard on a non-overlapping interval with graceful shutdown; durable indexing, retry and notification hooks remain.
- [ ] Add offline-safe retry using API idempotency keys.
- [~] Read `PaymentSettled` events through the generated contract spec and reconcile them against submitted API state only after a matching RPC receipt; cursor persistence and runtime wiring are in place behind `WORKER_EVENT_START_LEDGER`, while durable event indexing remains.
- [x] Add an RPC confirmation guard that accepts only `SUCCESS` with a valid ledger and rejects failed, missing or malformed receipts.
- [x] Add developer settings for network, contract ID and RPC status; the screen also switches settlement mode, shows the relayer and merchant registration state, and manages the demo wallet.
- [ ] Add metrics for created, authorized, confirmed and failed payments plus median confirmation time.
- [~] Add tests for wrong contract/network, fake merchant, relayer alteration, polling failure and offline retry; RPC/event cursor and receipt mismatch paths are covered, while offline API retry remains.
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
  `ANDROID_HOME=/Users/ege/Library/Android/sdk`, `adb reverse tcp:8081 tcp:8081`
  and `adb reverse tcp:4100 tcp:4100` for the API.
- iOS: iPhone 17 Pro Simulator (iOS 26.2), launched with
  `npx react-native run-ios --simulator 'iPhone 17 Pro'` from `apps/mobile`. The
  simulator shares the host network, so the app reaches the API on `127.0.0.1`.
- Driving the iOS simulator from a script needs `idb` or Accessibility
  permission for the terminal; neither is set up here, so iOS is verified by
  build, install, launch and render, and the settlement path is verified on
  Android plus the Node proof script.
- The demo path has no database or API dependency: mobile settlement stays in
  `mock` mode, `createApiRuntime` keeps in-memory storage while `DATABASE_URL` is
  unset, and the worker logs `worker_idle` and exits instead of looping.
- Mock receipts carry `settlementMode: 'mock'`, are shown as `DEMO ONLY` with a
  `demo:` reference instead of a hash, and expose no explorer link.
- Merchant requests are signed on-device with a demo Ed25519 key because React
  Native ships no CSPRNG and the native signer is not implemented yet. The
  insecure randomness fallback is logged and refused outside mock mode.

## Next Execution Order

1. Implement the native iOS and Android signer adapters (including a real CSPRNG) and replace the development merchant and customer keys.
2. Add the NFC transport for RTP/1 so the merchant signature round trip works across two devices.
3. Issue authenticated passkey sessions, then extend capability checks to every mutating endpoint.
4. Add real camera QR capture, rate limits and payment metrics.
