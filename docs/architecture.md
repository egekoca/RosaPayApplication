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
- `packages/postgres`: the driver-neutral PostgreSQL port plus the pooled, transaction-capable adapter shared by the API and the worker.
- `packages/secure-signer`: the only signing port exposed to TypeScript. The first implementation is an injected bridge; production adapters will be Swift/Kotlin backed.
- `packages/ui`: platform-neutral design tokens and small presentational components.
- `apps/mobile`: navigation, screen orchestration, runtime-validated API/query boundaries, capability switching and the mocked QR vertical slice.
- `apps/api`: Fastify transport, request validation, idempotency and repository ports.
- `apps/worker`: background RPC health, submitted-settlement confirmation and contract-event reconciliation boundary. Event data is treated as an audit/recovery signal and must match the submitted transaction plus an RPC `SUCCESS` receipt before state changes; cursor persistence is exposed as a port with a PostgreSQL adapter and a scheduled runtime, while durable event indexing, retries and notifications remain later phases.
- `contracts/settlement`: Soroban settlement policy and on-chain replay protection.

The API settlement record follows the domain state machine: `awaiting_approval`
can become `authorized`, then `submitted`, and only an RPC-verified receipt may
become `confirmed`. The current API exposes a read-only settlement status route;
mutation and persistence will move behind authenticated relayer/worker ports.
`StellarRpcClient.confirmTransaction` is the shared RPC guard for that receipt:
it rejects malformed hashes, `NOT_FOUND`, `FAILED`, and incomplete success
responses rather than allowing submission acceptance to masquerade as payment.

The API repository port supports an atomic intent-plus-initial-settlement write.
The PostgreSQL adapter uses `withTransaction` when the injected driver exposes it;
the in-memory and test adapters retain a deterministic fallback. `packages/postgres`
owns that driver port and wraps a `pg.Pool`, so a unit of work runs on one checked-out
connection with `BEGIN`/`COMMIT`/`ROLLBACK` and a nested call joins the same
transaction instead of opening a second one.

`createApiRuntime` picks the storage for a process: `DATABASE_URL` selects the
pooled PostgreSQL repository, its absence keeps the in-memory default for local
emulators, and `API_REQUIRE_DATABASE=true` refuses to start on memory so a
production deployment can never silently drop settlements. The server closes the
pool on `SIGINT`/`SIGTERM` after Fastify drains. Schema changes are applied by
`npm run db:migrate`, which runs each pending `db/migrations/NNN_name.sql` file in
its own transaction and records a checksum, so an already-applied migration that
was edited fails closed instead of diverging between environments.

API mutation auth is explicit: `API_AUTH_REQUIRED=true` makes the resolver
fail closed, and merchant intent creation requires both the merchant capability
and ownership of the referenced profile. Local emulator mode leaves this boundary
optional until passkey session issuance is wired. Every request also receives a
validated `x-request-id` response header for correlation without logging secrets.

Event pagination follows Stellar RPC's two modes: the first page uses a ledger
range, and later pages use only the returned cursor. The worker persists the
cursor after a page is reconciled, so a failed fetch does not advance the scan.
`PostgresEventCursorStore` provides the durable adapter.

The worker runtime mirrors the API's storage rule. It reports RPC health, and
without `DATABASE_URL` it logs `worker_idle` and exits rather than looping over
state it cannot read. With a database it runs one non-overlapping cycle on
`WORKER_INTERVAL_MS`: submitted settlements are checked against their RPC receipt
first, then a single contract-event page is reconciled once
`WORKER_EVENT_START_LEDGER` is configured. `PostgresSettlementState` performs the
writes the API owns; it re-reads the row, replays the domain transition guard, and
issues a status-conditional `UPDATE`, so a concurrent API write is detected instead
of being overwritten.

## Merchant profiles and request creation

A merchant profile carries the display name, the verified receiving address and
the signing key that publishes RTP/1 requests; `POST /v1/merchant-profiles`
rejects a malformed receiving address or a non-G signing key before any customer
can be shown a request, and reads are ownership-guarded. `createPaymentIntent` in
`@rosapay/protocol` builds the intent from that profile: it canonicalizes the
amount for the asset's precision, derives the expiry from the live ledger, and
takes the identifier, nonce and clock as inputs so the randomness source is an
explicit decision rather than a hidden default.

The mobile merchant flow signs each request with `signMerchantIntent`, and the
customer path re-verifies that signature at scan time and again on the
confirmation screen, where approval is blocked if verification fails or the
request has expired against the live ledger. Until the native signer exists, the
merchant key is a demo Ed25519 key generated on device: React Native ships no
`crypto.getRandomValues`, so the insecure fallback is logged and refused outside
mock mode, and demo receipts are labelled `DEMO ONLY` with no explorer link so a
local demo can never read as an on-chain settlement.

## Relayed settlement and the fee payer boundary

Authorization and submission are deliberately different actors. The settlement
service builds the generated-client transaction with the **relayer** as source
and fee payer, and the customer signs only the Soroban authorization entry for
that exact invocation; `settleSignedPayment` refuses to run when no relayer is
supplied or when the relayer address equals the customer, because that would
collapse "may submit" and "may spend" back into one account.

The API hosts the relayer: `GET /v1/relayer` publishes the address, network and
contract, and `POST /v1/relayer/transactions` adds the fee-payer signature. It
never blind-signs — it parses the envelope and refuses anything that is not a
single `settle_payment` invocation of the configured contract sourced by the
relayer itself. `POST /v1/merchant-profiles/:id/registration` registers a
merchant key with the contract using the admin account, since the contract
rejects requests from unregistered merchants. Both routes report 503 when no
relayer or admin secret is configured, so the emulator demo is unaffected.

The customer's contract-digest signature covers the customer address, so the
merchant can only produce it once the payer is known. On a single device the
merchant profile is present and signs it locally; a request signed by another
device fails closed with `MERCHANT_KEY_UNAVAILABLE` until the second transport
leg (the NFC round trip in the plan) exists.

The app mirrors each settlement into the API as it happens: it publishes the
intent when the merchant creates a request, records the authorizing address once
the customer signs the authorization entry, and records the transaction hash once
the relayer submits it. Reporting is strictly ordered and best effort — the chain
already holds the truth, so a failed report is logged and never fails a payment.
Only the worker's RPC-verified receipt moves a settlement to `confirmed`, which is
why the merchant request screen can poll the API and show a status the customer's
device did not assert on its own.

`scripts/testnet-relayed-settlement.mts` proves the model on-chain: it asserts
that the transaction source and fee account are the relayer, that the customer is
debited the amount and nothing more, and that the recipient receives it.

### Session persistence

The app keeps its session in the platform's encrypted store (iOS Keychain,
Android Keystore-backed storage) rather than plain app storage, because the
session carries the development signer secrets alongside the merchant profile,
demo wallet, open request and receipts. Secrets are byte arrays, so they are
written as hex and restored in place; receipts are capped so a long-lived session
cannot outgrow the store. Reading it back is asynchronous, so the app renders a
splash until hydration finishes and only then decides whether a returning user
sees onboarding or the home screen. Developer settings report whether the session
is actually being saved, so a device where the store is unavailable says so
instead of silently losing the wallet on restart.

### Configuration on device

React Native only populates `process.env.NODE_ENV`, so a build-time variable for
the API address would silently do nothing. The address is a runtime setting
stored with the session instead, which is also what a physical device needs: a
phone cannot reach the development machine on localhost, and pointing it at a
different host must not require a rebuild.

### React Native and the Buffer polyfill

`apps/mobile/src/shared/polyfills.ts` must be the first import in the app entry.
The `buffer` polyfill only re-attaches the Buffer prototype in `slice()`, so its
`subarray()` returns a plain `Uint8Array`, while Node returns a Buffer. js-xdr
reads every XDR string through `subarray().toString('utf8')`; without the
alignment, contract method names decode as comma-separated byte codes and the
generated client is constructed with no callable methods.

## Rosa smart wallet

`contracts/wallet` is the customer's account as a contract. It verifies
secp256r1 signatures in `__check_auth`, which is what a platform key can produce:
Secure Enclave on iOS and the Android Keystore both hold P-256 keys and never
release them, so the account can be controlled by hardware the app cannot export.
Adding or removing a signer is a wallet decision and runs through the same
authorization path, and the wallet refuses to remove its last signer because that
would make it permanently unspendable.

Recovery is a narrower authority, not a second full signer: the recovery key may
authorize `rotate` on the wallet itself and nothing else, enforced by inspecting
the authorization contexts. A recovery key that is asked to approve a payment is
rejected with `RecoveryScopeExceeded`.

`npm run testnet:wallet` proves this on-chain: a device key authorizes a wallet
operation through `__check_auth` while the relayer pays the fee, and the change
is read back from the contract. Signatures must be low-S, which the host enforces
and both the tests and the script normalize for.

## Signing and passkeys

JavaScript never receives a private key. `SecureSigner` accepts an opaque authorization request and returns an opaque signature or a typed error. A production native adapter must keep the key in Secure Enclave/Keychain (iOS) or Android Keystore, require user presence for payment authorization, and expose only public-key metadata to JS.

The platform modules implement exactly one signing operation: `signDigest`
proves user presence and signs an opaque 32-byte digest with a hardware key.
Android generates a secp256r1 key in the Keystore with
`setUserAuthenticationRequired`, so every signature is bound to a fresh
BiometricPrompt; iOS generates the key in the Secure Enclave with a
`.userPresence` access control and falls back to a keychain-held key on the
Simulator, which has no enclave. Neither module knows what a payment is: the
authorization entry, its preimage and the XDR are assembled in JavaScript, which
never sees the key, and `signWalletAuthPayload` converts the platform's DER
signature into the low-S 64-byte form the wallet contract verifies.

Both modules sign the payload bytes directly rather than hashing them again:
Android uses `NONEwithECDSA` with a key that allows the `NONE` digest, and iOS
uses `ecdsaSignatureDigestX962SHA256`, which takes a digest as input. Signing with
`SHA256withECDSA` would hash the authorization payload a second time and produce
a signature the contract can never verify — the device self-test in developer
settings exists to catch exactly that class of mistake, by verifying a real
signature against the exported public key with the same curve math the contract
uses.

The account decision is recorded in [ADR 0001](adr/0001-passkey-account-and-native-signer.md): use a Smart Account Kit/OpenZeppelin context-rule-compatible Soroban account, but keep React Native integration provider-neutral through a native bridge. Browser IndexedDB/WebAuthn storage is not used in React Native. Recovery and signer rotation are intentionally single-device for the Testnet demo and gated for production by [ADR 0002](adr/0002-recovery-and-signer-rotation.md). The bridge exposes Stellar SDK-compatible `signAuthEntry` and `signTransaction` operations so the generated contract client can separate customer auth-entry signing from relayer fee-payer signing. The iOS and Android `RosaPaySigner` modules are now registered fail-closed; they return `UNAVAILABLE` until platform credential storage and user-presence signing are implemented.

### Paying from the smart wallet

`POST /v1/wallets` deploys a customer's wallet with the device key as its only
signer and gives it a starting balance, so the deployer can create the account
but can never spend from it. A device key controls exactly one wallet, which the
API records, so a repeated call returns the existing wallet and funds nothing;
that endpoint and the relayer's signing endpoint are also rate limited, because
they are the two that spend real funds. The app provisions that wallet the first time it
pays, then settles with the wallet as the customer: the hardware key authorizes
the exact invocation and the relayer remains the transaction source and fee payer.

Contract accounts need two things a classic account does not. The generated
client's `signAuthEntry` callback receives a preimage, which only fits an
Ed25519 account, so the wallet supplies the whole `authorizeEntry` step instead.
And because the first simulation never runs `__check_auth`, the signer read it
performs is missing from the footprint; the pipeline therefore simulates again
once the entries are signed, or the ledger rejects the transaction for touching
data outside its footprint.

A contract balance is not indexed by Horizon, so the wallet's XLM is read
through the asset contract; the home screen shows that number and says plainly
when the network could not be reached instead of implying a zero balance. The
wallet itself is created when the device key is created rather than during a
payment, because deploying and funding it takes two Testnet transactions.

Evidence is in `config/testnet-hardware-wallet-evidence.json`: the wallet is
debited the amount and nothing else, the merchant is credited it, and the relayer
pays the fee.

## How a request reaches a customer

A payment request is one signed RTP/1 payload, and the transport is only how it
travels. QR is the universal path: every phone with a camera can read it, and it
is the whole story on iOS, which gives no app the ability to emulate a card. On
Android the same payload is also offered over NFC, so a customer can tap instead
of aiming.

Neither transport is trusted. Whatever arrives — scanned, tapped, or read from
this device's own request — goes through the same check before a customer sees an
approval screen: the payload must decode, the intent must be valid for this
network and unexpired against the live ledger, and the merchant signature must
verify against the key the request names. A hostile QR or a hostile tap can at
worst present a request the customer then declines.

The merchant side keeps the two in step. A request stops being broadcast the
moment it is paid or expires, so what NFC hands out never disagrees with the code
on screen.

## Where state lives

Three places hold state, and they fail independently.

- **Stellar** holds the payments themselves. Settled transactions, the settlement
  contract and the wallets survive everything else being switched off.
- **The API's database** holds orchestration: intents, settlements,
  authorizations, merchant profiles, device wallets and the audit trail. It is
  how a merchant sees a payment made from someone else's phone and how the worker
  knows what to reconcile. Losing it does not lose money; it loses the record of
  what the money was for.
- **The device** holds the session: the hardware key, the smart wallet address,
  the business profile, the open request and past receipts, in the platform's
  encrypted store. It survives a restart and needs no server.

Demo mode deliberately touches only the device — no API, no database, nothing on
chain — so the app can be demonstrated with nothing else running. Testnet mode
publishes the intent and reports each step, which is why the merchant screen can
show a payment that this device did not make.

Health reports whether the API is keeping records or holding them in memory, and
developer settings shows it, because an API started without `DATABASE_URL` loses
everything on restart and a merchant deserves to know that before relying on it.

## What the record keeps

Every mutation appends an audit event: the intent that was created, who
authorized it, the transaction that was submitted, the merchant key that was
registered, the wallet that was provisioned and each settlement the relayer
signed. The table is append-only and holds identifiers and Stellar addresses that
are already public on the ledger; a detail whose name suggests a secret is
dropped before it is written rather than masked afterwards, so a leak cannot
happen through a caller passing the wrong field.

`GET /v1/payment-intents/:id/history` reads a payment's trail, and
`GET /v1/merchant-profiles/:id/payments` lists what a merchant has been asked to
be paid with the outcome of each request. The merchant home reads the second one,
so it reports every request that merchant made rather than only the ones this
device recorded, and says so when the API cannot be reached.

## Interface and motion

`packages/ui` is the platform-neutral design system. Its motion primitives are
React Native ports of React Bits components — `AnimatedContent`, `FadeContent`,
`SplitText`, `AnimatedList`, `CountUp`, `Stepper`, `PressScale` and `Pulse`.
React Bits itself is a React DOM library built on CSS and web animation
libraries, so its components cannot be dropped into React Native; each one here
reimplements the same effect with the `Animated` API and native drivers, which
keeps behaviour identical on iOS and Android without adding a native dependency.
Every primitive renders its plain, un-animated content under test so assertions
and screen readers always see one string.

Screen transitions come from the native stack (`slide_from_right` by default,
`fade` for root swaps, `slide_from_bottom` for the payment review) rather than a
JS animation loop, again so both platforms behave the same.

`Stepper` carries the settlement stages — Prepare, Authorize, Submit, Confirm —
so a payment in flight never looks stalled or finished early, and the transaction
hash appears as soon as Stellar accepts it rather than only after confirmation.

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
