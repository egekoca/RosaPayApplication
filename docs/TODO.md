# Lumenade Pay Delivery Backlog

This backlog is derived from `docs/PRD.md` and reflects the repository state on 2026-08-25.

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

- [x] Replace the legacy blue-gray/rose palette with the black, lemon-yellow and white Lumenade system; add an animated lemon/XLM mark for hydration, unlock, camera startup and final-status settlement waiting.
- [x] Add the React Native shell, navigation, design system, English copy and error boundary; motion primitives are React Native ports of React Bits components, screen transitions run on the native stack, and the home balance is the wallet's real on-chain balance rather than a fixture.
- [x] Add Zustand capability/mode state, TanStack Query and structured redacted logging boundaries, with the session persisted in encrypted device storage.
- [x] Add a runtime-validated mobile API client with stable error handling.
- [~] Keep API intent creation/get and in-memory idempotency for local development.
- [~] Add authenticated passkey session start/complete and `GET /v1/me`; the API now has a fail-closed auth resolver boundary and request IDs, while passkey session issuance remains.
- [~] Enforce capability and resource ownership on every mutating endpoint; merchant intent creation now checks the authenticated merchant capability and owned profile when auth is required.
- [x] Add PostgreSQL migrations and a durable repository adapter; `packages/postgres` wraps a transaction-capable `pg` pool, `createApiRuntime` selects it from `DATABASE_URL` (and refuses memory when `API_REQUIRE_DATABASE=true`), and `npm run db:migrate` applies checksum-guarded migrations.
- [x] Complete the PRD data model: merchant keys (`002`), authorization records (`003`), device wallets (`004`) and audit events (`005`) all persist, with the audit trail refusing to store anything that names a secret.
- [x] Add merchant profile create/get endpoints and receiving-address verification; creation is idempotent, checks the Stellar receiving address and signing key, and reads are ownership-guarded.
- [x] Add authorization, submission, payment status and activity endpoints; authorize/submit record the payment, settlement and authorization are readable, `/history` returns a payment's audit trail and merchant profiles list their payments.
- [~] Add read-only settlement status and a domain-guarded in-memory state service; authenticated mutation and durable persistence remain pending.
- [x] Add rate limits, request correlation IDs and relayer-safe structured logs; the endpoints that spend funds are rate limited per caller, every response carries a validated `x-request-id`, and the logger redacts authorization/signature fields.

## P1 - Customer and Merchant Flows

- [x] QR encode/decode, signature validation, confirmation and local receipt flow now run on merchant-created, merchant-signed requests instead of fixtures.
- [x] Integrate a real camera QR scanner with size limits and malformed-payload recovery; the customer screen runs the device camera, the decoder refuses anything over 4 kB and reports a corrupted scan as a retry rather than a parser error, and permission is asked with the platform's own API because the camera library's Android request never settles.
- [x] Show full/copyable recipient details, non-native issuer, live expiry and verification state on confirmation; approval is blocked when the signature fails or the request has expired against the live ledger.
- [~] Track pending, confirmed and failed settlement states without false success; the settlement stepper reports Prepare/Authorize/Submit/Confirm, the submitted hash is shown before confirmation, demo settlements are labelled `DEMO ONLY`, and every failure maps to a specific message. Cross-device status still needs the API endpoints.
- [~] Include ledger, confirmation timestamp and a validated transaction hash in receipts; the Testnet path now records ledger and confirmation time, while hash re-validation against RPC remains.
- [x] Implement Merchant Profile onboarding instead of the current capability toggle; the business name and receiving address are verified before a profile exists.
- [x] Create and sign payment intents from merchant data rather than a fixture; amounts are canonicalized, expiry comes from the live ledger and the customer verifies the merchant signature.
- [x] Add merchant request status and receipt lookup; the request screen polls the API settlement, and the merchant home lists every request that merchant made with its outcome.
- [x] Persist local session and pending payment recovery across app restarts; the merchant profile, demo wallet, open request and receipts survive a restart in the platform's encrypted store, and a returning user skips onboarding.

## P2 - Reliability and Evidence

- [x] Publish a responsive product website at `https://lumenade-pay.vercel.app` with mobile-source links and independently inspectable Testnet contract, transaction and manifest evidence.
- [~] Implement the worker confirmation port and safe interval lifecycle: the runtime reconciles submitted settlements through the RPC receipt guard and closes out requests whose expiry ledger has passed, on a non-overlapping interval with graceful shutdown; durable indexing, retry and notification hooks remain.
- [x] Add offline-safe retry using API idempotency keys; a dropped connection, a timeout, a 5xx or a 429 is tried again with backoff, every retried call is idempotent on the server, and the two that spend funds — wallet provisioning and on-chain merchant registration — are deliberately left alone.
- [~] Read `PaymentSettled` events through the generated contract spec and reconcile them against submitted API state only after a matching RPC receipt; cursor persistence and runtime wiring are in place behind `WORKER_EVENT_START_LEDGER`, while durable event indexing remains.
- [x] Add an RPC confirmation guard that accepts only `SUCCESS` with a valid ledger and rejects failed, missing or malformed receipts.
- [x] Add developer settings for network, contract ID and RPC status; the screen also switches settlement mode, shows the relayer and merchant registration state, and manages the demo wallet.
- [x] Add metrics for created, authorized, confirmed and failed payments plus median confirmation time; `GET /v1/metrics` counts settlements by outcome and reports the median from two server-observed timestamps, excluding rows that appear to have confirmed before they were requested.
- [~] Add tests for wrong contract/network, fake merchant, relayer alteration, polling failure and offline retry; RPC/event cursor and receipt mismatch paths are covered, while offline API retry remains.
- [ ] Add static analysis, secret scanning and an independent contract review gate.

## P3 - Deferred Product Scope

- [x] Add a provider-independent SEP-1/10/24/45 anchor client with fail-closed challenge, network, URL-origin, live-expiry, signer-mutation, simulation-footprint and transaction-status validation.
- [x] Add Testnet XLM **Add money** and **Withdraw** wallet entry points using the smart wallet's C-account, an in-app system browser, encrypted pending-session recovery and resumable SEP-24 polling.
- [~] Prove testanchor live: `npm run testnet:anchor` opened a genuine SEP-10 session, started native-XLM SEP-24 deposit `00b77ef6-0a20-4d45-8f8b-faa8866f519e`, and read `incomplete`; a physical-device SEP-45/browser completion remains.
- [ ] Authorize and submit the smart-wallet payment requested by a SEP-24 withdrawal at `pending_user_transfer_start`; initiation/status are implemented but the asset transfer must not be implied.
- [!] Connect MoneyGram Ramps sandbox after provider allowlisting and a published Lumenade Pay domain are available.
- [!] Verify a Testnet USDC issuer/SAC and decimal policy before enabling USDC (PRD 22.2).
- [ ] Add USDC trustline onboarding only after the asset decision is recorded.
- [x] Implement Android NFC HCE as an optional transport over the same RTP/1 flow; a merchant publishes the request it is already showing as a QR, a customer reads it in reader mode, and a paid or expired request stops being offered.
- [x] Keep QR visible as the iOS and unsupported-device fallback; NFC is additive on both screens and iOS reports it unavailable rather than degrading.
- [ ] Record 100+ successful Testnet settlements and publish anonymized demo metrics.
- [ ] Prepare the architecture diagram, three-minute demo script and failure-path demo.

## Interface review

- Every control on screen does something: the receipt and wallet addresses share
  through the platform sheet, activity filters by all/on-chain/demo, and "View
  all" opens the activity tab. React Native has no clipboard in core, so sharing
  stands in for copying and long-press selection remains available.
- The wallet screen shows the device's real smart wallet, its balance and whether
  a hardware key exists, instead of a fixed address and an unconditional claim
  that a passkey signer is present.
- A merchant request shows its payment outcome once it has one; the expiry window
  is only reported while a request is still waiting for a customer.

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

## Paying between two devices

A customer's phone does not hold the merchant's signing key, and the settlement
contract needs a merchant signature naming the payer. The two devices now meet
through the API: the customer claims a request, the merchant's device signs for
that exact customer, and the customer collects the signature and pays.

Proven on Testnet by `npm run testnet:two-device`, which plays both sides with
the merchant's signing secret confined to the merchant half: tx
`3b4e4267…` at ledger 4312773.

The protocol can now also authorize without a network: the merchant prepares the
authorization entry, the customer verifies it against the intent on screen and
signs it locally, and the merchant submits. Proven on Testnet by
`npm run testnet:offline` — the customer's half runs with `fetch` taken away, so
offline is enforced rather than asserted. Wallet
`CCAATSIE…` paid 0.4 XLM without connecting, tx `89022bee…` at ledger 4313141.

Still open on this path:

- The mobile app still orchestrates from the customer's side, so the app itself
  is not yet the airplane-mode demo; the capability exists and is unwired.
- Carrying the exchange over NFC needs a stateful APDU session: intent out,
  customer address back, authorization request out, signature back.

## Getting in

Lumenade Pay is non-custodial, so there is no server account for an email and
password to unlock. The device key is the account. Onboarding says that plainly
instead of offering wallet vocabulary a customer has no reason to know:

- One way in. The old screen offered "Create your wallet" and "Sign in with
  passkey" side by side; both called the same function and neither told anyone
  which was theirs.
- Setting up asks for a name — what a merchant sees on a receipt — and an
  optional email for sending one. The screen says the email is not a login,
  because it is not.
- Returning asks the device. The hardware key signs a fresh random challenge and
  the app verifies it, so unlocking is the same guarantee that protects a
  payment rather than a decorative prompt.
- Locking stands in for the whole app rather than covering it, so no balance,
  receipt or open request is mounted while it is locked.
- A session locks again after a minute in the background. Zero would be safest
  and unusable; a minute covers stepping out to read a message without covering
  someone picking up a phone left on the counter. Only a real background counts,
  because iOS reports `inactive` for the Face ID prompt itself.
- The account, "Lock now" and sign-out live on the wallet screen. They used to be
  reachable only from the lock screen, which you see only when locked.

## Store readiness

Both stores need the app to declare what it takes and to work without the
laptop. What is in place:

- Android declares `CAMERA`, `USE_BIOMETRIC` and `NFC`, and removes the storage
  permissions the camera library adds for a photo feature Lumenade Pay does not use —
  a payment app asking to read the gallery is a review risk it does not need.
- Camera and NFC are declared `required="false"`, so a phone without either can
  still install and still receive payments.
- iOS carries `NSCameraUsageDescription` and `NSFaceIDUsageDescription`.

What still stands between here and a store build:

- A release build with the JS bundle embedded; the debug build loads from Metro
  and cannot run away from the development machine.
- Signing identities: a Play upload key and an Apple distribution certificate.
- The API, worker and database must run somewhere other than the laptop before
  Testnet mode works for anyone else (`docs/deployment.md`).
- Privacy declarations: Apple's nutrition label and Play's Data Safety form.

## Next Execution Order

1. Verify the NFC transport across two physical Android devices.
2. Issue authenticated passkey sessions, then extend capability checks to every mutating endpoint.
3. Produce signed release builds for both stores and deploy the API.
4. Record 100+ successful Testnet settlements and publish anonymized demo metrics.
