# Rosa Pay Delivery Backlog

This backlog is derived from `docs/PRD.md` and reflects the repository state on 2026-09-16.

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
- [x] Route the mobile confirmation screen through an explicit adapter; Testnet mode settles for real through the relayer (evidence: tx `e8a4ecfeb4d5a1439c54e9589122e37f91df9d12c0d9da4753b140716d82dcd5`, ledger 4283738).
- [x] Allow both `settle_payment` and `settle_payment_with_swap` through the hosted relayer and cover the swap entry point with an HTTP API test.

## P0 - Wallet and Authorization

- [x] Keep signing behind the `SecureSigner` TypeScript port with no private key exposed to JavaScript; a Testnet payment is now authorized by the Keystore key and paid from the smart wallet (tx `9417138c…`, ledger 4295728).
- [x] Complete the iOS/Android passkey smart-wallet feasibility decision and record the selected account model in ADR 0001 (PRD 22.1); the account is now implemented as `contracts/wallet` and deployed to Testnet.
- [x] Define the generated-client settlement pipeline boundary for simulation, customer auth-entry signing, relayer submission and final confirmation; the relayer is now the transaction source and fee payer, verified on-chain by `npm run testnet:relayed`.
- [x] Add a fail-closed signed-intent settlement service that keeps RTP/1 and contract-digest signatures separate.
- [x] Define first-release recovery and signer rotation requirements in ADR 0002 (PRD 22.5); the wallet enforces them, with the recovery key scoped to rotation only.
- [~] Implement native iOS signer storage and user-presence authorization; the Secure Enclave module is implemented as a local pod and builds, while on-device verification remains.
- [x] Implement native Android signer storage and user-presence authorization; a Keystore secp256r1 key signs only behind a device-credential prompt, verified on the Pixel 9 emulator against the exported public key.
- [x] Register fail-closed `RosaPaySigner` modules on iOS and Android; both now generate a hardware secp256r1 key and sign a digest behind a user-presence prompt.
- [x] Implement wallet creation/restoration and recoverable failure states; the app provisions a device-controlled smart wallet, restores it with the session, reuses the hardware key after a failed provisioning attempt, and never creates a partial account.
- [x] Delete the native iOS/Android device identity on sign-out and keep the account intact when secure deletion fails.
- [~] Add device tests for cancellation, biometric failure and process death during authorization; developer settings run a real signature self-test and every failure maps to a typed signer error, while scripted cancellation and process-death cases remain.
- [x] Give the iOS app a Keychain entitlement. It had no entitlements file at all, so every Keychain call failed with `errSecMissingEntitlement` — the session could not be written or read and no wallet key could be stored, which meant the iOS build forgot everything on relaunch and could not hold a wallet.
- [ ] Drive the full iOS flow (create wallet, add lira, cash out) on a simulator or device. The Keychain fix is verified — the session persists and the errors are gone — but the screens after it have only been walked as far as the recovery-phrase check, because the simulator has no scriptable tap.
- [x] Give the wallet a passkey signer, so an account is not bound to one handset. The contract now records how each key is held and checks it by those rules only — a device key signs the payload, a passkey signs `authenticatorData ‖ SHA-256(clientDataJSON)` and has to prove the challenge inside it is this transaction. The WebAuthn verifier is adapted from OpenZeppelin's audited Stellar implementation. Proven on Testnet by `npm run testnet:passkey` (7/7), including four refusals: another payload, a registration ceremony, an unverified assertion, and a device signature offered for a passkey.
- [x] Make a lost phone survivable. Wallets are provisioned with a recovery passkey, the API records which wallet a credential recovers, and `rotate` swaps the lost signer for the new phone's. `npm run testnet:recovery` proves all five steps on-chain, including that the lost key can no longer authorize and that the recovery passkey still cannot spend. This retires the single-device limitation in ADR 0002; see [passkeys.md](passkeys.md).
- [x] Give recovery a screen. **I lost my phone** on the welcome screen finds the wallet from the synced passkey (`POST /v1/wallets/recover` answers with the contract address and the signer to retire, both already public on the ledger), then rotates this phone's new Secure Enclave key in. The API records which wallet a credential recovers, and sign-out now clears the bridge key too.
- [ ] Add the time-delayed rotation and second recovery factor ADR 0002 requires for production. Today a stolen recovery credential can rotate a signer to itself in one step and then spend, which is the remaining gap between this and a production custody model.
- [ ] Fill in the two domain-association values passkeys cannot work without: the Apple Team ID in `apps/web/.well-known/apple-app-site-association` and the Android signing-certificate SHA-256 in `assetlinks.json`. Only the project owner can supply them, and without them both platforms refuse the prompt before the customer sees anything.
- [ ] Validate the native passkey modules on physical iOS and Android devices. Both compile (`xcodebuild`, `compileDebugKotlin`) and the contract and parsing halves are proven without a phone, but a simulator has no real passkey.

## P1 - Application and API Foundation

- [x] Replace the legacy blue-gray/rose palette with the black, amber and white Rosa system; add an animated rose mark for hydration, unlock, camera startup and final-status settlement waiting.
- [x] Add the React Native shell, navigation, design system, English copy and error boundary; motion primitives are React Native ports of React Bits components, screen transitions run on the native stack, and the home balance is the wallet's real on-chain balance rather than a fixture.
- [x] Add Zustand capability/mode state, TanStack Query and structured redacted logging boundaries, with the session persisted in encrypted device storage.
- [x] Add a runtime-validated mobile API client with stable error handling.
- [x] Keep API intent creation/get idempotent in memory and PostgreSQL, with atomic initial settlement creation.
- [x] Add authenticated device challenge/session issuance: single-use five-minute challenges prove possession of the wallet's P-256 key and issue 15-minute bearer sessions stored in the platform Keychain-backed state.
- [x] Enforce capability and resource ownership on every mutating endpoint; capabilities and wallet ownership are resolved from repositories for every request rather than accepted from token roles.
- [ ] Add `GET /v1/me` plus explicit server-side session revocation; current HMAC sessions expire after 15 minutes but cannot be revoked before expiry.
- [x] Add PostgreSQL migrations and a durable repository adapter; `packages/postgres` wraps a transaction-capable `pg` pool, `createApiRuntime` selects it from `DATABASE_URL` (and refuses memory when `API_REQUIRE_DATABASE=true`), and `npm run db:migrate` applies checksum-guarded migrations.
- [x] Complete the PRD data model: merchant keys (`002`), authorization records (`003`), device wallets (`004`) and audit events (`005`) all persist, with the audit trail refusing to store anything that names a secret.
- [x] Add merchant profile create/get endpoints and receiving-address verification; creation is idempotent, checks the Stellar receiving address and signing key, and reads are ownership-guarded.
- [x] Add authorization, submission, payment status and activity endpoints; authorize/submit record the payment, settlement and authorization are readable, `/history` returns a payment's audit trail and merchant profiles list their payments.
- [x] Add authenticated settlement mutation and read routes backed by domain-guarded in-memory/PostgreSQL state; PostgreSQL updates use compare-and-set status conditions to reject concurrent overwrites.
- [x] Add rate limits, request correlation IDs and relayer-safe structured logs; the endpoints that spend funds are rate limited per caller, every response carries a validated `x-request-id`, and the logger redacts authorization/signature fields.

## P1 - Customer and Merchant Flows

- [x] QR encode/decode, signature validation, confirmation and local receipt flow now run on merchant-created, merchant-signed requests instead of fixtures.
- [x] Integrate a real camera QR scanner with size limits and malformed-payload recovery; the customer screen runs the device camera, the decoder refuses anything over 4 kB and reports a corrupted scan as a retry rather than a parser error, and permission is asked with the platform's own API because the camera library's Android request never settles.
- [x] Distinguish iOS camera permission states (`authorized`, `denied`, `not determined`) so a fresh install presents the system prompt; camera startup failures can be retried and are no longer misreported as a missing camera.
- [x] Show full/copyable recipient details, non-native issuer, live expiry and verification state on confirmation; approval is blocked when the signature fails or the request has expired against the live ledger.
- [x] Track pending, confirmed and failed settlement states without false success; the settlement stepper reports Prepare/Authorize/Submit/Confirm, cross-device status comes from the API, demo settlements are labelled `DEMO ONLY`, and every failure maps to a specific message.
- [x] Include ledger, confirmation timestamp and a validated transaction hash in receipts; only an RPC `SUCCESS` result with a final ledger may confirm a Testnet payment.
- [x] Implement Merchant Profile onboarding instead of the current capability toggle; the business name and receiving address are verified before a profile exists.
- [x] Create and sign payment intents from merchant data rather than a fixture; amounts are canonicalized, expiry comes from the live ledger and the customer verifies the merchant signature.
- [x] Bound merchant QR lifetime to 60 ledgers (about five minutes) and reject longer caller-supplied lifetimes.
- [x] Recheck the 60-ledger policy against the live Stellar ledger in the production API before persisting an intent; expired, long-lived, wrong-network and RPC-unavailable requests fail closed, with API tests for the boundary.
- [x] Add merchant request status and receipt lookup; the request screen polls the API settlement, and the merchant home lists every request that merchant made with its outcome.
- [x] Persist local session and pending payment recovery across app restarts; the merchant profile, demo wallet, open request and receipts survive a restart in the platform's encrypted store, and a returning user skips onboarding.
- [x] Add transport-aware activity records and a Dashboard bottom tab; confirmed QR/NFC payment totals are separated, and completed TRY deposits and USDC withdrawals are retained for the money-movement summary. Merchant totals use the authenticated payment list when available.
- [x] Let a merchant price in the money on their menu: a request named in lira carries the converted asset amount, the `500.00 TRY` label travels in the signed reference, and both the customer's card and the merchant's read in lira. Verified on Android — 500 TRY became 55.7413601 XLM at 8.97 TRY/XLM.
- [x] Read lira rates from a real anchor: `tr-mock-anchor.fly.dev` quotes TRY against the USDC issuer this app already settles in, unauthenticated, on Testnet. Fixed a SEP-38 price-direction bug it exposed — the standard quotes sold-per-bought, this app read it bought-per-sold, and both sides being wrong the same way hid it until a real anchor priced a 500 TRY coffee at 24,095 USDC.
- [x] Add the anchor's TRY on-ramp (SEP-10 + SEP-38 + SEP-6), reachable from the home screen. Verified on Android end to end: 500 TRY arrived as 10.27 USDC at 48.67 TRY/USDC.
- [x] Make every new account one the anchor can verify. Setup no longer offers a custody choice: a smart wallet cannot answer a SEP-10 challenge, so offering one would be a trap that springs at the bank transfer. Phones that already hold one keep working.
- [x] Add the TRY off-ramp (SEP-6 withdraw-exchange) on the same screen as the on-ramp. Verified on Android: 10.27 USDC was paid out as 495.12 TRY to an IBAN. The wallet sends the USDC itself with the anchor's memo, and waits for Stellar to confirm before reporting anything.
- [x] Record the lira rail's own evidence file, the way every other proof does. `npm run testnet:try-ramp` now writes `config/testnet-try-ramp-evidence.json`; the anchor leg was the most heavily weighted claim and the only one with nothing under `config/` behind it.
- [x] Let a smart-wallet account use the lira rail. It is fronted by a bridge: a classic account that answers SEP-10, receives the deposit and pays the anchor, and holds nothing between transfers. Three live tests decided the shape — the anchor refuses a contract address on every SEP-6 door, a Soroban transaction cannot carry a memo, and a SAC transfer reaches Horizon as `invoke_host_function` rather than as a payment even when sent to a muxed address. `npm run testnet:bridge` proves both legs (9/9): 300 TRY in and 148.50 TRY back out, with the bridge empty at both ends. A deposit is not settled while the money is still on the bridge.
- [ ] Replace this deployment's own SEP-38 server for lumens when an anchor prices them. Surveying every domain in the Stellar Anchor Directory found two publishing an `ANCHOR_QUOTE_SERVER`, both the same operator, both pricing only `iso4217:BRL`; `testanchor.stellar.org` offers USD and CAD and its `/prices` has been answering 502. Until then rates come from a public market feed and the screens say so.
- [x] Offer both custody models at onboarding and let the account choose: a secure-hardware smart wallet, or a SEP-0005 recovery-phrase account that can also be imported from another wallet. Settlement, balances and merchant setup all follow whichever account the phone holds, since a contract account authorizes the whole entry and a classic one signs the hashed preimage.
- [x] Stop `Get paid` reading as a second account: both views show the same wallet balance, takings are labelled as takings, and business setup no longer asks for an address the app already knows.
- [x] Keep the Get paid action visible beside Scan to pay, including for an existing merchant profile, and switch directly into merchant mode from that action.
- [x] Keep held assets visible when fiat valuation is unavailable; NGN/EUR display rates fall back to a public indicative market feed while the hosted SEP-38 deployment is being redeployed.
- [x] Convert on the customer's behalf when they hold the wrong asset. It is inside the settlement, not before it: `settle_payment_with_swap` calls Soroswap's router for the exact amount the merchant signed for and pays them in the same transaction, so either they get exactly that or nothing moved. The funding path, ceiling and deadline are the customer's and are outside the merchant's signature, so no route can change who is paid or how much. Verified on Testnet — a smart wallet holding no USDC paid a 0.10 USDC request for 0.9465832 XLM (tx `b4a0cc9b…`, ledger 4,540,761); see [swap-funding.md](swap-funding.md).

- [ ] Route a funding swap through more than one hop. The contract and the client both accept a longer path, but nothing selects one: Soroswap's aggregator API is the right way to pick it, and a single XLM/USDC pool is enough for the pair this deployment settles.

- [x] Make the app usable by more than one person at once. Rate limits were counted by network address, so a room behind one router looked like a single caller: the relayer allowed thirty payments a minute *for everyone*, and the fourth phone to install could not create a wallet for an hour. They are counted per device now, with a looser address-wide ceiling behind them, and `apps/api/test/rateLimit.test.ts` fails without the change. The API address comes from the deployment manifest rather than a loopback default, so a TestFlight build reaches something. The lira bridge is funded from the wallet rather than Friendbot, which throttles by address.
- [x] Publish the API and put its HTTPS address in `config/testnet-deployment.json` as `apiBaseUrl`. Render serves the API over HTTPS and the health check verifies the Supabase connection before reporting ready.

## P2 - Reliability and Evidence

- [x] Bring the website up to what the product does. It now carries the custody story the app is actually built on — a key the phone cannot give away, a passkey that carries the wallet to a new phone, and a contract that lets that passkey rescue but never spend — with the rotation transaction linked on-chain beside it. The anchor tiles name SEP-6 and SEP-10, which is what the lira rail really speaks, rather than SEP-24 and SEP-45, which it does not.
- [x] Publish a responsive product website at `https://rosa-pay-app.vercel.app` with mobile-source links and independently inspectable Testnet contract, transaction and manifest evidence.
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
- [x] Add the minimal SEP-12 customer-information client and an in-memory mock-anchor demo (`NEEDS_INFO` -> `ACCEPTED`) without retaining identity values.
- [x] Add Testnet XLM **Add money** and **Withdraw** wallet entry points using the smart wallet's C-account, an in-app system browser, encrypted pending-session recovery and resumable SEP-24 polling.
- [~] Prove testanchor live: `npm run testnet:anchor` opened a genuine SEP-10 session, started native-XLM SEP-24 deposit `00b77ef6-0a20-4d45-8f8b-faa8866f519e`, and read `incomplete`; a physical-device SEP-45/browser completion remains.
- [ ] Authorize and submit the smart-wallet payment requested by a SEP-24 withdrawal at `pending_user_transfer_start`; initiation/status are implemented but the asset transfer must not be implied.
- [!] Connect MoneyGram Ramps sandbox after provider allowlisting and a published Rosa Pay domain are available.
- [!] Verify a Testnet USDC issuer/SAC and decimal policy before enabling USDC (PRD 22.2).
- [ ] Add USDC trustline onboarding only after the asset decision is recorded.
- [x] Implement Android NFC HCE over the same RTP/1 payload; Android listens on normal customer routes while Rosa Pay is foregrounded, a verified tap starts one device-authorization attempt, the merchant HCE service requires unlock, and expired/closed requests stop being shown or broadcast.
- [x] Gate merchant QR visibility on successful API publication, verify the API returned the same signature and intent, and surface publish/HCE failures with retries while retaining QR as the fallback.
- [x] Fail closed on NFC settlement when the live ledger or funding check is unavailable; a failed automatic attempt requires a deliberate retry.
- [x] Keep QR visible as the universal path on both platforms; NFC is additive and a device that cannot use it reports so rather than degrading.
- [x] Read a tap on iOS with CoreNFC after the customer starts the reader from Scan, so an iPhone customer can pay an Android merchant. The same AID and ISO 7816-4 chunked exchange is used; the reverse stays impossible because iOS grants no third-party card emulation.
- [x] Let an honest tap survive the things that are not the payment's fault: a reader bounds lifetime at 72 ledgers rather than 60, because the merchant, API and customer each poll their own RPC; the Android merchant keeps emulating the card when a phone refuses `setPreferredService`, since Rosa Pay's proprietary AID already routes to it; and the customer's confirmation screen no longer blocks on each five-second background ledger refetch.
- [x] Make foreground NFC lifecycle resilient: refresh the live ledger on an early tap, re-arm one-shot iOS sessions after cancellation/error, keep the global listener out of Scan/Confirm/merchant routes so native readers never compete, and keep it armed on every Main tab while the app is open.
- [ ] Record 100+ successful Testnet settlements and publish anonymized demo metrics.
- [x] Draw the architecture. Four Mermaid diagrams in [architecture-diagrams.md](architecture-diagrams.md) — the three-signature separation, where the keys live and why there are three, the lira rails through the bridge, and what runs where — each checked through a real Mermaid parser rather than eyeballed. The submission also asks which skill files were used; that record is [skills-used.md](skills-used.md), including the four things skills could not answer.
- [ ] Write the three-minute demo script and the failure-path demo.

## Interface review

- [x] Open Pay on each launch and keep the same persisted wallet/profile across Pay and Get paid.
- [x] Remove customer email collection; require business name and email only when activating Get paid, with mobile/API validation and PostgreSQL migration `010_merchant_email.sql`. Legacy profiles complete email without replacing their signer.
- [x] Bind new mobile merchant profiles to the current wallet; remove alternate recipient entry.
- [ ] Add merchant photo, location/map and PDF invoices in a later scope.

- [x] Keep a single mounted balance card directly below the home header on both
  platforms. Pay/Get paid changes only the content below the card; currency
  selection and the card's interaction state survive the mode change.

- Every control on screen does something: the receipt and wallet addresses share
  through the platform sheet, activity filters by all/on-chain/demo, and "View
  all" opens the activity tab. React Native has no clipboard in core, so sharing
  stands in for copying and long-press selection remains available.
- Pay and Get paid now share one workspace and the same device-controlled smart wallet; the switch changes the current task, not the account or signing key. The premium gold card
  treatment and an animated mode change. Merchant setup returns to that
  workspace after registration, where the next action is to create or reopen a
  payment request.
- The mobile UI uses platform-native premium font families, a shared gold
  material surface, screen entrance transitions and animated loading feedback.
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
- The Testnet settlement path requires the API, relayer and deployed contract;
  an unavailable dependency is reported as failure rather than a local success.
- The SEP-12 mock is intentionally local and does not create settlement receipts.
- Merchant RTP/1 requests use a separate on-device Ed25519 key generated from
  the platform CSPRNG. The customer payment key remains non-exportable in native
  secure storage, and insecure randomness is refused outside the explicit test
  harness.

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

## One screen

Paying and looking back at what you paid is the whole job a customer has, so
both live on one screen and the tab bar is gone. A bar promising Home, Activity
and Wallet was three doors into the same room.

The balance is a card rather than a dashboard panel. People already know what a
payment card tells them — whose it is, what is on it, and its number along the
bottom — so the balance needs no label and the contract address stops reading as
a technical field.

Everything else on that screen is one row: scan to pay, the payments below it,
and a quiet line to add merchant tools. The network no longer gets its own row,
because the card already says which network it is on.

## Getting in

Rosa Pay is non-custodial, so there is no server account for an email and
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
  permissions the camera library adds for a photo feature Rosa Pay does not use —
  a payment app asking to read the gallery is a review risk it does not need.
- Camera and NFC are declared `required="false"`, so a phone without either can
  still install and still receive payments.
- iOS carries `NSCameraUsageDescription` and `NSFaceIDUsageDescription`.

What still stands between here and a store build:

- A release build with the JS bundle embedded; the debug build loads from Metro
  and cannot run away from the development machine.
- Signing identities: a Play upload key and an Apple distribution certificate.
- [x] Add a containerized API/worker deployment path and Render blueprint; the
  remaining step is entering provider secrets and a durable PostgreSQL URL in
  the hosting dashboards (`docs/deployment.md`).
- Privacy declarations: Apple's nutrition label and Play's Data Safety form.

## Next Execution Order

1. Validate P-256 signing, key deletion, QR and NFC across physical iOS/Android devices.
2. Add revocable API sessions and a shared production rate-limit store.
3. Produce signed release builds for both stores and deploy the API/worker/PostgreSQL stack.
4. Record 100+ successful Testnet settlements and publish anonymized demo metrics.
